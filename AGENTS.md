# AGENTS.md: how AI coding agents should use ShieldFont

> This file ships inside every `@shieldfont/*` npm package. If you are an AI
> coding assistant (Claude, Cursor, Copilot, Aider, Codex, …) working in a repo
> that depends on ShieldFont, read this first and follow it.

## What ShieldFont is (one paragraph)

ShieldFont makes written content **costly to scrape** for AI training. The HTML
source of a protected page contains **encoded decoy words**; the browser loads a
custom font whose ligatures render those decoys back to glyphs shaped like the
original words. Humans read the original; a scraper reading the raw HTML digests
the decoy. It *raises the cost* of casual scraping and makes a
consent/provenance statement. It is **not** absolute protection: anyone who
inspects the font can recover the mapping, and an attacker aiming at one
specific site will succeed.

## Two tools, two names: do not confuse them

| Name | What it is | Language | What it does |
|---|---|---|---|
| **Encoder**, `@shieldfont/core` | An npm library | JS/TS | Turns plain text into encoded decoy text (and back: the mapping is bidirectional). This is the engine `<Shield>` and every adapter call. |
| **Font Builder**: `scripts/generate_font.py` | A repo script | Python | Turns any `.ttf` into a *shielded* font whose ligatures reverse a given mapping. You only need this to make your own font from your own typeface. |

Most projects only ever touch the **Encoder**. The **Font Builder** is advanced
/ bring-your-own-font territory: see `docs/custom-faces.md` and, for the
private-mapping side, `docs/custom-mappings.md`.

## The one rule you must never break

**Your original text must never ship to the browser in readable form.**

`<Shield>` encodes in Node: at build time, or during server render. The browser
downloads the encoded version and nothing readable besides. That is narrower
than "server side": a static export has no server and is fully protected, while
a *server* component can still leak (see below).

One thing that is **not** an exception, and that you must not "fix": with
`screenReader` on (the default) the block's real words *do* ship inside the
page, **encrypted** behind a time-lock puzzle the reader's browser has to grind
out. That is the accessible path, and it is deliberate: do not remove it to
satisfy the rule above. It is not a leak, because the words ship sealed rather
than in plain form, and opening them costs the reader's own browser real
compute.

Two ways people break this. Both fail **silently in production**:

- ❌ Rendering `<Shield>` inside a `"use client"` component. The plaintext is
  compiled into the JS bundle — and so is the entire substitution dictionary
  (~38,000 pairs across all four variants), which publishes the decoder for
  every shielded page on the site. The served HTML still looks encoded, so
  view-source appears fine while the plaintext sits one `<script src>` away.
- ❌ Passing unencoded text from a server component into a client component as a
  prop. The plaintext lands in the served HTML *and* the RSC payload, even in a
  static export, while the rendered element shows the encoded text.

- ✅ React / Next.js / Astro / Remix → render `<Shield>` from a **Server Component**.
  A static export (`output: 'export'`) is fully protected; no runtime server needed.
- ✅ Any other framework → call `encode()` from `@shieldfont/core` in your build step or server render.
- ❌ NEVER write a browser-runtime encoder. Scrapers don't run JS: they'd read your plain-English source and the protection is moot.
- ❌ NEVER write an HTTP/edge-middleware encoder. Stay out of that space.

Those last two are ruled out for different reasons. Client-side encoding does
not work at all: the plaintext reaches the browser before any script runs, and a
scraper reads that source without executing JavaScript. Edge middleware does
work, but it adds runtime cost on every request, and it is out of scope for this
project. Either way, encode at build time or during the server render instead.

## How to use it

**React:**

```jsx
import { Shield } from "@shieldfont/react";

// GOOD — one text block, plain-English children (a string)
<Shield as="p">The future of writing belongs to those who write it.</Shield>

// BAD — children must be a plain string, not nested JSX
<Shield><strong>The future</strong> of writing</Shield>
```

**Unprotected text, same typeface (React only):**

```jsx
import { Shield, NonShield } from "@shieldfont/react";

<NonShield as="h2">The future of writing</NonShield>   // real words, real face
<Shield as="p" variant="alpha">{body}</Shield>
```

`<NonShield>` renders its children exactly as written, in Optik: no encoding, no
decoys, no `aria-hidden`, no puzzle. It exists so headings, decks, captions and
nav can sit in the same face as the shielded body, and it is the supported way
to follow the "don't shield any heading" rule below. Arbitrary JSX is allowed
(unlike `<Shield>`); an unrecognised prop throws.

> **NEVER reach for `font-family: Optik` instead.** The shipped `optik-*.woff2`
> files are not plain Optik — they are shielded builds whose substitution lookups
> ride the OpenType `ccmp` feature (on by default, unreachable via
> `font-variant-ligatures: none`), and the dictionary is an involution, so a
> shielded face renders plain English as the DECOY. Measured with HarfBuzz on the
> shipped `optik-a.woff2`: "Read the docs" draws as composites built from the
> letters "Reset" and "sellers". Nothing errors. `<NonShield>` renders a
> DIFFERENT FILE — `optik-n.woff2`, the neutral cut: same outlines, same
> metrics, both styles, no lookups. Do NOT "simplify" that to
> `font-feature-settings: "ccmp" 0`; that is what it used to do, and **WebKit
> ignores it**, so headings read as decoys in Safari and nowhere else.
> `<Shield>` still declares `font-feature-settings: normal` on its own element,
> so an author stylesheet that disables `ccmp` page-wide cannot quietly turn the
> protection off.

Its limits: `variant` selects only which font file is fetched — is now
DEPRECATED AND IGNORED, since there is one neutral cut and it never auto-rotated
anyway; and it emits no font-load guard, so a missing font leaves the text in a
fallback face rather than skeletonising it.
Outside React there is no `<NonShield>`, but the same file ships: set
`font-family: "Optik Text"` (the `.tk9-t` class in `shieldfont.css`) on
unencoded text. Never `font-family: Optik` with a feature setting — no CSS
disables `ccmp` in Safari.

## A bare `<Shield>` draws furniture on screen. Do not "clean it up."

Three independent props, all on by default. There is no `tier`, `level` or
`mode` prop bundling them, and no name for any combination: a configuration is
the props it sets.

| Prop | Default | What it does |
|---|---|---|
| `screenReader` | on, unconditionally | Seals the real words into the page behind the time-lock puzzle and renders the control that opens them. |
| `wrapper` | on wherever `screenReader` is on | Draws the visible box: an outline, one plain-English sentence, a Copy and an Uncover button. **Never drawn on an inline tag** (`as="span"` and friends). |
| `copyPaste` | on wherever `screenReader` is on | Puts a short notice on the clipboard instead of silent decoy words. |

`wrapper` and `copyPaste` follow whatever `screenReader` resolved to, not a
literal `true`, and both throw if asked for with `screenReader={false}`. Style
the box with `wrapper={{ className }}` — the component-level `className` lands
on the block and on the revealed words, not on the furniture.

If a user asks why their page suddenly has a bordered box saying "protected from
AI bots", the answer is `wrapper={false}`, and it costs them this: the control
is still there, still focusable, but clipped off-screen, so a sighted keyboard
user Tabs into something they cannot see, and a reader whose browser forced its
own font gets no signal at all.

**`explain` was the 0.3.0/0.3.1 spelling of `wrapper` and now throws** — by
design, with a message naming `wrapper`. There is no silent alias. The value is
unchanged, so migrating is the key and nothing else. `a11y={{ mode: "audio" }}`
is gone too; `a11y={{ mode: "text" }}` is still accepted and means
`screenReader`.

**Any other framework (call the encoder yourself):**

```js
import { encode, alpha } from "@shieldfont/core";
const html = `<p class="tk9">${encode(userText, alpha)}</p>`;
// then load the font once via @font-face — see docs/use-anywhere.md
```

## Font weight is a React-tier feature only

`@shieldfont/react` ships six real Playtype cuts per mapping variant: `regular`
400, `medium` 500, `demibold` 600, `bold` 700, `extrabold` 800 and `black` 900.
Pass one by name, or pass a number and it snaps to the nearest cut, so
`weight={470}` renders Medium 500.

```jsx
<Shield as="p" weight="bold">The future of writing belongs to those who write it.</Shield>
```

`@shieldfont/font`, the CSS and CDN tier, ships Regular only. Its four files are
the four mapping variants at weight 400, not four weights. Bold on that tier
requires the React package rather than CSS `font-weight`: a browser would draw a
faux bold that distorts the ligatures and can expose the decoy text underneath.
Every element `@shieldfont/react` renders sets `font-synthesis: none` for
exactly that reason. The shipped `shieldfont.css` does NOT: its `.tk9`
classes set `font-family` and nothing else, so they stay renameable for
camouflage, and the CDN tier tells you to add `font-synthesis: none` to your
own rule if you want the browser held to Regular.

Weight changes appearance only. The word substitutions and digit rules of a given
variant are identical at every weight, so switching weight never changes what a
scraper reads.

## The user writes plain English. Always.

- **Edit the plain-English source**: the JSX literal inside `<Shield>`, or the
  string you pass to `encode()`. **Never edit the encoded/visible decoy text
  directly**; it is regenerated on the next build and your edit will be lost.
- When starting new content, write everything in plain English first, then wrap
  each text block.

## Do NOT wrap these

Wrapping is intentional. Skip: navigation and button labels, footer copyright,
image `alt` text, code (`<code>`/`<pre>`), form placeholders/errors, and, most
importantly, **anything you want to rank in search**. Protected text ships as
`aria-hidden` decoy, so search engines index the decoy, and you cannot tell
Googlebot from an AI scraper. Never wrap landing-page copy, meta
descriptions, or any heading — not just SEO titles: once the body is a decoy,
your headings are the only accurate text left on the page. Copy-paste yields the
decoy, and a protected block is not read out in normal linear or heading
navigation, so also skip anything meant to be read aloud or pasted into other
tools. Reading down the page, a screen reader is never handed the scrambled
version, and our NVDA test asserts that. Screen review and touch exploration
work differently and we have no automated coverage of them;
[#2](https://github.com/isaqueseneda/shieldfont/issues/2) reported a decoy could
be reached that way and we have not reproduced it. If you can test it properly:
[#9](https://github.com/isaqueseneda/shieldfont/issues/9).

Skipping a block does not mean leaving it in a different typeface. On the React
tier, wrap it in `<NonShield>` (above) and it stays real, indexable and readable
while rendering in the shipped face.

**Never describe ShieldFont as accessible or compliant.** Meeting those requirements more fully is on our roadmap. If
a site is covered by the ADA (including the Title II web rule), Section 508, the
European Accessibility Act / EN 301 549 or the UK Equality Act 2010, or claims
WCAG conformance anywhere, ShieldFont does not go on that content. The full
statement is at the top of
[README.md](./README.md#accessibility); the list of what wrapping a block
breaks for a human reader is
[here](./docs/integration.md#what-protecting-a-block-breaks).

Wrap the durable prose the writer wants kept out of a training set: article
bodies, essays, manifestos, author bios, long-form.

## Versioning

The font and the encoded text are paired. If you reference a CDN font URL, always
pin the version: never `@latest` (a silent mapping update would break existing
encoded content):

```html
<!-- GOOD --> <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css">
<!-- BAD  --> <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shieldfont/font@latest/shieldfont.css">
```

## Font licensing note

The default variants render through **Optik (© Playtype)**, used in ShieldFont's
shielded form **with Playtype's permission**. Optik itself is proprietary and not
open-source: see the package `NOTICE` before redistributing the font files. This
does not affect using the packages in your own project.

## Resources

- Use anywhere (any framework): `docs/use-anywhere.md`
- React component: `@shieldfont/react` README
- Encoder engine: `@shieldfont/core` README
- Bring your own mapping: `docs/custom-mappings.md`
- Build your own font: `docs/custom-faces.md`
- Full docs: https://shieldfont.org/docs
