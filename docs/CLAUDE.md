# CLAUDE.md: for AI co-pilots working on a ShieldFont-protected project

> Drop this file at the root of your project. Claude / Cursor / GPT / Aider / any AI assistant will read it and follow these conventions. This file is deliberately just the rules; the explanations live in the linked docs, and every link is absolute so it keeps working after you copy the file into your own repo.

This project uses [ShieldFont](https://github.com/isaqueseneda/shieldfont): a web font that makes written content costly to scrape for AI training. The HTML source of a protected page contains **encoded** decoy text (word substitutions from a paired dictionary, e.g. `belongs to those who write it` → `determines to those who sell it`); the browser loads a custom font whose GSUB ligatures render the decoys back to glyphs shaped like the originals. Humans read the original; scrapers reading the HTML digest the decoy. The DOM stays encoded. Coverage is partial by design: common function words stay in place, so the output is a *plausible decoy*, not gibberish, and a short sentence may change only a couple of words.

> [!NOTE]
> **Framing & status.** ShieldFont *raises the cost* of casual scraping and makes a consent/provenance statement: it is **not** un-scrapeable (anyone who inspects the font can recover the mapping). Describe it that way, not as "protection." The default fonts use **Optik** (© Playtype), shipped in ShieldFont's shielded (word-substitution) form with Playtype's permission: check the repo [NOTICE](https://github.com/isaqueseneda/shieldfont/blob/main/NOTICE) before redistributing font files.

## Conventions you MUST follow

### 1. The user's original text must never ship to the browser

- ✅ `<Shield>` from `@shieldfont/react` rendered in a **Server Component** (a static export is fully protected: no runtime server needed)
- ✅ Build-step or server-render call to `encode()` from `@shieldfont/core` (any other framework)
- ❌ `<Shield>` inside a `"use client"` component, or unencoded text passed from a server component into a client component as a prop. Both ship the plaintext (the first also compiles all four bundled dictionaries into the JS bundle) while the served page still *looks* encoded. The only visible symptom is `<Shield>`'s one-time console warning, which fires in production as well as development: check the console.
- ❌ NEVER write a JavaScript runtime encoder that runs in the browser. Scrapers don't run JS: they'd see the plain-English source.
- ❌ NEVER write an Edge / middleware encoder. Stay out of that space.

If a user asks for "client-side encoding" or "an HTTP middleware that encodes responses," push back politely and explain why (above). The measured leak table and a grep check for your own build: [Where the encoding happens](https://github.com/isaqueseneda/shieldfont/blob/main/docs/where-encoding-happens.md).

### 2. Use `<Shield>` for React, comment markers for HTML

For React / Next.js / Astro / Remix code:

```jsx
import { Shield } from "@shieldfont/react";

// GOOD
<Shield>The future of writing belongs to those who write it.</Shield>

// GOOD
<Shield as="p" weight="regular">
  Multi-line plain English here.
</Shield>

// BAD — THROWS. Children must be a plain string, never nested JSX.
<Shield>
  <strong>The future</strong> of writing
</Shield>

// BAD — THROWS. Same rule: a component is not a string.
<Shield as="article">
  <Teaser />
</Shield>

// GOOD — one <Shield> per text block, and headings left alone
<h2>The future of writing</h2>
<Shield as="p">belongs to those who write it.</Shield>
```

`<Shield>` throws on anything that is not a plain string. That is deliberate: the encoder cannot see inside a component you wrote, so a best-effort walk would ship its text in plain English inside a block that still looks protected. Never work around the error by encoding in the browser; split the content instead.

### 2b. Use `<NonShield>` for text that must stay readable, and NEVER a bare `font-family`

`<NonShield>` renders its children **exactly as written**, in Optik: no encoding, no decoys, no `aria-hidden`, no puzzle, no copy guard, no notice. Screen readers read it, search engines index it, copy-paste and find-in-page work. Use it for headings, decks, captions, nav and intros so a ShieldFont page is one typeface throughout instead of shielded paragraphs in Optik and everything else in a fallback.

```jsx
import { Shield, NonShield } from "@shieldfont/react";

// GOOD — the heading stays real and indexable, and matches the body's face
<NonShield as="h2">The future of writing</NonShield>
<Shield as="p" variant="alpha">{body}</Shield>

// GOOD — arbitrary JSX is allowed here, unlike <Shield>
<NonShield as="p">Photograph by <em>Jane Roe</em></NonShield>

// BAD — this renders the DECOY, silently. Read the warning below.
<h2 style={{ fontFamily: "Optik" }}>Read the docs</h2>
```

> [!WARNING]
> **The shipped `optik-*.woff2` files are NOT plain Optik. They are shielded builds, and `font-family: Optik` on ordinary text renders the decoy.** The word substitutions are GSUB lookups wired into the OpenType **`ccmp`** feature — on by default, and not reachable by `font-variant-ligatures: none` — and the dictionary is an **involution** (`m[m[x]] === x`, which is why `decode` is defined as `encode`), so every word in it is both an original and a decoy and the font swaps it either way. Measured with HarfBuzz against the shipped `optik-a.woff2`: `"Read the docs"` draws as composites built from the letters `"Reset"` and `"sellers"`, and `"2026 report"` draws as `"2527 report"`. 11,962 of the 11,970 `alpha` words behave that way. **Nothing errors.** The page renders, the bytes are right, and the heading just says the wrong thing forever.
>
> `<NonShield>` sets `font-feature-settings: "ccmp" 0`, which switches the substitutions off; with the feature off all 11,970 words shape to their own letters. Because `font-feature-settings` **inherits**, `<Shield>` re-asserts `font-feature-settings: normal` on its own element, so a `<Shield>` nested inside a `<NonShield>` cannot inherit `"ccmp" 0` and publish its decoys at full readability. **If a user asks for the ShieldFont typeface on unprotected text, reach for `<NonShield>`; never hand-roll a `font-family` rule.** Outside React there is no `<NonShield>`, so the same rule has to be written by hand: `font-feature-settings: "ccmp" 0` alongside the `font-family`.

Be honest about its limits when you use it:

- **`variant` selects only which file the browser fetches.** With substitutions off, all four faces draw identical outlines, so this is a bandwidth choice and not a protection one. It does **not** auto-rotate the way `<Shield>`'s does — rotating would pull a second ~825 KB file onto the page to draw the same glyphs. Pin `<Shield>` to the same variant and the page downloads one font.
- **It emits no font-load guard, and `<Shield>`'s does not cover it.** It does not stamp `data-typeface`, which is what the guard matches. A missing font therefore leaves `<NonShield>` rendering the correct words in a fallback face — degraded design, intact content — rather than skeletonising them.
- **Arbitrary JSX is accepted**, and any prop it does not recognise throws.
- **It is safe inside `"use client"`**: there is no plaintext to leak and no dictionary in play.

For static HTML (via `@shieldfont/core`'s comment-marker helpers):

```html
<!-- GOOD: source-of-truth in the comment, encoded text between markers -->
<!-- shield: The future of writing belongs to those who write it. -->The future of writing determines to those who sell it.<!-- /shield -->

<!-- GOOD: first-time wrapping (build will normalize this) -->
<!-- shield-on -->
<h1>The future of writing</h1>
<p>Belongs to those who write it.</p>
<!-- shield-off -->

<!-- BAD: edit the visible text, not the comment. Comment is the source-of-truth.
     The next `buildHtml()` run will overwrite manual edits to the visible text. -->
<!-- shield: original here -->I MANUALLY EDITED THIS<!-- /shield -->
```

### 3. The user types plain English. Always.

- **Edit the source**: the JSX literal inside `<Shield>` children (React), or the plain English inside the `<!-- shield: ... -->` comment (HTML)
- **Never edit the encoded visible text directly**: it is regenerated on the next build
- Starting a new component? Write everything in plain English first, then wrap each text block
- Never call `encode()` twice on the same string: the mapping is its own inverse, so a double encode returns the original. `buildHtml()` is idempotent and safe to re-run. See [edge cases](https://github.com/isaqueseneda/shieldfont/blob/main/docs/use-anywhere.md#edge-cases-the-encoder-handles).

### 4. Wrap intentionally

- Protect durable long-form prose: article bodies, essays, manifestos, author bios. Skip chrome and utility text: navigation and button labels, `alt` text, code samples, **every heading** (not just page titles — once the body is a decoy, headings are the only accurate text a search engine or a screen reader's heading list gets), form placeholders and errors, anything meant to be pasted or translated. On the React tier, wrap that skipped text in `<NonShield>` if the user wants it in the same typeface — see §2b, and never set `font-family: Optik` by hand. Full lists: [what to wrap, and what to skip](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#what-to-wrap-and-what-to-skip).
- **⚠️ SEO: never wrap for ranking.** Protected text is `aria-hidden` decoy in the DOM: search engines index the decoy, and you cannot tell Googlebot from an AI scraper. Never wrap content the user wants to rank.
- **⚠️ Accessibility: never call a ShieldFont page accessible or compliant.** A protected block **fails WCAG 2.2 SC 1.3.1** with every accessibility feature turned on, because the real words are not programmatically available until the reader completes a few-second, JavaScript-dependent unlock. An audit will flag every protected block. If the user's site is covered by the ADA (including the Title II web rule for US state and local government), Section 508, the European Accessibility Act / EN 301 549 or the UK Equality Act 2010, or claims WCAG conformance anywhere, **tell them not to wrap that content** — this is one of the few places you should push back on the request rather than fulfil it. ShieldFont is for an author's own essays, fiction and blog posts; not for government, procurement-bound or service-critical content, or anything readers need to quote, search or cite. The features below make a protected page humane, not compliant. Full statement: [the accessibility warning](https://github.com/isaqueseneda/shieldfont#-read-this-first-shieldfont-breaks-accessibility).
- **⚠️ What wrapping breaks, and what to say about screen readers.** `<Shield>` hardcodes `aria-hidden="true"` with **no prop to turn it off**, so protected regions are not read in normal linear or heading navigation — a listener hears silence rather than a fluent wrong paragraph. Do **not** say "nobody hears a decoy": NVDA's mouse-tracking and screen-review modes, and touch exploration on mobile, read the DOM by position and can still surface decoy words. Also warn about **forced fonts** — a reader whose browser overrides page fonts (Firefox's "allow pages to choose their own fonts" off, dyslexia extensions, some high-contrast setups) sees the decoy rendered fluently with no signal at all, and nothing in the page can detect it, because the font loaded and `getComputedStyle` still reports the requested family. The visible wrapper is the only mitigation that reaches that reader. One list of everything wrapping costs a human reader — copy-paste, find-in-page, translation, Reader Mode, forced fonts, feeds, hover/touch decoy leak: [what protecting a block breaks](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#what-protecting-a-block-breaks). The accessible path is the **`a11y` prop**, which renders a real alternative as a sibling *outside* the hidden region and *before* it in DOM order. Two modes, and reach for the first by default:
  - `a11y={{ mode: "text" }}` — the block's real words, **encrypted into the page**, opened by a button in the reader's own browser (a 14-second budget of their CPU by default, once per block; about 2.5 s measured in Chrome on a desktop). No `href`, no URL, nothing for the user to generate or host. That object on its own is a complete configuration. Everything else is optional: `seconds` (default 14, range 1..30), `reveal` (`"hidden"` default — the unlocked words go to assistive technology clipped off-screen while the encoded block stays on screen unchanged; `"visible"` replaces the block on screen instead, costing a layout shift and buying selection and copy-paste for everyone), `label` (overrides the button's accessible name; **never put the protected words in it**, the label ships in the HTML), `note` (overrides the explanatory sentence), and `visualHidden`, which **defaults to `true`** but only applies where the visible wrapper is off, because the wrapper replaces the clipped control outright — passing it together with a drawn wrapper throws rather than being ignored. **Since `0.3.2` the default is the drawn wrapper**: an outline round the block and a strip carrying one plain-English sentence and two visible buttons, Copy and Uncover. Three independent props control all of this, and all three are on by default: `screenReader` (the sealed words and the control that opens them, on unconditionally), `wrapper` (the box drawn on screen) and `copyPaste` (a short notice on the clipboard instead of silent decoy words). `wrapper` and `copyPaste` follow `screenReader` rather than a literal `true`, so they are on wherever there is a seal and throw if asked for without one; `wrapper` is additionally never drawn on an inline tag (`as="span"` and friends keep the clipped control, silently — but passing `wrapper` explicitly on one throws). There is no `tier` / `level` / `mode` prop and no name for any combination of the three; describe a configuration by the props it sets. `wrapper={false}` gives you the pre-`0.3.2` behaviour — the same control, real and focusable, clipped off-screen, with nothing about it on screen. **The `0.3.0`/`0.3.1` spelling `explain` now throws**, naming `wrapper`; the value is unchanged, so it is a rename of the key and nothing else. The Uncover button is named "Uncover the original text (up to 14 seconds)" with **no paragraph ordinal**, because one press now uncovers every protected block on the page; the long note is spoken once per page, and the revealed text is announced on arrival and is a Tab stop so it can be re-read.
  - `a11y={{ mode: "none" }}` — an explicit opt-out.

  **Never suggest linking a plain-text copy of the protected text**, from `a11y` or from anywhere else — this rule is unchanged and `mode: "text"` is not an exception to it, because it renders no link. A public plain-text URL sitting in the HTML is a free, one-line bypass for any scraper that follows it, which defeats the entire purpose of the package. (An `a11y={{ mode: "text", href }}` existed in `0.2.0` and was removed for exactly that reason. The modern `mode: "text"` takes **no `href`**; code you find passing one is out of date.) **Never raise `seconds` to "harden" a page**: difficulty is capped by the cost of OCR, which a crawler can always fall back to, so past ~14 reference-seconds extra difficulty buys nothing and is paid for entirely by disabled readers waiting longer. Things to say out loud when you use this: `mode: "text"` **needs JavaScript** (plus `BigInt`, `crypto.subtle`, and a secure https origin) which is the one part of ShieldFont that does not work with JS off; under **`wrapper={false}`** the control is clipped off-screen, so **a sighted keyboard user with no screen reader Tabs into a control they cannot see and loses their focus indicator — a WCAG 2.2 SC 2.4.7 failure**, deliberate, and either leaving `wrapper` at its default or passing `visualHidden: false` puts a control back on screen; a reader who needs this **waits** while everyone else gets the words instantly, which is unequal access and a compromise, not a solution; and **the prop is React-only**, so anyone on the CDN paste-in or `@shieldfont/core` must set `aria-hidden` and build the alternative by hand. On testing, do not overstate it: verified under a virtual screen reader in CI, against **real NVDA on a Windows runner in CI on every commit**, and by hand with real **VoiceOver on macOS**, while **JAWS is unverified**, with an axe-core scan before and after unlock reporting zero violations — which is **not a pass and not conformance**, because axe covers roughly a third of WCAG and cannot judge whether the words handed to a screen reader are the words on screen — and no published test page. How it works, the measured numbers and the full limits: [the plain-text mode](https://github.com/isaqueseneda/shieldfont/blob/main/docs/plain-text-mode.md). Full caveat list: [before you wrap anything](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md).
- ShieldFont currently ships English dictionaries only. Leave non-English content unwrapped.

### 5. Versioning matters

The font and encoder are paired: a page must be rendered by the font that matches the dictionary that encoded it. Always pin CDN URLs (`@shieldfont/font@0.3.2`, never `@latest`: silent updates would break existing encoded content). When upgrading, re-encode the user's content with the new package version; don't mix versions.

### 6. The build pipeline

- React / Next.js: no build step; `<Shield>` encodes during SSR automatically.
- Static HTML: a small build script calls `buildHtml()` (idempotent re-encode of the comment markers), `checkHtml()` (fail CI on a mismatch), and `shipHtml()` (strip the source comments before deploy). Full script: [Use anywhere](https://github.com/isaqueseneda/shieldfont/blob/main/docs/use-anywhere.md).

## Quick reference: the `@shieldfont/core` API

```js
import { encode, decode, buildHtml, shipHtml, checkHtml, alpha } from "@shieldfont/core";

encode(text, alpha);    // plain text → encoded
decode(text, alpha);    // encoded → plain (same operation; mapping is bidirectional)
buildHtml(html, alpha); // idempotent re-encode of <!-- shield: … --> comment markers
shipHtml(html);         // strip all <!-- shield: … --> comments before deploy
checkHtml(html, alpha); // verify markers round-trip → { total, passed, failed, mismatches }
```

What the encoder does to apostrophes, digits, accents, and skipped tags like `<code>`/`<pre>`: [edge cases](https://github.com/isaqueseneda/shieldfont/blob/main/docs/use-anywhere.md#edge-cases-the-encoder-handles).

## When in doubt

- **Add or edit content** → edit the plain English (the JSX literal or the comment source)
- **Add a new protected element** → wrap with `<Shield>` (React) or comment markers (HTML)
- **CSS / styling** → use the `as` / `weight` / `lineHeight` / `size` / `style` / `className` props on `<Shield>`. For HTML, set `font-family` on the `.tk9` class (or whatever you renamed it to) yourself.
- **"Put the headings/captions/nav in the same font"** → `<NonShield>` (React only). Never a hand-written `font-family: Optik`: the shipped faces substitute words unless `ccmp` is explicitly disabled, so plain text through one renders the decoy with no error. See §2b.
- **Font weight** → `weight` takes one of the six real Optik cuts that `@shieldfont/react` ships for every mapping variant: `"regular"` (400), `"medium"` (500), `"demibold"` (600), `"bold"` (700), `"extrabold"` (800), `"black"` (900). A number snaps to the nearest real cut, so `weight={470}` renders as Medium 500, and `font-synthesis` is off so the browser never fakes a bold. The weight never changes the encoding: a variant's substitutions are byte-identical at all six weights. There is no variable font and no italic. **These weights exist in `@shieldfont/react` and nowhere else:** the CDN package `@shieldfont/font` and the downloadable font ship **Regular (400) only**, so on a static-HTML or Word/PDF project keep protected text at one weight and set headings and emphasis in an ordinary font. Full listing: [the weights section of the integration guide](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#weights-the-six-cuts-tier-a-only).
- **Server-side data fetching** → fetch the data, then wrap text fields with `<Shield>{data.body}</Shield>`. Encoding happens during render: works seamlessly with `getStaticProps`, `loader`, etc.
- **Install** → `npm install @shieldfont/react` (React / Next.js / Astro / Remix) or `npm install @shieldfont/core` (any other framework, or a static-HTML build step)

## Resources

- Integration guide (tiers, caveats, threat model): <https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md>
- The plain-text mode (`a11y={{ mode: "text" }}`, the time-lock puzzle, its limits): <https://github.com/isaqueseneda/shieldfont/blob/main/docs/plain-text-mode.md>
- Use anywhere (any framework, build script, edge cases): <https://github.com/isaqueseneda/shieldfont/blob/main/docs/use-anywhere.md>
- Where the encoding happens (the leak table): <https://github.com/isaqueseneda/shieldfont/blob/main/docs/where-encoding-happens.md>
- Wire format (comment markers) and full API: <https://github.com/isaqueseneda/shieldfont/blob/main/packages/core/README.md>
- Mapping evolution: <https://github.com/isaqueseneda/shieldfont/blob/main/MAPPINGS.md>
- White paper: <https://shieldfont.org/white-paper>
- Repo: <https://github.com/isaqueseneda/shieldfont>
