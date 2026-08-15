# PROVENANCE — every number in README.md → its source

Paths under `benchmark/data/`, `scripts/`, or `packages/` are **in this repo**
— check them yourself. Any other path (e.g. `benchmarks/v3/...`, `site/...`,
`whitepaper-v2/...`) lives only in the project's private development
repository and is marked **(dev repo)** wherever it's cited; those rows are
author-checked, not independently reproducible by a third party.
**VERIFIED** = the exact value was read out of that source file.
**ASSUMED** = taken from background notes or the white paper prose
without an independent computed source in the benchmark data.

Legend for JSON: `file › key.path` means the value lives at that key.

---

## §1 — Shipped-mapping parameters

| # | README claim | Source | Status |
|---|---|---|---|
| 1 | α = internal `v15_0_1_0_0_0_0`, seed **42** | `benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json › _seed` = 42; `_v15_cell` = "v15_0_1_0_0_0_0" | VERIFIED |
| 2 | β seed **1**, γ seed **2** | `benchmarks/v7/data/pairs_v7_alpha_v18_b.json › _seed` = 1; `…_v18_c.json › _seed` = 2 (both dev repo only — the β/γ source pairs are not shipped, only α's). Also `benchmark/data/v7/BUILDING_VARIANTS.md:14-17` ("seeds 42 / 1 / 2") | VERIFIED |
| 3 | α is *pair-identical* to `v18_a` | Computed: src→tgt set of both files identical, symmetric-difference = 0 (both 11,988 `all_pairs`). NB the two files are **not byte-identical** (differ in metadata/serialization); `BUILDING_VARIANTS.md:182` overstates "byte-identical" | VERIFIED (+flag) |
| 4 | K-cell = **K1+K6 only**; six-knob decoder | `benchmark/data/v7/…v15_0_1_0_0_0_0.json › _v15_factors` = {K7b_freeze:0, K6_rotation:1, K5_top_n:0, K4_selectional:0, K_base_ext:0, F4_bigram_gate:0}. Decoder text: `benchmark/data/v7/BUILDING_VARIANTS.md:26-41`; K1 always-on stated `:37` | VERIFIED |
| 5 | Base pool = **v11** | `…v15_0_1_0_0_0_0.json › _v15_base` = "v11"; `_clustering.input` = "v11" | VERIFIED |
| 6 | Bucket dims = POS · inflection · concreteness · supersense | `benchmark/data/v7/BUILDING_VARIANTS.md:149` (Phase 1B "bucket every surface form by (POS, inflection, concreteness, supersense)"); bucket names confirmed in `…v15_0_1_0_0_0_0.json › buckets` (e.g. `verb.transitive.VB_VBP`, `noun.artifact.concrete.sing`, `adj.non_gradable.pos`, `adv.adv.all`) | VERIFIED |
| 7 | Pairing = **random within bucket**, only seed-dependent step | `benchmark/data/v7/BUILDING_VARIANTS.md:150,155-158` (Phase 1C "Random pairwise matching within bucket … Only Phase 1C … consume the seed") | VERIFIED |
| 8 | Semantic vetoes + exact reject tallies | `…v15_0_1_0_0_0_0.json › _reject_reasons` = {cosine_missing:18690, dominant_pos_mismatch:5502, verbnet_frame_jaccard_low:4598, in_top_k_nn:1486, wn_hypernym:206, wn_synonym:20, cosine_too_high:4, wn_hyponym:2} | VERIFIED |
| 9 | Source words **13,360**; buckets **204** (167 used); candidates **13,132**; accepted **11,988**; acceptance **0.816** | `…v15_0_1_0_0_0_0.json › _n_source_words / _n_buckets / _n_buckets_used / _n_candidate_pairs / _n_accepted_pairs / _acceptance_rate` | VERIFIED |
| 10 | α digit permutation 0↔5, 3↔8, 4↔9, 6↔7 | `…v15_0_1_0_0_0_0.json › _digit_permutation` = {"0":"5","5":"0","3":"8","8":"3","4":"9","9":"4","6":"7","7":"6"} | VERIFIED |
| 11 | Clustering added **1,456** pairs | `…v15_0_1_0_0_0_0.json › _clustering` = {input:"v11", added:1456, added_clusters:1456} | VERIFIED |
| 12 | Logical pairs 5,994 / 6,023 / 6,024 (α/β/γ) | `benchmark/data/v8/results/INTERIM_REPORT.md:9-11` (Phase-0 "Unique pairs" 5,994 / 6,023 / 6,024) | VERIFIED |
| 13 | Bidirectional entries 11,988 / 12,046 / 12,048 | `benchmark/data/v7/results/v18_variants_eval.json › [].n_pairs`; also `benchmark/data/v8/README.md:78-80` | VERIFIED |
| 14 | Shipped flat-file entries 11,976 / 12,037 / 12,040 (v18) and 2,534 (M15) | Computed from `scripts/v18alpha_for_font.json` (11,976 = 11,968 words + 8 digits), `v18beta_for_font.json` (12,037), `v18gamma_for_font.json` (12,040), `m15en_for_font.json` (2,534 = 2,528 words + 6 digits) | VERIFIED |
| 15 | Flattening drops collisions (last-write-wins) + adds digit entries | `scripts/build_alpha_mapping.py:26-36` (collision counter, digit loop) | VERIFIED |
| 16 | M15-EN = 2,534 dict entries = 1,267 logical pairs | `benchmark/data/v8/README.md:76,89`; `MAPPINGS.md:21` (1,267); shipped file confirms 2,534 | VERIFIED |
| 17 | M15-EN digits 1↔6, 3↔8, 4↔9; shorts + antonyms; ~53% coverage | `MAPPINGS.md:23-26,54` | VERIFIED |
| 18 | M15-EN wiki-KenLM rise ~266%; over ~150% cliff → fails modern gates | `site/app/white-paper/page.tsx:745` (dev repo) ("M15 266% … on the wrong side of the cliff") | VERIFIED |
| 19 | M15-EN v8 per-corpus KenLM pass 0–1.6% | `benchmark/data/v8/results/FINAL_REPORT.md:46,53` (m15_en 1.6% / 0.0% / 0.3%) | VERIFIED |
| 20 | m0_v3 = 400 pairs (`the→plumb`, `of→bezel`), function-word swaps, ~47% cov | `benchmark/data/v8/data/mappings/m0_v3.json › all_pairs` (len 400, samples the→plumb, of→bezel); `benchmark/data/v8/README.md:81` | VERIFIED |

## §1 — per-variant objective metrics table

| # | README claim | Source | Status |
|---|---|---|---|
| 21 | α: mass 27.49%, content 48.36%, info 34.27%, sem_div 0.2973, kenlm 120.8%, pass_27 10.27% | `benchmark/data/v7/results/v18_variants_eval.json › [0]` (cell v18_a) | VERIFIED |
| 22 | β: n 12,046, mass 27.81, content 48.95, sem_div 0.2991, kenlm 127.6, pass_27 12.98 | `benchmark/data/v7/results/v18_variants_eval.json › [1]` | VERIFIED |
| 23 | γ: n 12,048, mass 27.71, content 48.85, sem_div 0.2954, kenlm 122.8, pass_27 6.73 | `benchmark/data/v7/results/v18_variants_eval.json › [2]` | VERIFIED |

> **Note / minor internal disagreement (both internally consistent):**
> `benchmark/data/v7/V18_FINAL.md:139` reports the *v15-baseline* numbers as
> content **46.4%**, KenLM **114.9%**, sem-div **0.297**, pass_27 **10.27%**
> (from the 512-cell mega harness), while `v18_variants_eval.json` (the
> dedicated α/β/γ re-eval, matching `BUILDING_VARIANTS.md:300`) gives content
> **48.36%**, KenLM **120.8%**. They agree on sem-div (~0.297) and pass_27
> (10.27%). README uses the `v18_variants_eval.json` figures. VERIFIED both.
>
> **On the `pass_27` values in rows 21–23.** These are v7-harness readouts on
> curated corpora. README no longer prints this per-variant metrics table, and
> quotes none of these `pass_27` values as a filter-survival claim; the rows are
> retained as provenance for the v7 eval. For what the README does claim about
> filter survival, see rows 42a/42b and flag F-F.

---

## §2.1 — NLI hero (headline)

| # | README claim | Source | Status |
|---|---|---|---|
| 24 | v7 mean bidir-fail **59.6 / 61.3 / 60.0%** (α/β/γ) → "~60%" | `benchmark/data/v7/results/v18_variants_nli.json › v18_a.__avg__.bidir_failure_rate` = 0.5958, `v18_b…` = 0.6125, `v18_c…` = 0.6000 | VERIFIED |
| 25 | v7 **83.3%** books peak (γ) → "up to ~83% narrative prose" | `benchmark/data/v7/results/v18_variants_nli.json › v18_c.books.bidir_failure_rate` = 0.8333 (α books 0.7333, β books 0.80) | VERIFIED |
| 26 | v7 n = **60** chunks/corpus, 4 corpora (wiki/books/webtext/reddit) | `v18_variants_nli.json › *.*.n` = 60; `benchmark/data/v7/scripts/eval_v18_nli_meaning.py:41` (CORPORA), `:34` (n=60) | VERIFIED |
| 27 | NLI model = `cross-encoder/nli-deberta-v3-base`; bidir-fail = either dir P_entail<0.5 | `benchmark/data/v8/scripts/eval_phase1_semdiv.py:131,200`; same model in v7 `eval_v18_nli_meaning.py` | VERIFIED |
| 28 | v8 median bidir-fail **50.4%** (3 corpora, n=1,000/corpus, pre-registered) | `benchmark/data/v8/results/FINAL_REPORT.md:8,30` and `benchmark/data/v8/phase1_semdiv/results/semdiv_extended.json › falsification_bars.F1b.actual` = 0.504 | VERIFIED |
| 29 | α/β/γ within 2.4pp (family property) | `benchmark/data/v8/results/INTERIM_REPORT.md:74` (medians 51.9/49.5/50.4%) | VERIFIED |
| 30 | Synonym-swap control **~2%** bidir-fail | `semdiv_extended.json › derived.synonym_swap_nli_bidir_fail_median` = 0.021 (per-corpus 2.5/1.9/0.9/2.3%); `FINAL_REPORT.md:8` says 2.1% | VERIFIED |
| 31 | v8 n = **1,000** chunks/corpus, real corpora CC-News/OWT/PG-19 | `benchmark/data/v8/phase1_semdiv/results/semdiv_extended.json › results.v18_a.cc_news.n` = 1000 (every corpus entry agrees); `eval_phase1_semdiv.py:44` sets a **target** of `N_CHUNKS=1500`, but the actual stored per-chunk counts are 1,000 — the run script's config constant and its output disagree, and the output is authoritative. The live white paper (`site/app/white-paper/page.tsx:662`, dev repo) also states "1,000 passages each," confirming 1,000 is correct. **This corrects a prior version of this row, which quoted the stale 1,500 config constant.** | VERIFIED (corrected) |
| 32 | ⚠️ "83% books" did NOT replicate: v8 fiction (pg19/bookcorpus) = **31–35%** | `semdiv_extended.json › results.v18_a.pg19.nli_bidir_fail` = 0.311, `.bookcorpus` = 0.345; β/γ 0.32–0.34; `FINAL_REPORT.md:34` ("PG-19 … 31-34% … weakest corpus") | VERIFIED (loud flag) |
| 33 | ⚠️ 4-corpus v8 median drops to **41.8%** when bookcorpus added | `semdiv_extended.json › derived.v18_nli_bidir_fail_median_across_corpora` = 0.418 (vs `falsification_bars.F1b.actual` 0.504 computed on original 3 corpora — a genuine within-file inconsistency; FINAL_REPORT reports the 3-corpus 50.4%) | VERIFIED (loud flag) |

## §2.1 — supporting hero-claim prose (white paper)

| # | README claim | Source | Status |
|---|---|---|---|
| 34 | "~25% of tokens swapped" framing | `site/app/white-paper/page.tsx:92,302` (dev repo). Corresponds to α **mass_pct 27.49%** (`v18_variants_eval.json`). "25%" is the rounded surface/mass swap rate, distinct from **content** coverage ≈48% | VERIFIED (mass_pct); rounding ASSUMED |

---

## §2.2 — Semantic divergence

| # | README claim | Source | Status |
|---|---|---|---|
| 36 | α sem-div **0.297** (v7) | `benchmark/data/v7/results/v18_variants_eval.json › [0].sem_div` = 0.2973 | VERIFIED |
| 37 | α sem-div **0.268** median (v8) | `benchmark/data/v8/results/FINAL_REPORT.md:8,29`; `semdiv_extended.json › falsification_bars.F1a.actual` = 0.268 | VERIFIED |
| 38 | family ~0.27–0.30 across seeds | `semdiv_extended.json › results.{v18_a,v18_b,v18_c}.__median__.sem_div_mean` = 0.2656 / 0.2690 / 0.2644 (4-corpus); v7 0.2973/0.2991/0.2954 | VERIFIED |
| 39 | sem-div method = 1−cos, `all-MiniLM-L6-v2` | `eval_phase1_semdiv.py:127,188-190` | VERIFIED |
| 40 | m0_v3 sem-div **0.46–0.53** (higher, grammar-breaking) | `FINAL_REPORT.md:25` and `semdiv_extended.json › results.m0_v3` (cc_news 0.465, owt 0.495, pg19 0.529) | VERIFIED |
| 41 | Interpretation: muted sem-div is a feature (grammar preserved) | `FINAL_REPORT.md:31,157`; `INTERIM_REPORT.md:96-98` | VERIFIED |

---

## §2.3 — Staleness / filter survival

| # | README claim | Source | Status |
|---|---|---|---|
| 42 | α FineWeb-Edu **conditional retention 10.27%**, v7 harness on curated wiki/books/webtext | `benchmark/data/v7/results/v18_variants_eval.json › [0].pass_27` = 10.27; `V18_FINAL.md:139`. `pass_27` is conditional **by construction**: `benchmarks/v7/scripts/eval_v18_variants.py (dev repo):107-111` sets the denominator to the chunks whose *clean* version already scored ≥2.7. It measures the same quantity as row 42b, on a different corpus set | VERIFIED; see flag F-F |
| 42a | α FineWeb-Edu pass, **absolute** (v8, real corpora): **0.2% / 1.0% / 0.2%** (cc_news / owt / pg19) against clean baselines **2.9% / 7.4% / 3.1%** → **99.0–99.8% of encoded chunks dropped** | `benchmark/data/v8/phase2_filters/results/gate_fineweb_edu.json`; `benchmark/data/v8/results/FINAL_REPORT.md:48-55` | VERIFIED |
| 42b | Same measurement stated **conditionally**, i.e. relative to the chunks that pass clean: **6.5–13.5%** per corpus, **9.70% pooled** (13 of 134 clean-passing chunks) | Per-corpus computed from the `FINAL_REPORT.md:48-55` table: 0.2/2.9 = 6.9%, 1.0/7.4 = 13.5%, 0.2/3.1 = 6.5%; `FINAL_REPORT.md:56` states the same band rounded, "closer to 5-15% of clean-passing chunks". Pooled 13/134 = 9.70%, which independently reproduces the v7 value in row 42 (10.27%) on three different, uncurated corpora. Wilson 95% CI on 13/134 = **[5.8%, 15.9%]** | VERIFIED (pooled rate + CI recomputed by hand, see flag F-G) |
| 43 | FineWeb-Edu threshold ≥ **2.7** | `benchmark/data/v8/README.md:117`; `eval_phase1` context; FINAL_REPORT.md:56 | VERIFIED |
| 44 | v18 wasted-per-passing-page, **three corpora** (cc_news/owt/pg19): **~24%** (median α/β/γ, FineWeb-Edu primary) | `benchmark/data/v8/phase3_wasted/results/wasted_tokens.json › wasted.{v18_a,b,c}.*.fineweb_edu.wasted_per_passing_page`; 3-corpus medians 0.2485 / 0.2381 / 0.2411 → cross-variant median **0.2411 = 24.1%**; `FINAL_REPORT.md:92-99` (F3a PASS 24.1%) | VERIFIED |
| 44a | Same measurement, **four corpora** (BookCorpus added) — **19.4%**, the current headline figure | Same file, same field, `bookcorpus` included: per-variant 4-corpus medians 0.2015 / 0.1916 / 0.1939 → cross-variant median **0.1939 = 19.4%**. This is the figure the live white paper uses (its own style rule: "19.4% across four corpora, not the 3-corpus 24.1%") | VERIFIED (recomputed) |
| 45 | ~19pp above clean baseline (excess_waste, four-corpus) | `wasted_tokens.json › …fineweb_edu.excess_waste` (clean baseline 0.0, so excess = wasted = 19.4pp on the four-corpus cut; 24.1pp on the three-corpus cut, `FINAL_REPORT.md:100`, F3b) | VERIFIED |
| 46 | primary gate = FineWeb-Edu | `wasted_tokens.json › primary_gate` = "fineweb_edu" | VERIFIED |
| 47 | M15-EN ~40% per passing page but ~0–1% pass → adopter waste ~0 | `wasted_tokens.json › wasted.m15_en.*.fineweb_edu.wasted_per_passing_page` (cc 0.4056, owt 0.4001, pg19 0.2841) with `gate_pass_rate` 0.002/0.01/0.001; adopter=0.0008; `FINAL_REPORT.md:95,103` | VERIFIED |
| 48 | ⚠️ Gate-dependence: Kendall τ ≈ 0 across 4 gates | `FINAL_REPORT.md:74-79` (τ = −0.05…+0.02); `benchmark/data/v8/README.md:168` (F2c bar) | VERIFIED |
| 49 | ⚠️ per-corpus KenLM pass 1.4–33% (register-dependent) | `FINAL_REPORT.md:44-46` (v18_a cc_news 16.0%, owt 1.4%, pg19 29.0%); `INTERIM_REPORT.md:31-36` (up to 33.4% v18_c pg19) | VERIFIED |
| 49a | ⚠️ Conditional retention across the four gates spans **2.0%–65.3%**, median **12.4%**; per-gate medians per-corpus KenLM **32.1%**, Wiki-KenLM **13.6%**, Pythia-160M **6.9%**, FineWeb-Edu **6.7%** | Recomputed from the per-chunk scores in all four `benchmark/data/v8/phase2_filters/results/gate_*.json`, over the v18 variants × 4 corpora | VERIFIED (recomputed by hand, flag F-G) |
| 50 | ⚠️ Frontier labs gate with classifiers (fastText/DistilRoBERTa/FineWeb-Edu), not Wiki-KenLM | `benchmark/data/v8/README.md:121`; `site/app/white-paper/page.tsx:695,702` (dev repo) | VERIFIED |
| 51 | Marion "poisoning sweet spot" 110–140% KenLM band | `benchmark/data/v7/V18_FINAL.md:139`; `BUILDING_VARIANTS.md:259`; ~150% cliff `white-paper:745` (dev repo) | VERIFIED |

---

## §1 — v18-α vs M15-EN, gate by gate

All conditional-retention values below were recomputed from the raw
per-chunk scores in `benchmark/data/v8/phase2_filters/results/gate_*.json`. The
recomputation reproduces every stored `n_passed` exactly (0 mismatches across
5 gates × 6 variants × 4 corpora), which is what licenses quoting it. See
flag F-G: no committed script emits these values.

| # | README claim | Source | Status |
|---|---|---|---|
| 57 | Per-corpus KenLM conditional retention: v18-α **28.11%** vs M15-EN **2.07%** (13.6×) | Recomputed from `gate_per_corpus_kenlm.json` per-chunk scores (absolute 19.68% vs 1.45%) | VERIFIED (recomputed by hand, flag F-G) |
| 58 | All three fluency gates jointly (per-corpus KenLM ∩ Pythia-160M ∩ Wiki-KenLM): v18-α **24 / 4,000** chunks, M15-EN **0 / 4,000** | Recomputed by intersecting the per-chunk pass vectors in `gate_per_corpus_kenlm.json`, `gate_pythia_160m.json`, `gate_wiki_kenlm.json` (4 corpora × 1,000 chunks) | VERIFIED (recomputed by hand, flag F-G) |
| 59 | FineWeb-Edu ≥2.7 conditional retention **ties** at 9.70%: both keep 13 of 134 clean-passing chunks. Wilson 95% CI **[5.8%, 15.9%]** | `gate_fineweb_edu.json` per-chunk scores; CI computed from 13/134 | VERIFIED (recomputed by hand, flag F-G) |
| 59a | The tie is fragile three ways: it holds only at the 2.7 threshold (at ≥3.0 it is **6.52%** vs **2.17%**), only for the α seed (β/γ keep 14/134), and it is **not the same chunks** (survivor-set Jaccard 1.00 on cc_news, 0.18 on OpenWebText, **0.00** on PG-19 and BookCorpus) | Same file, rescored at 3.0 and intersected per corpus | VERIFIED (recomputed by hand, flag F-G) |
| 59b | Adding BookCorpus moves the pooled figure: v18-α 14/155 = **9.03%**, β/γ 16/155 = 10.32%, M15-EN 14/155 = 9.03%. The tie survives; the headline number changes | Same file, four-corpus pool | VERIFIED (recomputed by hand, flag F-G) |
| 60 | Mechanism: M15-EN rewrites **53.4%** of running tokens to v18-α's **24.4%**, and its source keys include **94 of NLTK's 198 stopwords** (`and→but`, `of→for`, `is→was`, `that→which`) at zipf 6.5–7.4. v18-α includes 10, none core, max zipf 6.25, 0 violations at zipf ≥7 | Computed over the shipped `scripts/m15en_for_font.json` and `scripts/v18alpha_for_font.json` against `nltk.corpus.stopwords` and `wordfreq.zipf_frequency` | VERIFIED (recomputed by hand, flag F-G) |
| 61 | "Maximum concealment" is **false on embedding semantic divergence**: M15-EN **0.217 / 0.228 / 0.186** vs v18-α **0.268 / 0.287 / 0.211** (cc_news / openwebtext / pg19) | `benchmark/data/v8/phase1_semdiv/results/semdiv_extended.json › results.m15_en.*.sem_div_mean` and `…results.v18_a.*.sem_div_mean` | VERIFIED |
| 62 | Both mappings are equally destroyed on the edu gate: median clean score 3.07 falls to 1.97 (v18-α) / 1.95 (M15-EN) against a 2.7 threshold; survivors average 3.88 clean vs 3.11 for non-survivors, so survival is a property of the **chunk**, not the mapping | Recomputed from `gate_fineweb_edu.json` per-chunk clean and encoded scores | VERIFIED (recomputed by hand, flag F-G) |

---

## §3 — Reproduction commands

| # | README claim | Source | Status |
|---|---|---|---|
| 52 | build_pairs → apply_v15_cell → generate_font → audit_font chain; `--expand-paradigms` required; pair-identical to α at seed 42 | `benchmark/data/v7/BUILDING_VARIANTS.md:129-235,160-164,182` | VERIFIED |
| 53 | Flatten via `scripts/build_alpha_mapping.py <pairs> <out>` | `scripts/build_alpha_mapping.py:9-12` (usage) | VERIFIED |
| 54 | Expected bands: pairs 11.8–12k, sem-div 0.295–0.300, content ≈48%, KenLM 110–140%, pass_27 8–15% | `benchmark/data/v7/BUILDING_VARIANTS.md:253-260` | VERIFIED **as a v7-harness rebuild sanity check**. The 8–15% `pass_27` band is measured on the v7 harness and its curated wiki/books/webtext corpora; it is **not** comparable to the v8 real-corpus absolute rate of 0.2–1.0% (row 42a) and is not a prediction of field behaviour. README states it under exactly that label. See flag F-F |
| 55 | Hero re-run scripts + models pulled | `benchmark/data/v8/scripts/eval_phase1_semdiv.py`, `gate_fineweb_edu.py`, `aggregate_phase3.py`; models at `eval_phase1_semdiv.py:127,131` + `README.md:117` | VERIFIED |
| 56 | β/γ shipped fonts built by running `build_alpha_mapping.py` on `pairs_v7_alpha_v18_b/c.json` | **INFERRED.** `build_alpha_mapping.py` is generic (argv src/out); no script or shell file names the β/γ invocations (grep found none). Files exist and match structure. | **ASSUMED (mechanism inferred, outputs VERIFIED to exist).** |

---

## §2.4 — The rule table and the concealment/filter-survival correlation

| # | README claim | Source | Status |
|---|---|---|---|
| 63 | 113-word `DO_NOT_SWAP` list, applied before bucketing | `benchmark/data/v7/scripts/build_pairs.py:190-209` (list), `:216-228` (`is_filtered`, applied stage 1A) | VERIFIED |
| 64 | K1 closed-class lockdown flags 145 swaps = 17.8% in a 120-sample audit | `benchmark/data/v7/V12_K_LENS_FINDINGS.md:8` | **ASSUMED** — from a research write-up, not a committed script over raw per-chunk data. See the sourcing note in `README.md` §2.4 |
| 65 | K6 rotation: `pass_27` 3.15% → 10.84%, cost 51 pairs | `benchmark/data/v7/V12_K_LENS_FINDINGS.md`; `benchmark/data/v7/V18_FINAL.md:31-42` | **ASSUMED**, same caveat as row 64 |
| 66 | K4+K5 bundled: content coverage 46.03% → 21.15% | `benchmark/data/v7/V18_FINAL.md:31-42` (main-effects table) | **ASSUMED**, same caveat as row 64 |
| 67 | Cell name decoder: shipped mapping = K1 + K6 only, six-knob name `v15_0_1_0_0_0_0` | `benchmark/data/v7/BUILDING_VARIANTS.md:26-41` | VERIFIED |
| 68 | Concealment-vs-filter-survival correlation: mixed pool r = −0.857 (n=855), within-family r = −0.556 (n=512, headline) | `benchmark/data/v7/results/mega_pareto.json`, `v18_mega_512_eval.json`; both recomputed live by `benchmark/data/verify.py` | VERIFIED (recomputed) |
| 69 | 512-cell sweep: 15 cells dominate the shipped cell on paper metrics; shipped anyway on a human grammar audit | `benchmark/data/v7/results/v18_mega_512_eval.json` (raw cells, domination computable), `benchmark/data/v7/V18_FINAL.md:20-21,45,51` (the audit-based verdict, and the corrected reading of its own "nothing dominates" line) | VERIFIED (domination recomputed by hand from the shipped JSON; the audit narrative is prose, not scripted) |
| 70 | Font-inversion hardening: 8 measures evaluated, 2 pure wins (drop glyph names, content-scoped subsetting), 6 rejected | Internal research notes, `whitepaper-v2/FINDINGS.md` §D (dev repo only, not shipped) | **ASSUMED.** No committed script reproduces these eight numbers from a single command; see the sourcing note in `README.md` §2.4 |
| 71 | A 400-pair dictionary that swaps the 113 commonest words anyway raises KenLM perplexity **+1,076%** (mean of wiki 937.8% / books 1,663.1% / webtext 988.1% / reddit 716.3%) | `benchmark/data/v7/results/gapfill_kenlm.json › M0_random_shuffle.by_corpus.*.median_pct` | VERIFIED |
| 71a | ⚠️ The shipping dictionary's rise on this **same** gapfill harness (wiki/books/webtext/reddit) is **+108.9%** ("~109%"), which is *below* the 110–140% Marion band, not inside it. The **120.8%** figure used elsewhere in this document (row 21) is `v18_variants_eval.json`'s reading on a different corpus set and *is* inside the band — same three-harness pattern already noted at rows 46-51 above. README §2.4 cites **120.8%**, not 109%, for exactly this reason. | `gapfill_kenlm.json › v15_0_1_0_0_0_0.by_corpus.*.median_pct` = 122.2/113.9/127.3/72.1 → avg 108.9 | VERIFIED (+flag) |
| 72 | "48.4% of content words" (top-of-document headline) | `benchmark/data/v7/results/v18_variants_eval.json › [0].content_pct` = 48.36 — this is the **v7-harness** figure, same corpus set as the 27.5% swap-rate reading (row 21), and it is what the live white paper itself states (`site/app/white-paper/page.tsx:692`, dev repo, `Stat n="48.4%"`). The v8 four-corpus pass that produces this document's 24.4% swap-rate headline gives **content coverage 44.7%** (mean) / 45.8% (median) for the same v18-α cell — a different-harness number, same mixing risk as the swap-rate case. README states this explicitly rather than silently pairing 24.4% with 48.4% as if from one pass. <br> `benchmark/data/v8/results/appendix_coverage_meaning.json › cells.v18_a__{cc_news,openwebtext,pg19,bookcorpus}.all.content_cov_mean` = 46.74/47.88/39.49/44.78 → mean 44.72, median 45.76 | VERIFIED (both figures; the pairing is the caveat) |

---

## Known caveats

- **Doc scope (F-A).** `MAPPINGS.md` is the M0→M15 research history, not a
  "what ships" spec. Its header now states the current default correctly
  (v18-α, with M15-EN shipping as the opt-in `maxhide`), but the tables below
  it describe superseded variants and count *logical* pairs where the shipped
  artifacts count bidirectional entries. For "what ships," trust this benchmark
  and each mapping's `_meta` block.
- **83% on books (F-B).** The white paper's "up to ~83% on narrative prose"
  rests on a **v7 n=60** measurement that the **v8 n=1,000** run *inverts* —
  fiction is v8's weakest register (31–35%). The public copy therefore leads
  with the **per-corpus table** (see row 31's correction on sample size), not
  a bare median, and footnotes the 83%.
- **Byte-identity (F-D).** α and its `v18_a` source are **pair-identical**, not
  byte-identical (an overstatement in an internal build doc).
- **Within-file NLI value (F-E).** One results file carries both a 3-corpus bar
  value (0.504) and a 4-corpus derived value (0.418); the reports publish
  0.504, which is the value used here.

- **Absolute vs conditional pass rates (F-F).** These are two different
  numbers and the docs must always say which one is meant. `pass_27` is
  **conditional by construction** (`benchmarks/v7/scripts/eval_v18_variants.py (dev repo):107-111`:
  the denominator is the chunks whose *clean* version already scored ≥2.7).
  The v7 harness measured it at **10.27%** on curated wiki/books/webtext; v8
  measured the same quantity at **9.70%** (13/134) on three uncurated
  real-world corpora, so the figure replicates across six corpora and three
  seeds. The **absolute** FineWeb-Edu pass rate is a separate quantity, and on
  real corpora it is **0.2–1.0%** (row 42a), because the great majority of
  chunks fail the gate even before encoding. The 8–15% `pass_27` band in §3 is
  a rebuild sanity signal on the v7 harness, not a field prediction. Never
  blend the two into one number.

- **Nothing computes the conditional figure — partially fixed (F-G).**
  `benchmark/data/v8/scripts/gate_fineweb_edu.py` emits the per-chunk pass/fail and
  the absolute rate only. Every conditional retention number published here
  used to be recomputed by hand from the stored per-chunk scores: checkable,
  but not runnable as one command. `benchmark/data/verify.py` now does this for
  the **FineWeb-Edu** gate specifically, reproducing the pooled 9.70% (13/134)
  directly from the committed per-chunk scores. **Still open:** the other
  numbers in this document that were also hand-recomputed — the per-corpus
  KenLM 28.11%/2.07%, the joint three-gate 24-of-4,000 count, the Wilson
  interval, and the cross-gate 2.0–65.3%/12.4% spread (row 49a) — are not yet
  covered by `verify.py` and still require the same by-hand method. Extending
  it to the other three gates is tracked on the
  [roadmap](../ROADMAP.md) as the next `conditional_retention.py` step.

- **The evaluation sample is not deterministic (F-H).**
  `benchmarks/v8/scripts/phase2_common.py (dev repo):68` seeds with
  `random.Random(SEED + hash(corpus) % 1000)`, and Python randomises string
  hashing per process, so a re-run draws a different sample of chunks. The
  exact denominators (n=134 here, n=93 in v7, 4,000 for the joint-gate count)
  cannot be regenerated. Rates are unaffected in expectation; exact counts are
  not reproducible. One-line fix: replace the builtin `hash` with a stable
  digest of the corpus name.
