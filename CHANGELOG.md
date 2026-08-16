<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# Changelog

All notable changes to ShieldFont. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry records what changed in a release, in the words used at the time it
shipped, and entries are not amended after publication. For where things stand
now — accessibility in particular — read the
[README](./README.md#accessibility) rather than an older entry here.

---

## [0.3.5] — 2026-08-16

A documentation and wording release, plus one behavioural fix each for readers
with JavaScript off and readers in Safari Reader. No API changed.

### Added

- **A `<noscript>` fallback.** Uncovering a block needs JavaScript, and until
  now a page with it turned off said nothing about that. On the default tier
  the Uncover button rendered normally and did nothing when pressed — a
  screen-reader user was told a route to the words existed, handed a control
  that named it, and got silence. Now the controls that cannot work are
  removed and a `<noscript>` says why, in one sentence that retracts the
  instruction before it. New `noScript` option on `wrapper` / `a11y`; set it
  to `""` to drop it.

### Fixed

- **Safari Reader read the notice sentence twice.** The sentence ships in two
  copies, one visible and one for screen readers. Safari Reader ignores
  `aria-hidden`, so it kept the visible copy, and it detects only the legacy
  `clip: rect()` form of hiding, so it kept the clipped one too. Adding
  `clip: rect(0 0 0 0)` beside the existing `clip-path` leaves exactly one
  copy in every reader mode, with no visual change anywhere.

### Changed

- **The accessibility wording across the project was corrected.** Several
  documents described the pre-0.3.2 arrangement — a control that was
  screen-reader-only, invisible, or in beta — when the visible notice has
  been the default since 0.3.2. Others asserted as established fact a
  reachability claim that came from a bug report and has never been
  reproduced. Both are fixed, and [#2](https://github.com/isaqueseneda/shieldfont/issues/2)
  is still credited for raising it.
- **Reader Mode is now documented honestly, and it splits by browser.**
  Firefox and Chrome drop a shielded block from Reader entirely; Safari
  ignores the `aria-hidden` that does it and shows the scrambled version in
  its own typeface. No markup excludes content from all three, and no
  specification offers an opt-out.
- **The CDN / paste-in tier is now labelled educational**, with
  `@shieldfont/react` named as the route for a site you are shipping. That
  tier cannot ship a complete alternative, because the original words are not
  in the page on it at all.
- **`@shieldfont/core` exported a stale `VERSION`.** It read `0.3.2` while the
  package was at `0.3.4`.
- Documentation fixes throughout: the root README never mentioned copying the
  font files, so its quick start produced a blank page; the camouflage recipe
  undercounted the font files a site needs; `<NonShield variant>` was
  documented as a live bandwidth choice after being deprecated and ignored;
  the audit command in the custom-font guide omitted a flag and failed on a
  correct build; and several stated defaults did not match the code.

---

## [Unreleased]

### Added

- **A French mapping, `fr-v1-alpha`, and the pipeline that builds it.**
  `scripts/build_fr_pairs.py` produces 5,415 logical pairs (10,830 entries)
  from Lexique 3.83 at seed 42, with `benchmark/data/fr/` carrying the pairs
  artifact and a per-pair audit CSV. It emits the v7 pairs schema, so
  `scripts/reseed_mapping.py --pairs …` re-seeds a private French mapping
  with no code change.

  French needed its own pipeline rather than the language-code swap
  `ROADMAP.md` describes, because a decoy has to agree in **gender** and
  preserve **elision class**: `la maison` → `la livre` and `l'arbre` →
  `l'maison` are ungrammatical, and ungrammatical text is filtered as noise
  instead of read as prose, which is the whole mechanism. Both are bucket
  dimensions; neither exists in English.

  Morphology comes from Lexique rather than a tagger. An earlier draft used
  spaCy and put `grandis` and `confesse` (verbs), `contemporaine` (an
  adjective) and `dupuy` (a surname) in the feminine-noun bucket — a
  contextual tagger cannot answer questions about context-free word forms,
  and carrier frames make it worse, not better.

- **`packages/core/test/encode-fr.test.ts`** — 16 tests over the French
  artifact: involution, NFC, no apostrophe or single-letter keys, the
  elision invariant across every pair, French round-trip, `aujourd'hui`
  passing through unencoded, entity safety and the digit rule. The elision
  test caught three real bugs in the hand-written special pairs, which
  bypass the agreement buckets; `assemble_specials()` now enforces the
  invariant at build time.

- **Elision propagates across inflection, and is checked.** The hand list of
  words that block elision was written as base forms while the mapping is
  built from inflected ones, so listing `haie` protected nothing when the
  pool held `haies`: 152 h-initial forms were classed as h-muet. Propagation
  is by lemma, never by shared prefix — Lexique files `héroïne` under the
  lemma `héros`, so it also needs an explicit override for the one
  irregularity the list exists for. `ELISION_CONTROLS` pins 27 known-answer
  cases on every build, because neither bug changed anything observable in
  the output: a wrong elision class yields a mapping that is internally
  consistent and merely ungrammatical on the page.

- **The audit CSV is sorted by risk**, with a `priority` and a `why` column.
  248 of 5,415 rows (P1–P3) carry the inferences worth a native reviewer's
  time: 56 where gender came from the lemma rather than the form, 174
  h-initial, 18 hand-written special pairs.

### Notes

**Nothing French ships in this release.** There is no French font — the
Optik base needed to build one is Playtype's — so the mapping is not wired
into `@shieldfont/core`, and a mapping without its font renders as visible
decoy text. No native speaker has audited the pairs, and none of the NLI,
KenLM or FineWeb-Edu benchmarks have been re-run for French, so no published
number in this repository describes the French mapping.

Lexique 3.83 is CC BY-SA 4.0. It is downloaded on demand and cached in
`scripts/lexicon/` (gitignored) rather than vendored; only the derived
mapping is committed. Whether that derived mapping counts as Adapted
Material is flagged in `NOTICE` for a maintainer to decide rather than
assumed away.

---

## [0.3.4] — 2026-08-04

The fix is in `@shieldfont/font`. `core` and `react` are byte-identical to
`0.3.3` and are versioned along with it: the release workflow requires all
three package versions to equal the tag, so the three move in lockstep.

### Fixed

- **The CDN tier's shielded italics were built but never shipped.** 0.3.3 added
  `optik-{a,b,c,m}-italic.woff2` to the package directory and forgot to list
  them in `files` or declare them in `shieldfont.css`, so they were absent from
  the tarball. The neutral italic shipped, the shielded ones did not — which
  meant an `<em>` inside a `.tk9` block still rendered upright on a paste-in
  install, the exact failure 0.3.3 set out to fix, surviving in the one tier
  nobody re-tested. Both are now declared, under the same family name as their
  uprights.

---

## [0.3.3] — 2026-08-04

### Fixed

- **`<NonShield>` rendered decoy words in Safari.** It switched the
  substitutions off with `font-feature-settings: "ccmp" 0`, which is exact in
  HarfBuzz, Blink and Gecko — and which **WebKit ignores outright**, because
  Safari applies `ccmp` unconditionally. Every spelling was tested against a
  shipped cut and all of them still painted the decoy: `"ccmp" 0`, `"ccmp"
  off`, `-webkit-font-feature-settings`, `font-variant-ligatures: none`,
  `font-variant: none`, and `"ccmp" 0,"calt" 0,"liga" 0,"clig" 0` together. So
  every heading, deck and caption in a `<NonShield>` read as scrambled words to
  every Safari reader while looking perfect to the author on Chrome — the exact
  silent-wrong-text failure the component exists to prevent.

  The fix is a different file rather than a different rule: **`optik-n`, the
  neutral cut** — same Optik outlines, same metrics, same sanitised name table,
  built from the same statics, and no injected lookups at all. Nothing to
  switch off means nothing an engine can decline to switch off. It is ~35 KB a
  cut against a shielded face's ~840 KB, because it carries the 526 real glyphs
  and none of the ~35,900 word composites. It is declared under its own family,
  **`"Optik Text"`** (`.tk9-t` in the paste-in CSS), and ships in both
  `@shieldfont/react` and `@shieldfont/font`.

  Every document that told you to write `font-feature-settings: "ccmp" 0` by
  hand outside React was wrong for the same reason and has been corrected.

- **`font-style: italic` silently rendered upright.** The family was upright
  only, and every element the package renders sets `font-synthesis: none` — a
  faux oblique smears Playtype's outlines and distorts the word composites
  enough to expose that decoys are in play — so an italic had no face to
  resolve to and simply did not happen. No error, no 404, no warning.

- **The font-load guard could not see a missing italic.** Its probe key was the
  weight alone, so an upright 700 marked italic 700 as covered. It now keys on
  `style:weight` and reads `font-style` in its DOM sweep, and the SSR seed
  carries the style with it.

### Added

- **Real italics for every weight, in every variant.** Six drawn cuts per
  dictionary, declared under the **same family name** as the uprights — which
  is what makes them reachable by ordinary CSS rather than only by a prop.
  Verified against every variant: the italic composites draw the same originals
  as their upright siblings, so a word encodes to one decoy whether or not it
  was italicised.

- **`italic` prop on `<Shield>` and `<NonShield>`.** Unset inherits, so a block
  inside an italic region follows it; `italic={false}` pins upright against
  one. Inside a `<Shield>` a whole block is the only italic available, because
  `children` must be a plain string — `<NonShield>` takes arbitrary JSX, so a
  nested `<em>` resolves on its own.

- **`setCamouflage({ neutralFamilyName, neutralFilePrefix })`**, and a
  hash-derived default (`Optik <hash> Text` / `font-<hash>-n`). A global
  `familyName` string deliberately does NOT sweep the neutral cut along with
  the shielded four: it is a different file and must keep a different family
  name, or CSS font matching would hand unshielded headings back to the
  shielded face.

### Changed

- **`<NonShield>`'s `variant` prop is deprecated and ignored.** It used to pick
  which shielded file to fetch, which was only ever a bandwidth choice. There
  is one neutral cut now. An unbundled value still throws.

- **Both packages roughly double in size.** `@shieldfont/react` goes from 24
  font files to 54, and that is what a complete italic family costs: each
  shielded cut carries ~35,900 composite word-glyphs. The neutral twelve add
  ~430 KB in total.

- The paste-in CSS and its documented `@import` pin now say `0.3.3`. They had
  been left at `0.3.0` through two releases.

---

## [0.3.2] — 2026-08-03

### Removed

- **`notice` no longer works as a silent alias for `wrapper`.** It was the 0.3.0
  spelling of the same prop and kept resolving quietly while `explain` — the
  other old spelling — threw. One mistake was loud in one spelling and silent in
  the other, and no document mentioned `notice`, so nobody could have known it
  was still there. It now throws and names `wrapper`, like `explain` does. The
  value is unchanged, so renaming the key is the whole migration.


### Added

- **`wrapper={{ className }}` — a styling hook on the drawn wrapper.** The box,
  its strips, the sentence and the Uncover/Copy buttons had no hook at all:
  `<Shield className>` lands on the encoded block and on the element the
  revealed words go into, i.e. on the text, and nothing reached the furniture.
  The reported case is the Uncover button inheriting colours from the emitted
  stylesheet, which cannot know a host page's dark mode.

  It is a separate field rather than a widening of `<Shield className>` on
  purpose. That prop already has a documented, shipped meaning, and making it
  also hit the wrapper would silently change what existing stylesheets do on
  upgrade — a rule setting an article's measure and line-height would start
  applying to the box and both strips, with nothing to say so. `<NonShield>`'s
  `className` is unchanged: it renders one element and has no furniture, so
  there is nothing to disambiguate.

- **`<NonShield>` in `@shieldfont/react` — the page's ordinary text, in the same
  typeface.** It renders its children exactly as written, in Optik: no encoding,
  no decoys, no `aria-hidden`, no sealed payload, no puzzle, no copy guard, no
  notice strip. A screen reader reads it, a search engine indexes it, a
  translator translates it, copy-paste copies it, find-in-page finds it.

  It exists because a ShieldFont page always had two kinds of type on it. The
  shielded paragraphs rendered in Optik and the headings, decks, captions and
  nav around them rendered in whatever fallback the host stylesheet supplied,
  because there was no supported way to put unprotected text in the shipped
  face. It also gives `docs/integration.md`'s own rule somewhere to land:
  headings must never be shielded, and `<NonShield as="h2">` is how a heading
  stays real *and* in the right typeface.

  **It is not a `font-family` rule with a component around it, and must never be
  reimplemented as one.** The shipped `optik-*.woff2` files are not the Optik
  typeface — they are *shielded* builds of it. `scripts/generate_font.py` wires
  the substitution lookups into the OpenType `ccmp` feature, which is on by
  default and which `font-variant-ligatures: none` does not reach, and the
  dictionary is an **involution** (`m[m[x]] === x`, which is why `decode` is
  defined as `encode`). Every word in it is therefore both an original and a
  decoy and the font swaps it either way, so plain English through a shielded
  face renders the **decoy**. Shaped through the shipped `optik-a.woff2` with
  HarfBuzz: `"Read the docs"` draws as composites built from the letters
  `"Reset"` and `"sellers"`, `"belongs"` draws as `"determines"`, `"2026
  report"` draws as `"2527 report"`. 11,962 of the 11,970 `alpha` words behave
  that way, and **nothing errors** — the page renders, the bytes are correct,
  and a heading just says the wrong thing.

  `<NonShield>` sets `font-feature-settings: "ccmp" 0`, which is exact rather
  than approximate: with the feature off, all 11,970 dictionary words shape to
  their own letters, the base font's real `fi`/`fl` ligatures survive, and
  accented text is untouched in both NFC and NFD.

  Arbitrary JSX is accepted, which `<Shield>` rejects — there is no encoder to
  blind here, so there is no protected form for nested content to fall out of,
  and the content this component exists for (headings, captions, nav) is the
  content most likely to contain a link or an emphasis. Any prop it does not
  recognise throws, the same fail-loud treatment `<Shield>` gives one. It is
  safe inside `"use client"`: no plaintext to leak, no dictionary in play.

  **Stated limits, because they are not obvious.** `variant` selects only which
  file the browser fetches — with substitutions off, all four faces draw
  identical outlines — so it is a bandwidth choice, and it deliberately does
  **not** auto-rotate the way `<Shield>`'s does. And it emits **no font-load
  guard** and is not covered by `<Shield>`'s: it does not stamp the
  `data-typeface` attribute the guard's selectors match, so a missing font
  leaves it rendering the correct words in a fallback face rather than blanking
  them behind the "Content unavailable" skeleton. Seeding its weights into the
  guard would also mean a missing `optik-a-800.woff2` used by one heading could
  skeletonise every genuinely shielded block on the page.

### Changed

- **`<Shield>`'s `explain` prop is now `wrapper`, and passing `explain` throws.**
  The prop decides whether the visible box is DRAWN on screen. `explain` named
  the sentence printed inside the box — one of the things the box contains — and
  read as though `explain={false}` would keep the box and drop the words. The
  value is unchanged: the same `boolean | ShieldNotice`, with the same nested
  `text`, `labels`, `position` and `className`.

  There is **no silent alias**. `explain` is rejected with a message naming
  `wrapper`, for the reason this package fails loud everywhere else: an alias
  leaves two spellings of one prop alive in every codebase that used the old
  one, and the next person reading that code has to know both. A block that
  quietly kept `explain` would render with the wrapper's default rather than the
  setting its author asked for, which is exactly the silent kind of wrong the
  component throws to avoid.

- **The four tier names — FULL, INVISIBLE, MINIMAL and SEALED SHUT — are
  deleted.** They were never API: there was no `tier` prop, only a table in a
  comment mapping each invented name onto a combination of `screenReader`,
  `wrapper` and `copyPaste`. A reader had to memorise the mapping before the
  names told them anything, and the three props say the same thing with nothing
  to memorise. Nothing is replacing them; the switches are described one at a
  time, each with what it costs.

  All three default to **on**, and the documentation now says exactly what the
  code does. `screenReader` defaults on unconditionally. `wrapper` and
  `copyPaste` default on wherever there is a seal to open — i.e. wherever
  `screenReader` is on — because both are inert without one and both throw if
  asked for explicitly with it off. `wrapper` has one further exception, which
  is not new but was undocumented: an inline tag (`as="span"` and the rest)
  never draws it, because the wrapper is a block-level box and a `<div>`
  mid-paragraph breaks both the layout and hydration.

  Two claims in the old `copyPaste` doc comment were stale and are corrected:
  it does **not** default to whatever the wrapper is. It has followed the
  presence of a seal since 0.3.2, and the independence is the point — a decision
  about whether to draw a box should not silently decide whether a copied
  paragraph comes out wrong.

- **`<Shield>` now declares `font-feature-settings: normal` on its rendered
  element.** `font-feature-settings` is an inherited property and every word
  swap in this package rides the `ccmp` feature, so any ancestor that turns
  `ccmp` off turns the shield off — the browser draws the raw decoy text at full
  readability, the page looks completely normal, nothing throws, nothing 404s,
  and the font-load guard stays silent because the font loaded fine.
  `<NonShield>` sets exactly that rule, so a `<Shield>` nested inside one was
  the concrete case; an author stylesheet doing the same thing is the general
  one. The inline declaration re-enables the feature at the shielded element
  itself, where it beats anything inherited.

- **The time-lock puzzle was re-costed against a corrected OCR measurement.**
  `DEFAULT_SECONDS` is **14** (was 20) and the accepted range is **1..30** (was
  5..120), so the default is **1,680,000** sequential squarings rather than
  5,000,000. `REFERENCE_SQUARINGS_PER_SECOND` moved **down** to **120,000** (was
  250,000): the old figure was described as "a deliberately slow reference
  device" and was in fact 96% of one of the fastest consumer cores in existence,
  so every author who reasoned from it was told their readers would wait N
  seconds and their readers waited longer. The old default's reasoning was wrong
  in three places at once — it put render+OCR at ~3 CPU-seconds per page when it
  measures ~5.0, assumed server cores beat a laptop at bignum work when they do
  not, and costed the puzzle per *page* while the component seals per *block*.
  Reader-side, the default now takes about **2.5 s** in a warmed Chrome worker on
  Apple Silicon.

- **`a11y={{ mode: "audio", src }}` is gone.** It shipped in 0.3.0 as one of the
  two ways to give a shielded block a real alternative: you synthesised a
  recording of the original words at build time, hosted it, and `<Shield>`
  rendered a native `<audio controls preload="none">` beside the block. It is
  removed on the maintainer's own reading of it in issue #2, and the reasons are
  worth keeping because they are the reasons not to bring it back.

  It was **the only mode that asked for work outside the build.** Every other
  part of this package runs from the text you already have; this one wanted a
  file you had to produce, name, host and keep in sync with the copy every time
  you edited a paragraph. Almost nobody was going to do that, and an accessible
  alternative that is not configured is not an alternative — it is a
  documentation entry sitting next to a silent block.

  The authors who *did* do it were not covered either. **Audio-only content with
  no text alternative fails WCAG 2.2 SC 1.2.1 (Level A)**, and `mode: "text"`
  never rescued it: the two were separate alternatives you chose *between*, not
  a pair. The `transcript` link that would have answered 1.2.1 had already been
  removed in 0.3.0, for the same reason the 0.2.0 `href` was — a URL cannot be
  offered to a screen reader without being offered to every crawler that reads
  the decoy beside it. So the mode was stuck: the fix for its one conformance
  hole was the exact thing this package cannot ship.

  **What to do instead.** `a11y={{ mode: "text" }}` is the default and needs
  nothing from you. If you want a recording as well, put an `<audio>` element
  next to the block yourself — nothing here ever stopped you, and doing it by
  hand keeps the transcript your decision rather than this library's omission.

  Passing `{ mode: "audio" }` is now a **type error**. A plain-JS caller who has
  not migrated gets no `<audio>` element and no `src` in the markup rather than
  a silently half-built player; `a11y.test.ts` asserts that. The `src`,
  per-mode `visualHidden` defaults (`true` for text, `false` for audio) and the
  per-mode note table went with it, so `visualHidden` now simply defaults to
  `true` and the note is one string. **No text-mode behaviour changed.**

- **The thrown errors and the dev-time warning no longer enumerate it.** The
  `copyPaste`-without-a-seal message used to end "Either remove
  `screenReader={false}` / `a11y={{ mode: "none" }}` / `a11y={{ mode: "audio" }}`",
  which after this release would send an author to configure a mode that does
  not type-check. The remaining two spellings of "off" are unchanged.

- **`docs/plain-text-mode.md` states a measured `seconds: 10` figure again.**
  The row had said 4.0 s, a number left over from the 5,000,000-step
  calibration and impossible under the current one — the default `seconds: 14`
  measures ~2.5 s, so a smaller budget cannot take longer — and it was deleted
  rather than replaced, because a figure produced by arithmetic and printed as a
  measurement is how it got wrong in the first place. It is now **~1.8 s**,
  timed in the solver's own warmed Worker under real Chrome, median of eleven
  runs, with the machine named beside it. The `seconds: 14` row was re-measured
  at the same time and its ~2.5 s stands.

### Fixed

- **The Uncover button was blank on a dark page.** Its fill is the host's text
  colour, which is deliberate; its glyphs were `Canvas`, on the reasoning that
  the UA canvas is the host's page colour so it must contrast. `Canvas` is not
  the host's page colour — it is what the user agent would paint, and it only
  goes dark when the document opts in with `color-scheme: dark`. A site with a
  hand-rolled dark theme (`body { background: #111; color: #eee }`, which is how
  most dark themes on the web are actually built) left `Canvas` white, so the
  button drew near-white glyphs on a near-white fill. Measured: **1.16:1** on
  that host, **1.09:1** on `#0b0b0b`/`#f5f5f5`, **1.23:1** under Tailwind
  Preflight with a slate theme, **1.00:1** under Windows High Contrast. Not
  "hard to read" — a button with nothing drawn on it.

  The glyph colour is now derived from `currentColor` itself with relative
  colour syntax, so it asks the fill rather than the user agent. The same three
  hosts now measure **18.1:1**, **19.3:1** and **17.0:1**, and forced-colors
  gets a block of its own using `ButtonFace`/`ButtonText`/`ButtonBorder`. The
  wrapper still inherits the host's text colour; nothing in it is a fixed
  palette. Browsers without relative colour (pre-Chrome 119 / Safari 16.4 /
  Firefox 128) get an outlined Uncover button instead of a filled one, which is
  plainer than intended and legible on any host.

- **Three more contrast failures found by the same audit.** The strip's sentence
  faded `currentColor` to `.7`, which measured 4.14:1 on a Tailwind `gray-700`
  body — one of the most-deployed pairs of colours on the web — and the loading
  line at `.72` measured 4.36:1; both are `.8` now (5.40:1 and 5.13:1). The copy
  confirmation's green and red were keyed to `prefers-color-scheme`, which is
  the reader's operating system and not the colour of the page they are looking
  at, so a dark site on a light OS got 3.68:1 and a light site on a dark OS got
  1.55:1; they are derived from `currentColor`'s lightness now (7.05:1 and
  11.9:1). No fixed colour could have fixed the last one: a green dark enough
  for 4.5:1 on white and a green light enough for 4.5:1 on `#111` do not overlap.

- **Host stylesheets could resize the controls.** The buttons' `font-size:.66rem`
  and the toast's `.82rem` are the HOST's root font size, so a page using the
  old `html { font-size: 62.5% }` trick drew the button labels at **6.6px** —
  uppercase, 500 weight, and invisible to every contrast checker because the
  colour was perfect. Both are absolute now (11px and 13px, what those rem
  values resolved to on a default host), and the buttons declare their own
  `line-height` so the pill's height is not the host's decision either. The
  buttons' outline was `rgba(128,128,128,.34)`, which measured 1.45:1 against
  the strip on every light host; it is `currentColor` at 62% now, over 3:1 on
  every host measured, with a mid-grey fallback.

  The emitted stylesheet grows by **1,715 bytes raw / 263 gzipped** per scope.

- **The cache of solved blocks grew forever.** When a reader finishes a block's
  puzzle, the answer is kept in `localStorage` under the store prefix plus the
  first 40 characters of that payload's ciphertext, so a second visit is instant
  instead of another fourteen seconds of squaring. **Nothing ever removed one.**
  `sealText` mints fresh primes and a fresh IV per call, so every build re-mints
  every ciphertext and every key written against the previous build is orphaned
  the moment the site deploys — roughly **550 bytes each**, accumulating for as
  long as the reader keeps coming back. It never errored and it had no ceiling,
  which is why nobody saw it.

  Each value now carries the time it was last used, and both emitted scripts
  drop anything under their own prefix untouched for **thirty days**, once per
  page load. The stamp is refreshed on every read, so the bound is "not used in
  thirty days" rather than "written thirty days ago" and a page anywhere in a
  reader's rotation stays cached indefinitely. Values written by 0.3.2 and
  earlier carry no stamp and are dropped on sight — they are provably dead
  rather than merely old, because the ciphertext each was keyed on came from a
  `sealText` call that will never be made again.

  **What this is not, and must not be turned into:** a sweep that drops the keys
  the current page does not need. The prefix is per-*site*, so most of what such
  a sweep cannot account for is the reader's **other pages**, and every
  navigation would wipe the cache for all of them — turning "instant on return"
  into "never instant", which is the entire feature. A bound here has to be
  decidable from the entry alone, which is why it is age and not membership. The
  two alternatives were weighed and rejected in the header of `notice.ts`: a cap
  with oldest-first eviction bounds the wrong quantity and evicts hardest from
  the readers who read the most, and a schema version fires only on the rare
  release that changes the format while the drip runs the rest of the year.

  A reader can still lose an entry they wanted: one for a page they last opened
  more than thirty days ago, on a site that has not redeployed in between. They
  pay the grind once more. Storage that is disabled, full or throwing is
  swallowed exactly as before. The emitted scripts grow by **682 bytes raw /
  245 gzipped** (the drawn wrapper) and **725 / 249** (the clipped control).

### Added

- **`npm run test:style` — the wrapper measured inside seventeen hostile host
  pages,** wired into CI beside the axe scan. `scripts/style-audit.mjs` renders
  the drawn wrapper under Tailwind Preflight, a `* { margin: 0 }` reset,
  `button { all: unset }`, `button { font-size: inherit !important }`,
  `* { line-height: 1 !important }`, a global `svg { width: 100% }`,
  forced-colors, 10px and 24px root font sizes, `dir="rtl"`, and four
  combinations of light/dark host and light/dark OS. For each it reports the
  computed contrast of the sentence and of every button label and icon against
  the background actually painted behind them, whether each control still has a
  perceivable boundary, whether anything overflows, whether the icons still have
  size, and whether each button is hit-testable at its centre point.

  It walks the ancestor chain and **accumulates opacity** on the way down, which
  is the reason it exists and not a detail: `getComputedStyle` reports a child's
  own opacity as 1 while an ancestor paints the whole subtree at 0.7, and an axe
  run had already returned a false all-clear on that exact element. Every number
  in the two entries above came out of this script, and every one of them was
  invisible to the four checks that ran before it. The bug report it was written
  for was one sentence long and nobody could say what it meant.

## [0.3.1] — the solver stops fighting React hydration

The fix is in `@shieldfont/react`. `@shieldfont/core` and `@shieldfont/font`
have no changes in this release and are republished at 0.3.1 only because the
three version together — the publish workflow refuses a tag that any package
disagrees with, which is what keeps a mismatched number off npm.

### Fixed

- **The puzzle control broke hydration for every returning reader.** The solver
  script runs at parse time, by design — it has to work without React, without a
  bundler, and on a static export. On a return visit it finds the reader's
  plain text in `localStorage` and reveals it immediately, which meant writing
  text into two elements React had server-rendered EMPTY: the live-region status
  line and the output element. React hydrated moments later, found children it
  had not rendered, and threw. Measured in a **production** React build against
  the real emitted solver: four `#418` recoverable errors plus one `#423`, in
  BOTH `reveal: "hidden"` (the default) and `reveal: "visible"`, where the whole
  subtree is then discarded and client-rendered from scratch.

  Both elements are now rendered with an empty `dangerouslySetInnerHTML`.
  Nothing is injected — the payload is a constant empty string — and the point
  is what it tells React: an element with `dangerouslySetInnerHTML` has no child
  fibers, so React neither hydrates nor reconciles anything inside it and the
  solver's writes stop being React's business. Same lesson the font-load guard
  learned in 0.2: anything touching the DOM before hydration has to be invisible
  to reconciliation. The guard's answer was a stylesheet; this one is an opaque
  container. Verified as zero recoverable errors in the same probe.

  No markup shape changed, no API changed, and the `localStorage` key is
  untouched — cached unlocks survive the upgrade.

### Known, and not fixed here

- **Attribute writes still mismatch in development.** The solver flips `hidden`,
  inline `display` and `tabindex`, and stamps `-solve-wired` on the button,
  before React arrives. React warns about attribute mismatches in `next dev` and
  never patches them, so this is noise in development and nothing in production.
  Fixing it means moving the visibility flips to a stylesheet keyed off
  `document.documentElement` — the one node React never owns — which is a real
  change rather than a two-prop one, and is not a correctness fix.
- **The plain-text cache persists across reloads**, so a block a reader has
  unlocked renders as plain text on every later visit in that browser. Intended
  on a real site; on a demo or preview page it deletes the demonstration. The
  key is the `attrName` prefix plus the first 40 characters of the ciphertext.

## [0.3.0] — the accessible alternative, and a pre-release audit

A plain-text accessible alternative that a scraper cannot read for free. The
URL-shaped answer is removed and a time-locked one replaces it, so the words
are in the page for the reader who needs them and cost real sequential compute
for anyone harvesting at scale.

Shipped alongside it: the fixes from an adversarial pre-1.0 review of the
encoder, the marker workflow and the docs. Two of those are **plain-text
leaks** — see *Fixed* below. If you run the comment-marker workflow, read the
`assertShipped` entry first; it is the one change that alters what your build
script should look like.

### Added

- **`assertShipped(html)` in `@shieldfont/core` — the deploy gate.** Throws if
  any shield marker survived, or if a `shield-on` block is missing its
  `shield-off`. `checkHtml` cannot do this job: it verifies the markers it
  *finds*, so an unbuilt page and a correctly shipped page both return
  `{ total: 0, failed: 0 }`. Add it as the last step before you write a file.
- **`checkHtml` now reports `unpairedBlocks`.** Non-zero means some region was
  never encoded, even when `failed` is `0`.
- **`<Shield>` throws on table-context `as` values** (`td`, `th`, `tr`, …). The
  browser foster-parents our wrapper out of the table, which dropped the cell
  from the accessibility tree and left a stray one behind. Use
  `<td><Shield as="span">…</Shield></td>`.

### Fixed

- **LEAK: the documented build recipe never stripped the markers.** The
  runnable script in `docs/use-anywhere.md` called `buildHtml` and wrote
  straight to `dist/`, so every protected block deployed with its plain text in
  the comment beside its decoy — worse than not using ShieldFont at all,
  because it also publishes a matched plaintext/decoy pair. The recipe now
  calls `shipHtml` and `assertShipped`.
- **LEAK: an unpaired `shield-on` shipped a whole block in plain English, and
  CI went green.** `BLOCK_RE` needs both markers, so an unclosed block was
  never encoded; `shipHtml` then deleted the orphan marker, erasing the
  evidence. `assertShipped` catches it.
- **LEAK: prose containing `-->` broke out of its own marker.** Author text was
  interpolated into an HTML comment unescaped, so a Mermaid arrow or a roadmap
  line shipped its tail in clear *and* corrupted the paragraph on screen.
  `buildHtml` now refuses that input with a message naming the offending text.
- **A tag name inside an HTML comment silently disabled encoding for the rest
  of the page.** The tag pattern could not match `<!--`, so `<!-- <pre> -->`
  incremented the skip depth and never gave it back. Comments are now matched
  whole, and raw-text elements (`script`, `style`, `textarea`, `title`) are
  consumed whole so markup-looking text inside them cannot move the counter.
- **`>` inside an attribute value closed the tag early**, so the rest of the
  attribute was encoded as text — against this package's own promise that
  attribute values are never touched. An `aria-label` rewritten that way voices
  a decoy. The tag grammar is now quote-aware.
- **HTML character references were corrupted.** The digit rule rewrote the code
  points inside them: `don&#39;t` rendered as "donTt", `&#169;` became ®,
  `&#8212;` became ಌ, and `&#75;b&#72;` became `&#60;b&#62;` — plain text the
  browser then parses as a live `<b>` tag. Named references went the same way
  (`&copy;` → `&avoid;`). The browser resolves these before the font runs, so
  no ligature could undo any of it, and `checkHtml` passed on all of them
  because the string round-tripped. References are now left alone.
- **`encode("constructor")` returned the source of `Object`**, and
  `"Constructor"` at the head of a sentence threw. The dictionary lookup walked
  `Object.prototype`, where `constructor`, `toString`, `valueOf` and
  `hasOwnProperty` are all reachable and all ordinary English. Own properties
  only, now.
- **`buildHtml` was not idempotent.** The marker stored its source trimmed, so
  boundary whitespace beside an inline element was lost on the next build:
  `call <code>x</code> and` became `call<code>x</code>and`, a little more each
  run. Whitespace now stays outside the marker.
- **`<title>` and `<option>` are no longer encoded.** They render in system
  chrome — the browser tab, a bookmark, a `<select>` popup — where the ligature
  table does not apply, so the reader saw the raw decoy.
- **The font guard ignored the protected element itself.** It walked only
  descendants, and our font-family arrives as an inline style that loses to any
  author `!important`. A theme rule like `article p { font-family: Georgia
  !important }` painted raw decoys to every reader while the guard whose job is
  to catch exactly that stayed silent.
- **`mappingMeta()` dropped `mappingId`, `pairs` and `seed`.** It rebuilt a
  four-field object instead of returning the `_meta` block, so the documented
  `mappingMeta(alpha)?.mappingId` returned `undefined` in three places that
  told you to read it.
- **The a11y ordinal counted across element types**, announcing h2 / p / h2 as
  "heading 1", "paragraph 2", "heading 3" — a number that is nowhere on the
  page. Each noun now counts in its own series.
- **The CDN encoder build inlined the mapping's `_meta` block**, which would
  have put `"family": "ShieldFont Optik"` and `"seed": 42` into the one
  artifact whose job is to carry no branding. `_`-prefixed keys are stripped.
- **The CDN encoder's digit pass was a different algorithm from core's**, not a
  transcription of it: it scanned the whole encoded string rather than the gaps
  between words, so a custom mapping whose values contain digits diverged. It
  is now a faithful port, and the parity test's corpus reaches beyond the
  dictionary's own keys — which is why it never caught the `constructor` case.
- **Each variant's font guard inspected every other variant's blocks.** One
  guard is emitted per variant and auto-rotation puts two or three on a normal
  page, but every DOM lookup used the bare `data-typeface` attribute — so
  alpha's guard warned that beta's blocks were "using the wrong font" (they were
  using beta's font, correctly), and one variant's missing font blanked blocks
  belonging to variants that had loaded fine. Every lookup is now scoped to its
  own variant value.
- **`<Shield>` silently discarded props it does not forward.**
  `<Shield as={Link} href="/post">` lost `href` and produced a dead link or an
  unrelated crash from inside the component, naming nothing. Unknown props now
  throw, listing what was dropped and the shape that works.
- **`<Shield variant="Alpha">`** — or any near-miss — died as
  `Cannot convert undefined or null to object` deep in the encoder. It now names
  the prop and lists the valid values.
- **`encode(null)` / `encodeHtml(null)`** threw
  `Cannot read properties of null (reading 'normalize')` from a frame the caller
  had no reason to recognise. Both now name the offending argument, as does a
  missing or non-object mapping.
- **The Tier C encoder link pointed at the GitHub repo**, not the encoder.
- **`fc-query` was recommended for reading a font's version** without noting it
  cannot open `.woff2` — it fails with `Can't query face 4294967295`, which
  looks like a corrupt font and isn't. A working `fontTools` command is given.

### Changed

- **`examples/nextjs-demo` runs.** It could not be installed (`prepack` rather
  than `prepare`), had no `public/` for the fonts it requests, documented an
  attribute name that does not exist, named the wrong mapping, and shipped five
  `aria-hidden` blocks with no alternative.
- **Docs: the plaintext side doors are documented** — RSS/Atom feeds, JSON-LD,
  OpenGraph, CMS APIs and newsletters are generated from your source data, not
  your rendered page, and ship in plain English. On most blog platforms the
  feed is on by default. This was previously mentioned nowhere.
- **Docs: the four-corpus benchmark figures are used throughout** (19.4% wasted
  tokens, 41.8% median, per-corpus NLI). The front door had been quoting the
  superseded three-corpus cut, which `benchmark/README.md` explicitly retires.
- **Docs: the community font-naming convention no longer breaches the OFL.**
  Recommending "ShieldFont Inter" put a Reserved Font Name in a Modified
  Version's name, which OFL §3 forbids and §5 terminates the licence over.
  Keep the `ShieldFont` prefix, then use a name of your own.
- **Docs: `SECURITY.md` has a real reporting channel** (GitHub private
  advisories) instead of a `security@shieldfont.<tld>` placeholder, and its
  scope section no longer describes a 400-word dictionary the project does not
  ship.
- CI runs the screen-reader audit, and `publish.yml` refuses to publish when
  the package versions disagree with the pushed tag.
- **Docs: the README no longer implies a Vite/CRA app can use `<Shield>`.** A
  client-only SPA has no Node render step, so the component runs in the browser
  and compiles the plaintext *and* all 38,574 dictionary pairs into the bundle —
  build clean, page correct, console warning the only tell. The README now says
  which frameworks qualify, warns about the SPA case, and links
  `where-encoding-happens.md`, which it previously did not link at all.
- **Docs: the RSS/side-door warning is in the README**, not only the integration
  guide — a reader who skims to Quick start was missing it entirely.
- **Docs: CORS is documented for self-hosted fonts.** A cross-origin font with no
  `Access-Control-Allow-Origin` is discarded by the browser while curl still
  reports `200`, and on the CDN and Documents tiers there is no guard, so the
  reader silently gets the decoy.
- **Docs: Tier C gained an offline encoding recipe** and the "paste the *encoded*
  text" warning that Tier D already carried; Tier D now names the font family to
  pick in Word (`ShieldFont Optik`).
- **Packages: `engines: >=20.10.0`, `sideEffects: false`**, a real `exports` map
  and hand-written types for `@shieldfont/font`, and `src/mappings` dropped from
  the published files (unreachable through `exports`): `@shieldfont/core`
  unpacked drops from 2.8 MB to 1.9 MB.
- **A flaky test in the puzzle suite.** The tamper-rejection case overwrote the
  first character of the base64 ciphertext with a literal `"A"`, so a payload
  that already began with `"A"` was left byte-identical, decrypted correctly, and
  failed the assertion for the one reason it was not testing — roughly 1 run in
  64, which is how it reached CI. It now decodes and inverts a byte.
- The example app builds the workspace packages itself (`predev`/`prebuild`)
  rather than relying on a package `prepare` script. A `prepare` on
  `@shieldfont/react` runs `tsc` during `npm install`, before
  `@shieldfont/core`'s `dist/` exists, which breaks a fresh clone — it only
  appeared to work where a previous build had left `dist/` on disk.

### Added

- **`a11y={{ mode: "text" }}` on `<Shield>` — the block's real words, encrypted
  into the page, opened by the reader's own browser.** No `href`, no URL, no
  link anywhere. That object on its own is a complete configuration: nothing to
  generate, nothing to host, no server. Full reference:
  [`docs/plain-text-mode.md`](docs/plain-text-mode.md).
  - **How.** Each block gets its own **time-lock puzzle** (Rivest–Shamir–Wagner,
    1996) at build time. With `n = p·q`, the key is `2^(2^T) mod n`: T
    sequential squarings, each needing the result of the one before, so the
    work **cannot be parallelised**. A crawler with a thousand GPUs still pays
    T sequential steps per block; its only advantage is a faster single core.
  - **The build is cheap because it holds a trapdoor.** Knowing `p` and `q`
    collapses the tower into two modular exponentiations: **62 ms to seal a
    block whose default budget is twenty seconds of the reader's own CPU.** The
    primes are discarded and never returned.
  - **Options, all optional.** `seconds` (default 20, range 5..120);
    `reveal: "hidden" | "visible"` (default `"hidden"`); `label` overrides the
    button's accessible name; `note` overrides the explanatory sentence; and
    `visualHidden`, which now defaults to **`true` for `mode: "text"`** and
    stays `false` for `mode: "audio"` — a player nobody can see is a player
    nobody can press.
  - **The control is screen-reader-only by default.** Nothing about it appears
    on screen. A sighted reader can already read the block — the font does that
    work — so a note and a button explaining an unlocking mechanism would be an
    unexplained widget attached to text that looks fine.
  - **Unlocked words go to assistive technology, not to the layout.** Under the
    default `reveal: "hidden"` they land in the accessibility tree clipped
    off-screen and the encoded block stays visible and unchanged, so nothing
    shifts for anyone else. `reveal: "visible"` instead replaces the encoded
    block on screen: it costs a layout shift and buys selection, copy-paste and
    browser translation of the real text for everyone.
  - **Every block's button has a distinct name** — "Unlock the plain text for
    paragraph 2 (up to 20 seconds)", built from the element type and the
    block's position on the page. Identical labels sounded fine on a one-block
    demo and were unusable on a real article: nothing told two buttons apart by
    ear. For the same reason the long explanatory note is spoken **once per
    page** and later blocks get a short form.
  - **Revealed text is spoken on arrival and can be re-read.** The output is its
    own polite live region, so filling it speaks it, and it becomes a real Tab
    stop the moment it has content. The wrapper is `role="presentation"` with
    **no group role** (VoiceOver was reading roughly twenty words of group
    scaffolding in front of every button), and the status region announces
    nothing at all while it is empty.
  - **Known cost, and not a small one: sighted keyboard users.** Because the
    control is invisible by default, someone navigating by keyboard **without**
    a screen reader Tabs into a control they cannot see and loses their focus
    indicator — a **WCAG 2.2 SC 2.4.7** failure. It is deliberate rather than
    an oversight (the skip-link pattern of appearing on focus was rejected: the
    control was asked to be invisible), and `visualHidden: false` restores an
    on-screen control for anyone who would rather take the other trade.
  - **Screen-reader verification, stated exactly.** Driven under Playwright
    with `@guidepup/virtual-screen-reader`, and by hand with **real VoiceOver on
    macOS** — which is what found the group chatter, the announcements that cut
    each other off, and the revealed text that could not be re-read. **NVDA and
    JAWS remain unverified**, there is no axe scan and no published test page.
  - **Fresh primes per block, per build.** Solving one block teaches an
    attacker nothing about the next, and every redeploy invalidates every
    solution already computed. That expires your readers' cached solutions too;
    the symmetry is the point, because it is the same property that expires the
    crawler's.
  - **Difficulty is bounded above by OCR, not by paranoia.** A crawler can
    always render the page and read the pixels for roughly three seconds of
    server CPU, with or without this feature — that is the floor on the whole
    package's protection and no cryptography raises it. So the target is not
    "expensive", it is **not cheaper than OCR**: enough that the accessible
    path stops being the *shortcut*, and no further. Past that, extra
    difficulty buys nothing and is paid for entirely by disabled readers
    waiting longer. Default `seconds: 20`, accepted range **5..120**, optional
    per block. Quote the ceiling whenever you quote the default.
  - **Measured.** Sealing ~62 ms per block; 2048-bit modulus; 5,000,000
    squarings at the default; **Chrome desktop solves it in 7.6 s**. The
    labelling rate is a deliberately conservative 250,000 squarings/second —
    roughly a mid-range phone — so `seconds` is a budget denominated on a
    *slow* device. The button says "up to N seconds" and a live status
    line replaces that with a real per-device measurement about 80 ms after the
    press.
  - **Limits, stated where the feature is sold.** It needs JavaScript plus
    `BigInt` and `crypto.subtle` — the only part of ShieldFont that does not
    work with JS off — and `crypto.subtle` is absent on insecure origins, so
    plain `http://` breaks it. A reader who needs this waits while everyone
    else has the words instantly, which is unequal access however carefully it
    is engineered. OCR stays cheaper for a determined crawler: this is not a
    wall. Once revealed the plaintext is in the DOM, having been paid for,
    which is the deal. React only — the CDN paste-in and `@shieldfont/core`
    ship none of it.
  - **It does not rescue the audio mode.** `{ mode: "audio" }` on its own still
    fails **WCAG 2.2 SC 1.2.1 (Level A)**; the two are separate alternatives an
    author chooses between, not a pair.
- **`@shieldfont/core/puzzle`** — a new export subpath exposing `sealText`,
  `solveText`, `DEFAULT_SECONDS` and `REFERENCE_SQUARINGS_PER_SECOND`. The
  puzzle is independent of React and is exported for tooling. Deliberately
  **not** re-exported from the package index: `sealText` needs `node:crypto`
  for prime generation, and keeping it off the index means bundling
  `@shieldfont/core` for a browser never pulls it in.
- **`encodeSegments(text, mapping)`** — the encoder's own tokenizer, exposed. It
  returns the text piece by piece (`{ original, encoded, swapped, kind }`), and
  `encode` is now defined as the join of those pieces, so the two cannot
  disagree. For anything that has to *show* the substitution rather than just
  apply it — a live encoder, an x-ray overlay, a swapped-token counter — this
  replaces re-deriving the token boundaries. Every consumer that rolled its own
  `/[A-Za-z]+/g` loop had the same bug: **digits were skipped entirely**, so a
  pane displayed "Take 3 tablets" while the encoder and the font both read 8.
  `encode` and `decode` are byte-for-byte unchanged.

### Removed

- **BREAKING (`@shieldfont/react`): every plain-text URL is gone from the
  `a11y` prop.** Both `a11y={{ mode: "text", href }}` and the optional
  `transcript` (with its companion `label`) on `{ mode: "audio" }` are
  removed, and `<Shield>` renders **no `<a>` element at all**. A project
  passing either **fails to compile**; there is no runtime deprecation window,
  because a silent fallback would leave the link in the HTML, which is the
  whole problem. Note that `mode: "text"` still exists as a name — with an
  entirely different shape and no `href`, per the Added section above.
  - **Why, once, for both.** A URL cannot be offered to a screen reader
    without being offered to everyone else, and the same crawl that reads the
    decoy reads the link sitting beside it. One line of scraper code follows
    it and gets the original. A block carrying either was strictly *less*
    protected than an unwrapped one while still looking protected, which
    defeats the entire purpose of the package.
  - `0.2.0`'s own acceptance criteria said as much about `mode: "text"` and
    shipped it anyway, filed under "the trade that mode asks you to make". It
    is not a trade an author can make knowingly, because the cost lands on the
    content, not on them. `transcript` was the same hole in a smaller opening.
  - **`{ mode: "audio" }` alone still fails WCAG 2.2 SC 1.2.1 (Level A),** and
    that is not fixed by anything in this release. `transcript` was this
    package's only answer to that criterion; the new text mode is a *separate*
    alternative, not a text alternative *for the audio*, so an author who ships
    audio and nothing else still cannot satisfy 1.2.1. Audio is also still not
    a document — not navigable by heading, not searchable, not quotable, not
    skimmable. Do not let the text mode's arrival blur either point.
  - **Migration.** Replace `{ mode: "text", href }` with `{ mode: "text" }` —
    drop the `href` and delete the page you were hosting; the words now ride in
    the block itself. Replace a `transcript` link the same way, or record the
    block (`piper` on CI, `say` on macOS, both free and offline) and pass
    `{ mode: "audio", src }`, or pass `{ mode: "none" }` to make the opt-out
    explicit and auditable. `note` still overrides the explanatory sentence. Do
    **not** reintroduce either link by hand beside the shielded block: the
    bypass is the URL being in the HTML, not the prop that wrote it.
  - `README.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `docs/integration.md`,
    `docs/use-anywhere.md`, `docs/custom-mappings.md`, `docs/CLAUDE.md` and the
    React package README are updated for both the removal and the replacement. `docs/CLAUDE.md`
    still tells AI co-pilots **never** to suggest linking a plain-text copy of
    protected text — that instruction is unchanged and is not softened by the
    new mode; what changed is that there is now a right answer to point at.
  - A test asserts the rendered output contains no `<a>` under any accepted
    configuration, including when a stale `transcript`/`label` object arrives
    from an unmigrated caller at runtime.

---

## [0.2.1] — the last letter of every shielded word

A rendering fix. `@shieldfont/core`, `@shieldfont/react` and `@shieldfont/font`
all move to `0.2.1`; only the two font-carrying packages have new bytes, and
`@shieldfont/core` moves with them to keep one version number across the set.

**Upgrade is drop-in. Already-encoded content stays valid** — the mappings, the
`cmap` and the whole GSUB payload are byte-identical, so no re-encoding, no
mapping bump, and no change to what a scraper reads. Pinned CDN URLs should move
from `@0.2.0` to `@0.2.1`.

### Fixed

- **Word ligatures rendered with the right-hand edge of the last letter shaved
  off.** Every composite word glyph was built with its `hmtx` left side bearing
  hardcoded to `0` while its real `xMin` was the first letter's own side bearing.
  Rasterizers size a glyph's raster from `(lsb, lsb + xMax - xMin)`, so an lsb
  of `0` on a glyph whose ink starts at 73 made that raster 73 units too narrow
  and took the shortfall off the **right** edge. In Chrome, `human`, `makes`,
  `hands`, `learns`, `people` and `bold` all lost the tail of their final letter;
  `world` and `things` did not, because the loss is the size of the **first**
  letter's bearing (`h`/`m`/`p` 73, `l` 68, capitalised cuts 81, `w` 7, `t` 19).
  Advance widths were always correct, so layout, line breaking and
  `measureText()` never showed it, and HarfBuzz/FreeType draw from the outline
  and never reproduced it — only the browser raster was wrong.
  - All four variants at all six weights are rebuilt: 35,886 composites per
    alpha file, 36,078 beta, 36,084 gamma, 7,584 maxhide.
  - `hhea`'s derived summary metrics are recalculated with them
    (`xMaxExtent` was reading 11973 against a true 11990).
  - WOFF2 files grow about 1.7%: a run of zeros compresses better than real
    side bearings.

### Added

- `scripts/fix_composite_lsb.py` — repairs the metrics on an already-built font
  without a full rebuild. `--check` reports (non-zero exit on damage),
  `--in-place` fixes, or `IN OUT` writes a copy.
- A third invariant check in `scripts/audit_font.py`: `lsb == xMin` on every
  composite, and the audit now fails on it. The existing shaping battery runs
  through HarfBuzz and is structurally blind to this class of bug.

### Changed

- `scripts/generate_font.py` writes the correct left side bearing, and seeds the
  composite bounding-box union from the first inked component instead of from
  `0` (which pinned `xMin` at ≤ 0 — masked in shipped files by fontTools
  recalculating bounds at save, but it is the value the bearing is read from).

---

## [0.2.0] — rotation, accessible alternatives, smaller fonts

> **Never published to npm.** This release shipped on the website only; the
> composite side-bearing bug fixed in `0.2.1` was found before it went out, so
> `0.2.1` is the first published version carrying any of the work below. Going
> from `0.1.1` straight to `0.2.1` on npm is deliberate, not a skipped release.

`@shieldfont/core`, `@shieldfont/react` and `@shieldfont/font` all move to
`0.2.0`. A feature release: two new `<Shield>` props, one new module-level
export, and rebuilt fonts that no longer carry glyph names.

### Added

- **Time-based variant rotation** in `@shieldfont/react` — the new `rotate`
  prop and the module-level `setRotation()`, plus `periodIndex()` and
  `variantFor()` for archive tooling. Off by default; omitting `rotate` keeps
  the existing content-hash behaviour exactly.
  - `period` is `"monthly"` (default, **calendar**-aligned — "the March font"
    means March, not a 30-day block), `"weekly"` or `"daily"`. All UTC, so two
    build machines in different time zones emit identical HTML.
  - The period is mixed **into** the existing per-block content hash, never
    used instead of it. A whole-site flip per period would be strictly worse
    than doing nothing: one font per site per period is a *cleaner* fingerprint
    than three. Mixing keeps the within-page spread and still reassigns about
    **two thirds** of blocks at each boundary.
  - `"maxhide"` is always filtered out of the rotation pool, even when a caller
    passes it explicitly — drifting into a much higher swap rate on a calendar
    boundary is not something that should happen unannounced. Pinning it with
    `variant="maxhide"` is unaffected.
  - Precedence, highest first: an explicit `variant` prop → the `rotate` prop
    → `setRotation()` → the content hash. `rotate={false}` opts a single block
    out of a site-wide `setRotation()`.
  - **Archives cannot be lost.** `at` pins the clock: a `Date` or ISO string is
    an instant whose period index is computed, and a **number *is* the period
    index**. Period 14 rebuilt in 2029 is byte-identical to period 14 built in
    2027, with no stored key and no backup. A published page is self-describing
    anyway — read `data-typeface`, apply that public mapping, and because the
    mapping is an involution, encoding the decoy returns the original.
  - **What this does not do.** Rotation does **not** defeat font inversion and
    does not slow it down. All three mappings are published in
    `@shieldfont/core`, all three fonts ship, and every block names its own
    variant twice (the `data-typeface` value and the `@font-face` `src`).
    Anyone who inverts once holds all three tables forever; anyone who re-reads
    the variant per crawl is unaffected. What it buys is narrower and real: a
    scraper's **cached** substitution table decays silently against a re-crawl,
    decoding the next period into plausible English that is wrong, with no
    exception and no 404 to trigger a retry. The cost added is recurring
    attention, not compute.
  - Only safe where the `@font-face` travels in the same bytes as the encoded
    text, which is what `<Shield>` does. Static exports stay correct forever.
    The CDN paste-in tier deliberately does not get this feature.
- **The `a11y` prop** on `<Shield>` — the accessible alternative, rendered as a
  sibling **outside** the `aria-hidden` region and **before** it in DOM order,
  so a screen-reader user reaches it before the silence.
  - `{ mode: "audio", src, transcript?, label?, note? }` renders a native
    `<audio controls preload="none">` plus a real explanatory sentence, and an
    optional transcript link. Native control, not a custom button: zero
    JavaScript, keyboard-operable and labelled for free, survives a static
    export.
  - `{ mode: "text", href, label?, note? }` links a plain-text copy.
  - `{ mode: "none" }` renders nothing and warns not at all — an explicit,
    auditable opt-out.
  - `visualHidden` clips (`clip-path: inset(50%)`), **never** `display:none`,
    which would remove the control from the accessibility tree as well and
    defeat the entire purpose.
  - Omitting `a11y` logs **one development-time warning per process**. A
    warning and not an error, so upgrading breaks no existing install.
  - `aria-hidden="true"` stays on the encoded block, unconditionally and
    deliberately. Voicing a decoy is worse than voicing nothing: it is fluent,
    wrong, and gives the listener no signal that anything is off.
- **Tests for the React package** (`packages/react/test/`, vitest, 51 tests)
  covering determinism, calendar alignment and UTC agreement, period-boundary
  reassignment rates, `maxhide` exclusion, archive reproducibility against
  golden values, the full precedence order, and the rendered accessibility
  markup.

### Changed

- **All four fonts rebuilt with the `post` table dropped to format 3.0**, in
  both `@shieldfont/font` and the React tier. This removes the glyph-name table
  from the shipped web fonts entirely — the composite word glyphs no longer
  carry names at all.
  - **About 18% smaller**: `optik-a` goes from 1,006,260 to 824,272 bytes;
    `optik-b` 1,010,016 → 829,144; `optik-c` 1,007,284 → 825,372; `optik-m`
    252,708 → 215,448. The React-tier copies shrink by the same proportion.
  - **Verified 100% round-trip on all four variants**, 77,148 shaping checks in
    total, with `ccmp` present and cmap and glyph counts unchanged
    (`optik-a` 36,412 glyphs / 438 cmap entries before and after).
  - `scripts/audit_font.py` now states that it must be pointed at a
    name-bearing `.ttf`, since a shipped `post` 3.0 woff2 has no glyph names
    left to audit by name.
- The React package's `README.md` accessibility section no longer claims the
  package "ships no accessible fallback" — it documents the `a11y` prop, the
  WCAG 2.2 SC 1.3.1 position, and what an audio track still does not fix.

### Fixed

- **Removed a self-contradiction in shipped source.** `Shield.tsx` recommended
  pairing the `aria-hidden` block with a browser `speechSynthesis` control over
  the original text — which would require shipping the plaintext to the
  browser, the exact leak the same file warns about a hundred lines earlier. It
  was also the package's only accessibility guidance. Replaced with a pointer
  to the `a11y` prop and an explicit note on why build-time synthesis is the
  only safe path.
- Rotation configuration is validated eagerly and fails loud: an unparseable
  `epoch`, or a non-finite period index, throws at `setRotation()` time instead
  of silently hashing `NaN` into a stable-but-meaningless variant.
- An inline `<Shield as="span">` now emits phrasing content for its accessible
  alternative, so the sibling cannot close an enclosing `<p>` early.

---

## [0.1.1] — camouflage hardening and honest licensing

Published to npm on 2026-07-24; this entry was written retrospectively at
`0.2.0` time, which is why it is short.

### Added

- `setCamouflage()` in `@shieldfont/react`: every SSR-visible literal
  (font-family, font filename, `data-*` attribute name, guard flag, console
  prefix) derives from a per-project hash, so two ShieldFont sites share no
  signature.
- `variant="maxhide"`, backed by the `m15en` mapping and the `optik-m` font.

### Changed

- Neutral `optik-{a,b,c,m}.woff2` filenames and a neutral `.tk9` class across
  the public and CDN tiers: nothing in the served bytes says "ShieldFont".
- The React tier's fonts are version-neutral (`Version 1.0`) on purpose, while
  `@shieldfont/font`'s report their dictionary generation. Keeping the two
  apart is what makes the React surface fully hidden.
- Licensing wording made consistent across `NOTICE` / `LICENSE-FONTS` /
  `AGENTS.md`: Optik is proprietary, used under the ShieldFont–Playtype
  partnership, not OFL.
- The `"use client"` footgun warning now fires in production too. A dev-only
  warning made the single worst misuse fail silently in the one environment
  where it matters.

### Removed

- `@shieldfont/cli` is no longer published.

---

## [0.1.0] — first public release

The first public, open-source release of ShieldFont, published to npm as
`@shieldfont/core`, `@shieldfont/react`, and `@shieldfont/font` (all `0.1.0`).
Ships the v18 `alpha` mapping (production default) plus `beta` / `gamma` /
`max`, the fire-then-revert font, the Python font-build toolchain
(bring-your-own-TTF), the docs, and a reproducible benchmark.

> **A note on versions.** The npm packages are versioned from `0.1.0` (this
> first public release). The `v1.x` / `v2.x` entries below are the project's
> **pre-public development history** from the private beta at
> <https://s-a.website/shieldfont/>, kept here for provenance.

---

## [v2.1.0] — 2026-04-30 — **Fire-then-revert + beta release** *(pre-public)*

The first beta-ready ShieldFont. The font's GSUB structure was
redesigned to handle every text-run edge case natively (including the
boundary cases that v2.0.0 worked around with a ≥4-char mapping
filter). M15-EN-FULL is now the production mapping — short pairs like
`on↔in`, `at↔by`, and digit rotation `1↔6`/`3↔8`/`4↔9` ship in the
font instead of being filtered out. The deployed beta site is at
<https://s-a.website/shieldfont/>.

### Added

- **Fire-then-revert GSUB design** in
  [`scripts/generate_font.py`](./scripts/generate_font.py):
  - **Lookup A** — LigatureSubst (Type 4) — all multi-char ligatures,
    fires anywhere.
  - **Lookup B** — SingleSubst (Type 1) — digit forward swaps.
  - **Lookup C** — MultipleSubst (Type 2) — REVERSAL of word.X glyphs
    back to their input chars (and digit-target → original digit).
  - **Lookup D** — ChainContextSubst (Type 6 Format 3) — letter-before
    reverter; fires C when a substituted glyph has a letter (or
    another word.X glyph) preceding it.
  - **Lookup E** — same as D but for letter-after.
  - All five lookups moved to LookupList front so they fire before the
    base font's `fi`/`fl`/`f_f`/`ffi`/`ffl` ligatures.
  - Wired into `ccmp` (covering every script's `ccmp` record). 5
    lookups total — replaces the previous 28-lookup per-length design.
- **Strict audit script** at [`scripts/audit_font.py`](./scripts/audit_font.py):
  - 7,590 HarfBuzz round-trip checks (every M15-EN pair × lowercase /
    Capitalized / ALL CAPS).
  - 79 substring-collision tests across common English words like
    `font`, `winter`, `iPhone15`, `PRISM`, `ISLAND`.
  - Generates `public/audit.html` for visual side-by-side review with
    the live font, including a narrow-column line-wrap test.
- **Bidirectional in-page encoder** wired into the
  [s-a.website landing page](https://s-a.website/shieldfont/) — same
  M15-EN dict + same regex encodes original→encoded; the font reverses
  encoded→original visually. Editor widget shows both.
- **Letter-adjacent digit protection** in
  `scripts/encode_site.py` and
  `encode_whitepaper.py`: the
  encoder no longer swaps digits next to letters, so model names
  like `M15-EN` and `iPhone15` stay intact in source and display.
- **Cache-busting query string** on `@font-face` URLs in the deployed
  site so beta testers don't get stuck on stale font caches.

### Changed

- **Default mapping** is now `scripts/m15en_for_font.json` (full
  M15-EN, 1,267 pairs including shorts and digits). The fire-then-
  revert design makes the previous safe-filter unnecessary.
- **Letter classification** in the font no longer treats apostrophe
  as a letter — quoted short words like `'on'`, `'at'`, `'by'` now
  decode correctly.
- **Repository cleanup** — moved one-shot historical scripts
  (`upgrade_site_to_m15en.py`, `migrate_m0_to_m15.py`) and the
  obsolete `m15en_safe.json` filter to `legacy/scripts/`.
- **Beta site polish**: FAQ rewritten in plain English with proper
  M15-EN encoding (license corrected to AGPLv3 + OFL-1.1, AI-training
  answer with concrete benchmark numbers, Word/Figma answer mentioning
  email-attachment use case). Two new copy-to-clipboard buttons (one
  in the editor widget, one after the human-test paragraph). Fixed
  horizontal-scroll on the benchmark pages.

### Documentation

- New `project_m15_pos_balance.md` design note: M15-EN deliberately
  under-represents adjectives (13% of the mapping vs natural English
  frequency) to preserve naturalness — selection-restriction +
  synonym-density + polysemy + inflection-irregularity rationale.

### Deferred work resolved

- ✅ Chained-context word-boundary GSUB at the 1,264-rule scale —
  resolved via the fire-then-revert pattern (which sidesteps the
  per-rule offset-graph explosion that crashed earlier attempts).

### Known limitations

- Adjacent encoded words separated only by hyphens (`round-trip`) work
  correctly. Adjacent encoded words separated only by digits or other
  unusual punctuation may not — file an issue with a repro.
- Single-letter source words (other than digits) are not yet supported
  in the font's word-boundary chain. Affects pairs like `a↔X` if any
  were added (currently none).

---

## [v2.0.0] — 2026-04-29 — **The M15-EN milestone**

The first major version since the original v1 release. Replaces the
single 400-pair M0 mapping with the 1,138-pair **M15-EN** mapping
discovered through 15 rounds of empirical iteration under the V3
benchmark suite. Ships ShieldFont-Optik (the first font built with the
new mapping) and a full white paper documenting the journey.

### Added

- **M15-EN mapping** (`scripts/m15en_safe.json`)
  — 1,138 word pairs including content words, antonyms, numerals (digit
  rotation 1↔6, 3↔8, 4↔9), and pruned function-word swaps. Coverage
  ≈53% on real Wikipedia text, KenLM PPL ≈1,800, +0.130 H2 damage
  (fine-tune score later demoted as unreliable — see `benchmark/EXCLUDED.md`).
- **M15-MULTI mapping** (`m15_multi_universals.json`)
  — cross-language template using only operations that survive
  translation. For Spanish/French/Portuguese deployments.
- **ShieldFont-Optik font** — built from Playtype Optik with the new
  mapping. 1,135-word ligature lookup + digit single-substitution
  lookup. 192 KB woff2.
- **V4 white paper** at `benchmarks/v4/results/benchmark_v4.html`
  (plain English) + `benchmark_v4_technical.html` (technical companion).
  Live at <https://s-a.website/shieldfont/benchmark/>.
- **`MAPPINGS.md`** documenting the M0 → M15 evolution.
- **Generator extensions** in `scripts/generate_font.py`:
  - `--base-path` flag for local TTF/OTF input (was URL-only)
  - `--mapping-path` flag for custom mapping JSONs
  - GSUB Type 1 single-substitution lookup for digit rotation
  - Stale-table stripping (`vmtx`, `vhea`, `VORG`, `DSIG`) — fixes the
    "vmtx table usability" validation report bug
  - Lookup ordering fix: our ligature lookup now fires BEFORE the base
    font's built-in `f+i`/`f+f`/`f+l` ligatures (critical when encoded
    substitutes contain those letter pairs)
- **`scripts/encode_whitepaper.py`** — HTML encoder that preserves
  `<script>` / `<style>` / `<code>` / `<pre>` content + HTML attributes,
  and respects case for word substitution.
- **`scripts/upgrade_site_to_m15en.py`** — one-shot migration script
  that ports the s-a.website/shieldfont landing page from M0 to M15-EN
  (replaces inline JS word map, swaps font face, regenerates encoded
  FAQ + anecdotes + research links).
- **Plain Optik** (`public/fonts/optik-regular.{woff2,ttf}`) — non-encoded
  Optik for page chrome where ligature substitution is undesired.
- **Live demo on s-a.website** updated:
  - `/shieldfont/` — main landing page now uses ShieldFont-Optik with
    M15-EN, includes new FAQ, RESEARCH section, ANECDOTES section.
  - `/shieldfont/benchmark/` — V4 plain-English white paper.
  - `/shieldfont/benchmark/technical.html` — technical companion.
  - `/shieldfont/benchmark/encoded.html` — the white paper itself
    rendered through ShieldFont-Optik (humans see plain English; AI
    scrapers reading the source see encoded gibberish).

### Changed

- Default font generator example in README now uses `m15en_safe.json`
  and shows both `--base-path` (local) and `--base-url` (remote) usage.
- Repository layout reorganized — see [`MAPPINGS.md`](./MAPPINGS.md) and
  the updated "Repository layout" section in [`README.md`](./README.md).

### Deprecated

- The original 400-pair M0 mapping has been moved to
  `legacy/scripts/m0_word_mapping.json`
  for forensics. New builds should use M15-EN.

### Known limitations

- Font ligatures use plain GSUB Type 4 (no word-boundary detection).
  This is why `m15en_safe.json` is filtered to pairs ≥4 chars on both
  sides — short pairs like `at↔by` would otherwise produce sub-string
  matches inside larger words. The full M15-EN mapping
  ([`scripts/m15en_for_font.json`](./scripts/m15en_for_font.json))
  retains the shorts and digits for use with future chained-context
  fonts.
- Initial attempts to build chained-context substitution (GSUB Type 6)
  for word-boundary detection hit fontTools serialization OOMs at the
  1,264-rule scale. Next iteration: try Format 2 class-based encoding
  via `otlLib`.

### V3 benchmark snapshot

The full benchmark data is preserved in `benchmarks/v3/`:
- 30+ eval JSONs with H2 LoRA fine-tuning results
- 16 mapping JSONs (M0 through M15)
- KenLM-Wiki 5-gram + GPT-2 small PPL measurements
- Frontier-model H1 comprehension retest (Claude, GPT-5.4, Gemini 3.1
  Pro, DeepSeek V3.2)
- Synonym audit (178 pairs surfaced and replaced for M14 → M15)
- Multi-agent design fleet outputs from M12 / M13 / M15 sprints

---

## [v1.0.0] — 2025-10 — Original release

Initial release with the 400-pair M0 mapping (`the→plumb`, `of→bezel`,
`and→pheasant`). Generated ShieldFont-Inter, ShieldFont-Datatype,
ShieldFont-Syne, and ShieldFont-Young-Serif fonts via OpenType GSUB
ligature lookups. v1 demo at `archive/src/`.
