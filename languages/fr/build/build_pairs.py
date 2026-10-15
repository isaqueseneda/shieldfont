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
"""build_pairs.py — build a FRENCH ShieldFont mapping (fr-v1) from scratch.

The French counterpart of the English v7 pipeline
(`benchmark/data/v7/scripts/build_pairs.py`), rewritten around the two
agreements French enforces and English does not. It emits the same
`pairs_*.json` schema, so `scripts/reseed_mapping.py --pairs <output>`
re-seeds a private French mapping with no code change.

    Grammalecte lexicon -> agreement buckets -> vector clusters -> in-bucket
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
     `héroïne` takes `l'`. Two sources decide it: NO_ELISION below, a hand
     list, and the lexicon's own `pel` / `hm` markers (lexicon_elision).
     Where they contradict each other the form is left out.

WHY A LEXICON AND NOT A TAGGER
------------------------------
An earlier draft of this script took POS and gender from spaCy
`fr_core_news_md`. It does not work, and the failure is structural rather
than a tuning problem: spaCy is a *contextual* tagger, and a dictionary
build asks it about context-free word forms. Measured on the pool it
produced, the feminine-singular-noun bucket contained `grandis` and
`confesse` (verbs), `contemporaine` (an adjective), `dupuy` (a surname) and
`stargate` (English). Carrier frames make it worse, not better — asked
about `le maison`, the tagger reports Gender=Masc, having taken the
determiner's word for it.

A lexicon answers the question actually being asked, and `dupuy` and
`stargate` are simply absent from it, which filters proper nouns and
English borrowings for free.

WHY GRAMMALECTE AND NOT LEXIQUE
-------------------------------
The first draft read Lexique 3.83, which is CC BY-SA 4.0; the maintainers
want the repository under AGPL-3.0 alone, and the share-alike terms carry
over to the word pairs. Grammalecte's lexicon is MPL 2.0. It has what the
buckets need — form, lemma, part of speech, gender, number, verb mood and
person — marks epicene and invariable forms (`e`, `i`) as such, and marks
elision (`pel`, `hm`), which Lexique did not.

What it lacks is a usable per-reading frequency (see load_lexicon). Lexique
could say that `voiture` is a noun 99.8% of the time and keep it; this
build cannot, so every form that is more than one part of speech is left
out, `marche`, `livre` and `lit` included. That is the quality the licence
costs.

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
Grammalecte's "Lexique des formes fléchies du français" (Olivier R.,
grammalecte.net), MPL 2.0, downloaded on first run and cached in
`languages/fr/build/.cache/` (gitignored). It is NOT vendored into the
repository; only the derived mapping is committed. See NOTICE.

The vectors still come from spaCy `fr_core_news_md`, which is LGPL-LR. Whether
an input that only steers clustering and the semantic veto needs replacing
is open with the maintainers; `inputs` in `../language.json` records it as
not yet approved.

SETUP
-----
    python3 -m venv .venv && . .venv/bin/activate
    pip install spacy
    python -m spacy download fr_core_news_md

USAGE
-----
    python3 languages/fr/build/build_pairs.py                  # defaults, seed 42
    python3 languages/fr/build/build_pairs.py --seed 7
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
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

LANG_DIR = Path(__file__).resolve().parent.parent  # languages/fr
ROOT = LANG_DIR.parent.parent
LEXICON_DIR = LANG_DIR / "build" / ".cache"
LEXICON_VERSION = "7.7"
LEXICON_ZIP_NAME = f"lexique-grammalecte-fr-v{LEXICON_VERSION}.zip"
LEXICON_URL = f"https://www.grammalecte.net/dic/{LEXICON_ZIP_NAME}"
LEXICON_TXT = LEXICON_DIR / f"lexique-grammalecte-fr-v{LEXICON_VERSION}.txt"

PAIRS_OUT = LANG_DIR / "data" / "pairs_fr_v1_alpha.json"
AUDIT_OUT = LANG_DIR / "audit" / "audit_fr_v1_alpha.csv"
FLAT_OUT = LANG_DIR / "data" / "fr_v1_alpha_for_font.json"

# ── Config ────────────────────────────────────────────────────────────
SEED = 42

# Zipf floor, from the lexicon's own occurrence counts (see form_zipf). The
# lexicon includes a long tail of forms no contemporary reader would
# recognise, and a decoy drawn from it announces itself. 3.0 is roughly
# "appears once per million words".
MIN_ZIPF = 3.0

# The lexicon's corpora that form_zipf averages: Google Books for breadth,
# Wikipedia for recency.
ZIPF_CORPORA = ("Google 1-grams", "Wikipédia")

# Readings the lexicon's editors mark as archaic, rare or pejorative. Each
# makes a decoy that reads as an oddity, or worse, puts an insult on the
# page; the frequency floor alone does not catch them, because old books
# are much of what the lexicon counts.
NOTES_EXCLUDED = frozenset({"vx", "rare", "péj"})

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

CONTENT_POS = ("NOM", "ADJ", "NOMADJ", "VER", "ADV")

# The forms `beau`, `nouveau`, `vieux`, `fou` and `mou` take before a
# vowel-initial noun (`un nouvel ami`). They exist only in that slot, so a
# decoy for one is wrong in it and the reverse swap puts them where they
# never go: `le mécanicien arrive` -> `le nouvel arrive`.
PRENOMINAL_ALLOMORPHS = frozenset("bel nouvel vieil fol mol".split())

# ── Elision ───────────────────────────────────────────────────────────
# `y` is deliberately NOT a vowel here. French y-initial words overwhelmingly
# block elision — `le yaourt`, `le yoga`, `le yen` — so treating them as
# consonants is right far more often than not.
VOWELS = set("aeiouàâäéèêëíîïóôöùúûüœæ")

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
# blocked_forms() must not sweep them up. Lexique lemmatised a feminine noun
# to its masculine (`chienne` -> `chien`), which put `héroïne` and
# `héroïnes` under the lemma `héros` — and `l'héroïne` elides where `le
# héros` does not. Grammalecte gives `héroïne` its own lemma and marks it
# h-muet, so this no longer has work to do, but it stays: it is the
# canonical h-aspiré irregularity, and a lexicon update should not be able
# to undo it silently.
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
    # spelling-driven; `œ` is a vowel (`l'œil`) and was once missing here
    ("écriture", "elides"), ("université", "elides"),
    ("œil", "elides"), ("œuvre", "elides"),
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
# `languages/fr/tests/encode-fr.test.ts` checks it. Two ordinals is a cheap
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
def download_lexicon() -> Path:
    if LEXICON_TXT.exists():
        return LEXICON_TXT
    LEXICON_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = LEXICON_DIR / LEXICON_ZIP_NAME
    if not zip_path.exists():
        print(f"[A] downloading the Grammalecte lexicon from {LEXICON_URL}", flush=True)
        with urllib.request.urlopen(LEXICON_URL, timeout=120) as resp:
            zip_path.write_bytes(resp.read())
    with zipfile.ZipFile(zip_path) as zf:
        LEXICON_TXT.write_bytes(zf.read(LEXICON_TXT.name))
    print(f"[A] cached at {LEXICON_TXT.relative_to(ROOT)} "
          f"({LEXICON_TXT.stat().st_size:,} bytes)", flush=True)
    return LEXICON_TXT


# Grammalecte's tags are space-separated words. These are the ones a bucket
# needs; everything else on the line (verb conjugation class, `mg` for
# function words, `npr` for proper nouns, ...) only decides the POS below.
GENDER_TAGS = {"mas": "m", "fem": "f", "epi": "e"}
NUMBER_TAGS = {"sg": "s", "pl": "p", "inv": "i"}
VERB_MOODS = {"infi", "ppre", "ppas", "ipre", "iimp", "ipsi", "ifut",
              "cond", "spre", "simp", "impe"}


def _pos(tags: list[str]) -> str:
    """Grammalecte tags -> one of CONTENT_POS, or the raw first tag.

    `nom adj` on one line (`grand`, `politique`) is a single reading that is
    both, with no frequency split between them, so it gets its own POS
    rather than being forced into either. Pairing two such words is safe
    under both readings.
    """
    if tags[0][:1] == "v" and tags[0][1:2].isdigit():
        # Conjugation class 0 is `être` and `avoir`. Lexique tagged them AUX
        # and so does this, which keeps them out of CONTENT_POS: an
        # auxiliary is a function word, and swapping `est` breaks every
        # compound tense it sits in.
        return "AUX" if tags[0][1] == "0" else "VER"
    s = set(tags)
    if "nom" in s and "adj" in s:
        return "NOMADJ"
    for tag, pos in (("nom", "NOM"), ("adj", "ADJ"), ("adv", "ADV")):
        if tag in s:
            return pos
    return tags[0]


def _verb_codes(tags: list[str]) -> list[str]:
    """`ipre spre 1sg 3sg` -> ipre:1sg, ipre:3sg, spre:1sg, spre:3sg.

    One Grammalecte line lists every mood and person a form serves, as a
    cross product. Moods with no person (`infi`, `ppre`, `ppas`) stand alone.
    """
    moods = [t for t in tags if t in VERB_MOODS]
    persons = [t for t in tags if t[:1] in "123"]
    codes = []
    for mood in moods:
        if mood in ("infi", "ppre", "ppas") or not persons:
            codes.append(mood)
        else:
            codes.extend(f"{mood}:{p}" for p in persons)
    return codes


def load_lexicon(path: Path):
    """Flexion -> every Grammalecte reading, plus a lemma-level gender index.

    Each reading is reshaped into the fields the rest of this script reads:
    `ortho`, `lemme`, `cgram`, `genre`, `nombre`, `infover`, `counts`,
    `notes`.

    Grammalecte's `Total occurrences` column is NOT read, although it looks
    like a per-reading frequency. It hands nearly the whole count to the
    noun reading wherever one exists: `lit` comes out 96% "bed", `est` 98%
    "east", `soutiens` 94% "supporters". Lexique's per-reading counts were
    what let the first draft resolve a homograph to its usual part of
    speech; this lexicon has no equivalent, so resolve() refuses homographs
    across parts of speech instead.

    The gender index is kept from the Lexique version, where some singular
    head entries had no gender. Grammalecte gives every noun one, so it
    rarely fires, but a reading with no gender still falls back to it.
    """
    by_form: dict[str, list[dict]] = defaultdict(list)
    lemma_gender: dict[tuple[str, str], set[str]] = defaultdict(set)
    corpus_words: dict[str, int] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            # The header block gives each corpus's size, e.g.
            # ` * Wikipédia  ->  1,091,867,445 mots reconnus / 1,642,516,410`
            if line.lstrip().startswith("*") and "->" in line:
                name, rest = line.lstrip()[1:].split("->", 1)
                corpus_words[name.strip()] = int(
                    rest.split("mots")[0].replace(",", "").strip())
            if line.startswith("id\t"):
                header = line.rstrip("\n").split("\t")
                break
        else:
            raise ValueError(f"{path} has no column header line")
        missing = [c for c in ZIPF_CORPORA if corpus_words.get(c, 0) <= 0]
        if missing:
            raise ValueError(f"{path} does not state the size of {missing}")
        for fields in csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            raw = dict(zip(header, fields))
            tags = raw["Étiquettes"].split()
            if not tags:
                continue
            form = unicodedata.normalize("NFC", raw["Flexion"])
            pos = _pos(tags)
            row = {
                "ortho": form,
                "lemme": unicodedata.normalize("NFC", raw["Lemme"]),
                "cgram": pos,
                "genre": next((GENDER_TAGS[t] for t in tags if t in GENDER_TAGS), ""),
                "nombre": next((NUMBER_TAGS[t] for t in tags if t in NUMBER_TAGS), ""),
                "infover": ";".join(_verb_codes(tags)) if pos == "VER" else "",
                "counts": {c: float(raw[c] or 0) for c in ZIPF_CORPORA},
                "notes": frozenset(raw["Notes"].split()),
            }
            by_form[form].append(row)
            if row["genre"]:
                lemma_gender[(row["lemme"], pos)].add(row["genre"])
    return by_form, lemma_gender, corpus_words


def form_zipf(rows: list[dict], corpus_words: dict[str, int]) -> float:
    """Zipf frequency (log10 of occurrences per billion words) of one form.

    The mean of its Zipf in Google Books and in Wikipedia. This replaces
    wordfreq, whose data is CC BY-SA, and was picked by checking candidate
    measures against wordfreq's own Zipf >= 3.0 split over every lowercase
    content form in the lexicon:

        measure                         best cut   F1
        mean(Google Books, Wikipedia)   3.0        0.83
        Wikipedia alone                 2.9        0.81
        Google Books alone              3.2        0.77
        Total occurrences               3.2        0.77

    Google Books alone leans on old books: it lets in `épizooties` and
    `cochenille` and keeps out `portable`, `courriel` and `bagnole`.
    Wikipedia brings in what is current. The mean keeps the existing 3.0
    floor meaning what it meant before.

    These two columns count the FORM, so every reading of it carries the
    same numbers and any row will do.
    """
    if not rows:
        return 0.0
    counts = rows[0]["counts"]
    return statistics.fmean(
        math.log10(max(counts[c], 1.0) / corpus_words[c] * 1e9)
        for c in ZIPF_CORPORA)


def lexicon_elision(by_form: dict[str, list[dict]]):
    """What Grammalecte's `Notes` column says about elision, per form.

    `pel` (pas d'élision) marks a form that blocks it — `héros`, `haie`,
    `onze`, `yaourt` — and `hm` marks an h-muet form that allows it —
    `homme`, `héroïne`. It is the same split NO_ELISION is a hand list of,
    written by the lexicon's own editors.

    Returns (blocks, elides, both). A form marked both ways, which happens
    when two lemmas share a spelling (`hélions`), is returned in `both` and
    kept out of the pool, since no single class is right for it.
    """
    blocks, elides = set(), set()
    for form, rows in by_form.items():
        notes = set().union(*(r["notes"] for r in rows))
        if "pel" in notes:
            blocks.add(form)
        if "hm" in notes:
            elides.add(form)
    both = blocks & elides
    return frozenset(blocks - both), frozenset(elides - both), frozenset(both)


def resolve(form: str, rows: list[dict], lemma_gender) -> tuple[str, str] | None:
    """The agreement signature a decoy for `form` must reproduce.

    Returns (bucket_prefix, evidence) or None when the form is ambiguous,
    not a content word, or missing the features its category needs.
    """
    # One part of speech, or the form is out. The lexicon cannot say which
    # reading of `lit` (bed / reads) or `marche` (step / walks) a sentence
    # uses (see load_lexicon), and a guess is ungrammatical whenever it is
    # wrong: `il lit un livre` -> `il canapé un livre`. This drops common
    # nouns with a verb homograph (`marche`, `livre`, `danse`), which is the
    # price of the lexicon's licence. Noun and adjective readings are the
    # one combination kept, under NOMADJ, the same as a single `nom adj`
    # line: a decoy from that bucket is safe under either reading.
    poses = {r["cgram"] for r in rows}
    if len(poses) > 1 and poses <= {"NOM", "ADJ", "NOMADJ"}:
        pos = "NOMADJ"
    elif len(poses) == 1:
        pos = next(iter(poses))
    else:
        return None
    if pos not in CONTENT_POS:
        return None

    chosen = rows

    if pos in ("NOM", "ADJ", "NOMADJ"):
        # `e` (épicène: `enfant`, `rapide`) and `i` (invariable: `souris`,
        # `pas`) are classes of their own. An epicene word agrees with either
        # gender, so it is safe next to another epicene word and wrong next
        # to a gendered one half the time: `la voiture rapide` -> `la
        # voiture grand`. Two DIFFERENT genders across readings of one form
        # is still unpairable, because whichever we pick disagrees with the
        # other reading's occurrences.
        genders = {r["genre"] for r in chosen if r["genre"]}
        if not genders:
            genders = lemma_gender.get((chosen[0]["lemme"], pos), set())
        numbers = {r["nombre"] for r in chosen if r["nombre"]}
        if len(genders) != 1 or len(numbers) != 1:
            return None
        evidence = ("lexicon" if any(r["genre"] for r in chosen)
                    else "lemma_backfill")
        return f"{pos.lower()}.{genders.pop()}.{numbers.pop()}", evidence

    if pos == "VER":
        # Bucket on the whole inflection set, not one code. `parle` is
        # ipre:1sg AND ipre:3sg, and pairing it with another form
        # carrying exactly that set is safe under either reading; pairing it
        # with a bare 3s form would break the 1s one.
        codes = set()
        for row in chosen:
            codes.update(c for c in (row["infover"] or "").split(";") if c)
        if not codes:
            return None
        if "ppas" in codes:
            # Participles agree like adjectives, so they need the full
            # gender/number signature too.
            genders = {r["genre"] for r in chosen if r["genre"]}
            numbers = {r["nombre"] for r in chosen if r["nombre"]}
            if len(genders) != 1 or len(numbers) != 1:
                return None
            return f"verb.part.{genders.pop()}.{numbers.pop()}", "lexicon"
        return "verb." + "_".join(sorted(codes)), "lexicon"

    if pos == "ADV":
        # See the module docstring: -ment is what separates a French manner
        # adverb from a function word wearing the same tag.
        if not form.endswith("ment"):
            return None
        return "adv.ment", "lexicon"

    return None


def build_pool(by_form, lemma_gender, corpus_words, blocked, conflicted):
    buckets: dict[str, list[str]] = defaultdict(list)
    evidence: dict[str, str] = {}
    lemma: dict[str, str] = {}
    zipf: dict[str, float] = {}
    reasons = Counter()

    for form, rows in by_form.items():
        if len(form) < MIN_WORD_LEN or not form.isalpha() or form != form.lower():
            reasons["form_shape"] += 1
            continue
        if form in PRENOMINAL_ALLOMORPHS:
            reasons["prenominal_allomorph"] += 1
            continue
        z = form_zipf(rows, corpus_words)
        if z < MIN_ZIPF:
            reasons["below_zipf_floor"] += 1
            continue
        if form in conflicted:
            reasons["elision_conflict"] += 1
            continue
        if form[0] in VOWELS and elision_class(form, blocked) == "consonant":
            # `onzième`, `oui`, `ouate`: spelled with a vowel, but they block
            # elision. Left out for the reason ORDINAL_PAIRS leaves out
            # `onzième`: with them gone, the elision invariant can be checked
            # from spelling alone, which is how the encoder-side test does it.
            reasons["blocks_elision_against_spelling"] += 1
            continue
        rows = [r for r in rows if not r["notes"] & NOTES_EXCLUDED]
        if not rows:
            reasons["archaic_rare_or_pejorative"] += 1
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
def add_specials(accepted: list[dict], claimed: set[str], by_form,
                 corpus_words: dict[str, int]) -> list[dict]:
    out = list(accepted)
    for src, tgt in assemble_specials().items():
        if src in claimed or tgt in claimed:
            continue
        kind = ("month" if src in MONTH_PAIRS else
                "day" if src in DAY_PAIRS else
                "ordinal" if src in ORDINAL_PAIRS else "number_word")
        s_zipf = round(form_zipf(by_form.get(src, []), corpus_words), 2)
        t_zipf = round(form_zipf(by_form.get(tgt, []), corpus_words), 2)
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
        "_source": f"Grammalecte lexicon v{LEXICON_VERSION} (grammalecte.net), MPL 2.0",
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
            # Whether the h elides comes from the hand list and the
            # lexicon's markers, and a wrong call here is a grammatical error
            # in every sentence the pair touches.
            priority, why = 2, "h-initial: elision from NO_ELISION and the lexicon's markers"
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

    by_form, lemma_gender, corpus_words = load_lexicon(download_lexicon())
    print(f"[A] Grammalecte v{LEXICON_VERSION}: {len(by_form):,} distinct forms",
          flush=True)

    hand_blocked = blocked_forms(by_form)
    lex_blocks, lex_elides, lex_both = lexicon_elision(by_form)
    # The hand list and the lexicon are two independent calls on the same
    # question. Where they agree, or only one has an opinion, its answer
    # stands. Where they contradict each other, nothing here can say which
    # is right, so the form is kept out of the pool and printed for review.
    conflicted = frozenset((hand_blocked & lex_elides) | lex_both)
    blocked = frozenset((hand_blocked | lex_blocks) - H_MUET_OVERRIDE - conflicted)
    wrong = [(w, want, elision_class(w, blocked))
             for w, want in ELISION_CONTROLS
             if elision_class(w, blocked) != want]
    if wrong:
        for w, want, got in wrong:
            print(f"[FAIL] elision_class({w!r}) = {got!r}, expected {want!r}")
        print("[A] elision controls failed — the mapping would be ungrammatical")
        return 1
    print(f"[A] {len(NO_ELISION)} NO_ELISION base forms → {len(hand_blocked):,} "
          f"inflected forms; the lexicon marks {len(lex_blocks):,} as blocking "
          f"and {len(lex_elides):,} as h-muet; {len(blocked):,} block elision "
          f"in all; {len(ELISION_CONTROLS)} elision controls pass", flush=True)
    hand_conflicts = sorted(hand_blocked & lex_elides)
    if hand_conflicts:
        print(f"[A] {len(hand_conflicts)} forms the hand list blocks and the "
              f"lexicon marks h-muet, left out of the pool: "
              f"{', '.join(hand_conflicts[:12])}"
              f"{' …' if len(hand_conflicts) > 12 else ''}", flush=True)

    buckets, evidence, lemma, zipf, pool_reasons = build_pool(
        by_form, lemma_gender, corpus_words, blocked, conflicted)
    backfilled = sum(1 for v in evidence.values() if v == "lemma_backfill")
    print(f"[A] {pool_reasons['kept']:,} forms in {len(buckets)} agreement buckets "
          f"({backfilled} genders recovered from the lemma); "
          f"dropped {pool_reasons['ambiguous_or_not_content']:,} ambiguous/non-content, "
          f"{pool_reasons['below_zipf_floor']:,} below the zipf floor, "
          f"{pool_reasons['elision_conflict']:,} with conflicting elision, "
          f"{pool_reasons['blocks_elision_against_spelling']:,} vowel-initial "
          f"forms that block elision, "
          f"{pool_reasons['archaic_rare_or_pejorative']:,} archaic/rare/pejorative",
          flush=True)

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

    accepted = add_specials(accepted, {p["src"] for p in accepted},
                            by_form, corpus_words)
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
