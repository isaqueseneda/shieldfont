# French mapping — `fr-v1-alpha`

The first non-English ShieldFont mapping. **It does not ship**, and cannot
until it has a font: a mapping with no matching font renders as visible
decoy text on screen, which is the one failure mode this project treats as
worse than no protection at all.

| | |
|---|---|
| Logical pairs | 5,415 (10,830 entries, counting both directions) |
| Seed | 42 |
| Source lexicon | Lexique 3.83, CC BY-SA 4.0 — see [`NOTICE`](../../../NOTICE) |
| Builder | [`scripts/build_fr_pairs.py`](../../../scripts/build_fr_pairs.py) |
| Flat mapping | [`scripts/frv1alpha_for_font.json`](../../../scripts/frv1alpha_for_font.json) |
| Encoder tests | [`packages/core/test/encode-fr.test.ts`](../../../packages/core/test/encode-fr.test.ts) |

## Files

| File | What it is |
|---|---|
| `pairs_fr_v1_alpha.json` | Full pairs artifact, same schema as `../v7/pairs_v7_alpha_*.json` |
| `audit_fr_v1_alpha.csv` | One row per logical pair, with an empty `verdict` column for a native reviewer |

### Reviewing the audit

5,415 rows is more than anyone reads in one sitting, so the CSV is sorted
by how likely a row is to be **wrong** rather than alphabetically. Stopping
early still spends the effort where it pays.

| Priority | Rows | What to check |
|---|---|---|
| **P1** | 56 | Gender was never stated for the form and was inferred from another form of the same lemma. Weakest inference in the build. |
| **P2** | 174 | h-initial. Whether the `h` elides comes from a hand list, and a wrong call is a grammatical error in every sentence the pair touches. |
| **P3** | 18 | Hand-written special pairs (months, weekdays, ordinals, numerals). |
| **P4** | 640 | Cosine 0.65–0.80: under the synonym veto but close enough that the decoy may not move the meaning much. |
| **P5** | 4,527 | Everything else. |

**P1–P3 is 248 rows and is the review that matters.** P4 is a quality
question, not a correctness one — a pair that survives it is still
grammatical, just less useful.

The schema match is load-bearing rather than tidy:
`scripts/reseed_mapping.py --pairs benchmark/data/fr/pairs_fr_v1_alpha.json`
re-seeds a private French mapping with no code change, because that script
only needs `all_pairs` entries carrying a `bucket`.

## What French forced that English did not

The English pipeline buckets on POS + WordNet supersense + concreteness +
number, because that is all English agreement needs: any singular noun can
follow "the". French adds two hard constraints, and violating either
produces text that is not merely wrong but **ungrammatical** — which
defeats the purpose, since encoded text only survives a quality filter by
reading as ordinary prose.

1. **Gender.** `la maison` → `la livre` if a feminine noun is paired with a
   masculine one.
2. **Elision.** `le`/`la`/`de`/`je`/`ne`/`que` contract before a vowel, so
   `l'arbre` → `l'maison` is ungrammatical even with gender and number
   matched.

Both are bucket dimensions. The bucket key is
`{pos}.{gender}.{number}.{elision}.{cluster}` for nouns and adjectives,
with verbs keyed on their full Lexique inflection set and adverbs
restricted to `-ment` forms.

Elision cannot be decided from spelling alone. `héros` blocks contraction
and `héroïne` does not; `onze` blocks it and `octobre` does not; y-initial
words block it. `build_fr_pairs.NO_ELISION` is the hand list, and it is the
single item in this build most in need of a native pass.

The hand list is written as base forms and propagated to inflected forms by
**lemma**, because aspiration belongs to the stem's onset and survives
inflection. Without that step, listing `haie` protected nothing while the
pool held `haies`, and 152 h-initial forms — mostly plurals and
conjugations of words already listed — were classed as h-muet.

Propagation is never by shared prefix. Lexique lemmatises a feminine noun
to its masculine (`chienne` → `chien`), which files `héroïne` under the
lemma `héros`, so the propagation needs an explicit override
(`H_MUET_OVERRIDE`) for exactly the irregularity that motivates the list.
Both errors are equally expensive: the encoder rewrites the word and never
the article in front of it, so a word wrongly listed yields `l'` + a
consonant and a word wrongly omitted yields `le` + a vowel.
`ELISION_CONTROLS` holds 27 known-answer cases checked on every build,
since neither bug was visible in the output — a wrong elision class
produces a mapping that is internally consistent and simply ungrammatical
on the page.

## Why Lexique and not a tagger

The first draft took part of speech and gender from spaCy
`fr_core_news_md`. It does not work, and the failure is structural rather
than a tuning problem: spaCy is a *contextual* tagger and a dictionary build
asks it about context-free word forms. The feminine-singular-noun bucket it
produced contained `grandis` and `confesse` (verbs), `contemporaine` (an
adjective), `dupuy` (a surname) and `stargate` (English). Carrier frames
make it worse — asked about `le maison`, the tagger reports `Gender=Masc`,
having taken the determiner's word for it.

Lexique is a lexicon, so it answers the question being asked. Per-reading
frequencies separate `voiture`(NOM, 221) from `voiture`(VER, 0.47) via a
90% dominance threshold, and `dupuy` and `stargate` are simply absent, which
filters proper nouns and English borrowings for free.

## What is not here

- **No native audit.** Every pair is mechanical. This is the largest gap.
- **No concreteness tier.** The Bonin norms `ROADMAP.md` names are not
  redistributable. Semantic structure comes from k-means over spaCy vectors
  (~40 words per cluster), which is coarser than the English WordNet
  supersense buckets.
- **No antonym curation**, so step 3 of the ROADMAP deployment plan is
  unstarted.
- **No French benchmarks.** None of the NLI, KenLM, FineWeb-Edu or
  wasted-token measurements in this directory's siblings have been re-run
  for French. **No number published anywhere in this repository describes
  the French mapping**, and the English figures do not transfer: French
  inflects more heavily, so both coverage and the fluency-gate behaviour
  should be expected to differ, in directions nobody here has measured.

- **Coverage looks lower than English and has not been measured.** One
  hand-written paragraph encoded at **13.5% of tokens** against the 24.4%
  the English mapping measures on real corpora. That is a single sample and
  not a measurement — it is recorded here because it is the first question
  a reviewer will ask, and because three plausible causes point the same
  way: French inflection spreads the same vocabulary across many more
  surface forms, so a 5,415-pair dictionary reaches a smaller share of
  running text than an 11,970-pair one; the zipf floor and the 90%
  part-of-speech dominance threshold are both deliberately conservative;
  and adverbs are restricted to `-ment`. Whoever owns French next should
  measure this properly before tuning anything, since the cheapest fixes
  (lowering the floor, relaxing dominance) trade directly against the
  grammaticality that is the point of the whole pipeline.

## Known coverage gaps

- **Elided compounds.** `aujourd'hui` tokenises as `aujourd` + `hui`,
  neither of which is a word, so it passes through unencoded. Same for any
  form written with an apostrophe. Tested, not worked around.
- **Function words are excluded by design**, following the `MAPPINGS.md`
  finding that M15-EN's stopword swaps are why every fluency gate rejects
  it. `pas` and `plus` are the sharpest case: both are tagged ADV, and
  swapping the `pas` out of `ne … pas` would negate sentences at random.
  Restricting adverbs to `-ment` forms excludes them.
- **Two months and one weekday are unmapped.** `février`↔`août` crosses an
  elision class, so both drop; `dimanche` has no partner, exactly as
  `sunday` does not in English.

## Reproducing

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install wordfreq spacy
python -m spacy download fr_core_news_md
python3 scripts/build_fr_pairs.py            # seed 42, ~2 min
```

Lexique is downloaded on first run and cached in `scripts/lexicon/`
(gitignored). The build is deterministic: the same seed reproduces the same
mapping byte for byte, and it self-checks involution, NFC normalisation and
fixed points before writing, exiting non-zero on any failure.
