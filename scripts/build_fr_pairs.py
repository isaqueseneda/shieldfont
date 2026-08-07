#!/usr/bin/env python3
#
# ShieldFont — a web font that protects written content from AI scraping.
# Copyright (c) 2026 Isaque Seneda and Gabriel Abrucio.
#
# This file is part of ShieldFont.
#
# ShieldFont is free software: you can redistribute it and/or modify it
# under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# ShieldFont is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public
# License along with this program. If not, see
# <https://www.gnu.org/licenses/>.
"""build_fr_pairs.py — build a FRENCH ShieldFont mapping (fr-v1) from scratch.

The French counterpart of the English v7 pipeline
(`benchmark/data/v7/scripts/build_pairs.py`), rewritten around the two
agreements French enforces and English does not. It emits the same
`pairs_*.json` schema, so `scripts/reseed_mapping.py --pairs <output>`
re-seeds a private French mapping with no code change.

    Lexique 3.83 -> agreement buckets -> vector clusters -> in-bucket
    derangement -> semantic veto -> pairs JSON + flat mapping + audit CSV

WHY FRENCH NEEDS ITS OWN BUCKETS
--------------------------------
The English mapping buckets on POS + WordNet supersense + concreteness +
number, because that is all English agreement requires: any singular noun
can follow "the". A French decoy has to satisfy two more, and missing
either produces text that is not merely wrong but *ungrammatical* — the one
failure this project cannot afford, since the whole thesis is that encoded
text stays fluent enough to read as ordinary prose to a quality filter.
Ungrammatical output is filtered as noise, and a mapping that produces it
protects nothing.

  1. GENDER. `la maison` -> `la livre` if `maison`(f) is paired with a
     masculine noun. Gender is a bucket dimension, not a preference.

  2. ELISION. `le`/`la`/`de`/`je`/`ne`/`se`/`que` all elide before a vowel,
     and `ce`->`cet`, `ma`->`mon`, `beau`->`bel` do the same job, so
     `l'arbre` -> `l'maison` is ungrammatical even with gender and number
     matched. Words are bucketed by whether what precedes them elides.

     h-aspiré is why this cannot be a character test: `héros` takes `le`,
     `héroïne` takes `l'`. Lexique's `phon` column does not mark it — both
     transcribe with an initial vowel — so H_ASPIRE below is a hand list.

WHY LEXIQUE AND NOT A TAGGER
----------------------------
An earlier draft of this script took POS and gender from spaCy
`fr_core_news_md`. It does not work, and the failure is structural rather
than a tuning problem: spaCy is a *contextual* tagger, and a dictionary
build asks it about context-free word forms. Measured on the pool it
produced, the feminine-singular-noun bucket contained `grandis` and
`confesse` (verbs), `contemporaine` (an adjective), `dupuy` (a surname) and
`stargate` (English). Carrier frames make it worse, not better — asked
about `le maison`, the tagger reports Gender=Masc, having taken the
determiner's word for it.

Lexique is a lexicon, so it answers the question actually being asked.
`nbhomogr` and the per-reading frequencies separate `voiture`(NOM, 221) from
`voiture`(VER, 0.47); `dupuy` and `stargate` are simply absent, which
filters proper nouns and English borrowings for free.

NO FUNCTION-WORD PAIRS, DELIBERATELY
------------------------------------
The English pipeline defines FUNCTION_PAIRS (`and`->`or`, `in`->`on`), but
shipped v18-alpha does not use them, and `MAPPINGS.md` says why: 94 of
M15-EN's source keys are stopwords, n-gram gates keep most of their
probability mass in function-word transitions, and M15-EN is consequently
rejected by every fluency gate instrumented in v8. French inherits that
finding rather than re-testing it. It is also why ADV is restricted to
`-ment` forms: that one rule admits `rapidement` and excludes every French
adverb that is really a function word, `pas` and `plus` above all — and
swapping the `pas` out of `ne ... pas` would negate sentences at random.

WHAT THIS DOES NOT DO
---------------------
No concreteness tier (the Bonin norms `ROADMAP.md` names are not
redistributable, and nothing here substitutes for them), no French WordNet
supersense, no antonym curation, and no French NLI or filter benchmarks.
Semantic structure comes from k-means over spaCy vectors, which is a
coarser instrument than the English Numberbatch + WordNet stack. Every pair
is mechanical until a native speaker signs off on the audit CSV.

DATA
----
Lexique 3.83 (New, Pallier, Ferrand & Matos 2001; lexique.org), CC BY-SA
4.0, downloaded on first run and cached in `scripts/lexicon/` — the same
shape as the base-font cache `generate_font.py` keeps in `scripts/fonts/`.
It is NOT vendored into the repository; only the derived mapping is
committed. See NOTICE for attribution.

SETUP
-----
    python3 -m venv .venv && . .venv/bin/activate
    pip install wordfreq spacy
    python -m spacy download fr_core_news_md

USAGE
-----
    python3 scripts/build_fr_pairs.py                  # defaults, seed 42
    python3 scripts/build_fr_pairs.py --seed 7
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import statistics
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEXICON_DIR = ROOT / "scripts" / "lexicon"
LEXIQUE_TSV = LEXICON_DIR / "Lexique383.tsv"
LEXIQUE_URL = "http://www.lexique.org/databases/Lexique383/Lexique383.tsv"

PAIRS_OUT = ROOT / "benchmark" / "data" / "fr" / "pairs_fr_v1_alpha.json"
AUDIT_OUT = ROOT / "benchmark" / "data" / "fr" / "audit_fr_v1_alpha.csv"
FLAT_OUT = ROOT / "scripts" / "frv1alpha_for_font.json"

# ── Config ────────────────────────────────────────────────────────────
SEED = 42

# A form whose dominant part of speech carries less than this share of its
# total frequency is dropped as genuinely ambiguous. `voiture` is 99.8% NOM
# and survives; `confesse` splits between a rare noun and a common verb and
# is resolved to the verb; a form near 50/50 is dropped outright, because
# whichever bucket it goes in it will be wrong half the time it appears.
POS_DOMINANCE = 0.90

# Zipf floor from wordfreq. Lexique includes a long tail of forms no
# contemporary reader would recognise, and a decoy drawn from it announces
# itself. 3.0 is roughly "appears once per million words".
MIN_ZIPF = 3.0

# Rejects near-synonyms. Same value as the English pipeline's COSINE_HIGH,
# though over a different vector space (spaCy fr_core_news_md, not
# Numberbatch), so it is the same number and not the same threshold.
# Retuning it is a reasonable thing for a French owner to do.
COSINE_HIGH = 0.80

# Reject a pair when the target is among the source's K nearest neighbours
# inside its own cluster. Catches near-synonyms that sit under COSINE_HIGH
# in absolute terms but are still the closest thing on offer.
NN_REJECT_K = 10

# Words per semantic cluster. Buckets are subdivided by k-means over spaCy
# vectors before pairing, which is what keeps `chien` from being swapped for
# `gouvernement`: grammatical, but an anomaly any fluency gate scores badly,
# and the English pipeline avoids it with WordNet supersenses that French
# has no equivalent of. The `.cluster` suffix in the English bucket names is
# the same idea.
CLUSTER_TARGET = 40

# Below this a bucket cannot be paired without becoming guessable: with two
# words there is exactly one possible pairing.
MIN_BUCKET_SIZE = 4

# The short tail of French is almost entirely clitics and function words,
# and the encoder splits `l'écriture` at the apostrophe, so an entry for `l`
# would rewrite the elided article of every phrase it touched. The
# content-POS filter already excludes them; this is the belt to its braces.
MIN_WORD_LEN = 3

CONTENT_POS = ("NOM", "ADJ", "VER", "ADV")

# ── Elision ───────────────────────────────────────────────────────────
# `y` is deliberately NOT a vowel here. French y-initial words overwhelmingly
# block elision — `le yaourt`, `le yoga`, `le yen` — so treating them as
# consonants is right far more often than not.
VOWELS = set("aeiouàâäéèêëíîïóôöùúûü")

# Words that BLOCK elision and liaison despite what their first letter
# suggests, so `le`/`la`/`de` stay uncontracted: `le héros`, `le onze`.
#
# Mostly h-aspiré — an initial `h` that blocks (`le hasard`) as against
# h-muet, which does not (`l'heure`, `l'homme`). The distinction is lexical
# rather than phonological: there is no rule, only a list, and it is largely
# Germanic and Old Frankish borrowings. `onze`/`onzième` join them for the
# same behaviour from a different history (`la onzième`, never `l'onzième`).
#
# BOTH directions of error are equally expensive, and an earlier version of
# this comment claimed otherwise — that over-listing merely cost pairing
# choice. That is false. The encoder rewrites the WORD and never the article
# in front of it, so a misclassification breaks agreement either way:
#
#   truly eliding, listed here    `l'héroïne`  -> `l'` + a consonant word
#   truly blocking, left off      `le hasard`  -> `le` + a vowel word
#
# So this list wants to be ACCURATE rather than long, and it wants a native
# pass — `héros` blocks while `héroïne` and `héroïque` do not, which is the
# kind of thing no generalisation catches.
NO_ELISION = frozenset("""
onze onzième
""".split()) | frozenset("""
hache hagard haie haillon haine haïr hall halle halo halte hamac hameau
hamster hanche handicap hangar hanter happer harceler hardi hareng hargne
haricot harnais harpe hasard hâte hausse haut hautain hautement hauteur
havre hennir hérisson hernie héron héros herse hêtre heurter hibou hideux
hiérarchie hisser hocher hockey homard honte honteux hoquet horde hors
hotte houle housse hublot huit hurler hutte
""".split()) | frozenset("""
hack hacker hadj halal hamburger haras harcèlement harem hausser hebdo
hercule hidalgo himalaya hit houille houlette house hun hunter héro
""".split())
# ^ Aspiré, but on a different LEMMA from anything above, so
# blocked_forms() cannot reach them: derivations (`hausse` -> `hausser`,
# `harceler` -> `harcèlement`) and recent borrowings that entered French
# with an aspirated h (`le hacker`, `le hamburger`, `la house`). Every word
# in this block wants a native verdict; the neighbouring `hexagone`,
# `hilarant`, `huître` and `huissier` are h-MUET and deliberately absent.

# Forms that ELIDE despite sharing a lemma with a word above, so
# blocked_forms() must not sweep them up. Lexique lemmatises a feminine noun
# to its masculine (`chienne` -> `chien`), which puts `héroïne` and
# `héroïnes` under the lemma `héros` — and `l'héroïne` elides where `le
# héros` does not. This is the canonical h-aspiré irregularity and it is
# irreducible: it has to be written down in one direction or the other.
H_MUET_OVERRIDE = frozenset("héroïne héroïnes".split())

# Known-answer controls for elision_class, checked on every build. Two bugs
# have already shipped through this one function — the NO_ELISION list not
# propagating to inflected forms (`l'haies`), and lemma propagation then
# over-reaching onto `héroïne` — and neither was visible in the output,
# because a wrong elision class produces a mapping that is internally
# consistent and simply ungrammatical on the page.
ELISION_CONTROLS: tuple[tuple[str, str], ...] = (
    # h-muet — these contract
    ("heure", "elides"), ("homme", "elides"), ("histoire", "elides"),
    ("héroïne", "elides"), ("héroïque", "elides"), ("héroïsme", "elides"),
    ("huître", "elides"), ("huile", "elides"), ("hôpital", "elides"),
    ("hexagone", "elides"),
    # h-aspiré and friends — these do not
    ("héros", "consonant"), ("hasard", "consonant"), ("honte", "consonant"),
    ("hockey", "consonant"), ("huit", "consonant"), ("hameaux", "consonant"),
    ("haies", "consonant"), ("hanches", "consonant"), ("hante", "consonant"),
    ("hauteurs", "consonant"), ("hamburger", "consonant"),
    ("onze", "consonant"), ("onzième", "consonant"),
    # spelling-driven
    ("écriture", "elides"), ("université", "elides"),
    ("yacht", "consonant"), ("maison", "consonant"),
)


def blocked_forms(by_form: dict[str, list[dict]]) -> frozenset[str]:
    """Every INFLECTED form of every NO_ELISION word.

    NO_ELISION is written as base forms, but the mapping is built from
    inflected ones, and listing `haie` protects nothing when the pool holds
    `haies`. Left unpropagated this produced `l'haies`, `l'hurlent` and
    `l'hanches` — 152 h-initial forms were classed as h-muet, most of them
    plurals and conjugations of words already on the list.

    Propagation is by LEMMA, never by shared prefix. Aspiration belongs to
    the stem's onset and so survives inflection, which makes the lemma safe;
    a prefix rule would merge `héros` (aspiré) with `héroïne` (muet) on four
    shared characters, and those two are the reason this list cannot be
    generated in the first place.

    Derivations across lemmas — `hausse`/`hausser`, `harceler`/`harcèlement`
    — are NOT caught here and have to be listed explicitly.
    """
    lemmas = {r["lemme"] for w in NO_ELISION for r in by_form.get(w, [])}
    forms = {w for w, rows in by_form.items()
             if any(r["lemme"] in lemmas for r in rows)}
    return frozenset((NO_ELISION | forms) - H_MUET_OVERRIDE)


def elision_class(word: str, blocked: frozenset[str] = frozenset()) -> str:
    """`elides` when a preceding `le`/`de`/`ne` would contract, else `consonant`.

    A blocked word returns `consonant`, because that is how it behaves:
    `le hasard`, never `l'hasard`.
    """
    if word in H_MUET_OVERRIDE:
        return "elides"
    if word in blocked or word in NO_ELISION:
        return "consonant"
    if word[0] in VOWELS:
        return "elides"
    if word[0] == "h":
        return "elides"
    return "consonant"


# ── Special pairs ─────────────────────────────────────────────────────
# Bidirectional derangements added unconditionally, bypassing the semantic
# veto — they are cohyponyms by construction, which is exactly what the veto
# exists to reject. French calendar terms are lowercase, unlike English;
# the encoder's preserveCase handles a capitalised occurrence either way.

# Shifted six months, but ONLY where the shift keeps the elision class.
# `février`+6 is `août`, and `le mois d'août` -> `le mois d'février` is
# ungrammatical, so both drop out rather than the shift being fudged. Two
# unmapped months is the same shape as the unmapped `dimanche` below.
MONTH_PAIRS = {
    "janvier": "juillet", "juillet": "janvier",
    "mars": "septembre", "septembre": "mars",
    "avril": "octobre", "octobre": "avril",
    "mai": "novembre", "novembre": "mai",
    "juin": "décembre", "décembre": "juin",
}
DAY_PAIRS = {  # dimanche left unmapped: seven is odd, as `sunday` is in English
    "lundi": "jeudi", "jeudi": "lundi",
    "mardi": "vendredi", "vendredi": "mardi",
    "mercredi": "samedi", "samedi": "mercredi",
}
# No TIME_PAIRS. The English pipeline pairs `yesterday`/`tomorrow` and
# `soon`/`eventually`, and every French equivalent crosses an elision class:
# `hier` and `autrefois` contract (`d'hier`), `demain` and `bientôt` do not.
# Pairing within class instead leaves only past-with-past and
# future-with-future, which barely moves the meaning and is not worth the
# entries. French time adverbs want a native pass before they get a table.

# `premier`/`première` inflect for gender and the rest do not, so the two
# inflecting forms are paired into each other's slot. Pairing `première`
# with an invariant ordinal would put `le première` on the page half the
# time it fired.
#
# `huitième` and `onzième` are left out. Both block elision (`la huitième`,
# `la onzième`) while being spelled with a leading vowel or `h`, so
# including them would make the elision invariant impossible to check from
# spelling alone — which is how the encoder-side test in
# `packages/core/test/encode-fr.test.ts` checks it. Two ordinals is a cheap
# price for an invariant that stays mechanically verifiable.
ORDINAL_PAIRS = {
    "premier": "septième", "septième": "premier",
    "première": "douzième", "douzième": "première",
    "deuxième": "neuvième", "neuvième": "deuxième",
    "troisième": "dixième", "dixième": "troisième",
    "quatrième": "sixième", "sixième": "quatrième",
}
NUMBER_WORD_PAIRS = {
    # parallel to DIGIT_PERM: `un` and `deux` stay put, as `one`/`two` do.
    # `quatre`/`neuf` is the one pair from that parallel left out — `neuf`
    # is also the adjective "new", so the swap would rewrite `un
    # appartement neuf` as `un appartement quatre`. The 4/9 digit swap is
    # unaffected; only the spelled-out words are skipped.
    "zéro": "cinq", "cinq": "zéro",
    "trois": "huit", "huit": "trois",
    "six": "sept", "sept": "six",
    # tens and magnitudes
    "dix": "vingt", "vingt": "dix",
    "trente": "quarante", "quarante": "trente",
    "cent": "mille", "mille": "cent",
    "million": "milliard", "milliard": "million",
}
# Language-neutral, and identical to the English permutation on purpose:
# 1 and 2 are held fixed so year prefixes (1990, 2024) survive encoding.
DIGIT_PERM = {"0": "5", "5": "0", "3": "8", "8": "3",
              "4": "9", "9": "4", "6": "7", "7": "6"}


def assemble_specials() -> dict[str, str]:
    """Merge the special tables, keeping only clean involutions.

    These tables are hand-written and bypass the agreement buckets, which is
    precisely why they are checked here: the first draft of this file paired
    `février` with `août` and `hier` with `demain`, and both put a
    contracted article in front of a word that does not take one. A silent
    half-pair would survive all the way into the font.
    """
    merged: dict[str, str] = {}
    for table in (MONTH_PAIRS, DAY_PAIRS, ORDINAL_PAIRS, NUMBER_WORD_PAIRS):
        for src, tgt in table.items():
            if table.get(tgt) != src:
                raise ValueError(
                    f"special pair {src!r}->{tgt!r} is not bidirectional")
            if elision_class(src) != elision_class(tgt):
                raise ValueError(
                    f"special pair {src!r}({elision_class(src)}) -> "
                    f"{tgt!r}({elision_class(tgt)}) crosses an elision class")
            merged[src] = tgt
    return {s: t for s, t in merged.items() if merged.get(t) == s}


# ── Stage A — the lexicon ─────────────────────────────────────────────
def download_lexique() -> Path:
    if LEXIQUE_TSV.exists():
        return LEXIQUE_TSV
    LEXICON_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[A] downloading Lexique 3.83 from {LEXIQUE_URL}", flush=True)
    with urllib.request.urlopen(LEXIQUE_URL, timeout=120) as resp:
        LEXIQUE_TSV.write_bytes(resp.read())
    print(f"[A] cached at {LEXIQUE_TSV.relative_to(ROOT)} "
          f"({LEXIQUE_TSV.stat().st_size:,} bytes)", flush=True)
    return LEXIQUE_TSV


def _freq(row: dict) -> float:
    """Combined book + film frequency. Neither corpus alone covers both
    registers: `bagnole` is common in film and near-absent in books."""
    total = 0.0
    for key in ("freqlivres", "freqfilms2"):
        try:
            total += float(row.get(key) or 0.0)
        except ValueError:
            pass
    return total


def load_lexicon(path: Path):
    """ortho -> every Lexique reading, plus a lemma-level gender index.

    The gender index exists because Lexique leaves `genre` empty on some
    singular head entries while filling it on their plurals: `maison` is
    blank, `maisons` is `f`. Reading gender at the lemma rather than the
    form recovers those.
    """
    by_form: dict[str, list[dict]] = defaultdict(list)
    lemma_gender: dict[tuple[str, str], set[str]] = defaultdict(set)
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            form = unicodedata.normalize("NFC", row["ortho"])
            row["ortho"] = form
            by_form[form].append(row)
            if row["genre"] in ("m", "f"):
                lemma_gender[(row["lemme"], row["cgram"])].add(row["genre"])
    return by_form, lemma_gender


def resolve(form: str, rows: list[dict], lemma_gender) -> tuple[str, str] | None:
    """The agreement signature a decoy for `form` must reproduce.

    Returns (bucket_prefix, evidence) or None when the form is ambiguous,
    not a content word, or missing the features its category needs.
    """
    by_pos: dict[str, float] = defaultdict(float)
    for row in rows:
        by_pos[row["cgram"]] += _freq(row)
    total = sum(by_pos.values())
    if total <= 0:
        return None
    pos, dom = max(by_pos.items(), key=lambda kv: kv[1])
    if pos not in CONTENT_POS or dom / total < POS_DOMINANCE:
        return None

    chosen = [r for r in rows if r["cgram"] == pos]

    if pos in ("NOM", "ADJ"):
        genders = {r["genre"] for r in chosen if r["genre"] in ("m", "f")}
        if not genders:
            genders = lemma_gender.get((chosen[0]["lemme"], pos), set())
        numbers = {r["nombre"] for r in chosen if r["nombre"] in ("s", "p")}
        # Two genders for one form is `un/une enfant`: real, and unpairable,
        # because whichever we pick disagrees with half its occurrences.
        if len(genders) != 1 or len(numbers) != 1:
            return None
        evidence = ("lexique" if any(r["genre"] in ("m", "f") for r in chosen)
                    else "lemma_backfill")
        return f"{pos.lower()}.{genders.pop()}.{numbers.pop()}", evidence

    if pos == "VER":
        # Bucket on the whole inflection set, not one code. `parle` is
        # ind:pre:1s AND ind:pre:3s, and pairing it with another form
        # carrying exactly that set is safe under either reading; pairing it
        # with a bare 3s form would break the 1s one.
        codes = set()
        for row in chosen:
            codes.update(c for c in (row["infover"] or "").split(";") if c)
        if not codes:
            return None
        if any(c.startswith("par:") for c in codes):
            # Participles agree like adjectives, so they need the full
            # gender/number signature too.
            genders = {r["genre"] for r in chosen if r["genre"] in ("m", "f")}
            numbers = {r["nombre"] for r in chosen if r["nombre"] in ("s", "p")}
            if len(genders) != 1 or len(numbers) != 1:
                return None
            return f"verb.part.{genders.pop()}.{numbers.pop()}", "lexique"
        return "verb." + "_".join(sorted(codes)), "lexique"

    if pos == "ADV":
        # See the module docstring: -ment is what separates a French manner
        # adverb from a function word wearing the same tag.
        if not form.endswith("ment"):
            return None
        return "adv.ment", "lexique"

    return None


def build_pool(by_form, lemma_gender, blocked):
    from wordfreq import zipf_frequency

    buckets: dict[str, list[str]] = defaultdict(list)
    evidence: dict[str, str] = {}
    lemma: dict[str, str] = {}
    zipf: dict[str, float] = {}
    reasons = Counter()

    for form, rows in by_form.items():
        if len(form) < MIN_WORD_LEN or not form.isalpha() or form != form.lower():
            reasons["form_shape"] += 1
            continue
        z = zipf_frequency(form, "fr")
        if z < MIN_ZIPF:
            reasons["below_zipf_floor"] += 1
            continue
        resolved = resolve(form, rows, lemma_gender)
        if resolved is None:
            reasons["ambiguous_or_not_content"] += 1
            continue
        prefix, ev = resolved
        buckets[f"{prefix}.{elision_class(form, blocked)}"].append(form)
        evidence[form] = ev
        lemma[form] = rows[0]["lemme"]
        zipf[form] = round(z, 2)
        reasons["kept"] += 1

    return buckets, evidence, lemma, zipf, reasons


# ── Stage B — semantic clustering ─────────────────────────────────────
class Vectors:
    """spaCy vectors, used for clustering and for the semantic veto."""

    def __init__(self, nlp, words: list[str]):
        import numpy as np

        self.np = np
        self.vec: dict[str, "np.ndarray"] = {}
        for word, doc in zip(words, nlp.pipe(words, batch_size=1024)):
            if len(doc) != 1:
                continue
            v = doc[0].vector
            norm = np.linalg.norm(v)
            if norm > 0:
                self.vec[word] = v / norm

    def cosine(self, a: str, b: str) -> float | None:
        va, vb = self.vec.get(a), self.vec.get(b)
        if va is None or vb is None:
            return None
        return float(va @ vb)

    def kmeans(self, words: list[str], k: int, seed: int) -> dict[str, int]:
        """Spherical k-means. Vectors are unit-normalised, so a dot product
        is the cosine and the mean re-normalises to the centroid."""
        np = self.np
        known = [w for w in words if w in self.vec]
        if k <= 1 or len(known) <= k:
            return {w: 0 for w in words}
        matrix = np.vstack([self.vec[w] for w in known])
        rng = np.random.default_rng(seed)
        centroids = matrix[rng.choice(len(known), size=k, replace=False)]
        labels = np.zeros(len(known), dtype=int)
        for _ in range(15):
            labels = np.argmax(matrix @ centroids.T, axis=1)
            for j in range(k):
                members = matrix[labels == j]
                if len(members):
                    c = members.mean(axis=0)
                    norm = np.linalg.norm(c)
                    if norm > 0:
                        centroids[j] = c / norm
        out = {w: int(labels[i]) for i, w in enumerate(known)}
        # A word with no vector cannot be placed; give it its own cluster so
        # it is dropped by MIN_BUCKET_SIZE rather than silently mixed in.
        for w in words:
            out.setdefault(w, -1)
        return out


def cluster_buckets(buckets, vectors: Vectors, seed: int):
    """Subdivide each bucket into semantic clusters of ~CLUSTER_TARGET."""
    out: dict[str, list[str]] = {}
    for bucket, words in sorted(buckets.items()):
        k = max(1, math.ceil(len(words) / CLUSTER_TARGET))
        if k == 1:
            out[bucket] = words
            continue
        labels = vectors.kmeans(sorted(words), k, seed)
        grouped: dict[int, list[str]] = defaultdict(list)
        for w in words:
            grouped[labels[w]].append(w)
        for label, members in grouped.items():
            if label < 0:
                continue
            out[f"{bucket}.c{label}"] = members
    return out


# ── Stage C — in-bucket derangement ───────────────────────────────────
def pair_within_buckets(buckets, seed: int):
    """Random pairwise matching inside each bucket, both directions emitted.

    Same shape as the English pipeline's `pair_within_buckets`, so a French
    pairs file re-seeds through `scripts/reseed_mapping.py` unchanged.
    """
    rng = random.Random(seed)
    candidates: list[tuple[str, str, str]] = []
    skipped = 0
    for bucket, words in sorted(buckets.items()):
        if len(words) < MIN_BUCKET_SIZE:
            skipped += 1
            continue
        shuffled = sorted(words)
        rng.shuffle(shuffled)
        n = len(shuffled) - (len(shuffled) % 2)
        for i in range(0, n, 2):
            a, b = shuffled[i], shuffled[i + 1]
            if a != b:
                candidates.append((a, b, bucket))
                candidates.append((b, a, bucket))
    return candidates, skipped


# ── Stage D — semantic veto ───────────────────────────────────────────
def shares_stem(a: str, b: str) -> bool:
    """True when the two look morphologically related.

    `nation`/`national` sit in different buckets but would still read as a
    typo rather than a different word, and the reader sees the original
    either way — it is the scraper's copy that stops being plausible.
    """
    if a in b or b in a:
        return True
    common = 0
    for x, y in zip(a, b):
        if x != y:
            break
        common += 1
    return common >= 5


def nearest_within(bucket_words: list[str], vectors: Vectors, k: int):
    """Top-k neighbours of each word inside its own cluster."""
    np = vectors.np
    known = [w for w in bucket_words if w in vectors.vec]
    if len(known) < 2:
        return {}
    matrix = np.vstack([vectors.vec[w] for w in known])
    sims = matrix @ matrix.T
    np.fill_diagonal(sims, -2.0)
    take = min(k, len(known) - 1)
    out: dict[str, set[str]] = {}
    for i, w in enumerate(known):
        idx = np.argpartition(-sims[i], take - 1)[:take]
        out[w] = {known[j] for j in idx}
    return out


def filter_pairs(candidates, buckets, vectors: Vectors, lemma, zipf):
    accepted: list[dict] = []
    reasons = Counter()
    rejected: set[str] = set()

    neighbours: dict[str, set[str]] = {}
    for words in buckets.values():
        neighbours.update(nearest_within(words, vectors, NN_REJECT_K))

    # Reject symmetrically. A pair is bidirectional, so dropping one
    # direction while keeping the other would break the involution the whole
    # design rests on — `decode` is literally `encode`.
    for src, tgt, bucket in candidates:
        if src in rejected or tgt in rejected:
            continue
        if lemma.get(src) == lemma.get(tgt):
            reasons["same_lemma"] += 1
            rejected.update((src, tgt))
            continue
        if shares_stem(src, tgt):
            reasons["shares_stem"] += 1
            rejected.update((src, tgt))
            continue
        cos = vectors.cosine(src, tgt)
        if cos is not None and cos > COSINE_HIGH:
            reasons["cosine_too_high"] += 1
            rejected.update((src, tgt))
            continue
        if tgt in neighbours.get(src, ()) or src in neighbours.get(tgt, ()):
            reasons["nearest_neighbour"] += 1
            rejected.update((src, tgt))
            continue
        reasons["accepted"] += 1
        accepted.append({
            "src": src, "tgt": tgt, "bucket": bucket,
            "src_zipf": zipf[src], "tgt_zipf": zipf[tgt],
            "shift": round(zipf[src] - zipf[tgt], 2),
            "cosine": None if cos is None else round(cos, 4),
            "special": False,
        })

    return [p for p in accepted
            if p["src"] not in rejected and p["tgt"] not in rejected], reasons


# ── Stage E — outputs ─────────────────────────────────────────────────
def add_specials(accepted: list[dict], claimed: set[str]) -> list[dict]:
    from wordfreq import zipf_frequency

    out = list(accepted)
    for src, tgt in assemble_specials().items():
        if src in claimed or tgt in claimed:
            continue
        kind = ("month" if src in MONTH_PAIRS else
                "day" if src in DAY_PAIRS else
                "ordinal" if src in ORDINAL_PAIRS else "number_word")
        s_zipf = round(zipf_frequency(src, "fr"), 2)
        t_zipf = round(zipf_frequency(tgt, "fr"), 2)
        out.append({
            "src": src, "tgt": tgt, "bucket": f"special.{kind}",
            "src_zipf": s_zipf, "tgt_zipf": t_zipf,
            "shift": round(s_zipf - t_zipf, 2),
            "cosine": None, "special": True,
        })
    for src, tgt in DIGIT_PERM.items():
        out.append({
            "src": src, "tgt": tgt, "bucket": "special.digit",
            "src_zipf": 0.0, "tgt_zipf": 0.0, "shift": 0.0,
            "cosine": None, "special": True,
        })
    return out


def write_outputs(accepted, buckets, candidates, reasons, evidence, seed):
    PAIRS_OUT.parent.mkdir(parents=True, exist_ok=True)

    bucket_pairs: dict[str, list[dict]] = defaultdict(list)
    for p in accepted:
        bucket_pairs[p["bucket"]].append(p)

    shifts = [p["shift"] for p in accepted]
    doc = {
        "_schema_version": 1,
        "_lang": "fr",
        "_seed": seed,
        "_source": "Lexique 3.83 (lexique.org), CC BY-SA 4.0",
        "_n_source_words": sum(len(v) for v in buckets.values()),
        "_n_buckets": len(buckets),
        "_n_buckets_used": len(bucket_pairs),
        "_n_candidate_pairs": len(candidates),
        "_n_accepted_pairs": len(accepted),
        "_acceptance_rate": round(len(accepted) / len(candidates), 4) if candidates else 0,
        "_zipf_shift_stats": {
            "mean": round(statistics.fmean(shifts), 3) if shifts else 0.0,
            "std": round(statistics.pstdev(shifts), 3) if len(shifts) > 1 else 0.0,
            "median": round(statistics.median(shifts), 3) if shifts else 0.0,
        },
        "_reject_reasons": dict(reasons.most_common()),
        "_digit_permutation": DIGIT_PERM,
        "buckets": dict(bucket_pairs),
        "all_pairs": accepted,
    }
    PAIRS_OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2))

    flat = {p["src"]: p["tgt"] for p in accepted}
    FLAT_OUT.write_text(json.dumps(flat, ensure_ascii=False, indent=0))

    # One row per LOGICAL pair, not per direction: a reviewer who has read
    # `maison -> voiture` has already reviewed `voiture -> maison`.
    #
    # Sorted by how likely a row is to be WRONG rather than alphabetically,
    # because 5,422 rows is more than anyone reviews in one sitting and the
    # order decides what gets looked at. Highest risk first, so stopping
    # early still spends the effort where it pays.
    seen: set[str] = set()
    rows: list[tuple[int, str, list]] = []
    for p in accepted:
        if p["src"] in seen or p["tgt"] in seen:
            continue
        seen.update((p["src"], p["tgt"]))
        ev = evidence.get(p["src"], "special")
        if evidence.get(p["tgt"]) == "lemma_backfill":
            ev = "lemma_backfill"

        if ev == "lemma_backfill":
            # Gender was never stated for this form; it was inferred from
            # another form of the same lemma. Weakest inference in the build.
            priority, why = 1, "gender inferred from the lemma, not stated"
        elif p["src"][0] == "h" or p["tgt"][0] == "h":
            # Whether the h elides is a hand list, and a wrong call here is
            # a grammatical error in every sentence the pair touches.
            priority, why = 2, "h-initial: elision class comes from a hand list"
        elif p["special"]:
            priority, why = 3, "hand-written special pair"
        elif p["cosine"] is not None and p["cosine"] > 0.65:
            # Under the 0.80 veto but close enough that the decoy may read
            # as a near-synonym, which costs meaning destruction.
            priority, why = 4, "close in meaning — may read as a synonym"
        else:
            priority, why = 5, ""
        rows.append((priority, p["bucket"], [
            priority, why, p["src"], p["tgt"], p["bucket"],
            p["src_zipf"], p["tgt_zipf"], p["cosine"], ev, "", "",
        ]))

    with AUDIT_OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["priority", "why", "src", "tgt", "bucket", "src_zipf",
                    "tgt_zipf", "cosine", "gender_evidence", "verdict", "note"])
        for _, _, row in sorted(rows, key=lambda r: (r[0], r[1], r[2][2])):
            w.writerow(row)
    return doc, flat


def verify(flat: dict[str, str]) -> int:
    """Fail loudly on the invariants the font and the encoder both assume."""
    problems = 0
    broken = [(s, t) for s, t in flat.items() if flat.get(t) != s]
    if broken:
        print(f"[FAIL] involution broken for {len(broken)} entries, e.g. {broken[:3]}")
        problems += 1
    non_nfc = [k for k in flat if unicodedata.normalize("NFC", k) != k]
    if non_nfc:
        print(f"[FAIL] {len(non_nfc)} keys are not NFC-normalised: {non_nfc[:3]}")
        problems += 1
    fixed = [s for s, t in flat.items() if s == t]
    if fixed:
        print(f"[FAIL] {len(fixed)} entries map to themselves: {fixed[:3]}")
        problems += 1
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()

    try:
        import spacy
        import wordfreq  # noqa: F401
    except ImportError as exc:
        print(f"missing dependency ({exc.name}) — see SETUP in this file's docstring.")
        return 1
    try:
        nlp = spacy.load("fr_core_news_md", exclude=["parser", "ner", "tagger",
                                                     "morphologizer", "lemmatizer",
                                                     "attribute_ruler"])
    except OSError:
        print("fr_core_news_md is not installed:\n"
              "  python -m spacy download fr_core_news_md")
        return 1

    by_form, lemma_gender = load_lexicon(download_lexique())
    print(f"[A] Lexique: {len(by_form):,} distinct forms", flush=True)

    blocked = blocked_forms(by_form)
    wrong = [(w, want, elision_class(w, blocked))
             for w, want in ELISION_CONTROLS
             if elision_class(w, blocked) != want]
    if wrong:
        for w, want, got in wrong:
            print(f"[FAIL] elision_class({w!r}) = {got!r}, expected {want!r}")
        print("[A] elision controls failed — the mapping would be ungrammatical")
        return 1
    print(f"[A] {len(NO_ELISION)} NO_ELISION base forms → {len(blocked):,} "
          f"inflected forms that block elision; "
          f"{len(ELISION_CONTROLS)} elision controls pass", flush=True)

    buckets, evidence, lemma, zipf, pool_reasons = build_pool(
        by_form, lemma_gender, blocked)
    backfilled = sum(1 for v in evidence.values() if v == "lemma_backfill")
    print(f"[A] {pool_reasons['kept']:,} forms in {len(buckets)} agreement buckets "
          f"({backfilled} genders recovered from the lemma); "
          f"dropped {pool_reasons['ambiguous_or_not_content']:,} ambiguous/non-content, "
          f"{pool_reasons['below_zipf_floor']:,} below the zipf floor", flush=True)

    pool = sorted({w for words in buckets.values() for w in words})
    vectors = Vectors(nlp, pool)
    print(f"[B] vectors for {len(vectors.vec):,}/{len(pool):,} pool words", flush=True)

    clustered = cluster_buckets(buckets, vectors, args.seed)
    print(f"[B] {len(buckets)} buckets → {len(clustered)} semantic clusters "
          f"(target {CLUSTER_TARGET} words each)", flush=True)

    candidates, skipped = pair_within_buckets(clustered, args.seed)
    print(f"[C] {len(candidates):,} candidate directions "
          f"({skipped} clusters below MIN_BUCKET_SIZE={MIN_BUCKET_SIZE})", flush=True)

    accepted, reasons = filter_pairs(candidates, clustered, vectors, lemma, zipf)
    print(f"[D] {len(accepted):,} directions survive the semantic veto "
          f"({dict(reasons.most_common())})", flush=True)

    accepted = add_specials(accepted, {p["src"] for p in accepted})
    doc, flat = write_outputs(accepted, clustered, candidates, reasons,
                              evidence, args.seed)

    print(f"[E] wrote {PAIRS_OUT.relative_to(ROOT)} "
          f"({len(accepted):,} directions, {len(accepted) // 2:,} logical pairs)")
    print(f"[E] wrote {FLAT_OUT.relative_to(ROOT)} ({len(flat):,} entries)")
    print(f"[E] wrote {AUDIT_OUT.relative_to(ROOT)}")

    problems = verify(flat)
    if problems:
        print(f"[verify] {problems} invariant(s) FAILED — do not ship this mapping")
        return 1
    print(f"[verify] involution 100%, NFC clean, no fixed points ({len(flat):,} entries)")
    print("[next] build a matching font — see docs/custom-faces.md — and have a "
          "native speaker fill the `verdict` column of the audit CSV")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
