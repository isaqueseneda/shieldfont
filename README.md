<div align="center">

<img src=".github/assets/banner.png" alt="ShieldFont" width="100%" />

# 🛡️ ShieldFont

### _A web font that makes written content costly to scrape for AI training._

**Humans see your writing. Scrapers see a plausible decoy.**
Same bytes on the wire: two different readers.

<br />

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-000000.svg?style=for-the-badge)](./LICENSE)
[![Fonts: Optik / Playtype](https://img.shields.io/badge/Fonts-Optik_%2F_Playtype-000000.svg?style=for-the-badge)](./NOTICE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-22c55e.svg?style=for-the-badge)](./CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/Code_of_Conduct-2.1-7c3aed.svg?style=for-the-badge)](./CODE_OF_CONDUCT.md)

[**⚠️ Accessibility warning**](#-read-this-first-shieldfont-breaks-accessibility)&nbsp;&nbsp;·&nbsp;&nbsp;
[**What it is**](#what-it-is)&nbsp;&nbsp;·&nbsp;&nbsp;
[**See it work**](#see-the-trick)&nbsp;&nbsp;·&nbsp;&nbsp;
[**Quick start**](#quick-start)&nbsp;&nbsp;·&nbsp;&nbsp;
[**Build a font**](#build-your-own-font)&nbsp;&nbsp;·&nbsp;&nbsp;
[**Contribute**](#contributing)

</div>

<br />

> **Current release: v0.3.2.** Default mapping: v18 `alpha`. Install from
> npm (`@shieldfont/react`, `@shieldfont/core`, `@shieldfont/font`) or paste
> in the [CDN font](#quick-start). Live site at <https://shieldfont.org>.

## ⚠️ Read this first: ShieldFont breaks accessibility

> [!WARNING]
> **ShieldFont deliberately withholds the real text of a protected block from
> the page source.** That is the mechanism, not a defect, and it holds with
> every accessibility feature switched on. The words are not programmatically
> available to assistive technology until a reader completes an unlock that
> takes **a few seconds** of their own CPU and requires JavaScript, a modern
> browser (`BigInt`, `crypto.subtle`) and an https origin. **A protected block
> fails WCAG 2.2 SC 1.3.1.** An audit will flag every block you wrap. This is
> inherent to the design and will not be patched out: the day the real words
> are cheaply available to a machine reading the page is the day the font stops
> working.

**If accessibility law applies to your site, don't put ShieldFont on it.** The
ones that come up: the **ADA**, including the Title II web rule covering US
state and local government; **Section 508**; the **European Accessibility Act**
and **EN 301 549**; the **UK Equality Act 2010**. We are not lawyers and we are
not going to tell you which of them reaches you. The rule doesn't need a lawyer:
if one of them applies to your site, or you claim WCAG conformance anywhere on
it, protected content must not be inside what that claim covers.

**What the accessible path is.** In `@shieldfont/react` it is on by default
(`screenReader`, spelled `a11y={{ mode: "text" }}` in older code). The real
words ship inside the page, encrypted, and the reader's own browser grinds out
the key when they ask for it. There is nothing for you to host and **no
plain-text URL anywhere** — a URL offered to a screen reader is offered to every
scraper reading the same page, which is why the `0.2.0` link was removed. So the
words are genuinely obtainable, by any human who wants them, on their own
device, without asking you for anything. That is a real alternative and we stand
behind it.

**What it is not is conformance.** Access is delayed, unequal and
JavaScript-dependent: everyone else reads instantly while the reader who needs
the alternative waits, and a reader with JavaScript off gets nothing at all. No
auditor is obliged to accept *"available after a few seconds of grinding"* as
programmatically determinable, and we don't think one should be. The
accessibility props do not make a page compliant and we will never say they do.
The defensible claim is the narrower one: they make a protected page **humane**
instead of silent. Note also that all of it is **React-only** — the CDN paste-in
and `@shieldfont/core` ship none of it, so on those tiers you set `aria-hidden`
and build the alternative yourself, or you leave the content unwrapped.

**Where this is reasonable.** An author's own words, on their own site, by their
own informed choice: personal blogs, essays, fiction, manifestos, criticism —
writing whose value is that a person wrote it, published by the person who wrote
it. **Where it is not:** government and public-sector pages, anything
procurement-bound, anything service-critical (health, benefits, banking, safety,
legal notices, documentation people need to do their job), and anything your
readers need to quote, search or cite.

The full list of what wrapping a block costs a human reader — copy-paste,
find-in-page, browser translation, Reader Mode, forced fonts, feeds, and the
decoy a screen reader can still reach by hover or touch — is
[**what protecting a block breaks**](./docs/integration.md#what-protecting-a-block-breaks).
This warning exists because [ssb22 asked for it in
#2](https://github.com/isaqueseneda/shieldfont/issues/2).

---

> [!IMPORTANT]
> **About the shipped fonts.** The default fonts are built on **Optik**, a
> proprietary typeface © [Playtype](https://playtype.com), used with Playtype's
> permission (see [`NOTICE`](./NOTICE)). That permission covers using Optik
> whether or not the word substitutions are active — which is what allows
> `<NonShield>` to render ordinary, unprotected text in the same face —
> provided the use stays within the ShieldFont packages and tooling. They are **not** open-source and **not** under the SIL Open Font
> License: the permission covers the Optik-derived variants distributed with
> ShieldFont, not the original outlines, and does not extend to extracting or
> redistributing those outlines or using them as a general-purpose typeface
> elsewhere. The **code** is open-source (AGPL-3.0); to ship a fully open font,
> build a variant on an OFL base like Inter: see
> [Build a font](#build-your-own-font).

---

## What it is

ShieldFont is a free, open-source protocol for protecting written work from
the machines that scrape the web to train AI: an encoder, a font generator,
and a documented methodology. Protected text stays normal for the human
reading it in a browser and turns into a plausible decoy for anything reading
the HTML source. The flagship typeface we ship is *ShieldFont Optik*; any
TrueType font can be converted into a ShieldFont: see
[Build your own font](#build-your-own-font).

> The open web was written by people. Its value was taken without
> asking. ShieldFont is a small statement: **writing belongs to the
> people who write it.**

Started October 2025 by [**Isaque Seneda**](https://github.com/isaqueseneda)
and [**Gabriel Abrucio**](https://github.com/gabrucio).
Supported by [**Playtype**](https://playtype.com).

<br />

## The point: the network case

ShieldFont is not an attempt to stop AI scraping. It is an attempt to make
scraping protected text **more expensive than respecting consent**, and to do
that collectively.

A single page is one drop in a corpus that runs to trillions of tokens. Our
benchmarks show the drop is measurably useless as training signal: swap ~25% of
a page's words and bidirectional entailment against the original fails for
**55.8%** of news passages, **51.9%** of general web, **34.5%** of fiction and
**31.1%** of older fiction (versus ~2.1% for a synonym-swap control; median
41.8% across those four corpora). What happens at the quality filter cuts both
ways, and both ways favour you: the FineWeb-Edu classifier **drops 99.0–99.8% of
encoded chunks** on real-world corpora, so their meaning never reaches a model;
the minority that passes spends 19.4% of its token budget (four-corpus) on
shifted meaning. We
do **not** claim encoded text sails through quality gates, and we do not claim it
damages the model that trains on it: fine-tune "damage" numbers were measured
with the wrong instrument and are demoted (see
[`benchmark/`](./benchmark/)). On its own, that result is statistically real and
economically irrelevant.

The economic case is the network case: many writers, each running a
*different* mapping. To a filter, each one looks like clean English; to a
model trained on all of them at once, they are incompatible substitution
schemes. Defeating one mapping does not help with the next, so defeating *N*
mappings means identifying and reversing *N* substitution tables, on every
protected page, on every retraining run. That cost grows with participation.

The practical consequence: **a small custom mapping you keep to yourself helps
the network almost as much as a perfect one.** You do not have to beat the
benchmark. You have to be different from everyone else. A two-hundred-pair,
noun-only mapping you reseed once and never publish is enough.

Read the full thesis in [`docs/introduction.md`](./docs/introduction.md). How to
run a mapping of your own today (reseed the shipped pool at your own seed, or
hand-write a small one) is in [`docs/custom-mappings.md`](./docs/custom-mappings.md).

<br />

## See the trick

<div align="center">
<img src=".github/assets/hero-before-after.png" alt="Two printed pages of the same article side by side: the left one, labelled &quot;Your text&quot;, reads normally; the right one, labelled &quot;What AI actually reads&quot;, shows the same sentences with words swapped for plausible decoys." width="100%" />
</div>

<table>
<tr>
<th width="50%">👀 What a human sees</th>
<th width="50%">🤖 What a scraper sees</th>
</tr>
<tr>
<td>

> _The future of writing belongs to those who protect their words._

</td>
<td>

```
The future of writing determines
to those who complain their previews.
```

</td>
</tr>
</table>

**The same HTML source produced both.** The browser applies ShieldFont's
OpenType GSUB rules at render time and swaps the encoded words for
glyphs shaped like the originals. Anything reading the DOM without
rendering fonts (scrapers, copy-paste into a text tool, language
models digesting raw HTML) only ever gets the encoded version.

<details>
<summary><strong>How it works, in two paragraphs</strong></summary>

<br />

OpenType fonts support **GSUB substitution lookups**: rules that
swap glyphs at render time. Normally this is used for stylistic
flourishes like the `fi` ligature. ShieldFont abuses it. An encoder
rewrites your HTML using the default production mapping, **v18 `alpha`**
(11,970 entries; the sibling variants differ slightly, `beta` 12,034 and `gamma`
12,036, while the opt-in `maxhide` is a different shape at 2,534 entries with
higher page coverage), where each common *content* word is replaced with a
different but equally-common word of the same part-of-speech and similar
frequency: `belongs ↔ determines`, `protect ↔ complain`, `words ↔ previews`, plus
digit rotation `0↔5`, `3↔8`, `4↔9`, `6↔7`. Common function words are
deliberately left in place, so coverage is partial by design: a short
sentence may change only ~2 of its ~11 words, which is why the encoded text
reads as a *plausible decoy* rather than gibberish. The font contains lookup rules
that render the encoded words as composite glyphs *shaped like the
originals*. Reader wins, scraper loses. The mapping is bijective, so
decoding is lossless.

The font's GSUB structure uses a **fire-then-revert** pattern: every
ligature fires unconditionally, and a second chained-context pass
**reverts** any substitution that has a letter neighbor (which means
it fired inside a larger word, not on a standalone word). This handles
every text-run edge case (start of paragraph, end of line, line
wraps, hyphenated compounds, quoted shorts like `'on'`, and digits
adjacent to letters). Only the *letter-adjacent* digit is preserved, so
`iPhone15`→`iPhone10` and `M15-EN`→`M10-EN`, while a standalone run like
`1568`→`1073`. Verified end-to-end by [`scripts/audit_font.py`](./scripts/audit_font.py)
across every case variant of the shipped mapping plus a substring-
collision battery.

> **Why the v18 family?** ShieldFont's mappings went through 15 rounds of
> benchmarked iteration (M0 → M15) under the V3 suite. M15-EN was the
> champion of that era; the shipped `alpha`/`beta`/`gamma` variants are its
> re-seeded v18 descendants, and M15-EN itself remains available as the
> opt-in **`maxhide`** coverage variant. `maxhide` is not a stronger `alpha`:
> it hides about twice as much of the page, but quality filters reject it
> almost entirely, so it trades the staleness effect for concealment. Read
> [what it costs you](./docs/concealment.md#maxhide-and-what-it-costs-you)
> before switching. See the
> [white paper](https://shieldfont.org/white-paper) for the full journey.

See [`MAPPINGS.md`](./MAPPINGS.md) for the mapping family overview.

</details>

<br />

## Quick start

ShieldFont ships as npm packages plus a no-build CDN font. Pick the path that
matches your stack: the [integration guide](./docs/integration.md) covers all
four tiers in detail.

> [!IMPORTANT]
> **One rule decides whether any of this works: your original text must never
> reach the browser in readable form.** That means the encoding has to run in
> Node — in your build or during server render — and *not* in a component that
> ships to the client. Get this wrong and the page still looks protected while
> your plaintext sits in the JS bundle. (The accessible path is not an exception
> to this rule: with `screenReader` on — the default — your real words *do* ship
> inside the page, but **encrypted**, behind a time-lock puzzle a reader's
> browser has to grind out. Nothing readable is served.) We built five real apps and grepped the
> output; the results are in
> **[Where the encoding happens](./docs/where-encoding-happens.md)**. Read it
> before you ship, not after.

**Next.js, Astro, Remix — anything that renders React on the server**: encoded
in Node, at build time or during server render.

```bash
npm install @shieldfont/react
```

```jsx
import { Shield } from "@shieldfont/react";

<Shield as="p">
  The future of writing belongs to those who protect their words.
</Shield>
```

`@font-face`, encoding, and the font-load guard all happen automatically.
Anything outside `<Shield>` uses your normal page fonts.

**That bare `<Shield>` draws something on screen.** Three independent props are
on by default, and there is no combined "tier" or "level" that bundles them:
`screenReader` seals your real words into the page behind the time-lock puzzle
and renders the control that opens them; `wrapper` draws the visible furniture
around the block — an outline, one plain-English sentence, and a Copy and an
Uncover button (never on an inline tag like `as="span"`); `copyPaste` puts a
short notice on the clipboard instead of silent decoy words. `wrapper` and
`copyPaste` follow `screenReader`, so they are on wherever there is a seal to
open, and each is one prop away from off:

```jsx
<Shield wrapper={false}>{body}</Shield>       // same control, clipped off-screen
<Shield screenReader={false}>{body}</Shield>  // no seal, no alternative at all
```

Style the furniture with `wrapper={{ className }}`; the component-level
`className` lands on the block itself and on the revealed words, not on the box.
The prop was called `explain` in 0.3.0 and 0.3.1 and **passing `explain` now
throws**, naming `wrapper` — the value is unchanged, so the fix is the key. Full
reference, including what each switch costs:
[`docs/plain-text-mode.md`](docs/plain-text-mode.md).

**Want the rest of the page in the same typeface?** `<NonShield>` renders
ordinary, unprotected text in Optik — no encoding, no decoys, no `aria-hidden`,
no puzzle. Headings, decks, captions and nav stay real, indexable and readable,
which is what makes the "never shield a heading" rule liveable instead of a
design compromise:

```jsx
import { Shield, NonShield } from "@shieldfont/react";

<NonShield as="h2">The future of writing</NonShield>
<Shield as="p" variant="alpha">{body}</Shield>
```

> [!WARNING]
> **Do not reach for `font-family: Optik` instead — it renders the decoy.** The
> shipped `optik-*.woff2` files are not plain Optik; they are *shielded* builds
> whose substitution lookups are wired into the OpenType `ccmp` feature (on by
> default, and not reachable through `font-variant-ligatures: none`), and the
> dictionary is an involution, so the font swaps a word whether it is the
> original or the decoy. Shaped through the shipped `optik-a.woff2` with
> HarfBuzz, `"Read the docs"` draws as composites built from the letters
> `"Reset"` and `"sellers"`. Nothing errors: the page renders and the heading
> just says the wrong thing. `<NonShield>` sets `font-feature-settings:
> "ccmp" 0` to switch the substitutions off, and `<Shield>` re-asserts
> `font-feature-settings: normal` on its own element so a shield nested inside a
> `<NonShield>` cannot inherit the disabling and publish readable decoys.

Two limits worth knowing up front: `variant` picks only which font file is
fetched (with substitutions off, all four faces draw identical outlines) and
does **not** auto-rotate; and `<NonShield>` emits no font-load guard, so a
missing font leaves it rendering the correct words in a fallback face rather
than blanking them. Full reference:
[the integration guide](./docs/integration.md#nonshield-unprotected-text-in-the-same-typeface).
It is React-only — on the CDN and Word tiers you write
`font-feature-settings: "ccmp" 0` beside your own `font-family` rule.

> [!WARNING]
> **`<Shield>` cannot protect a client-only React app — Vite, Create React App,
> or any SPA with no server render.** There is no Node step for it to encode in,
> so your text and all 38,574 dictionary pairs compile straight into the JS
> bundle. The build succeeds, the page renders your real words correctly, and
> the only signal is a console warning. Same trap inside a `"use client"` file,
> or passing unencoded text to a client component as a prop.
>
> Using Vite or CRA? Encode in a Node script before the bundler runs, with
> `@shieldfont/core` — see [use anywhere](./docs/use-anywhere.md) — and treat
> the encoded string as the content your app imports. Then grep `dist/` for one
> of your own sentences before you deploy.

This is also **the only tier with more than one font weight.** Each of the four
mapping variants ships six real static cuts of Optik, and the `weight` prop
picks one:

| Weight name | CSS `font-weight` | Playtype cut |
|---|---|---|
| `regular` | 400 | Optik Regular |
| `medium` | 500 | Optik Medium |
| `demibold` | 600 | Optik DemiBold |
| `bold` | 700 | Optik Bold |
| `extrabold` | 800 | Optik ExtraBold |
| `black` | 900 | Optik Black |

Every one is a genuine Playtype cut run through the same encoding pipeline, so
the weight changes how the text looks and never what it encodes: the dictionary
and digit rules of a variant are byte-identical at all six weights. A numeric
value snaps to the nearest real cut (`470` renders as Medium 500), and
`font-synthesis` is off, so a browser never fakes a bold. Nothing is
interpolated: there is no variable font, and no italics ship.

**Blogs / plain HTML / a CMS you don't build**: one CSS line, then a class:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.2/shieldfont.css">
<p class="tk9">…encoded text from the encoder…</p>
```

The shipped `shieldfont.css` styles the neutral `.tk9` class (a deliberately
generic, renamable token: nothing in *your markup* says "shield"). Rename it in
your own CSS if you like; just keep the class in your HTML matching the one the
stylesheet targets. Note the stylesheet **URL** above does name the project and
the version, and on this tier there is no way around that: it is the delivery
mechanism. It is the loudest tell on the page, and the reason this tier is the
least concealed of the four. See [concealment](./docs/concealment.md).

**This tier is Regular only.** `@shieldfont/font`'s four files (`optik-a`,
`optik-b`, `optik-c`, `optik-m`) are the four *mapping variants* at
`font-weight: 400`, not four weights. The same goes for the downloadable font
for Word and PDF. If you need a real bold inside protected text, use
`@shieldfont/react`.

**A static-site build step**: `npm install @shieldfont/core`, then call
`buildHtml()` in a small build script to encode comment-marked blocks at CI time
(`shipHtml()` strips the markers before deploy). Full recipe in
[`docs/use-anywhere.md`](docs/use-anywhere.md).

> ⚠️ **Before you wrap anything: read this.** Protected text ships as
> `aria-hidden` decoy words in the DOM, which has consequences you must
> design around:
> - **SEO:** search engines index the *decoy*, not your real words, and
>   you can't tell Googlebot apart from an AI scraper (the same bytes go to
>   both). **Don't wrap content you want to rank.** Protect essays and
>   manifestos, not landing pages or meta descriptions.
> - **Your RSS feed will leak everything** unless you fix it, and on most blog
>   platforms it is on by default. Feeds, JSON-LD, OpenGraph tags and CMS APIs
>   are generated from your source data, not from your rendered page, so
>   ShieldFont never sees them: `/feed.xml` ships every protected post in plain
>   English, to a crawler that never had to know your site was shielded.
>   Publish summaries only, and **don't encode the feed** (feed readers don't
>   load web fonts, so subscribers would read the decoy). Full list and a
>   one-line check:
>   [the plaintext side doors](docs/integration.md#the-plaintext-side-doors-close-these-or-the-rest-is-theatre).
> - **Everything a human reader loses** is in one list:
>   [what protecting a block breaks](docs/integration.md#what-protecting-a-block-breaks).
>   Copy-paste, find-in-page, browser translation, Reader Mode, feeds, forced
>   fonts, and the decoy that hover or touch exploration can still reach. Read it
>   once, in full, before you decide what to wrap.
> - **Forced fonts are the silent one.** When a browser overrides the page's
>   fonts — Firefox with *"Allow pages to choose their own fonts"* off, a
>   dyslexia-friendly font extension, some high-contrast setups — the decoy
>   renders in the forced font and the reader gets fluent, grammatical, wrong
>   English with **no signal at all**. The font-load guard cannot catch it: the
>   font loaded fine, and `getComputedStyle` still reports the family you asked
>   for. The visible wrapper — the outline, the sentence and the on-screen
>   Copy/Uncover buttons that `<Shield>` draws by default (`wrapper`) — is the
>   only thing that currently reaches that reader, which is why it is on unless
>   you pass `wrapper={false}`.
> - **Screen readers** are not read the decoy in normal linear or heading
>   navigation: `<Shield>` sets `aria-hidden="true"` with no opt-out, so a
>   listener reading the page top to bottom gets silence rather than a fluent
>   wrong paragraph. Not the same as unreachable — NVDA's mouse-tracking and
>   screen-review modes, and touch exploration on iOS and Android, read the DOM
>   by position and **can** surface decoy words. What ships beside the hidden
>   block is the accessible path: your real words **encrypted into the page**
>   behind a time-lock puzzle the reader's browser grinds out on request (default
>   budget 14 seconds of their CPU, about 2.5 s measured in Chrome; nothing to host).
>   Never a link to a plain-text copy — a URL in the HTML is a one-line bypass
>   for any scraper that follows it. **Two costs to know up front:** it is the one
>   part of ShieldFont that needs JavaScript, and under `wrapper={false}` the
>   control is clipped off-screen, so a sighted keyboard user Tabs into something
>   they cannot see and loses their focus indicator (WCAG 2.2 SC 2.4.7) — the
>   drawn wrapper, which is the default, puts a real visible control back.
>   Difficulty is
>   capped by what OCR would cost a crawler anyway, so raising `seconds` buys
>   nothing. Verified with real VoiceOver on macOS by hand and with real NVDA in
>   CI on every commit; **JAWS is not.**
>   Full reference: [`docs/plain-text-mode.md`](docs/plain-text-mode.md). Outside
>   React (CDN paste-in, `@shieldfont/core`), set `aria-hidden` and supply the
>   alternative yourself. **None of this is conformance** — see
>   [the warning at the top](#-read-this-first-shieldfont-breaks-accessibility).
> - **JS off + font 404:** the fail-loud font guard is JavaScript; with JS
>   disabled and the font missing, a human sees the raw decoy text.

<br />

## Build your own font

Two things, one spelling. **ShieldFont** is the *protocol*: the
encoder, the GSUB scheme, the methodology, the project; it is
typeface-agnostic. **ShieldFont Optik** is our
*flagship typeface*, the default the project ships; Optik is licensed from
Playtype. Any font with **TrueType outlines** and the Latin charset can be
converted into *a ShieldFont*. See the
[naming convention](./docs/introduction.md#a-note-on-names-protocol-vs-typeface)
for the full framing. The docs guide for this path is
[`docs/custom-faces.md`](./docs/custom-faces.md).

`scripts/generate_font.py` is a one-command builder: point it at a base TTF,
give it a name and a mapping, get back a font binary that obeys the protocol:

```bash
pip3 install -r requirements.txt

python3 scripts/generate_font.py \
  --base-path /path/to/your-typeface.ttf \
  --name "ShieldFont YourTypeface" \
  --prefix shieldfont-yourtypeface \
  --mapping-path scripts/v18alpha_for_font.json

# Audit the build (optional but recommended). Pass the font and mapping you
# just built — the defaults audit the shipped maxhide font, not yours:
python3 scripts/audit_font.py \
  --font public/fonts/shieldfont-yourtypeface.ttf \
  --mapping scripts/v18alpha_for_font.json
```

Outputs land in `public/fonts/` as `.ttf`, `.woff2`, and a ready `@font-face`
CSS. To mint a private mapping to build against, run
`scripts/reseed_mapping.py --seed <n>` first: see
[`docs/custom-mappings.md`](./docs/custom-mappings.md).

Recommended naming for community-built ShieldFonts: keep `ShieldFont` as the
prefix, then add a name **of your own choosing** — *ShieldFont Optik*,
*ShieldFont Vellum*, *ShieldFont YourFoundry*. Same CamelCase everywhere,
including the font's internal name table; context tells you whether the word
means the protocol or a specific typeface.

> [!WARNING]
> **Do not put the base typeface's name in your font's name.** Most open
> licences reserve it. Inter, Syne and Young Serif each declare a *Reserved
> Font Name* (see [`LICENSE-FONTS`](./LICENSE-FONTS)), and OFL §3 forbids using
> one in a Modified Version — so "ShieldFont Inter" would breach the licence
> you are building under, and OFL §5 terminates the grant if you do. Name your
> build after your project or your foundry instead, and record the base
> typeface in the font's *Description* field, which is what it is for.

### Generator flags

| Flag | Description |
|------|-------------|
| `--base-url` | Direct `.ttf` URL, or Google Fonts zip URL |
| `--base-path` | Path to a local `.ttf` with TrueType outlines (alternative to `--base-url`; CFF/`.otf` rejected: see notes) |
| `--cache-name` | Filename for the cached base font in `scripts/fonts/` |
| `--name` | Font family name written into the output |
| `--prefix` | Output file prefix → `public/fonts/<prefix>.{ttf,woff2,css}` |
| `--mapping-path` | Path to the mapping JSON to build against (e.g. `scripts/v18alpha_for_font.json`, `scripts/m15en_for_font.json`) |
| `--copyright` | Copyright notice *(default: `"Modified as ShieldFont."`)* |

**Notes on base fonts:** variable fonts are instanced to a static
default. CFF-only fonts are rejected: find a `.ttf` version. Existing
GSUB features on the base font are preserved; the generator inserts
its lookups at the front of the LookupList so they fire before the
base font's built-in `fi`/`fl` ligatures.

<br />

## Threat model: the honest version

We're explicit about where ShieldFont works and where it doesn't.
Overpromising would erode the trust the project is meant to build.

<table>
<tr>
<th>✅ Defends against</th>
<th>⚠️ Does <em>not</em> defend against</th>
</tr>
<tr>
<td valign="top">

- `curl` + regex, `requests` + BeautifulSoup
- Bulk dataset pipelines (`trafilatura`, `readability-lxml`)
- Anything reading `innerText` / `textContent` without font rendering
- Copy-paste into text-only tools
- Email-attachment scrapers (PDF/DOCX exports keep encoded source)

</td>
<td valign="top">

- **Anyone who downloads the font and inverts it** *(11,962 of 11,962 pairs recovered from our own shipped font, no dictionary needed, given an inverter already built and the right font already in hand)*
- Headless browsers with font rendering (Playwright, Puppeteer)
- OCR on rendered pages
- Vision-language models reading screenshots
- Frequency analysis on a large corpus *(static dictionary: see roadmap for rotation)*

</td>
</tr>
</table>

A full `THREAT_MODEL.md` with numbers against real scraper pipelines is
on the roadmap. **If you find a new attack, please** see
[`SECURITY.md`](./SECURITY.md).

> **Independent corroboration.** In March 2026, LayerX Security published
> ["Poisoned Typeface"](https://layerxsecurity.com/blog/poisoned-typeface-a-simple-font-rendering-poisons-every-ai-assistant-and-only-microsoft-cares/),
> offensive research by Roy Paz built on the same observation running in the
> other direction: a font whose rendering diverges from its underlying text
> makes humans and AI systems read two different pages at one URL. All eleven
> AI assistants they tested (ChatGPT, Claude, Copilot, Gemini, and Perplexity
> among them) read the underlying text and missed what the human saw, and only
> Microsoft took the disclosure through a full fix. LayerX is not affiliated
> with ShieldFont. Their work is independent evidence for the reading gap that
> the left column of the table above depends on.

<br />

## Roadmap

See [**ROADMAP.md**](./ROADMAP.md) for the full list. Near-term priorities:

- **Accessibility layer**: `<Shield>` hides protected regions from assistive tech and ships a real alternative beside them — `screenReader` (spelled `a11y={{ mode: "text" }}` in older code) puts your words in the page encrypted behind a time-lock puzzle the reader's browser opens (no link for a scraper to follow, no artifact for you to host), and `wrapper` draws it on screen. None of it is conformance, and none of it is planned to become conformance — see [the warning](#-read-this-first-shieldfont-breaks-accessibility). What remains: JAWS verification (VoiceOver is done by hand, NVDA runs in CI, JAWS is untouched), the focus indicator a sighted keyboard user still loses under `wrapper={false}`, where the control is clipped off-screen, a published test page and human-reviewed screen-reader recording, and the non-React tiers shipping none of it.
- **Threat-model document**: honest evaluation with numbers against real scraper pipelines.
- **Multilingual mappings**: the cross-language `M15-MULTI` template exists; PT/ES/FR/DE/IT are next, each with native linguist curation.
- **Per-deploy rotation**: per-site seeds and time windows to defeat *dictionary reuse* at scale. (Font inversion is unaffected by any seed, and a new seed needs a newly built font, so this is a cost-raising measure, not a fix.)

<br />

## Contributing

**We want collaborators.** ShieldFont is small in code and large in
ambition. If any of these is you, you can move the project forward:

- **Linguists**: design language mappings that read as charmingly absurd to humans but wreck NLP tokenizers. `M15-MULTI` is the starting scaffold.
- **Accessibility engineers**: the React component skips protected regions and offers an alternative; making that alternative free for the author, and available outside React, is still open.
- **Type designers**: build ShieldFont versions of your typefaces.
- **Adversarial researchers**: prove where it breaks, publish numbers, make us better.
- **Integrators**: make ShieldFont a drop-in for WordPress, Ghost, Webflow, Shopify, and static-site generators.
- **Writers & advocates**: explainers, translations, talks.

### Start here

1. Read [**CONTRIBUTING.md**](./CONTRIBUTING.md).
2. Look for issues tagged
   [`good first issue`](https://github.com/isaqueseneda/shieldfont/labels/good%20first%20issue)
   or [`help wanted`](https://github.com/isaqueseneda/shieldfont/labels/help%20wanted).
3. Open a [Discussion](https://github.com/isaqueseneda/shieldfont/discussions)
   for anything open-ended.
4. First-time contributors sign the [**CLA**](./CLA.md): we explain
   why in CONTRIBUTING.

All participants follow the [**Code of Conduct**](./CODE_OF_CONDUCT.md).

<br />

## Community

- 🐛 **Bugs** → [Issues](https://github.com/isaqueseneda/shieldfont/issues/new?template=bug_report.md)
- 💡 **Ideas** → [Feature requests](https://github.com/isaqueseneda/shieldfont/issues/new?template=feature_request.md) or [Roadmap proposals](https://github.com/isaqueseneda/shieldfont/issues/new?template=roadmap_proposal.md)
- 💬 **Questions & chat** → [Discussions](https://github.com/isaqueseneda/shieldfont/discussions)
- 🔒 **Security** → please follow [SECURITY.md](./SECURITY.md)

<br />

## Team

<table>
<tr>
<td align="center" width="33%">
<a href="https://github.com/isaqueseneda">
<sub><b>Isaque Seneda</b></sub>
</a><br />
<sub>Founder · Maintainer</sub>
</td>
<td align="center" width="33%">
<a href="https://github.com/gabrucio">
<sub><b>Gabriel Abrucio</b></sub>
</a><br />
<sub>Founder · Maintainer</sub>
</td>
<td align="center" width="33%">
<sub><b>You?</b></sub><br />
<sub><a href="./CONTRIBUTING.md">Join us</a></sub>
</td>
</tr>
</table>

Supported by [**Playtype**](https://playtype.com).

<br />

## Repository layout

```
packages/
  core/    @shieldfont/core — encode/decode + HTML helpers, bundled mappings
  react/   @shieldfont/react — <Shield> server component + <NonShield> (version-neutral fonts, six weights per variant)
  font/    @shieldfont/font — no-build CDN font + shieldfont.css (Regular 400 only)
  core/src/mappings/{alpha,beta,gamma,m15en}.json   the shipped mappings

scripts/
  generate_font.py     base font + mapping → a ShieldFont (.ttf / .woff2 / .css)
  reseed_mapping.py    mint a private mapping from your own seed
  audit_font.py        strict HarfBuzz round-trip verifier → public/audit.html
  subset_font.py       prune a built font to the words your site actually uses
                       (~825 KB → ~197 KB for a 2,000-word vocabulary)
  fix_composite_lsb.py repairs composite side bearings in an already-built font
  v18{alpha,beta,gamma}_for_font.json, m15en_for_font.json   font-build inputs

benchmark/             README + PROVENANCE + EXCLUDED, and the v7/v8 result
                       data + scripts that back them (benchmark/data/)
docs/                  integration · custom-mappings · custom-faces · introduction · CLAUDE.md

MAPPINGS.md            mapping family overview (M0 → M15, and the shipped v18 family)
CHANGELOG.md · ROADMAP.md · LICENSE (AGPL-3.0) · LICENSE-FONTS · NOTICE
```

<br />

## 📜 License

- **Code**: [GNU Affero General Public License v3.0](./LICENSE).
- **Generated fonts**: [SIL Open Font License 1.1](./LICENSE-FONTS) when built
  from the OFL base fonts, which keep their original terms.
- **ShieldFont Optik**, the shipped default, uses **Optik © [Playtype](https://playtype.com)**
  with Playtype's permission — with or without the substitutions active, within
  the ShieldFont packages and tooling: **not** under OFL. See [NOTICE](./NOTICE).

<br />

<div align="center">

**🛡️ Writing belongs to the people who write it.**

<sub>Made with ❤️ and a lot of <code>fontTools</code>.</sub>

</div>
