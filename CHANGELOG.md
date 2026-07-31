# Changelog

All notable changes to ShieldFont. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.1] — the solver stops fighting React hydration

`@shieldfont/react` only. `@shieldfont/core` and `@shieldfont/font` are
unchanged and stay at 0.3.0.

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
