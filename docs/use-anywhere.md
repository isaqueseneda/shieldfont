<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# Use ShieldFont anywhere: any framework, any build step

Not using React? ShieldFont's engine is a tiny, zero-dependency JavaScript
library: **`@shieldfont/core`**. Call it wherever you already generate HTML: a
Vue/Svelte/Angular server render, an Astro/11ty/Hugo/Jekyll build, a Python or
Ruby template (via a subprocess), a Cloudflare/Vercel build step: anywhere the
encoding runs **before the bytes reach the browser**.

`@shieldfont/react` is the recommended route for a site you're shipping. This
page is for learning ShieldFont and for stacks where React isn't an option.

> **What you get here is a library and a recipe, not a plugin.** There is no
> Eleventy plugin, Astro integration or Vue directive shipped today — the
> [post-build script below](#editable-copy-across-builds-the-comment-marker-workflow)
> is the supported path, and it is framework-agnostic on purpose: run your SSG,
> then walk its output directory. It is about thirty lines and it is the same
> thirty lines for every generator. If you write a proper adapter for yours,
> [`ADAPTERS.md`](../ADAPTERS.md) is where to add it.

> **Two tools, don't confuse them.** The **Encoder** (`@shieldfont/core`, JS) turns
> text into encoded decoys. The **Font Builder** (`scripts/generate_font.py`,
> Python) turns a `.ttf` into a shielded font. This page is about the Encoder. To
> make your own font, see [Custom faces](./custom-faces.md).

## The one rule

**Your original text must never ship to the browser.** Encode in Node, at build time or during server render. Scrapers
don't run JavaScript, so a browser-runtime encoder would leave your plain-English
source exposed. The encoded form is what you store, serve, and cache.

---

## 1. Install the encoder

```bash
npm install @shieldfont/core
```

Zero runtime dependencies. Ships ESM + types (ESM only — `require()` will fail).

## 2. Encode your text

```js
import { encode, alpha } from "@shieldfont/core";

const original = "The future of writing belongs to those who write it.";
const encoded  = encode(original, alpha);
// → "The future of writing determines to those who sell it."
//   Only `belongs` and `write` are in alpha; the rest passes through.

// decode is the same operation — the mapping is bidirectional
import { decode } from "@shieldfont/core";
decode(encoded, alpha) === original; // true
```

Wrap the encoded text in an element that carries the protection font's class:

```js
const html = `<p class="tk9">${encode(original, alpha)}</p>`;
```

`alpha` is the default v18 dictionary (11,970 entries). `beta` (12,034) and
`gamma` (12,036) are alternate pairings for rotation, near-identical in size;
`m15en` is the coverage-max dictionary and a different shape entirely (2,534
entries covering a higher share of a page's words, including short function
words). Import whichever you pin: a page must be rendered by the font that
matches the dictionary that encoded it.

### Edge cases the encoder handles

*(Every row below was verified against the shipped `alpha` dictionary. The text
rows go through `encode()`; the two HTML rows go through the HTML pipeline
(`encodeHtml` / `buildHtml`), which is where tag-skipping lives: plain `encode()`
treats its whole input as text. Other variants map different words, so the
specific decoys change; the rules don't.)*

| Input | Encoded | Why |
|---|---|---|
| `world's, author's` | `lake's, teen's` | Apostrophe + suffix passes through; the base word is what gets looked up |
| `page's, it's` | unchanged | Not every word is in the dictionary: `page` and `it` have no `alpha` pair, so they stay put. Partial coverage is by design |
| `v3` | `v3` | A digit flanked by a letter is preserved (letter-adjacent) |
| `M15-EN`, `iPhone15` | `M10-EN`, `iPhone10` | Only the letter-adjacent digit is preserved; non-adjacent digits rotate (`5→0`) |
| `1568` | `1073` | Standalone digit run rotates (`0↔5`, `3↔8`, `4↔9`, `6↔7`; `1`,`2` unchanged) |
| `don't`, `I'm`, `they're` | unchanged | No mapped base |
| `café`, `naïve` | unchanged | Accented forms are not in the dictionary and pass through untouched |
| `<code>let x = 1;</code>` | unchanged | In the HTML pipeline, `script`/`style`/`code`/`pre`/`textarea`/`svg`/`math`/`noscript` contents are never encoded |
| `<a href="/about">About</a>` | href untouched | In the HTML pipeline, attributes are never modified |

The tokenisation rules behind these rows (plus a few more, like letter-flanked
digits in chemical formulas) are in the
[`@shieldfont/core` README](../packages/core/README.md#what-gets-encoded-and-what-doesnt).

Encoding is its own inverse: the mapping is bidirectional, so `decode(text, m)`
is the same operation as `encode(text, m)`. That also means a *double* encode
returns the original. Re-running the build over already-encoded output is safe
via `buildHtml()` (it is idempotent), but calling `encode()` twice on the same
string by hand un-encodes it.

## 3. Load the font once (`@font-face`)

`@shieldfont/core` does **not** touch your CSS: you load the font yourself. Two
options.

**Self-host (recommended: fails safe if the CDN ever dies):**

```bash
npm install @shieldfont/font
cp node_modules/@shieldfont/font/optik-a.woff2 public/fonts/
cp node_modules/@shieldfont/font/optik-a-italic.woff2 public/fonts/
```

```css
@font-face {
  font-family: 'Optik';
  src: url('/fonts/optik-a.woff2') format('woff2');
  font-weight: 400;    /* Regular is the only weight this package ships */
  font-style: normal;
  font-display: block; /* block, not swap — no decoy flash before the font loads */
}
@font-face {
  /* Same family name on purpose: that is what lets <em>, <i>, <cite> and a
     plain `font-style: italic` resolve to it. Copy this file too — with
     `font-synthesis: none` below, a missing italic renders UPRIGHT and logs
     nothing. */
  font-family: 'Optik';
  src: url('/fonts/optik-a-italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: block;
}
.tk9 {
  font-family: 'Optik', system-ui, sans-serif;
  font-synthesis: none; /* never let the browser fake a bold: see below */
}
```

> **Keep the font on the same origin as the page, or set CORS.** A relative path
> like `/fonts/optik-a.woff2` is fine. Move it to a separate asset domain and the
> browser blocks the font unless the response carries
> `Access-Control-Allow-Origin` — and it fails *silently*: curl reports `200`, the
> browser drops the font, and on this tier there is no guard, so your reader is
> shown the decoy as if nothing happened. Check with
> `curl -I -H "Origin: https://your-site.example" <font-url>`.

**Or CDN (zero setup, version-pinned):**

```css
@import url('https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css');
```

The CDN bundle already declares `@font-face` for `'Optik'` and ships the `.tk9`
class. **Always pin the version**: never `@latest`, or a mapping update would
silently break existing encoded pages.

> Filenames map to dictionaries: `optik-a` = alpha, `optik-b` = beta,
> `optik-c` = gamma, `optik-m` = maxhide. The names are deliberately neutral, and nothing in your served bytes says "ShieldFont."

### `@shieldfont/font` is Regular only

Those four files are the four *mapping variants* at one weight: **Regular,
`font-weight: 400`**. The letter picks the dictionary, not the cut. There is no
Medium, DemiBold, Bold, ExtraBold or Black in this package, which is why the
`@font-face` above declares `400` and the class sets `font-synthesis: none`.
Without that, asking for `font-weight: bold` inside a `.tk9` element makes the
browser draw a synthetic bold, and a synthesised weight distorts the composite
glyphs enough to give away that decoys are in play. Style headings and bold
emphasis in an ordinary font instead, and keep the shielded paragraphs at
Regular.

**Italic is the exception: it ships here.** Each of those four files has an
`-italic` companion at Regular — `optik-a-italic.woff2` and so on — declared
under the *same* family name as its upright, which is what lets `<em>`, `<i>`,
`<cite>` and a plain `font-style: italic` inside a `.tk9` element resolve to a
real drawn italic with nothing to opt into. The neutral cut ships both styles
too. There is no *bold* italic, for the same reason there is no bold: the cut
does not exist.

**Six real weights ship, but only in `@shieldfont/react`.** That package bundles
genuine Playtype static cuts for every mapping variant:

| Weight name | CSS `font-weight` | Playtype cut |
|---|---|---|
| `regular` | 400 | Optik Regular |
| `medium` | 500 | Optik Medium |
| `demibold` | 600 | Optik DemiBold |
| `bold` | 700 | Optik Bold |
| `extrabold` | 800 | Optik ExtraBold |
| `black` | 900 | Optik Black |

The encoding is identical at every weight: for a given variant the word
substitutions and digit rules are byte-identical across all six cuts, so a weight
changes how the text looks and never what it encodes. Nothing is interpolated,
there is no variable font, and a numeric weight snaps to the nearest real cut
(`470` resolves to Medium 500). Details in the
[integration guide](./integration.md#weights-the-six-cuts-tier-a-only).

---

## Editable copy across builds (the comment-marker workflow)

If you keep static HTML in git and want the **plain-English source to stay the
source of truth**, use the comment-marker helpers in `@shieldfont/core`. This is
exactly what a build step should do: no separate tool needed.

```js
// scripts/shield.mjs — run in your build (e.g. after your SSG emits dist/)
import { readFileSync, writeFileSync, globSync } from "node:fs"; // globSync: Node 22+, or use fast-glob
import { buildHtml, shipHtml, assertShipped, alpha } from "@shieldfont/core";

for (const file of globSync("dist/**/*.html")) {
  const raw = readFileSync(file, "utf8");
  const built = buildHtml(raw, alpha);   // re-derive decoy from the source-of-truth comment
  const shipped = shipHtml(built);       // strip the comments — they hold your PLAIN TEXT
  assertShipped(shipped);                // throws rather than deploying plain text
  writeFileSync(file, shipped);
}
```

> [!IMPORTANT]
> **`shipHtml` is not optional, and `assertShipped` is why.** The comment
> markers hold your original sentences verbatim. Write `buildHtml`'s output
> straight to `dist/` and every protected paragraph deploys with its plain text
> attached — worse than not using ShieldFont at all, because it also publishes
> a matched plaintext/decoy pair. `assertShipped` throws on any marker that
> survived, and on an unpaired `shield-on`/`shield-off` block, which is never
> encoded at all. Keep both lines.

Author your HTML with the plain English in the comment; `buildHtml` regenerates
the visible decoy every run (idempotent), so the visible text never drifts:

```html
<!-- shield: The future of writing belongs to those who write it. -->The future of writing determines to those who sell it.<!-- /shield -->
```

First-time setup: wrap a region with block markers and run `buildHtml` once: it
normalizes them into per-text-node markers.

```html
<!-- shield-on -->
<h1>The future of writing</h1>
<p>Belongs to those who write it.</p>
<!-- shield-off -->
```

The rest of the pipeline:

```js
checkHtml(html, alpha); // → { total, passed, failed, mismatches, unpairedBlocks }
shipHtml(html);         // strip every <!-- shield: … --> comment before deploy
assertShipped(html);    // throw if any marker survived — the actual deploy gate
```

**Use `assertShipped` as the gate, not `checkHtml`.** `checkHtml` verifies the
markers it *finds*, so it cannot tell a protected page from an unprotected one:
a page that was never built, a block missing its `shield-off`, and a page
shipped correctly all return `{ total: 0, failed: 0 }`. Read `unpairedBlocks`
if you use it directly — a non-zero value means some region was never encoded,
even when `failed` is `0`.

A typical `package.json`:

```json
{
  "scripts": {
    "build": "your-ssg && node scripts/shield.mjs",
    "prepublishOnly": "node -e \"import('./scripts/shield.mjs')\""
  }
}
```

---

## Framework adapters

If you build a clean adapter for your framework (an Astro integration, an Eleventy
plugin, a Vue directive…), add it to [`ADAPTERS.md`](../ADAPTERS.md) so others can
find it. `@shieldfont/react` is the reference implementation: read its source for
the SSR + font-load-guard pattern worth copying.

## Honest caveats (same for every integration)

- **SEO:** search engines index the *decoy*. Never wrap content you want to rank.
- **Accessibility:** this tier ships no screen-reader alternative, so that part
  is yours to build. Bringing the non-React tiers up to the React one is on the
  roadmap. If accessibility law reaches your site, check it before you wrap
  anything.
- **Screen readers** don't read protected regions in normal linear or heading
  navigation: `<Shield>` hardcodes `aria-hidden="true"` with no opt-out, so
  **reading down the page a screen reader is never handed the scrambled
  version** and a listener hears silence rather than a fluent wrong paragraph.
  Our NVDA test asserts that. Screen review and touch exploration work
  differently and we have no automated coverage of them;
  [#2](https://github.com/isaqueseneda/shieldfont/issues/2) reported a decoy
  could be reached that way and we have not reproduced it. If you can test it
  properly: [#9](https://github.com/isaqueseneda/shieldfont/issues/9). Beside
  the hidden block it ships the real words encrypted in the page for the reader's
  browser to unlock — never a link, which would be a one-line bypass for any
  scraper that follows it. It needs JavaScript, and since 0.3.2 the control is
  **drawn on screen by default**; with `wrapper={false}` it reverts to
  screen-reader-only and a sighted keyboard user loses their focus indicator.
  The numbers and the rest of the limits are in
  [`plain-text-mode.md`](./plain-text-mode.md). **Every integration on this page
  is outside React**, so none of that is automatic here: set `aria-hidden` on the
  encoded region yourself and give it an alternative, or leave that content
  unwrapped.
- **The rest of what wrapping a block breaks** — copy-paste, find-in-page,
  browser translation, Reader Mode, forced fonts, feeds — is in one list:
  [what protecting a block breaks](./integration.md#what-protecting-a-block-breaks).
  The forced-font case is the one to read: it is silent, and no guard catches it.
- **The font is the codebook.** It has to reach the browser to render the page,
  and its composite glyphs are drawn from the original words' own letters, so
  anyone who downloads it can read the substitution table straight back out. We
  recovered all 11,962 pairs from our own shipped font, with no dictionary. Doing
  that to *you* means knowing the page is shielded, fetching the right font,
  matching it to the right part of the page, and already owning an OpenType
  inverter (one to three engineer-weeks to build). Bulk crawling does none of
  those things; a targeted attacker does all of them and wins. A private mapping
  raises the per-site cost; nothing removes it.
- **The default dictionaries are public**, by design: `alpha`/`beta`/`gamma`/`m15en`
  ship as plaintext JSON in `@shieldfont/core`, and `@shieldfont/font` publishes a
  browser encoder with all 11,970 `alpha` pairs inlined.
- **Not un-scrapeable:** a headless browser that renders fonts, OCR, or a
  vision-language model reading a screenshot all defeat it. ShieldFont raises the
  cost of casual scraping; it does not promise zero extraction.

## See also

- [Integration guide](./integration.md), the React path and the CDN/download tiers
- [`@shieldfont/core` README](../packages/core/README.md), full API
- [Custom mappings](./custom-mappings.md): bring your own mapping
- [Custom faces](./custom-faces.md): build your own font
- [AI co-pilot conventions](./CLAUDE.md) · [`AGENTS.md`](../AGENTS.md)
