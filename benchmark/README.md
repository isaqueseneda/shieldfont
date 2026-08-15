# ShieldFont Benchmark (public, minimal core)

ShieldFont swaps ~1 in 4 words on a page (measured: **24.4%** of all tokens
— 24.48% exact, reported to one decimal to match the white paper —
**48.4%** of content words) for a *grammatically-matched but semantically-wrong*
decoy. A human never sees the swap — the font's ligature
table renders every decoy back to the original word shape. A machine reading
the HTML source sees the decoys. This benchmark answers one question:

> **Does the swap actually destroy meaning for a machine? And what happens to an
> encoded page when it meets the quality filters that frontier labs run before
> training?**

The answer, distilled to the numbers you can reproduce:

| | Metric | Result | Where |
|---|---|---|---|
| **Meaning is destroyed** | NLI bidirectional-entailment failure, **per corpus** (n=1,000/corpus, real-world text) | **55.8%** news (CC-News) · **51.9%** general web (OpenWebText) · **34.5%** fiction (BookCorpus) · **31.1%** older fiction (PG-19) | §2.1 |
| **Not just noise** | Same metric on a WordNet synonym-swap control, same four corpora | **~2.1%**, so the per-corpus numbers above are meaning loss, not "rare words confuse the model" | §2.1 |
| **Most encoded pages never reach training** | FineWeb-Edu pass rate, **absolute** | **0.2% / 1.0% / 0.2%** (cc_news / owt / pg19) against clean baselines of 2.9% / 7.4% / 3.1%: **99.0–99.8% of encoded chunks are dropped** | §2.3 |
| **A minority does survive the gate** | Same classifier, **conditional** on the chunks that pass clean | **9.70%** pooled (13 of 134), **6.5–13.5%** per corpus, still passing once encoded | §2.3 |
| **Those tokens are wasted** | Wasted content per *passing* page, across all four corpora | **19.4%** of the page's token budget carries shifted meaning | §2.3 |

**Read the two filter rows together.** They are not a failure and a success:
they are the two branches of one defence. A page the classifier **drops** never
reaches the model, so its meaning is never learned; rejection *is* protection.
A page that **passes** carries 19.4% of its token budget as null propositional
content, so the gradient spent on it teaches less than the page appears to be
worth.

**Report per corpus, never a bare median.** A three-corpus pre-registered run
(CC-News, OpenWebText, PG-19) gave a median bidir-fail of 50.4%; adding a
fourth corpus (BookCorpus, fiction) pulls the median to 41.8%, because fiction
is the weakest register for this technique. Both numbers are honestly computed
and differ only in which corpora are counted — but a bare median invites
exactly the "which one did you pick" question the per-corpus table above
answers directly. The same corpus-count sensitivity applies to the waste
figure: 19.4% is the four-corpus number; the pre-BookCorpus three-corpus cut
reads 24.1%. This document uses the four-corpus numbers throughout as the
current headline; both cuts are VERIFIED in `PROVENANCE.md` rows 28/33 (NLI)
and 44/44a (waste), each tagged by corpus count.

**One pairing in the opening line is a different harness, not a different
pass.** The 24.4% swap-rate above is a v8, four-corpus, real-world-text
reading. The adjacent 48.4% content-word figure is not from that same pass —
it's the v7-harness reading on curated corpora (also what the live white paper
quotes). The actual v8 four-corpus content coverage for the same cell is
44.7% (mean) / 45.8% (median) — a few points lower, same direction, different
harness. See `PROVENANCE.md` row 72. This is the same kind of mixing the
27.5%-vs-24.4% swap-rate note below already flags; it just hadn't been called
out for content coverage until this pass.

**The "~10%" figure is a conditional rate, not an absolute one**, and the
difference is the single easiest thing to get wrong here. It is the share of
chunks that *already passed the gate when clean* and still pass once encoded.
The v7 harness measured it at **10.27%** on curated wiki/books/webtext; v8
measured the same quantity at **9.70%** (13 of 134) on three uncurated
real-world corpora. Six corpora and three seeds apart, they agree. What that
number never was is an **absolute** pass rate: on real-world corpora that is
**0.2–1.0%**, because the great majority of chunks fail the classifier even
before encoding. Always state which of the two you mean; never blend them into
one number.

Everything below is either a parameter you need to rebuild the mapping (§1) or
the method + exact number behind one of those claims (§2). Full research
history (v2–v8, 500+ experimental cells) is deliberately excluded — see
`EXCLUDED.md`.

---

## §1 — What shipped

Four mappings matter. A **mapping** is a bijective dictionary `{word: decoy}`;
the encoder swaps `word`→`decoy` in HTML and the font renders `decoy`→`word`
visually. Three of these ship (a rotation family); one is a benchmark baseline.

### The three shipped variants (v18 family)

**v18-α (alpha)** is the production default. It *is* the mapping internally
named `v15_0_1_0_0_0_0`, built at seed 42. The name "v18" is the ship label
for "v15's recipe, kept after a 512-cell sweep found nothing worth switching
to" — 15 of those 512 cells actually scored better on paper, but a human
grammar audit found they were generating pairs that were grammatically valid
and semantically nonsensical in ways no automatic metric caught (§2.4 has the
detail). It is not that nothing beat it; it's that beating it on the numbers
wasn't the same as being a better dictionary.

**v18-β and v18-γ** are the *same recipe re-run at seeds 1 and 2*. Same
vocabulary, same buckets, same filters — only the concrete word↔decoy
assignments differ. They exist so a site can rotate its mapping (a leaked
mapping is a one-time loss; re-seeding invalidates it). The three land on
statistically identical metrics — that is the point: the design is a
*family property*, not a lucky seed.

**M15-EN** is an older (V3, 2024) coverage-maximising mapping, retained as the
opt-in `maxhide` variant and as the **rejection-staleness baseline**. It swaps
more words, including short function words, so it conceals more per page. It is
not a stronger version of the default and it is not interchangeable with it.

> **v18-α is the balanced shipping mapping. M15-EN is the maximum-coverage
> opt-in B-side, and it is rejected by every fluency gate we instrumented.**
> Never mix the two inside one statistic: every headline number in this
> document is v18-α.

Gate by gate, as **conditional retention** (of the chunks that passed the gate
when clean, the share that still passes once encoded):

| Gate | v18-α | M15-EN |
|---|---|---|
| **Per-corpus KenLM** (register-fair: each corpus scored by a model trained on that corpus) | **28.11%** | **2.07%** |
| FineWeb-Edu ≥ 2.7 | 9.70% (13/134) | 9.70% (13/134) |
| FineWeb-Edu ≥ 3.0 | 6.52% | 2.17% |
| Pythia-160M | 11.07% | 4.57% |
| Wiki-KenLM | 26.11% | 8.32% |
| **All three fluency gates at once** | **24 of 4,000 chunks** | **0 of 4,000** |

**The FineWeb-Edu tie is a small-denominator artifact, not a finding.** The
Wilson 95% interval on 13/134 is **[5.8%, 15.9%]**: that gate cannot resolve a
2× difference between two mappings, so it certainly cannot establish a tie. The
tie is also fragile three ways. It holds only at the 2.7 threshold (at ≥3.0 the
two separate, 6.52% against 2.17%), only for the α seed (β and γ keep 14/134),
and **the surviving chunks are not the same chunks**: survivor-set overlap
(Jaccard) is 1.00 on CC-News, 0.18 on OpenWebText, and **0.00** on PG-19 and
BookCorpus. Adding BookCorpus to the pool moves the number to 9.03% for both
without changing the verdict.

**Why the gap.** M15-EN rewrites **53.4%** of running tokens against v18-α's
**24.4%** (both counted in the same pass, so they are directly comparable to
each other; an older v7-harness reading of 27.5% — the same quantity on a
different, curated corpus set — appears in the per-variant metrics table in
`PROVENANCE.md` (rows 21–23) and should not be mixed with this one), and its
source keys include **94 of NLTK's 198 stopwords**
(`and→but`, `of→for`, `is→was`, `that→which`) at zipf frequency 6.5–7.4. v18-α
includes 10 stopwords, none of them core, at a maximum zipf of 6.25. An n-gram
language model keeps most of its probability mass in function-word transitions,
so M15-EN detonates exactly what KenLM scores hardest, at 2.2× the volume.

> ⚠️ **"Maximum concealment" is only half true.** M15-EN does lead on coverage,
> on NLI meaning loss, on contradiction rate, and on waste per surviving page
> (~40% against α's 19.4%). It **loses** on embedding semantic divergence:
> **0.217 / 0.228 / 0.186** against v18-α's **0.268 / 0.287 / 0.211** on
> CC-News / OpenWebText / PG-19. Say "maximum coverage and maximum measured
> meaning destruction," not "maximum concealment."

None of this makes M15-EN useless. Rejection is a real defence: a page the
filter drops never teaches the model anything, and that branch is where nearly
all of M15-EN's value sits. But it is not exclusive to M15-EN either. The
shipped v18-α is also dropped for 99.0–99.8% of encoded chunks (§2.3). What
separates the two is what happens to the survivors, and on that axis v18-α wins
on every gate that has the resolution to tell them apart.

#### Exact parameters (sufficient to reproduce)

| Parameter | v18-α | v18-β | v18-γ | M15-EN |
|---|---|---|---|---|
| Ship label / internal name | α = `v15_0_1_0_0_0_0` | β = `v18_b` | γ = `v18_c` | M15-EN-FULL |
| **Seed** | **42** | **1** | **2** | n/a (curated) |
| Base pool | v11 | v11 | v11 | M14 + function pairs |
| Bucket dimensions | POS · inflection · concreteness · supersense | same | same | POS + antonym curation |
| Pairing within bucket | random (seed-driven) | random | random | curated + random |
| K-filter cell | K1+K6 only¹ | K1+K6 | K1+K6 | n/a |
| Digit permutation | 0↔5, 3↔8, 4↔9, 6↔7 | same | same | 1↔6, 3↔8, 4↔9 |
| Logical pairs | 5,994 | 6,023 | 6,024 | 1,267 |
| Bidirectional dict entries² | 11,988 | 12,046 | 12,048 | 2,534 |
| Shipped flat-file entries³ | 11,976 | 12,037 | 12,040 | 2,534 |
| Source pairs file | `benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json` | β/γ source in dev repo | β/γ source in dev repo | — |
| Shipped mapping file | `scripts/v18alpha_for_font.json` | `scripts/v18beta_for_font.json` | `scripts/v18gamma_for_font.json` | `scripts/m15en_for_font.json` |

¹ The cell name `v15_K7b_K6_K5_K4_Ke_F4 = v15_0_1_0_0_0_0` sets six binary
knobs; only **K6 (rotation-rerank)** is on. **K1 (lexical lockdown of
pronouns/function tokens)** is always on. Everything else — K7b calendar
freeze, K5 MWE freeze, K4 selectional restriction, Ke base-extensions, F4
bigram gate — is **off**. This is the leanest cell that survives every gate.

² Counting `a→b` and `b→a` separately (the white paper's convention).

³ After flattening to `{src:tgt}` for the font/encoder, last-write-wins drops
a handful of colliding source keys; +8 (v18) or +6 (M15) single-char digit
entries are added. This is the file `generate_font.py` actually consumes.

#### How the pairs are built (the one design rule that matters)

> **Buckets are grammar-only. Semantics is a veto, never an assignment.**

Every source word is bucketed by *grammar* — part of speech, inflection
(e.g. `verb.transitive.VB_VBP`, `noun.artifact.concrete.sing`,
`adj.non_gradable.pos`), and coarse supersense. Words are then paired
**at random within a bucket** (this is the only seed-dependent step). A
candidate pair is then *rejected* if it trips a **semantic veto**, so decoys
never accidentally mean the same thing as the original. The actual reject
tally for α (from the shipped pairs file's `_reject_reasons`):

| Veto | Pairs rejected | What it prevents |
|---|---|---|
| `cosine_missing` | 18,690 | no embedding → can't verify dissimilarity |
| `dominant_pos_mismatch` | 5,502 | decoy's dominant POS ≠ source's |
| `verbnet_frame_jaccard_low` | 4,598 | verbs with incompatible argument frames |
| `in_top_k_nn` | 1,486 | decoy is a Numberbatch nearest-neighbour (too close) |
| `wn_hypernym` / `wn_synonym` / `wn_hyponym` | 206 / 20 / 2 | WordNet is-a / synonym / has-a relations |
| `cosine_too_high` | 4 | embedding cosine above the dissimilarity ceiling |

Acceptance rate: 11,988 accepted / 13,132 candidates = **0.816**, from 13,360
source words across 204 buckets (167 used).

### The benchmark control (not shipped)

**m0_v3** — the original 400-pair ShieldFont mapping (`the→plumb`, `of→bezel`).
Used only as a control to prove the meaning-loss signal is *not* a rare-vocab
artifact (§2.2). It swaps high-frequency **function** words, which visibly
breaks grammar — useful as a foil, wrong as a product.

---

## §2 — Why these choices work

Three experiments justify the design. Each is: **claim → method → number →
how to reproduce.** All three run on Apple Silicon, no GPU rental.

### §2.1 — Encoded text loses its meaning (the headline)

**Claim.** Swapping ~25% of a page's tokens (24.4% measured, 48.4% of content
words) for grammar-matched decoys makes the encoded text stop *entailing* the original — i.e. a machine no longer
reads it as the same factual claim.

**Method.** Natural Language Inference (NLI) is the standard NLP test for "does
text B follow from text A?" For every `(original, encoded)` chunk pair we run a
public NLI cross-encoder (`cross-encoder/nli-deberta-v3-base`) **in both
directions** and count a pair as failed if *either* direction's P(entail) < 0.5:

```
bidir_fail = (P_entail(orig → enc) < 0.5) OR (P_entail(enc → orig) < 0.5)
```

Bidirectional is the right test because content-word swaps do outsized damage:
`the→a` barely moves entailment, but `winners→participants` flips it.

**Result.**

- **The headline, v8 (n=1,000 chunks/corpus, pre-registered, real-world
  corpora), reported per corpus, never as a bare median:** news (CC-News)
  **55.8%**, general web (OpenWebText) **51.9%**, fiction (BookCorpus) **34.5%**,
  older fiction (PG-19) **31.1%**. Fiction is consistently the weakest register
  for this technique — say so, don't average it away.
- **The median, for readers who want one number, with its corpus-count
  attached:** the three-corpus pre-registered set (CC-News / OpenWebText /
  PG-19) gives **50.4%**; adding BookCorpus as a fourth corpus pulls it to
  **41.8%**. Both are honestly computed from the same run and differ only in
  which corpora are counted — quote one, and say which.
- **Control (crucial):** a WordNet **synonym-swap** at the same ~25% density
  scores **~2.1%** bidir-fail (clean-text instrument noise is **1.1%**). So the
  per-corpus numbers above are genuine meaning loss, **not** the NLI model
  being confused by unusual words. At the weakest corpus this is still **15×**
  a synonym swap; on news, **27×**. This control is the strongest single result
  in the benchmark.
- **Secondary, smaller sample, v7 (n=60 chunks/corpus, 4 curated corpora):**
  mean bidirectional-entailment failure **59.6% / 61.3% / 60.0%** for α / β / γ,
  the source of the older "~60%" shorthand, with a **books** peak of **83.3%**
  (γ). This is an n=60 measurement on curated corpora and did not replicate at
  n=1,000 (see caveat below). Label it as such wherever it appears; do not lead
  with it.

> ⚠️ **Honest caveat, verified against the data.** The v7 "**83% on books**"
> peak was **n=60** and did **not** replicate at scale: on v8's larger-n
> fiction corpora fiction is the *weakest* register, at **34.5%** (BookCorpus)
> and **31.1%** (PG-19). Lead with the per-corpus table above; treat "up to 83%
> on narrative prose" as a smaller-sample earlier result, not a headline. See
> `PROVENANCE.md`.

**Reproduce.** `benchmark/data/v8/scripts/eval_phase1_semdiv.py` (needs the corpus
splits + `pairs_v7_alpha_v18_*.json`, *dev repo* — only α's source pairs ship
here, as `benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json`), or run
`benchmark/data/verify.py` against
the committed `semdiv_extended.json` to recompute the per-corpus and median
figures directly without re-running the model. Expected: NLI bidir-fail
31–56% depending on corpus, synonym-swap control < 5%.

### §2.2 — The signal is meaning, not rare vocabulary

**Claim.** The divergence comes from *what* we swap (content words → wrong
content words), not merely from injecting uncommon words.

**Method.** Semantic divergence = `1 − cos(sBERT(clean), sBERT(encoded))` with
`all-MiniLM-L6-v2`, computed alongside NLI in the same script. Compare α
against **m0_v3**, a control that swaps *function* words for rare nouns.

**Result.** v18-α sem-div = **0.297** (v7) / **0.268** median (v8). The
family sits at ~0.27–0.30 across all three seeds — a stable, moderate shift.
The m0_v3 control actually scores *higher* sem-div (0.46–0.53) **because it
breaks grammar visibly** — which is exactly what ShieldFont avoids. The lesson:
α keeps sentence structure intact (so the chunks that do clear a quality gate
read as prose rather than as noise, §2.3) while still
shifting propositional content (so NLI fails, §2.1). A muted sem-div relative
to a grammar-breaking control is a **feature**, not a weakness.

**Reproduce.** Same script as §2.1 (sem-div is emitted per chunk). Expected
α sem-div 0.25–0.30; m0_v3 higher.

### §2.3 — Most encoded pages are dropped by the filter; the survivors waste the training budget

**Claim.** Frontier labs discard low-quality web text with **quality
classifiers** before training. Encoding sends a page down one of two branches,
and both are defences. Either the classifier **drops** it, and the page's
meaning never reaches the model at all, which is the branch the great majority
of encoded chunks take; or it **passes**, in which case it still carries mostly
null-meaning tokens, so the gradient spent on it can't teach the page's real
content: "staleness."

**Method.** Two measurements:

1. **Filter survival** — run the **FineWeb-Edu** educational-quality classifier
   (keep chunks scoring ≥ 2.7) on encoded chunks.
2. **Wasted content** — for chunks that pass, compute
   `wasted_per_passing_page = content_coverage × meaning_loss` (meaning_loss =
   NLI bidir-fail on the passing subset), and subtract the same quantity
   measured on clean text (`excess_waste`).

**Result.**
- v18-α FineWeb-Edu pass rate, **absolute** (v8, real-world corpora):
  **0.2% / 1.0% / 0.2%** on cc_news / owt / pg19, against clean baselines of
  **2.9% / 7.4% / 3.1%**. In other words **99.0–99.8% of encoded chunks are
  dropped** before training.
- The same measurement stated **relative** to the chunks that pass when clean:
  **6.5–13.5%** survive encoding. This ratio, not the absolute rate, is the
  only defensible reading of the old "~10% passes" shorthand.
- Pooled across the three corpora, that conditional rate is **9.70%** (13 of
  134 clean-passing chunks). The v7 harness measured the same quantity at
  **10.27%** on a different, curated corpus set. The two are independent
  measurements of one rate and they agree; what limits how precisely either is
  known is the **denominator**, not the corpus. The Wilson 95% interval on
  13/134 is **[5.8%, 15.9%]**, which is wide enough that this gate cannot
  resolve a 2× difference between two mappings, let alone a tie.
- v18 wasted-per-passing-page: **19.4%** (median across α/β/γ, FineWeb-Edu
  primary gate, across all four corpora — cc_news / owt / pg19 plus
  BookCorpus): of every page that does reach training, 19.4% of its
  token budget is null propositional content, **~19pp above the clean-text
  baseline**. The pre-BookCorpus, three-corpus cut of the same measurement
  reads 24.1% — both are stored in `wasted_tokens.json`; this document
  quotes the four-corpus figure throughout.
- **M15-EN** wastes **~40%** per passing page **but** passes at **~0–1%**,
  so its adopter-weighted waste collapses to ~0. That is the *rejection*
  branch in its purest form: the filter, not the gradient, does the work.

Neither branch is a defeat. A dropped page is a page whose meaning never
entered the corpus; a passing page is a page that spends the model's capacity
on content that has been shifted. The honest summary is that rejection is the
dominant outcome and staleness is what remains for the minority that survives.

> ⚠️ **Caveat you must ship with this number.** Filter survival is
> **gate-dependent.** Across the four instrumented gates (per-corpus KenLM,
> FineWeb-Edu, Pythia-160M, Wiki-KenLM) the per-chunk pass/fail rankings barely
> correlate (**Kendall τ ≈ 0**), so a chunk only ever has to survive the gate
> the pipeline in front of it actually runs. Conditional retention across the
> four spans **2.0% to 65.3%**, median **12.4%** (per-gate medians: per-corpus
> KenLM 32.1%, Wiki-KenLM 13.6%, Pythia-160M 6.9%, FineWeb-Edu 6.7%). Stated
> **absolutely**, on register-fair per-corpus KenLM v18 passes at 1.4–33%
> depending on corpus. **Do not** lead with a Wikipedia-KenLM perplexity
> claim: a Wikipedia-trained n-gram model mis-references every non-wiki
> register, so those percentages describe the reference corpus as much as the
> encoded text, and real pipelines (FineWeb, DCLM, RefinedWeb) gate with
> fastText / DistilRoBERTa / FineWeb-Edu *classifiers* instead. State the pass
> rate per-gate, never in aggregate.

**Reproduce.** `benchmark/data/v8/scripts/gate_fineweb_edu.py` then
`benchmark/data/v8/scripts/aggregate_phase3.py`. Expected on real-world corpora:
FineWeb-Edu **absolute** pass 0.2–1.0%, **relative** to clean-passing chunks
6.5–13.5%; wasted-per-passing-page ~15–26%.

---

### §2.4 — The rule table: what's on, what's off, and why

Eighteen dictionary rebuilds and roughly 1,100 further configurations scored
after the shipping version was chosen. Almost none of it changed the
outcome — which is itself the finding: two rules earn their place, everything
else was tested and left off.

**The foundation: a 113-word do-not-swap list.** Swapping the commonest words
in English — `the`, `of`, `and`, `by`, `is`, `can` — is the worst possible use
of this technique: those words carry almost no meaning, so hiding them
conceals nothing, but they hold a sentence together, so replacing them makes
the page read as visibly broken. A 400-pair mapping that swapped them anyway
(`the→plumb`, `of→bezel`) raised KenLM perplexity **+1,076%**; excluding them
by construction, the shipping dictionary raises it **+120.8%**, inside the
110–140% band where pages survive a quality filter (a different, per-corpus
reading of the same shipped cell reads +109% — see the note in `PROVENANCE.md`
row 71a on why that figure is *not* the one to quote as "inside the band").
The exclusion is a hand-written,
113-word list (`benchmark/data/v7/scripts/build_pairs.py:190-209`, function
`is_filtered`), applied before any word is bucketed or paired — not a zipf
threshold computed at build time, though a post-hoc audit confirms it
happens to cover every English word at zipf ≥ 7.

| Rule | What it does | Shipped? | Why |
|---|---|---|---|
| **`DO_NOT_SWAP`** | Never touch the 113 commonest words | **ON**, always | Foundation. Without it: +1,076% perplexity, every filter rejects the page. |
| **K1 — closed-class lockdown** | Also exclude high-frequency words that *look* like content but behave like glue: light verbs (*do, get, make*), quote verbs (*said, asked*), time/place nouns (*day, year, way*), pointing adverbs (*now, then, here*) | **ON** | Highest-impact rule found. Flagged **145 swaps = 17.8%** of all swaps in a 120-sample audit. |
| **K6 — rotation rerank** | When a word repeats, cycle through several decoys instead of always picking one | **ON** | The only rule that buys filter survival for free: took `pass_27` from 3.15% to **10.84%**, for a cost of 51 lost pairs. |
| **K7b — calendar/number freeze** | Stop swapping month names, weekdays, number words | off | A dedicated sweep was built to test this toggle. Off won: it costs concealment for little gain. |
| **K4 — selectional restriction** | Require verb and object to be compatible (*eat* takes food, not ideas) | off | Right in principle, too expensive: bundled with K5 it dropped content coverage **46.03% → 21.15%**. |
| **K5 — MWE freeze** | Don't break fixed phrases (*take up arms*, *make sure*) | off | Real problem — 18 broken idioms in 120 samples — but every level tested cost more concealment than it bought. |
| **Ke — K-base extensions** | Toxic-word blacklist + strict deictic rule + year banding | off | Costs 16–20% of semantic divergence. An earlier "winner" cell using it was explicitly retracted. |
| **F4 — bigram gate** | Reject a swap that makes the local word pair improbable | off | Never earned its place in any sweep. |
| **K2 — bigram surprisal blacklist** | Build-time version of F4 | never shipped | Rarely flagged a sample that K1 missed. |
| **K3 — register matching** | Don't swap formal words for casual ones | never shipped | Flags 30% of samples, the second-highest-impact rule found — but never produced a winning cell. |

**The cell name.** The shipped mapping (`v15_0_1_0_0_0_0`) decodes as
`K7b_K6_K5_K4_Ke_F4 = 0_1_0_0_0_0`: only K6 is on (K1 is always on and not
named). Full decoder: `benchmark/data/v7/BUILDING_VARIANTS.md:26-41`.

**The concealment-vs-filter-survival tradeoff.** Raising concealment lowers
filter survival, reliably and steeply. Across a mixed pool of 855 dictionary
versions, Pearson **r = −0.857**. Measured within one recipe family (the
512-cell sweep below, everything else held fixed) — the conservative reading,
since the 855-version pool mixes families and so confounds the correlation
with general dictionary aggressiveness — **r = −0.556**. Use this as the
headline figure.

**The 512-cell sweep.** Fifteen of the 512 tested configurations beat the
shipped cell on the three measured metrics (concealment, KenLM band, filter
survival) — this is *not* a case of "nothing scored better." What happened
instead: a human grammar audit of the higher-scoring cells' output found they
were generating pairs that were grammatically valid and semantically
nonsensical in ways no automatic metric caught. They were rejected and the
incumbent shipped. **Every automatic measurement alone would have shipped a
worse dictionary.**

**Reproduce.** `python3 benchmark/data/verify.py` recomputes both correlations
directly from `benchmark/data/v7/results/mega_pareto.json` (855-version pool)
and `v18_mega_512_eval.json` (512-cell family).

> ⚠️ **Sourcing note on the table above.** Unlike the rest of this document,
> the rule table's per-rule numbers (17.8%, the 51-pair rotation cost, the
> 46.03%→21.15% K4+K5 collapse) are drawn from internal research write-ups
> (`V12_K_LENS_FINDINGS.md`, `V18_FINAL.md`) rather than from a single
> committed script that recomputes them from raw per-chunk data. The
> reasoning and the underlying eval files are shipped and checkable; treat
> this table as **ASSUMED** in the sense `PROVENANCE.md` uses that word, not
> **VERIFIED**.

**Font inversion: what we tried, honestly.** The font has to reach the
browser to render the page, and its composite glyphs are drawn from the
original words' own letters, so anyone who downloads it can read the
substitution table back out — we do not claim otherwise. We evaluated eight
approaches to making that harder:

| # | Approach | Attacker cost added | Our cost | Verdict |
|---|---|---|---|---|
| 1 | Drop the glyph-name table | small (removes a whole attack surface) | −18% bytes | ✅ pure win, shipped |
| 2 | Content-scoped subsetting | small (per-site codebook only) | −78% bytes | ✅ pure win, shipped |
| 3 | Salt the glyph-name hash | closes the dictionary route on the `.ttf` tier | ~0 | ✅ narrow win, superseded by #1 for the web |
| 4 | Flattened outlines | raises inversion from sub-second to ~13s in Python (still sub-second with a compiled tool) | +16% bytes, 4× memory | ❌ poor: one afternoon of attacker engineering defeats it |
| 5 | Decoy / reordered components | ~1 line of attacker code to strip | small; layout risk | ❌ |
| 6 | Split glyphs (top/bottom) | ~0 | high | ❌ breaks the ligature chain and Word/Pages/InDesign rendering |
| 7 | SVG glyphs | negative — plain-text path data is *easier* to read than binary outlines | double storage | ❌ breaks Word and the GSUB pipeline |
| 8 | Coordinate perturbation (jitter) | attacker still recovers 75.8% of words / 87.2% of characters | 12× the bytes (a 12.3MB font, self-inflicted) | ❌ worst on the list |

Only #1 and #2 are unambiguous wins, and both are *performance* work that
happens to reduce attack surface — neither claims to make inversion
impossible. The honest conclusion is not to keep trying to defeat inversion,
but to price it correctly: see `docs/concealment.md` and
`docs/custom-mappings.md` for what that cost actually is (identifying a
shielded page, fetching the right font, and building an inverter in the
first place — not the sub-second parse once all of that is already done).

> ⚠️ Same sourcing caveat as the rule table above: this comparison is drawn
> from internal research notes, not a committed, re-runnable benchmark
> script. No project file currently reproduces these eight numbers from a
> single command.

---

## §3 — Reproduce it yourself

### A. Rebuild a mapping (your own seed → your own private mapping)

The bucket-and-pair builder (`build_pairs.py`) and its cell-name decoder
(`BUILDING_VARIANTS.md`) are shipped in `benchmark/data/v7/`. The one step that
still lives only in the **development repository** is `apply_v15_cell_to_v11.py`,
which turns a `build_pairs.py` run into a specific K1+K6-style cell — what you
*can* run with everything shipped here: rebuild the font from the shipped
production-alpha source pairs, and mint your own reseeded mapping.

```bash
# 1. Flatten the shipped production-alpha source pairs into the {src:tgt}
#    form the font/encoder consume.
python3 scripts/build_alpha_mapping.py \
    benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json \
    scripts/myvariant_for_font.json

# 2. Build the font from any TrueType base, then audit round-trip + collisions
#    (both must be 0).
python3 scripts/generate_font.py --base-path /path/to/base.ttf \
    --name "ShieldFont Mine" --prefix shieldfont-mine \
    --mapping-path scripts/myvariant_for_font.json
# --mapping-id must match the id the build derived (the --prefix minus
# "shieldfont-", since this mapping has no _meta.mappingId). It seeds the
# glyph-name salt; audit_font.py defaults to "m15en" and would fail a good build.
python3 scripts/audit_font.py --font public/fonts/shieldfont-mine.ttf \
    --mapping scripts/myvariant_for_font.json --mapping-id mine

# Or mint your OWN private mapping at your own seed (re-pairs the v18 pool):
python3 scripts/reseed_mapping.py --seed 42 --out mine.json
```

**Expected metric band for a healthy v15-family variant** (any seed):

| Metric | Expected range |
|---|---|
| logical pairs | 11,800–12,000 bidirectional |
| sem-div (sBERT) | 0.295–0.300 |
| content coverage | ≈ 48% |
| KenLM PPL rise | 110–140% (Marion "poisoning sweet spot") |
| FineWeb-Edu pass (≥2.7), **v7 harness on curated wiki/books/webtext** | 8–15% |

The `pass_27` band above is a **build-health check on the v7 harness and its
curated corpora**, not a prediction of how your variant behaves in the wild.
It is not comparable to the v8 real-corpus absolute rate of 0.2–1.0% in §2.3.
Use it only as a rebuild sanity signal: if `pass_27 < 5%` on that harness, you
almost certainly forgot `--expand-paradigms`.

### B. Re-run the hero measurements

The measurement harness that computes §2.1–§2.3 is shipped in
`benchmark/data/v8/scripts/`. It still needs the corpus splits and a few
HuggingFace models pulled on first run (see below) — those are not committed,
for size. It runs:

```bash
# Sem-div + NLI + synonym-swap control (§2.1, §2.2). Needs corpus splits.
python3 benchmark/data/v8/scripts/eval_phase1_semdiv.py
#   → sem-div 0.25-0.30 median · NLI bidir-fail ~50% median · control < 5%

# Filter outcome + wasted tokens (§2.3).
python3 benchmark/data/v8/scripts/gate_fineweb_edu.py
python3 benchmark/data/v8/scripts/aggregate_phase3.py
#   → FineWeb-Edu absolute pass 0.2-1.0% (relative to clean-passing: 6.5-13.5%)
#     · wasted-per-passing-page ~15-26%
```

Models pulled from HuggingFace on first run: `all-MiniLM-L6-v2` (sBERT),
`cross-encoder/nli-deberta-v3-base` (NLI), `HuggingFaceFW/fineweb-edu-classifier`.

### C. Two known reproducibility gaps

Both are real, both are small, and you should know about them before you try to
replicate anything above.

**1. ~~No script computes the conditional retention rate~~ — fixed.**
`gate_fineweb_edu.py` emits the per-chunk pass/fail and the **absolute** rate
only; the conditional figures in this document were originally recomputed by
hand from the stored per-chunk scores, which meant the inputs were committed
and the arithmetic was checkable but not runnable as one command. `verify.py`
now does that recomputation directly against the committed per-chunk scores
and reproduces 9.70% (13/134) exactly — run `python3 benchmark/data/verify.py`.
It currently covers the FineWeb-Edu gate; extending it to the other three
instrumented gates (per-corpus KenLM, Pythia-160M, Wiki-KenLM) and emitting a
Wilson interval per gate is still open, tracked on the
[roadmap](../ROADMAP.md).

**2. The evaluation sample is not deterministic.**
`benchmarks/v8/scripts/phase2_common.py (dev repo):68` seeds
with `random.Random(SEED + hash(corpus) % 1000)`, and Python randomises string
hashing per process, so a re-run draws a different sample of chunks. The exact
denominators (134 here, 93 in the v7 harness, 4,000 for the joint-gate count)
cannot be regenerated. The **rate** is unaffected in expectation: you should
land on the same value within sampling error, just not on the same counts. The
fix is one line, a stable digest of the corpus name in place of the builtin
`hash`.

---

## Adding more later

This core intentionally reports **only** the three claims above. Natural
extensions, each self-contained: cross-model NLI replication; a proper
fine-tune damage study conditioned on filter-passing text (the v8 Phase-5
pipeline exists but its eval is stubbed); cross-language mappings (the
M15-MULTI template uses only translation-invariant operations). None are
required for the three headline claims, which follow from the encoded text
alone.
