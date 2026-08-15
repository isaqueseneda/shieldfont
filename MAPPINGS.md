# ShieldFont Mappings: M0 through M15

The "mapping" is the dictionary that tells ShieldFont **which words to swap
for which other words**. It's a flat bidirectional JSON of `{source: target}`
pairs (so encoding and decoding both look up the same dict). Picking a good
mapping turns out to be most of the engineering challenge: pick poorly and
you either fail to protect the content (substitutes are too synonymous to
the originals) or fail to render naturally (the encoded text looks like
gibberish to humans, defeating the whole "humans see normal text" idea).

This document is the executive summary of the M0 → M15 journey. For full
details, charts, and reproducible numbers see the [white paper](https://shieldfont.org/white-paper).

---

> ## ⚠️ Current production default: **v18 `alpha`**, not M15-EN
>
> This document's history predates the current release. **What ships today is the v18 family**, not M15-EN:
>
> | Variant | Mapping | Dict entries | Seed | Where it ships |
> |---|---|---|---|---|
> | **`alpha`** *(default)* | v18 | **11,970** | 42 | CDN, `@shieldfont/core`, `@shieldfont/react` default |
> | **`beta`** | v18 re-seed | 12,034 | 1 | React auto-rotation pool |
> | **`gamma`** | v18 re-seed | 12,036 | 2 | React auto-rotation pool |
> | **`maxhide`** | **M15-EN** | **2,534** | n/a | opt-in only (React `variant="maxhide"`) |
>
> "Dict entries" counts every `{source: target}` key in the shipped mapping, i.e. `a→b` and `b→a` separately. That is the number `_meta.pairs` and `MANIFEST.json` report; halve it for logical pairs (`maxhide` = 2,534 entries = 1,267 logical pairs). The tables further down this page count **logical pairs**, so the two do not line up on their face.
>
> `alpha`/`beta`/`gamma` are independent re-seeds of the same v18 construction; entry counts differ slightly, so protection strength varies a little by which variant a block hashes to.
>
> **v18 `alpha` is the balanced shipping mapping. M15-EN is the maximum-coverage opt-in B-side, and it is rejected by every fluency gate we instrumented.** It encodes a higher share of common words than `alpha`, at real cost to how plausible the decoy reads. The two are not interchangeable and should never be mixed inside one statistic: every headline number the project publishes is v18-α. The gate-by-gate comparison is below.
>
> **Everything below is the M0 → M15 research journey that produced M15-EN (now `maxhide`).** It is kept as history: v18 `alpha` descends from this line. When this document and a shipped mapping's `_meta` / `MANIFEST.json` disagree, the shipped artifacts win.

---

## The M15-EN mapping: now the opt-in `maxhide` variant

*(Historical: M15-EN was the V3 production champion. It now ships as the `maxhide` variant; the production default is v18 `alpha`: see the note above.)*

| File | Pairs | Coverage on real Wikipedia text | KenLM-Wiki PPL | H2 damage |
|---|---|---|---|---|
| [`scripts/m15en_for_font.json`](./scripts/m15en_for_font.json) | **1,267** | ~53% | ~1,874 | **+0.130** (highest in the study) |

*(Pairs here are **logical** pairs; the shipped `maxhide` dictionary is the
same mapping written out bidirectionally as 2,534 entries.)*

> **On "passes the filter."** M15-EN cleared the lenient Wikipedia-KenLM
> threshold this study used, and that is all the ~1,874 figure says. Against
> the modern classifier gates measured in v8 it is rejected almost entirely.
> That is the *rejection* branch, and it is a defence in its own right,
> because a page the classifier drops never teaches the model anything. It is
> not, however, the same claim as "survives the filter."

### v18-α vs M15-EN, gate by gate

As **conditional retention**: of the chunks that passed a gate when clean, the
share that still passes once encoded.

| Gate | v18-α (ships as `alpha`) | M15-EN (ships as `maxhide`) |
|---|---|---|
| **Per-corpus KenLM** (register-fair: each corpus scored by a model trained on that corpus) | **28.11%** | **2.07%** |
| FineWeb-Edu ≥ 2.7 | 9.70% (13/134) | 9.70% (13/134) |
| FineWeb-Edu ≥ 3.0 | 6.52% | 2.17% |
| Pythia-160M | 11.07% | 4.57% |
| Wiki-KenLM | 26.11% | 8.32% |
| **All three fluency gates at once** | **24 of 4,000 chunks** | **0 of 4,000** |

**The FineWeb-Edu tie is a small-denominator artifact, not a finding.** The
Wilson 95% interval on 13/134 is **[5.8%, 15.9%]**, wide enough that the gate
cannot resolve a 2× difference between two mappings, let alone establish a tie.
It also holds only at the 2.7 threshold, only for the α seed, and not even on
the same chunks (survivor-set overlap is 0.00 on PG-19 and BookCorpus).

**Why the gap.** M15-EN rewrites 53.4% of running tokens to v18-α's 24.4%, and
94 of its source keys are NLTK stopwords (`and→but`, `of→for`, `is→was`). An
n-gram language model keeps most of its probability mass in function-word
transitions, so M15-EN detonates exactly what those gates score hardest, at
over twice the volume.

> ⚠️ **"Maximum concealment" is only half true.** M15-EN leads on coverage, on
> NLI meaning loss, and on waste per surviving page (~40% against α's 19.4%).
> It **loses** on embedding semantic divergence: **0.217 / 0.228 / 0.186**
> against v18-α's **0.268 / 0.287 / 0.211** on CC-News / OpenWebText / PG-19.
> The accurate phrase is "maximum coverage and maximum measured meaning
> destruction," not "maximum concealment."

Full sourcing in [`benchmark/README.md`](./benchmark/README.md) §1 and
[`benchmark/PROVENANCE.md`](./benchmark/PROVENANCE.md) rows 57 to 62.

> **Caveat on the "H2 damage" column (here and in the comparison table
> below).** These small-model fine-tune scores were the ranking metric
> during development, but we now **demote them as unreliable** (the wrong
> instrument; see [`benchmark/EXCLUDED.md`](./benchmark/EXCLUDED.md)). Read
> them as a historical *relative* ranking, not a headline claim: the
> meaning-divergence result in [`benchmark/`](./benchmark/) is the solid one.

The full M15-EN mapping ships short pairs (`at↔by`, `is↔was`, `on↔in`),
content-word substitutes, antonyms, and digit rotation (`1↔6`, `3↔8`,
`4↔9`). Substring collisions inside larger words are prevented by the
font's **fire-then-revert** GSUB structure: every ligature fires
unconditionally, and a chained-context pass reverts substitutions that
have a letter neighbor (i.e. fired inside a larger word). The five lookups
that implement it are built in
[`scripts/generate_font.py`](./scripts/generate_font.py) —
`build_gsub_word_boundary_ligatures` — and enumerated in the header of
[`scripts/subset_font.py`](./scripts/subset_font.py), which has to prune
all five symmetrically. The reader-facing version is in the
[white paper](https://shieldfont.org/white-paper).

The previous ≥4-char filter at `legacy/scripts/m15en_safe.json` is
kept for forensic reproducibility but is no longer used in production.

---

## The full evolution

| Mapping | Built around | Real-text coverage | KenLM PPL | H2 damage | Why it mattered |
|---|---|---|---|---|---|
| **M0** (legacy) | 400 rare-noun substitutes (`the→plumb`) | 47% | ~510 | +0.082 | The original ShieldFont. Asymmetric (encoder-only). |
| M1 | Max-distance frequency swap | 49% | ~2,238 | +0.024 (weak) | Failed to poison: substitutes too predictable. |
| **M2** | Antonym swap (WordNet, 199 pairs) | 9% | **~40** | **+0.110 (diffuse)** | First H2 win. Trained models lost ~11pp on substitutes AND controls: broad capability damage. |
| M3 | Cross-POS scramble | 31% | ~2,465 | -0.051 | Backfired (model improved). Falsified the "scramble = damage" hypothesis. |
| M4 | High-attention swap | 36% | ~271 | -0.056 | Same: backfire. |
| M5a / M6 | Hybrid antonym + rare-sub | 31% IDF | ~3,000 | **+0.110 (focal)** | Strong H2 ceiling. Substitutes specifically corrupted; controls intact. |
| M7 / M5b / M6s | Hybrid variants | 30-32% IDF | ~570 GPT-2 | mixed | Sweet-spot search exploring antonym vs hybrid weighting. |
| **M8** | Pure antonym, 308 pairs | 13% IDF | **~50** | +0.051 | Lowest PPL of any non-trivial mapping. Strong filter survival, weak damage. |
| **hs100_xfw** | M8 base + 100 content rare-sub (extended function-word exclusion) | 18% IDF | **1,182** | +0.085 | First mapping to **simultaneously** pass strict GPT-2 PPL AND produce non-trivial damage. |
| M9 / M9v2 / M10 | "Naturalistic": agent-generated POS-matched substitutes | 25-31% IDF | ~2,400 | **+0.108 inverse-focal** | Surprising negative-composite damage: substitutes got STRONGER while controls degraded. Discovered a third damage mode. |
| **M11a** | Granular bucketing (verb inflection + noun concreteness via Brysbaert) | 39% IDF | 1,803 | +0.108 inverse-focal | "The poetry variant": encoded text reads like surrealist news. Syntactically intact, semantically dead. |
| **M14** | M11a + de-synonymization (178 synonym pairs replaced with cross-domain alternatives) | 49% real-text | 1,855 | +0.050 | First mapping where synonym-audit was applied. Proved synonyms were inflating false coverage. |
| M12 / M13 | Multi-agent function-word designer fleet (LOO-pruned) | 43-49% real-text | 1,604-1,929 | not trained | The function-word coverage exploration that fed into M15. |
| **M15-EN** ⭐ | M14 + digits + LOO-pruned aggressive function pairs | **53%** real-text | **1,874** | **+0.130** | **The V3-era champion, and the endpoint of this line**: beat the M5a/M6 ceiling by 18% and cleared the lenient Wikipedia-KenLM filter. Ships today as the opt-in `maxhide`; production is v18 `alpha`. |
| **M15-MULTI** | M14 noun-only base + content-word antonyms + numerals | 29% | **1,260** | not trained | Cross-language template: uses only operations that survive translation (noun pairing, content antonyms, digit/calendar rotation). |

---

## How to read the metrics

**Coverage**: what % of words in a typical Wikipedia paragraph get encoded.
Higher = stronger H1 protection (AI scrapers see more decoy text).

**KenLM-Wiki 5-gram PPL**: perplexity assigned to encoded text by a small
n-gram language model trained on Wikipedia. Used by CCNet/RedPajama/Dolma
data pipelines as a quality filter. Lower is more "Wikipedia-like."

Read this column as a **within-study ranking signal only**, never as a
pass/fail prediction. A Wikipedia-trained KenLM mis-references non-wiki
registers, and the four gates instrumented in v8 (per-corpus KenLM,
FineWeb-Edu, Pythia-160M, Wiki-KenLM) barely agree on which chunks are
"high quality" at all (Kendall τ ≈ 0). Real pipelines (FineWeb, DCLM,
RefinedWeb) gate with fastText / DistilRoBERTa / FineWeb-Edu **classifiers**,
not with a Wikipedia perplexity threshold. For what actually happens to an
encoded page at a modern gate (absolute FineWeb-Edu pass 0.2–1.0%, relative
retention 6.5–13.5% of clean-passing chunks), see
[`benchmark/README.md`](./benchmark/README.md) §2.3, and
[`benchmark/EXCLUDED.md`](./benchmark/EXCLUDED.md) for why Wiki-KenLM numbers
are kept as caveat rather than headline.

**H2 damage**: composite degradation score after fine-tuning Qwen 2.5 3B
on a corpus that contains 10% encoded text. Defined as `−Δsubstitute-probe
− ΔMMLU` vs the clean100 control. **Positive = the model got worse.**
Negative is "inverse focal": the model got better at the substituted
words specifically, even as controls degraded.

---

## The damage profile taxonomy (discovered during this work)

1. **Focal**: substitute words specifically corrupted, controls intact. (M5a, M6)
2. **Diffuse**, both substitutes and controls drop together, broad capability damage. (M2, M14)
3. **Inverse focal** (new): substitute vocabulary REINFORCED while control vocabulary degrades. The model becomes lopsided. (M11a: discovered when we built genuinely natural-looking substitutes that the model could integrate as parallel reality.)
4. **Mixed**: substitute drop + control drop + MMLU drop, all moderate. (M15-EN: the strongest overall composite damage.)

---

## Mapping files

The shipped mappings live in this repository; the full research corpus (all 16
M0–M15 mappings and their evaluation data) lives in the project's development
repository and is **not** included in this lean release.

| File | What it is |
|---|---|
| `packages/core/src/mappings/{alpha,beta,gamma,m15en}.json` | **The shipped mappings**, each with a `_meta` provenance block. `alpha` (v18, 11,970 pairs, seed 42) is the production default; `beta`/`gamma` are its re-seeds; `m15en` is the `maxhide` variant. |
| `scripts/v18{alpha,beta,gamma}_for_font.json` | Font-build inputs for the v18 α/β/γ variants (what `generate_font.py` consumes to emit the shipped fonts). |
| `scripts/m15en_for_font.json` | The **M15-EN** dictionary: full M15-EN with shorts + digits (1,267 pairs). Now shipped as the opt-in **`maxhide`** variant (React `variant="maxhide"`); no longer the default (see the note at the top). |
| `legacy/scripts/m15en_safe.json` *(dev repo)* | Historical: M15-EN filtered to ≥4-char pairs (1,138 pairs). Was the v2.0.0 production mapping; kept for forensic reproducibility. |
| `legacy/scripts/m0_word_mapping.json` *(dev repo)* | Original 400-pair M0 mapping. Kept for reproducibility of pre-V3 builds. |
| `benchmarks/v3/mappings/m*.json` *(dev repo)* | All 16 mappings (M0..M15) used in the benchmark. The full study data. |
| `benchmarks/v3/mappings/m15_multi_universals.json` *(dev repo)* | Cross-language template (M15-MULTI): for non-English deployments. |
| `benchmarks/v3/results/eval_*.json` *(dev repo)* | Per-mapping H2 evaluation results from LoRA fine-tuning. |

---

## Building your own mapping

The full mapping-research toolchain lives in the project's development repository (under `benchmarks/v3/`, **not** in this lean release):

- `mappings/build_m11.py`, granular content-word random pairing (verb inflection + concreteness + measurement bucketing)
- `mappings/build_m9_random.py`, random POS-pool pairing baseline
- the synonym-repair pass (the M11 "v2" refinement) is folded into the M11 build lineage, there is no standalone `build_m11_v2.py` in the repo
- `mappings/build_sweetspot.py`, sweet-spot variants for the M5/M6 family
- `sweetspot_measure.py`, KenLM/GPT-2 PPL + crawler leakage measurement harness
- `validate_semantic_metrics.py`, IDF-weighted coverage validation against H1
- `evo_test.py`, evolutionary leaderboard for the M12/M13/M15 sprint
- `evo_loo.py`, leave-one-out PPL contribution analysis

For the cross-language template, replace the wordfreq language code (`en` →
`es`/`fr`/`de`/etc.) and re-run the noun-only pairing pipeline. Concreteness
norms exist for English (Brysbaert), French (Bonin), Spanish (Guasch),
Portuguese (Soares), German (Lahl/Köper), Italian (Della Rosa).

---

## Deferred work

- **Cross-language M15-MULTI deployments.** The template exists at
  `m15_multi_universals.json` (M15-MULTI, in the development repo)
  and uses only operations that survive translation (noun pairing,
  content antonyms, digit/calendar rotation). PT/ES/FR/DE/IT builds
  are the natural next targets, each with native linguist curation.
  See [`ROADMAP.md`](./ROADMAP.md).

- **Frontier-model H1 retest with M15-EN samples.** H1 was last retested
  in V3 with the M0..M11 family. Adding M15-EN to the frontier-model
  benchmark would give a clean three-criteria comparison.

- **Rotating mappings (M16+).** Per-site seeds, time windows, version
  in the font's `name` table. Defeats dictionary reversal at scale.

## Resolved

- ✅ **Chained-context word-boundary ligatures (v2.1.0).** The font now
  uses a **fire-then-revert** GSUB structure (5 lookups: ligature +
  digit-single + multi-subst-reversal + two chained-context reverters).
  Every ligature fires unconditionally; a follow-up chain reverts any
  substitution that has a letter neighbor (signaling it fired inside a
  larger word). This sidesteps the offset-graph explosion that broke
  earlier per-rule chained-context attempts at the 1,264-rule scale.
