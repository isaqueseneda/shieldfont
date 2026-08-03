# ShieldFont 0.3.2 — what changed, and what to do

Working document for PR #6 and the release that follows. Written 2026-08-03.
Everything below was verified by running it; where a number appears, it was
measured on this machine rather than carried over.

---

## Part 1 — What this release is

It answers [issue #2](https://github.com/isaqueseneda/shieldfont/issues/2),
filed by **scbaker**: *"[BUG] Shieldfont makes websites inaccessible to screen
readers."*

The one-line version: **the accessible path is now on by default.** A bare
`<Shield>` seals the real words into the page, draws a visible control, and
mediates copy/paste. None of that used to happen unless you asked for it.

---

## Part 2 — Everything that changed

### The accessible path became the default

| | 0.3.1 | 0.3.2 |
|---|---|---|
| A bare `<Shield>` | `aria-hidden` block, no alternative | sealed words + visible wrapper + copy guard |
| Original words in the page | never | **yes, encrypted** among 3 decoys |
| Markup per block | ~7 kB | ~11 kB |

**This is the biggest behavioural change in the release.** Anyone who chose
ShieldFont on "the original text never reaches the browser" must now pass
`screenReader={false}` to keep that property.

### The announcement redesign

- One press uncovers every block on the page, but **only the pressed block is
  announced**. Previously all of them were, out of order — one press read the
  whole article at the reader.
- The clipped tier's note used to say *"please uncover the text before reading"*
  permanently, about text already uncovered. It now swaps to the open-state
  sentence.
- Verified: 4 blocks fill, 1 speaks, all 4 remain Tab stops.

### Three switches replace four invented tier names

`FULL` / `INVISIBLE` / `MINIMAL` / `SEALED SHUT` are **deleted**. They were never
API — just names for combinations of three booleans that already existed.

| Prop | Default |
|---|---|
| `screenReader` | on, unconditionally |
| `wrapper` (renamed from `explain`) | on wherever the seal is on |
| `copyPaste` | on wherever the seal is on |

- `explain` now **throws**, naming `wrapper`. No silent alias.
- `wrapper` is never drawn on an inline tag; passing it explicitly there throws.
- New styling hook `wrapper={{ className }}` on the frame. The component-level
  `className` was deliberately **not** widened — that would have retargeted
  every existing stylesheet on upgrade.

### `<NonShield>` — new component

Ordinary, unprotected text in the Optik face. For headings, decks and captions,
which should never be shielded.

**The fact that made it necessary:** the shipped `optik-*.woff2` are *not* plain
Optik. They are shielded builds whose substitutions live in the OpenType `ccmp`
feature, and the dictionary is an involution — so setting `font-family: Optik`
on real text renders the **decoy** (`Read the docs` → `Reset the sellers`).
`<NonShield>` disables `ccmp`; `<Shield>` re-asserts it so nesting cannot
silently unprotect.

### Decoy payloads

- 4 sealed payloads per block, 1 real. All padded to one ciphertext length.
- Corpus widened from Austen alone to **six public-domain works**.
- Selection is now **random via Web Crypto**. It used to be derived from the
  camouflage attribute and block key — both printed in the page, using public
  exports — so a reviewer recomputed which payloads were filler on 8 blocks of 8
  with no CPU spent.

### Puzzle recalibrated against measured OCR cost

| | 0.3.1 | 0.3.2 |
|---|---|---|
| Default | 20 | **14** |
| Range | 5..120 | **1..30** |
| Steps | 5,000,000 | **1,680,000** |
| Reader wait (Chrome) | 7.6 s | **~2.5 s** |
| Share of OCR floor | 81% | **97%** |

Sealing: **64 ms per payload**, **261 ms per block of four**. A 200-block site
adds ~52 s of single-threaded sealing (docs previously said "a few seconds").

### Correctness fixes

- **Contrast**: strip sentence was `opacity:.55` — 3.24:1 on a `#333` host, and
  only passing on pure black. Now `.70`. An earlier axe run reported this clean
  because ancestor opacity does not appear in a child's computed style.
- **Dark mode**: the Uncover button's glyphs used `Canvas` while its fill used
  `currentColor`. On a hand-rolled dark theme that drew near-white on near-white
  — **1.09:1**, and exactly **1.00:1** under Windows High Contrast. A button with
  nothing on it.
- **Font-failure signal was dead**: a font-check cache meant to dedupe within one
  probe was kept *between* probes, so the re-probe returned the stale healthy
  answer. The guard logged the failure while the wrapper kept telling readers the
  text was fine — with the decoys visible to everyone.
- **One malformed payload killed every block** on the page. Now contained.
- **Empty block → 19 kB clipboard bomb** (`split('')` between every character).
- **Copy on a multi-block page** spliced only the first block; the rest went to
  the clipboard as raw decoys.
- **Cross-tier focus steal**; **stale Frame objects** never pruned.
- `</script>` breakout in all four emitted scripts; `setCamouflage({ attrName })`
  now validated.
- **`a11y={{ mode: "audio" }}`** from a plain-JS caller slipped past the guard and
  rendered an instruction with no operable control behind it.
- `fontGuardScript` was shipping 22 comment lines and mechanism-naming strings
  into every page — undoing `setCamouflage({ hash })` for anyone using it.

### Test and audit infrastructure

| Suite | What it covers |
|---|---|
| `npm test` | 253 react + 113 core |
| `test:a11y` | virtual screen reader, incl. the announcement design and font-failure round trip |
| `test:hydration` | solver vs React reconciliation |
| `test:axe` | **new** — axe-core, 0 violations, 2 tiers × before/after unlock |
| `test:style` | **new** — 17 hostile host pages, 16 clean, 1 documented limit |
| NVDA | real NVDA on a Windows runner, every commit |

### Documentation

- The WCAG table said three tiers **"Pass"**. Removed — replaced with per-column
  **known failures**. It contradicted the README and this same file 400 lines
  down. **No document may use "pass" about a protected block, or cite the axe run
  as conformance.**
- `CONTRIBUTING.md` and `plain-text-mode.md` claimed *"NVDA and JAWS are
  unverified. Nobody has run either against it."* NVDA runs in CI every commit.
- `concealment.md` claimed *"Nothing on the page announces that the text is
  protected."* False since the wrapper became default.
- Headings rule is now blanket — **don't shield any heading** — not the narrower
  "headings that double as page titles".
- `packages/{core,react,font}/AGENTS.md` had been stale since 0.3.0 and shipped
  dead relative links inside every npm tarball.
- Byte tables in `Shield.tsx` re-measured: 1 el/276 B · 17/~9 kB · 32/~11 kB ·
  59/~14 kB (old comments said 17/3537, 30/5128, 55/7685).

### Marketing site (`shieldfont-dev`)

- **The site was voicing decoys to screen readers.** `site/components/Shield.tsx`
  is a hand-rolled encoder with no `aria-hidden` — a screen reader on the site
  arguing this problem is solved was read fluent, wrong English. The manifesto
  fold and every `ShieldedDemo` are now `aria-hidden`. Verified: **0 exposed
  decoys** across `/`, `/white-paper/`, `/docs/`, `/press/`, and nothing
  focusable trapped inside.
- Homepage claim *"Your text never reaches the browser"* → *"No readable copy
  ships in the HTML."*
- FAQ called the alternative *"in beta and off by default"*; white paper said
  *"up to twenty seconds"*.
- Demo: settings panel now honest about live vs pre-rendered; tour rebuilt to 11
  stops covering every control; the copy step no longer secretly disables the
  copy guard to demonstrate its absence.

---

## Part 3 — Breaking changes

**Hard breaks (throw on upgrade):**

1. `seconds` range 5..120 → **1..30**. `seconds: 60` now throws. (`seconds: 20`
   still valid.)
2. `a11y.reveal` / `visualHidden` / `label` / `note` **throw** when combined with
   the wrapper — which is the default.
3. `explain` throws; use `wrapper`.
4. `setCamouflage({ attrName })` validates `^data-[a-zA-Z0-9-]+$`. **Underscores
   now rejected** — `data-my_thing` worked in 0.3.1.
5. `a11y={{ mode: "audio" }}` removed.

**Silent behaviour changes:**

6. A bare `<Shield>` ships the original words encrypted (see Part 2).
7. Copy/paste is mediated by default.
8. `DEFAULT_SECONDS` 20 → 14, reference rate 250,000 → 120,000.
9. Payload JSON is an array of four, not one object.

**CSS hooks that may break:** the block now nests inside `[attr]-frame`;
`.…-alt-btn` is gone; button accessible names changed.

> ⚠️ **Publishing as 0.3.2 means every consumer on `^0.3.1` gets this
> automatically.** Consider `npm publish --tag next` first, then promote.

---

## Part 4 — The runbook

- [ ] **1. Decide the Playtype licensing wording.** ⚠️ *Blocker.* The NOTICE now
      says the grant covers Optik *"whether or not the word substitutions are
      active, provided the use is within the ShieldFont packages and tooling."*
      This is in the root `NOTICE`, all three **package** NOTICEs (which publish
      to npm), `README.md` and `packages/react/README.md`. **Check it against the
      actual agreement.**
- [ ] **2. Decide what to commit.** 47 changed files; some pre-date today and are
      yours. Nothing has been committed.
- [ ] **3. Commit in logical groups** and push to `a11y-visible-wrapper`.
- [ ] **4. Retitle PR #6** — currently "Draw the accessibility control, and make
      it the default", which no longer describes the scope. Use Part 2 as the body.
- [ ] **5. Merge to main.**
- [ ] **6. Tag `v0.3.2`.**
- [ ] **7. Publish to npm** — `core`, then `react` (its dep is `^0.3.2`), then
      `font`. Consider `--tag next`.
- [ ] **8. Bump the site's CDN pins** to `@shieldfont/font@0.3.2`. **Only after
      step 7** — 5 places in `shieldfont-dev/site` still point at `@0.3.0`, and
      pointing them at an unpublished version 404s the font on a live site.
- [ ] **9. Deploy the site** — `deploy-cf.sh`.
- [ ] **10. Reply on issue #2** (draft below), then close it.
- [ ] **11. Open follow-up issues** for what is still open (below).

---

## Part 5 — Draft reply to scbaker

> Thanks for this, and for staying with it through the back-and-forth.
>
> The accessible path is now **on by default**. A bare `<Shield>` draws a visible
> wrapper with an Uncover button, seals the real words into the page, and
> mediates copy/paste — you no longer opt into any of it.
>
> Specifically since your report:
> - one press uncovers every block, and **only the block you pressed is
>   announced** — it no longer reads the whole article at you
> - the wrapper's sentence was failing contrast at 3.24:1 on a typical page;
>   it's 7.85:1 now. The Uncover button was drawing invisibly in hand-rolled
>   dark themes (1.09:1 — a blank button). Both fixed.
> - real **NVDA** now runs on a Windows runner on every commit, alongside a
>   virtual screen reader, an axe-core scan, and a 17-host CSS audit
> - the unlock went from ~7.6 s to ~2.5 s
>
> **What has not changed, and won't:** a protected block still fails WCAG 2.2
> SC 1.3.1. That's inherent to the mechanism, not something we're working
> around, and the docs say so plainly. This makes a protected page humane, not
> compliant.
>
> If you have NVDA to hand, I'd genuinely value you trying it — you found what
> our tests didn't.

---

## Part 6 — Follow-up issues to open

1. **One puzzle per page, not per block.** CPU scales linearly with blocks and
   parallelism is only free if the reader has cores. A 10-block article on a
   2-core phone serialises — the reader who needs this waits longest.
2. **JAWS is unverified.** Never run against it.
3. **The site's homepage uses a hand-rolled `Shield`, not the package.** Now
   `aria-hidden`, so it is no longer harmful, but the site does not demonstrate
   its own product. Adopting `@shieldfont/react` has visual consequences.
4. **`notice` is a silent alias for `wrapper`** while `explain` throws, and no
   document mentions it. The stated rationale is "no silent alias".
5. **NVDA CI job is `continue-on-error`** — it cannot go red yet.
6. **`DemoTiers.tsx` is dead code** (0 importers) carrying the last copy of the
   deleted tier vocabulary, plus orphaned CSS.
7. **A measurement was deleted, not replaced:** `plain-text-mode.md` had
   "Chrome, `seconds: 10` → 4.0 s", impossible under the new step count. Needs
   re-measuring rather than deriving.
8. **README's benchmark figures are unverified** (entailment 55.8/51.9/34.5/31.1%,
   "FineWeb-Edu drops 99.0–99.8%"). Unchanged from before today; the strongest
   quantitative claim on the front page.
9. **localStorage entries are never GC'd** across deploys (~550 B/block).
