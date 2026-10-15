# French mapping: `fr-v1-alpha`

Status: `building`. Does not ship (see `../README.md`). A mapping with no
matching font renders as visible decoy text on screen, which is the one
failure mode this project treats as worse than no protection at all.

| | |
|---|---|
| Logical pairs | 6,441 (12,882 entries, counting both directions) |
| Seed | 42 |
| Dictionary used | Grammalecte lexicon v7.7, MPL 2.0, [grammalecte.net](https://grammalecte.net/) |
| Build script | [`build/build_pairs.py`](build/build_pairs.py) |
| Word pairs | [`data/pairs_fr_v1_alpha.json`](data/pairs_fr_v1_alpha.json) |
| Flat word list for the font | [`data/fr_v1_alpha_for_font.json`](data/fr_v1_alpha_for_font.json) |
| Review sheet | [`audit/audit_fr_v1_alpha.csv`](audit/audit_fr_v1_alpha.csv) |
| Encoder tests | [`tests/encode-fr.test.ts`](tests/encode-fr.test.ts) |

### Reviewing the audit

6,441 rows is more than anyone reads in one sitting, so the CSV is sorted
by how likely a row is to be **wrong** rather than alphabetically. Stopping
early still spends the effort where it pays.

| Priority | Rows | What to check |
|---|---|---|
| **P1** | 0 | Gender was never stated for the form and was inferred from another form of the same lemma. Grammalecte states gender on every noun, so this is empty; the check stays for the next lexicon. |
| **P2** | 217 | h-initial. Whether the `h` elides comes from `NO_ELISION` and the lexicon's markers, and a wrong call is a grammatical error in every sentence the pair touches. |
| **P3** | 19 | Hand-written special pairs (months, weekdays, ordinals, numerals). |
| **P4** | 827 | Cosine 0.65–0.80: under the synonym veto but close enough that the decoy may not move the meaning much. |
| **P5** | 5,378 | Everything else. |

**P2–P3 is 236 rows and is the review that matters.** P4 is a quality
question, not a correctness one — a pair that survives it is still
grammatical, just less useful.

The pairs file is in the shared schema, so
`scripts/reseed_mapping.py --pairs languages/fr/data/pairs_fr_v1_alpha.json`
re-seeds a private French mapping with no code change, and
`scripts/check_pairs.py` passes on it.

## Grammar this language needs that English does not

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
with verbs keyed on their full inflection set (every mood and person the
form serves) and adverbs restricted to `-ment` forms. Gender is `m`, `f`
or `e` (epicene: `enfant`, `rapide`) and number is `s`, `p` or `i`
(invariable: `souris`); an epicene word is only ever paired with another
epicene word, so it agrees with whatever the original agreed with. A form
that is both a noun and an adjective (`grand`, `politique`) goes in its own
`nomadj` bucket.

Elision cannot be decided from spelling alone. `héros` blocks contraction
and `héroïne` does not; `onze` blocks it and `octobre` does not; y-initial
words block it. Two sources decide it, and they are checked against each
other on every build:

- `NO_ELISION` in `build/build_pairs.py`, the hand list. It is the single
  item in this build most in need of a native pass.
- Grammalecte's own `Notes` markers: `pel` (blocks elision, about 3,700
  forms) and `hm` (h muet, about 4,800 forms).

A form either source says blocks elision is classed as blocking. A form the
hand list blocks and the lexicon marks h-muet is left out of the pool and
printed by the build; today that is `hebdo` and `hebdos`. Vowel-initial
forms that block elision (`onzième`, `oui`, `ouate`) are left out too, so
the elision invariant stays checkable from spelling alone, which is how the
encoder test checks it.

The hand list is written as base forms and propagated to inflected forms by
**lemma**, because aspiration belongs to the stem's onset and survives
inflection. Without that step, listing `haie` protected nothing while the
pool held `haies`, and 152 h-initial forms — mostly plurals and
conjugations of words already listed — were classed as h-muet.

Propagation is never by shared prefix. Lexique lemmatised a feminine noun
to its masculine (`chienne` → `chien`), which filed `héroïne` under the
lemma `héros`, so the propagation needed an explicit override
(`H_MUET_OVERRIDE`) for exactly the irregularity that motivates the list.
Grammalecte gives `héroïne` its own lemma and marks it h-muet; the override
stays so a lexicon update cannot undo it silently.
Both errors are equally expensive: the encoder rewrites the word and never
the article in front of it, so a word wrongly listed yields `l'` + a
consonant and a word wrongly omitted yields `le` + a vowel.
`ELISION_CONTROLS` holds 29 known-answer cases checked on every build,
since neither bug was visible in the output — a wrong elision class
produces a mapping that is internally consistent and simply ungrammatical
on the page.

## Why a lexicon and not a tagger

The first draft took part of speech and gender from spaCy
`fr_core_news_md`. It does not work, and the failure is structural rather
than a tuning problem: spaCy is a *contextual* tagger and a dictionary build
asks it about context-free word forms. The feminine-singular-noun bucket it
produced contained `grandis` and `confesse` (verbs), `contemporaine` (an
adjective), `dupuy` (a surname) and `stargate` (English). Carrier frames
make it worse — asked about `le maison`, the tagger reports `Gender=Masc`,
having taken the determiner's word for it.

A lexicon answers the question being asked, and `dupuy` and `stargate`
are simply absent from it, which filters proper nouns and English
borrowings for free.

## Why Grammalecte and not Lexique

The first draft read Lexique 3.83. Lexique is CC BY-SA 4.0, and the
maintainers want this repository under AGPL-3.0 alone; the share-alike
terms carry over to the word pairs. Grammalecte's lexicon is MPL 2.0.

What the switch cost:

- **Homographs across parts of speech are gone.** Lexique counted each
  reading of a form separately, so the first draft could keep `voiture` as
  a noun because it is one 99.8% of the time. Grammalecte has a
  `Total occurrences` column that looks like the same thing and is not: it
  gives nearly the whole count to the noun reading wherever there is one
  (`lit` 96% "bed", `est` 98% "east", `soutiens` 94% "supporters"). Trusting
  it swapped `est` for `obélisque`. So any form that is more than one part
  of speech is left out, common nouns like `marche`, `livre` and `danse`
  included. A noun-and-adjective form is the one exception (see above).
- **The frequency floor is a proxy.** wordfreq is CC BY-SA 4.0 as well, so
  the Zipf floor now comes from the lexicon's own per-corpus counts: the
  mean of a form's Zipf in Google Books and in Wikipedia. Checked against
  wordfreq's own Zipf ≥ 3.0 split over every lowercase content form, that
  measure agrees best (F1 0.83, at the same 3.0 cut), against 0.77 for
  Google Books alone, which leans on old books (`épizooties` in,
  `courriel` out). Readings the lexicon marks archaic, rare or pejorative
  are dropped as well.

What it gained: epicene and invariable forms are paired with each other
instead of dropped, elision is marked in the data rather than only in a hand
list, and `œ` is now treated as the vowel it is (`l'œil`), which the first
draft got wrong and never exercised because no `œ` word reached its pool.

The pool is larger than the first draft's (21,351 forms against 17,938) and
gives 6,441 pairs against 5,415. Most of the difference is the epicene,
invariable and `nomadj` buckets, which the first draft dropped.

## What is not here

- **No native audit.** Every pair is mechanical. This is the largest gap.
- **No concreteness tier.** The Bonin norms `ROADMAP.md` names are not
  redistributable. Semantic structure comes from k-means over spaCy vectors
  (~40 words per cluster), which is coarser than the English WordNet
  supersense buckets.
- **The vectors' licence is not settled.** spaCy `fr_core_news_md` is
  LGPL-LR. Whether an input that only steers clustering and the semantic
  veto has to be replaced is open with the maintainers.
- **Adjective position is not a bucket dimension.** Most French adjectives
  follow the noun and a few precede it (`grand`, `petit`, `beau`), so a
  pair across the two reads oddly (`un grand homme` → `un sanscrit homme`).
  The first draft had the same gap.
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
  running text than an 11,970-pair one; the zipf floor and the refusal of
  part-of-speech homographs are both deliberately conservative;
  and adverbs are restricted to `-ment`. That sample was taken on the
  Lexique build and has not been retaken. Whoever owns French next should
  measure this properly before tuning anything, since the cheapest fixes
  (lowering the floor, admitting homographs) trade directly against the
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
pip install spacy
python -m spacy download fr_core_news_md
python3 languages/fr/build/build_pairs.py          # seed 42, ~15 s once cached
python3 scripts/check_pairs.py languages/fr/data/pairs_fr_v1_alpha.json
```

The Grammalecte lexicon (12 MB zip) is downloaded on first run and cached in
`languages/fr/build/.cache/` (gitignored). The build is deterministic: the
same seed reproduces the same mapping byte for byte, and it self-checks the
elision controls, involution, NFC normalisation and fixed points, exiting
non-zero on any failure.
