# @shieldfont/react

A React **server component** for [ShieldFont](https://github.com/isaqueseneda/shieldfont): encodes its children in Node — at build time or during server render — and ships only the encoded form to the browser, rendered through a bundled font.

**Encoded text is what reaches the browser.** Scrapers reading the HTML source see the encoded form. Humans, rendering through the font, see the original.

> [!CAUTION]
> **ShieldFont harms accessibility, on purpose, and no setting turns that off.** It withholds the real text of a protected block from the page source, so a protected block **fails WCAG 2.2 SC 1.3.1** even with every accessibility feature on: the words are not programmatically available until a reader completes a few-second unlock that needs JavaScript. If the ADA (including the Title II web rule), Section 508, the European Accessibility Act / EN 301 549 or the UK Equality Act 2010 applies to your site — or you claim WCAG conformance anywhere on it — don't use this on content that claim covers. It is for an author's own essays, fiction and blog posts, by their own informed choice; not for government, procurement-bound or service-critical content. Details: [Accessibility](#accessibility-read-this).

> [!WARNING]
> **Wrapping content in `<Shield>` removes it from search-engine indexing.** The DOM text is `aria-hidden` decoy gibberish, and you **cannot** distinguish Googlebot from an AI scraper, so search engines index the decoy, not your words. **Do not wrap anything you want to rank.** This is the single biggest thing to understand before you ship; see [Accessibility](#accessibility-read-this) and [Where the encoding must run](#where-the-encoding-must-run-important).

```bash
npm install @shieldfont/react
```

## Quick start (Next.js App Router, Astro, Remix: any RSC framework)

```jsx
import { Shield, NonShield } from "@shieldfont/react";

export default function Page() {
  return (
    <main>
      <h1>About us</h1>                 {/* not protected — your normal font */}

      <Shield as="p">
        The future of writing belongs to those who protect their words.
      </Shield>

      {/* Headings are never shielded. <NonShield> renders them unprotected,
          in the same typeface as the block above. */}
      <NonShield as="h2" size="2.4rem">Manifesto</NonShield>
    </main>
  );
}
```

Then copy the fonts into your app once (they're bundled with the package):

```bash
# copies the neutral optik-a / optik-b / optik-c / optik-m woff2 files
cp node_modules/@shieldfont/react/fonts/*.woff2 public/fonts/
```

That's it. `@font-face`, encoding, and the font-load guard all happen automatically.

## Where the encoding must run (important)

Protection only holds if encoding runs **on the server / at build time**, so encoded text (never plaintext) reaches the browser. Two setups break this and silently ship your plaintext:

1. **Inside a `"use client"` boundary.** The plaintext `children` is serialized into the RSC payload *before* Shield's encoder runs, and view-source shows it. Always render `<Shield>` from a **Server Component**.
2. **Client-only React (Vite, CRA, raw `ReactDOM.render`).** The plaintext compiles into the JS bundle as string literals. Use an SSR/SSG framework (Next, Astro, Remix) instead, so encoding happens on the server.

`<Shield>` detects when it renders in the browser and logs a `console.warn`, because this failure is otherwise silent. **The warning fires in production too**, deliberately: a dev-only warning made the single worst misuse fail silently in the one environment where it matters. It costs nothing, because by the time it can fire the bundle already contains your plaintext and the full dictionary; used correctly (server components only) the module never reaches the client bundle, so neither does the message. It is deduped to one warning per process. (This is the one caveat to read before anything else, which is why it's up here.)

## Variants: the rotation system

`<Shield>` ships four mappings, each with its own font:

| `variant` | Mapping | When to use |
|---|---|---|
| *(unset, **default**)* | **Auto-rotates** across `alpha`/`beta`/`gamma` | Recommended. Each `<Shield>` picks one by content hash, so your site uses **all three** mappings and a scraper can't learn one mapping and reverse everything. |
| `"alpha"` / `"beta"` / `"gamma"` | Pin one v18 mapping | When you want a single fixed font per page (one font download instead of up to three). |
| `"maxhide"` | M15 "maximum coverage" | Encodes a higher share of common words. A single fixed mapping; **never** chosen by auto-rotation, so opt in explicitly. |

```jsx
<Shield>auto-rotated across alpha/beta/gamma</Shield>
<Shield variant="beta">pinned to beta</Shield>
<Shield variant="maxhide">maximum-coverage dictionary</Shield>
```

Auto-rotation is **deterministic by content** (same text → same variant): SSR-safe, reproducible builds, and it still spreads all three mappings across your content. **Cost:** a page that mixes variants loads one font per variant used (roughly 825 KB each). Pin a variant if you want exactly one font per page.

Note: α/β/γ have slightly different pair counts (11,970 / 12,034 / 12,036), so how much of a given block is concealed varies a little depending on which mapping it hashes to.

## Component API

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `as` | `ElementType` | `"div"` | **An HTML tag name.** `"span"` for inline, `"h1"`…`"h6"` for headings, `"article"`/`"section"` to wrap a block. It only picks the wrapper tag; it does not change what gets encoded. Table-context tags (`td`, `th`, `tr`, …) **throw** — the browser moves the wrapper out of the table and the cell disappears from the accessibility tree. |

> **`<Shield>` forwards only the props in this table.** It is not a polymorphic
> pass-through, so anything else — `href`, `id`, `onClick`, `aria-*` — is not
> rendered, and passing one **throws** rather than disappearing quietly. That
> makes `<Shield as={Link} href="/post">` an error instead of a dead link. Put
> the element that needs its own props on the outside:
>
> ```jsx
> <Link href="/post"><Shield as="span">The title of the post</Shield></Link>
> ```
>
> The same applies to a custom component: it would receive none of its required
> props, so wrap rather than substitute.
| `variant` | `"alpha" \| "beta" \| "gamma" \| "maxhide"` | *auto-rotate* | Pin a mapping, or leave unset to auto-rotate α/β/γ. |
| `weight` | `"regular"` \| `"medium"` \| `"demibold"` \| `"bold"` \| `"extrabold"` \| `"black"` \| `number` (1..1000) | inherit | Font weight. Six real cuts of Optik ship per variant; a number snaps to the nearest one and that resolved value is what gets emitted. See [Weights](#weights-what-actually-ships). |
| `lineHeight` | `number \| string` | inherit | Line-height passthrough. |
| `size` | `string` | inherit | font-size passthrough. |
| `className` | `string` | n/a | Merges with the internal scope. |
| `style` | `CSSProperties` | n/a | Merges with the internal font-family scope. |
| `rotate` | `boolean \| RotateConfig` | `false` | Mix a **time period** into the variant choice. See [Time-based rotation](#time-based-rotation-optional). |
| `screenReader` | `boolean \| { seconds? }` | **`true`**, unconditionally | Seals the block's real words into the page behind the time-lock puzzle and renders the control that opens them. The other two switches stand on this one. See [Accessibility](#accessibility-read-this). |
| `wrapper` | `boolean \| ShieldNotice` | **on wherever `screenReader` is on** | Draws the visible box: an outline, one plain-English sentence, a Copy and an Uncover button. **Never drawn on an inline tag** (`as="span"` and friends) — asking for it there throws. `wrapper={{ className }}` styles the box and its strips; the component-level `className` does not reach them. Called `explain` in 0.3.0/0.3.1; **passing `explain` throws**. |
| `copyPaste` | `boolean \| { notice? }` | **on wherever `screenReader` is on** | Puts a short notice on the clipboard instead of silent decoy words. Independent of `wrapper`. |
| `a11y` | `ShieldA11y` | *(the `screenReader` default)* | The older spelling: `a11y={{ mode: "text" }}` means `screenReader`, `a11y={{ mode: "none" }}` means `screenReader={false}`. Still accepted, and the place the `seconds`, `reveal`, `label`, `note` and `visualHidden` options live. See [Accessibility](#accessibility-read-this). |
| `children` | `string` | required | A plain string. **Anything else throws** — see [What gets encoded](#what-gets-encoded-inside-shield). |

Precedence when several of these could pick the variant, highest first: an explicit **`variant`** prop (always pins) → the **`rotate`** prop → module-level **`setRotation()`** → the content hash.

### Weights: what actually ships

> [!IMPORTANT]
> **Weights are a React-tier feature.** The static [`@shieldfont/font`](https://www.npmjs.com/package/@shieldfont/font) package (the CDN paste-in tier) ships **Regular only**: one file per mapping variant, each declared `font-weight: normal`. If you need Bold, or any cut other than Regular, you need this package. Everything in this section applies to `<Shield>` and to nothing else.

The mapping variants and the weights are two orthogonal axes. `optik-a/b/c/m` correspond to the `alpha`/`beta`/`gamma`/`maxhide` dictionaries; each of the four ships six real static cuts of Optik, licensed from Playtype. Every file is built from one of Playtype's own upright masters, run through the same encoding pipeline. There is no variable font and nothing is interpolated or synthesised.

The named weights are Playtype's own cut names, lowercased:

| Weight name | CSS `font-weight` | Playtype cut | Bundled file (alpha) |
|---|---|---|---|
| `"regular"` | `400` | Optik Regular | `optik-a.woff2` |
| `"medium"` | `500` | Optik Medium | `optik-a-500.woff2` |
| `"demibold"` | `600` | Optik DemiBold | `optik-a-600.woff2` |
| `"bold"` | `700` | Optik Bold | `optik-a-700.woff2` |
| `"extrabold"` | `800` | Optik ExtraBold | `optik-a-800.woff2` |
| `"black"` | `900` | Optik Black | `optik-a-900.woff2` |

Filenames follow one rule: the Regular cut keeps the bare variant name, every other cut carries a numeric suffix. Twenty-four files ship in total (6 weights x 4 variants). The exported `OPTIK_WEIGHTS` object maps each name to its numeric weight, so code can check at runtime what exists.

#### Numbers snap to the nearest real cut

Six static cuts cannot honour an arbitrary number, so a numeric `weight` **snaps to the nearest cut and `<Shield>` emits that resolved value**. What lands in the HTML is always a weight a real file exists for:

```jsx
<Shield weight="bold">Rendered with the real Bold (700) cut.</Shield>
<Shield weight={470}>Emits font-weight:500, the Medium cut.</Shield>
<Shield weight={620}>Emits font-weight:600, the DemiBold cut.</Shield>
```

| You write | `<Shield>` emits | Renders as |
|---|---|---|
| `weight={300}` | `400` | Regular |
| `weight={470}` | `500` | Medium |
| `weight={620}` | `600` | DemiBold |
| `weight={999}` | `900` | Black |

**Tie-break: exact midpoints round up.** The five boundaries are `450`, `550`, `650`, `750` and `850`, and each resolves to the heavier of its two neighbours. `weight={450}` renders as Medium (500), not Regular (400).

Use `resolveOptikWeight` to see what a value becomes without rendering anything:

```js
import { resolveOptikWeight } from "@shieldfont/react";

resolveOptikWeight("demibold");  // 600
resolveOptikWeight(470);         // 500
resolveOptikWeight(450);         // 500 (midpoints round up)
```

Snapping is a convenience for real weight values, **not** a reason to accept nonsense. A `RangeError` still fires for an unknown name such as `"semibold"`, for `NaN` or `Infinity`, and for any number outside `1..1000`. `470` is imprecise and gets helped; `NaN` is a bug and gets reported.

#### Why nothing is ever synthesised

The injected `@font-face` declares one face per cut, each claiming a numeric band (400 claims 1-449, 500 claims 450-549, 600 claims 550-649, 700 claims 650-749, 800 claims 750-849, 900 claims 850-1000). The bands tile `1..1000` with no gaps and use the same midpoint-rounds-up boundaries as the table above, so they agree with the prop exactly. Their job now is the weights `<Shield>` never sees: one arriving by inheritance or from your own stylesheet still lands on a real cut. The rendered element also sets `font-synthesis: none` as a second line of defense; a synthetic weight would distort the ligature composites enough to expose that decoys are in play.

Only the faces a page actually uses are downloaded; declaring six faces per variant costs nothing on a single-weight page. Each alpha, beta or gamma cut is roughly 825 KB of woff2 and each maxhide cut is roughly 215 KB, so a page that mixes many weights pays for each one it renders.

### What gets encoded inside `<Shield>`

- `children` **must be a plain string.** It is encoded with the resolved variant's mapping and rendered.
- **Anything else throws**: nested JSX, a number, an array produced by `{interpolation}`. `<Shield>` does not encode them best-effort.
- **Why throw instead of walk?** The encoder cannot see inside a component you wrote, so walking a tree would leave that component's text in plain English inside a block that still renders as protected. Nothing on the page would look wrong. Failing loud is the only way that mistake is visible.
- For mixed content, use one `<Shield>` per text block.

```jsx
// ❌ THROWS — children are JSX, not a string.
<Shield as="article">
  <h2>Chapter One</h2>
  <p>Text with <em>emphasis</em> is all encoded.</p>
  <MyWidget />
</Shield>

// ✅ One <Shield> per text block, and the heading left unprotected.
<article>
  <NonShield as="h2">Chapter One</NonShield>
  <Shield as="p">Text without inline markup is encoded.</Shield>
  <MyWidget />
</article>
```

`as` also refuses table-context tags (`td`, `th`, `tr`, …): the browser moves
our wrapper out of the table and the cell disappears from the accessibility
tree, so `<Shield>` throws rather than let that happen silently. Put a plain
`<td>` in your markup and shield its contents:
`<td><Shield as="span">…</Shield></td>`.

## `<NonShield>`: the same typeface, none of the protection

`<NonShield>` renders its children **exactly as written**, in Optik. No
encoding, no decoys, no `aria-hidden`, no sealed payload, no puzzle, no copy
guard, no notice strip. The words in the DOM are the words on screen: a screen
reader reads them, a search engine indexes them, a translator translates them,
copy-paste copies them, find-in-page finds them.

```jsx
import { Shield, NonShield } from "@shieldfont/react";

<article>
  <NonShield as="h2">The future of writing</NonShield>
  <Shield as="p" variant="alpha">{body}</Shield>
  <NonShield as="p" size="0.9rem">Photograph by <em>Jane Roe</em></NonShield>
</article>
```

It is there so a ShieldFont page can be **one typeface throughout**. Until it
existed, the shielded paragraphs rendered in Optik and everything around them —
headings, decks, captions, nav — rendered in whatever fallback the host
stylesheet supplied, and the author's only fix was to hand-roll a `@font-face`
and a `font-family` rule of their own. It is also the supported way to follow
this project's own rule that
[headings must never be shielded](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#headings-dont-shield-them):
once the body is a decoy, the headings are the only accurate text left on the
page, so `<NonShield as="h2">` keeps them real *and* in the right face.

### The bit that matters: `font-family: Optik` alone renders the decoy

> [!WARNING]
> **The bundled `optik-*.woff2` files are not the Optik typeface — they are
> *shielded builds* of it.** Setting `font-family: Optik` on ordinary text
> renders the **decoy**, and nothing errors when it does.

The word substitutions are GSUB lookups wired into the OpenType **`ccmp`**
feature, which is on by default and which `font-variant-ligatures: none` does
not reach. The dictionary is an **involution** (`m[m[x]] === x` — the reason
`decode` in `@shieldfont/core` is defined as `encode`), so every word in it is
both an original and a decoy and the font swaps it either way. Shaping through
the shipped `optik-a.woff2` with HarfBuzz: `"Read the docs"` draws as composites
built from the letters `"Reset"` and `"sellers"`; `"2026 report"` draws as
`"2527 report"`. 11,962 of the 11,970 `alpha` words behave that way.

`<NonShield>` sets **`font-feature-settings: "ccmp" 0`** on the element it
renders. With the feature off, all 11,970 dictionary words shape to their own
letters, the base font's real `fi`/`fl` ligatures survive, and accented text is
untouched in NFC and NFD alike.

Because `font-feature-settings` **inherits**, `<Shield>` declares
`font-feature-settings: normal` on its own element, so a `<Shield>` nested
inside a `<NonShield>` cannot inherit `"ccmp" 0`, silently stop substituting,
and publish its decoy text at full readability.

### Props

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `as` | `ElementType` | `"div"` | Which element to render. No table-tag restriction — `<NonShield>` renders one element and no wrapper, so `as="td"` is a `<td>` and behaves like one. |
| `variant` | `"alpha" \| "beta" \| "gamma" \| "maxhide"` | `"alpha"` | **Only which file the browser fetches.** With substitutions off all four faces draw identical outlines, so this is a bandwidth choice, not a protection one. |
| `weight` | cut name or `1..1000` | inherit | The same six real cuts, the same nearest-cut snapping, the same `font-synthesis: none`. |
| `lineHeight` | `number \| string` | inherit | Passthrough. |
| `size` | `string` | inherit | font-size passthrough. |
| `className` | `string` | n/a | Escape hatch. |
| `style` | `CSSProperties` | n/a | Merges **over** the internal scope, so it can override `fontFeatureSettings` — which turns the substitutions back on for text that was never encoded. Documented, unguarded. |
| `children` | `ReactNode` | | Rendered verbatim. |

Any other prop **throws**, same as on `<Shield>`.

**Arbitrary JSX is allowed here and is not on `<Shield>`.** `<Shield>` rejects
anything but a plain string because the encoder cannot see inside a component,
so nested content would ship unencoded inside a block that still looks
protected. Nothing about that applies here: nothing is encoded, hidden or
sealed, so there is no protected form for nested content to fall out of.
`font-family` and `font-feature-settings` both inherit, so a nested `<a>` or
`<em>` picks up the typeface and the substitution-off rule untouched.

### What it deliberately does not do

- **It does not rotate `variant`.** `<Shield>` spreads blocks across
  `alpha`/`beta`/`gamma` because the mapping changes what a scraper reads; here
  nothing is encoded, so rotating would pull a second ~825 KB file onto the page
  to draw the same outlines. Pin `<Shield>` to the variant your `<NonShield>`s
  use and the page downloads one font.
- **It emits no font-load guard and is not covered by `<Shield>`'s.** It does
  not stamp `data-typeface`, which is what the guard's selectors match. A
  missing font therefore leaves `<NonShield>` rendering **the correct words in a
  fallback face** — degraded design, intact content — instead of blanking them
  behind the "Content unavailable" skeleton. Its weights are not seeded into the
  guard either, so a missing `optik-a-800.woff2` used only by a heading cannot
  skeletonise every genuinely shielded block on the page.
- **It shares assets rather than duplicating them.** A page mixing the two
  components emits one `@font-face` stylesheet per family whichever renders
  first, and a `<NonShield>` rendering first does not stop a later `<Shield>`
  emitting the guard it still needs.
- **It is safe inside `"use client"`.** There is no plaintext to leak and no
  dictionary in play, so it emits none of `<Shield>`'s client-render warning —
  which is what lets you put a heading in Optik inside an interactive island.

## Time-based rotation (optional)

Off by default. Turned on, `<Shield>` mixes a **period index** into the same
content hash, so every block gets reassigned when the period rolls:

```jsx
// app/layout.tsx — imported once
import { setRotation } from "@shieldfont/react";
setRotation({ period: "monthly", salt: "example.com" });
```

```jsx
<Shield rotate>per-instance, with the defaults</Shield>
<Shield rotate={{ period: "weekly" }}>per-instance, tuned</Shield>
<Shield rotate={false}>opted out of a site-wide setRotation()</Shield>
```

`period` is `"monthly"` (default, **calendar**-aligned, not 30-day blocks),
`"weekly"` or `"daily"`; `epoch` is the UTC period-0 anchor; `salt` is a
per-site string; `pool` is the variants to rotate through. Everything is UTC, so
build machines in different time zones agree. `"maxhide"` is **always** filtered
out of the pool, even if you pass it — pin it per block instead.

### What rotation actually buys, without the overclaim

**It does not defeat font inversion, and does not slow it down.** All three
mappings are published in `@shieldfont/core`, all three fonts ship here and on
the CDN, and every block names its own variant twice (the `data-typeface` value
and the `@font-face` `src`). Anyone who inverts once holds all three tables
forever; anyone who re-reads the variant per crawl is unaffected.

What it buys is narrower: **a cached substitution table decays silently.** A
scraper that inverted the font once and stored the table decodes the next period
into plausible English that is wrong. Nothing throws, nothing 404s — so there is
no error to trigger a re-crawl. About **two thirds** of blocks change variant at
each boundary. The cost you are adding is recurring attention, not compute.

Only safe where the `@font-face` travels with the HTML, which is what `<Shield>`
does — a static export stays correct forever, because its HTML is frozen with
its own inline `@font-face`. The CDN paste-in tier deliberately has no rotation.

### Rebuilding a past period

Pin the clock. A number **is** the period index, so no key and no backup is
needed — period 14 rebuilt years later is byte-identical:

```js
import { setRotation, periodIndex, variantFor } from "@shieldfont/react";

setRotation({ period: "monthly", at: 14 });            // by index
setRotation({ period: "monthly", at: "2026-03-15" });  // by instant
periodIndex("2026-03-15T00:00:00Z");                   // → 2
variantFor(text, { at: 14 });                          // which variant a block used
```

A published page is self-describing anyway: read `data-typeface` off the
element, apply that public mapping, and because the mapping is an involution,
encoding the decoy returns the original. **Rotation cannot lose your archive.**

## `encodeText`: for places JSX can't go

`<title>`, `<meta>`, attribute values:

```jsx
import { encodeText } from "@shieldfont/react";

export const metadata = { title: encodeText("My protected page title") };
```

Returns a plain encoded string (unset variant auto-rotates by content). Apply the ShieldFont font to that element yourself.

## Self-hosted fonts (and why there's no default CDN)

The component points `@font-face` at **`/fonts`** by default (the copy step above). Change it with `setFontHost`:

```jsx
import { setFontHost } from "@shieldfont/react";
setFontHost("/static/shieldfont");           // or your OWN CDN
```

There is **no default public CDN by design**. A scraping defense must fail *loud*, never silent: if the font can't load, readers would otherwise see decoy gibberish with no signal it's wrong. Self-hosting guarantees the font ships with your build, and the bundled **font-load guard** (inlined, no hydration needed) watches `document.fonts` and, if the font doesn't load within 4 s, visibly replaces every protected element with *"Content unavailable"* and logs a clear console error. Never the raw decoy.

The guard checks **every weight the page actually renders**, not just Regular: the weights `<Shield>` resolved from the `weight` prop, plus a sweep of each protected element's computed `font-weight` for weights that arrive by inheritance or from your own stylesheet. A missing `optik-a-700.woff2` fails exactly as loudly as a missing `optik-a.woff2`, and a page that only uses Black downloads only the Black cut.

> **JS-off caveat:** that font-load guard is **JavaScript**. With JavaScript disabled *and* the font failing to load (e.g. a 404), the guard can't run, and a reader in that state sees the **raw decoy text**. There is no non-JS fallback for this specific case; the fail-loud guarantee holds only where scripts run.

### One `@font-face` block per page, not per `<Shield>`

The `@font-face` `<style>` and the guard `<script>` are page-level assets, so `<Shield>` emits them **once per font family per render pass** rather than once per instance. Under React Server Components that happens automatically: React's `cache()` scopes the bookkeeping to the render pass, isolated per request.

The synchronous renderers (`renderToString`, `renderToStaticMarkup`) install no React cache dispatcher, so there is nothing to scope to and every `<Shield>` emits its own copy. Opt them in by wrapping the render:

```jsx
import { renderToString } from "react-dom/server";
import { withShieldRenderPass } from "@shieldfont/react";

const html = withShieldRenderPass(() => renderToString(<App />));
```

Wrap one render call, and only a synchronous one: `renderToPipeableStream` returns before the tree finishes, so the scope closes early and later shields go back to emitting their own assets. That is deliberate. There is no module-level de-duplication and there never will be, because a static export rendering page after page in one synchronous loop would then ship every page after the first with no `@font-face` and no guard: invisible in the HTML, and a wall of raw decoy text on screen. Duplicated assets cost bytes; missing ones cost the whole guarantee.

## Camouflage (optional, recommended for production)

By default every ShieldFont React page shares the same **neutral** fingerprints (`data-typeface`, `font-family: 'Optik'`, the `optik-*` filenames): nothing that names ShieldFont, but a signature two ShieldFont sites hold in common. `setCamouflage({ hash })` rewrites those shared SSR-visible literals to per-project unique names so two sites share no signature:

```jsx
// Imported once in your root layout:
import { setCamouflage } from "@shieldfont/react";
setCamouflage({ hash: "a8f3" });   // → font-family "Optik a8f3", data-typeface-a8f3, …
```

> [!WARNING]
> **Camouflage also renames the font *files* in the `@font-face` `src`, so you MUST copy each font to its camouflaged filename, or the page fails loud.** With `hash: "a8f3"`, `<Shield>` stops requesting `optik-*.woff2` and instead requests `/fonts/font-a8f3.woff2` (alpha Regular), `/fonts/font-a8f3-beta.woff2`, `/fonts/font-a8f3-gamma.woff2`, **and one file per weight on top of that**: a `weight="bold"` block asks for `/fonts/font-a8f3-700.woff2`. Those files don't exist until you create them; if they 404, the font-load guard replaces every protected element with *"Content unavailable."* The plain `cp …/*.woff2` step from the quick start is **not** enough once camouflage is on.

Camouflaged names follow the same rule as the bundled ones: **Regular keeps the bare prefix, every other cut carries its numeric suffix.** So the full set for one hash is 6 weights x 4 variants = 24 files. Copy every weight of every variant in the auto-rotation pool (all three, because a block can hash to any of them), and repeat for each hash you use:

```bash
SRC=node_modules/@shieldfont/react/fonts
HASH=a8f3

for W in "" -500 -600 -700 -800 -900; do
  cp "$SRC/optik-a$W.woff2" "public/fonts/font-$HASH$W.woff2"          # alpha
  cp "$SRC/optik-b$W.woff2" "public/fonts/font-$HASH-beta$W.woff2"     # beta
  cp "$SRC/optik-c$W.woff2" "public/fonts/font-$HASH-gamma$W.woff2"    # gamma
  # only if you also use <Shield variant="maxhide">:
  cp "$SRC/optik-m$W.woff2" "public/fonts/font-$HASH-maxhide$W.woff2"
done
```

Copying only the Regular cuts is the trap: nothing breaks until the first `weight="bold"` block ships, and then that block alone 404s and blanks to *"Content unavailable."* If you are certain a variant or a weight is never used you can skip its file, but the auto-rotation pool makes that hard to be certain about, and all 24 files together are roughly 16 MB either way.

There's no CLI for this step: pick any short string for the hash and script the copy/rename into your build (e.g. a `package.json` `postinstall`/build script) alongside the build-time encoding you run with [`@shieldfont/core`](https://www.npmjs.com/package/@shieldfont/core).

## Accessibility: read this

> [!WARNING]
> **SEO:** the same property that hides text from scrapers hides it from **search engines**. Protected text is `aria-hidden` gibberish in the DOM, and you can't tell Googlebot apart from an AI scraper, so anything inside `<Shield>` is indexed as decoy, not as your real words. **Don't wrap content you want to rank** (page titles, headings, marketing copy). Wrap only what you're deliberately withholding from machines.

> [!WARNING]
> **A protected block fails WCAG 2.2 SC 1.3.1, with every accessibility feature turned on, and that will not be patched out.** ShieldFont deliberately withholds the real text of a protected block from the page source: the words are not programmatically available until a reader completes an unlock taking **a few seconds** and requiring JavaScript, a modern browser and an https origin. An audit will flag every block you wrap. If the **ADA** (including the Title II web rule for US state and local government), **Section 508**, the **European Accessibility Act / EN 301 549** or the **UK Equality Act 2010** applies to your site, or you claim WCAG conformance anywhere on it, don't put `<Shield>` on content that claim covers. The accessible features below make a protected page **humane**, not compliant, and we will never describe them otherwise. Full statement, including where ShieldFont *is* a reasonable choice: [the accessibility warning](https://github.com/isaqueseneda/shieldfont#-read-this-first-shieldfont-breaks-accessibility).

Protected regions are `aria-hidden="true"`: the DOM text is encoded gibberish, so screen readers, `Ctrl/⌘-F`, copy-paste, and translation tools operate on the gibberish, not the visible words. **This is inherent to the approach** (a font that hides text from machines hides it from assistive tech too), and `aria-hidden` is not configurable — it is set unconditionally and there is no prop to turn it off.

That is the right call and it is still not enough. Un-hiding would make a screen reader voice the decoy: fluent, grammatical, wrong, with nothing to signal that anything is off — worse than silence, because it doesn't announce itself as broken. But silence isn't a fix either. Either way, what a sighted reader perceives is not programmatically determinable, which fails **WCAG 2.2 SC 1.3.1**.

Two things that claim is often stretched into, and neither is true:

- **`aria-hidden` does not put the decoy out of reach.** It governs linear and heading navigation, which is where the silence comes from. NVDA's mouse-tracking and screen-review modes, and touch exploration on iOS and Android, walk the DOM by screen position, so a reader using one of those can still land on a decoy word and hear it. Reported in [#2](https://github.com/isaqueseneda/shieldfont/issues/2).
- **A reader who forces their own font gets no protection from any of this and no warning either.** With Firefox's *"Allow pages to choose their own fonts"* off, a dyslexia-friendly font extension, or some high-contrast setups, the decoy renders in the forced font. The font loaded, so the font-load guard never fires, and `getComputedStyle` still reports the family you asked for, so nothing in the page can detect it. They read fluent, wrong English silently. The **visible wrapper** is the only mitigation that reaches them: [forced fonts](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#forced-fonts-the-one-with-no-signal).

The whole list of what wrapping a block costs a human reader is [what protecting a block breaks](https://github.com/isaqueseneda/shieldfont/blob/main/docs/integration.md#what-protecting-a-block-breaks).

So the fix is not to un-hide, it's to put a real alternative *next to* the block. The **`a11y` prop** renders one outside the hidden region and before it in DOM order, so a screen-reader user reaches it before the silence:

```jsx
<Shield a11y={{ mode: "text" }}>{body}</Shield>                   {/* the real words, time-locked */}
<Shield a11y={{ mode: "text", seconds: 14 }}>{body}</Shield>       {/* 14 is the default; 1..30 */}
<Shield a11y={{ mode: "text", reveal: "visible" }}>{body}</Shield> {/* replace the block on screen */}
<Shield a11y={{ mode: "none" }}>{body}</Shield>   {/* explicit, auditable opt-out */}
```

- `"text"` ships the block's **real words, encrypted into the page**, with a button that grinds out the key in the reader's own browser (a 14-second budget by default, once per block, cached until you next deploy; about 2.5 s measured in Chrome on a desktop). Nothing to generate, nothing to host, no server. **[Full reference: `docs/plain-text-mode.md`](../../docs/plain-text-mode.md)** — read it before changing `seconds`.
- `"none"` renders nothing. **Omitting `a11y` entirely is silent and gets the `"text"` default; what logs one development-time warning per process is turning the alternative off** — `{ mode: "none" }` or `screenReader={false}` — because that is the configuration where assistive technology gets nothing at all. A warning, not an error, so upgrading breaks nothing.

### `ShieldA11y` options

All five apply to `mode: "text"`, which is the only mode that renders anything.

| Option | Type | Default | What it does |
|---|---|---|---|
| `seconds` | `number` | `14` | Grind budget on the reference device — 120,000 squarings/second, an honest median (a mid-range phone, or Safari, which trails V8), not a fast desktop. Range **1..30**; `sealText` throws outside it. Read the warning below before raising it. |
| `reveal` | `"hidden" \| "visible"` | `"hidden"` | Where the unlocked words go. `"hidden"` puts them in the accessibility tree clipped off-screen and leaves the encoded block on screen untouched — a sighted reader sees nothing happen, because they can already read it. `"visible"` replaces the encoded block on screen: a layout shift, in exchange for selection, copy-paste and browser translation of the real text for everyone. |
| `label` | `string` | *auto* | Overrides the button's accessible name. The default is *"Uncover the original text (up to 14 seconds)"* — no paragraph ordinal, because one press uncovers every protected block on the page, and naming one paragraph would describe a scope the button does not have. **Never put the protected words in it:** the label ships in the HTML. |
| `note` | `string` | *auto* | Overrides the explanatory sentence. The default long sentence is spoken **once per page**; later blocks get a short form, because hearing the same explanation before every paragraph is an obstacle, not thoroughness. |
| `visualHidden` | `boolean` | **`true`** | Clips the control with **clip-path**, never `display:none` (which would remove it from the accessibility tree too — the exact bug this prop exists to fix). **Only applies where `wrapper` is off**, because the drawn wrapper replaces the clipped control outright; passing it together with a drawn wrapper throws rather than being quietly ignored. See the focus warning below. |

What the reader actually gets, in the default configuration: a note, then a button that says what it does and how long it may take; a `<progress>` element that assistive tech can query but that does not chatter; a polite status line that says nothing at all while it is empty; and, when the work finishes, the words themselves — announced automatically on arrival, and a real Tab stop, so they can be re-read as often as the reader wants. The wrapper is `role="presentation"` and carries **no group role**: with one, VoiceOver read out roughly twenty words of "you are currently on a button inside of a group" scaffolding in front of every block.

> [!NOTE]
> **`mode: "text"` renders no link.** The `0.2.0` shape was `{ mode: "text", href }`, pointing at a plain-text copy on its own URL; it was removed, along with every other link this layer ever offered, because a URL cannot be offered to a screen reader without being offered to everyone else and the same crawl that reads the decoy reads the link sitting beside it. The mode that replaced it inverts that trade: the words are in the page but **closed**, and the key is the answer to a time-lock puzzle — T sequential squarings that cannot be parallelised, so a crawler with a thousand GPUs still pays them one at a time, per block. Sealing costs about 64 ms per payload, and a block is four of them — one real, three decoys — so about 261 ms per block; opening costs the reader their 14-second budget, and they grind exactly one payload. Nobody is denied the text; the accessible path simply stops being the *cheapest* path in.

> [!WARNING]
> **Under `wrapper={false}` the control is invisible, and a sighted keyboard user pays for it.** The drawn wrapper is the default and its Copy and Uncover buttons are real, on screen and `:focus-visible`. Turn it off and `visualHidden` takes over at its `true` default: someone navigating by keyboard **without** a screen reader Tabs into a control they cannot see and their focus indicator vanishes — a **WCAG 2.2 SC 2.4.7** failure. That is deliberate, and it was the shipped default in 0.3.0 and 0.3.1; the reasoning was that a sighted reader can already read the block, so an on-screen widget offering to unlock it is unexplained noise. The usual remedy (clipped until focused, visible while focused) is not applied, because the control was asked to be invisible. Leave `wrapper` at its default, or pass `visualHidden: false`, to take the other trade.

> [!WARNING]
> **Difficulty has a ceiling, and `seconds: 14` is at it.** A crawler that wants your words can render the page and OCR the pixels for roughly five seconds of server CPU per page whether or not this feature exists — that is the floor on ShieldFont's protection, and no cryptography raises it. The goal is therefore *not cheaper than OCR*, not "expensive". Past that point, extra difficulty buys **nothing** (a crawler just takes the cheaper door) and is paid for entirely by disabled readers waiting longer. `sealText` refuses anything above 30 or below 1. If you are tempted to raise it to "harden" a page, that is the mistake this paragraph exists to stop.

**What this does not fix, and we won't pretend otherwise:**

- **OCR is still cheaper** for a crawler that wants your words. `mode: "text"` stops the accessible path being a *shortcut*; it does not stop scraping and it is not a wall.
- **A reader who needs `mode: "text"` waits.** Everyone else has the words instantly. That is unequal access however carefully it is engineered — a compromise, not a solution.
- **`mode: "text"` needs JavaScript**, plus `BigInt` and `crypto.subtle`, and a secure (https) origin. Everything else in ShieldFont works with JS off; this does not. `crypto.subtle` is also missing on insecure origins, so plain `http://` breaks it (the control says so rather than blaming the browser).
- **A sighted keyboard user loses their focus indicator under `wrapper={false}`** (WCAG 2.2 SC 2.4.7, above), where the control is clipped off-screen. The default draws it; `visualHidden: false` is the other opt-out. None of that makes a protected block conformant — it still fails SC 1.3.1, and that is the mechanism.
- **Once revealed, the plaintext is in the DOM.** A crawler that runs a real browser, presses the button and waits gets the words — having paid for them, which is the deal.

**Where the testing stands, exactly.** The text mode is exercised under `@guidepup/virtual-screen-reader` in Playwright, driven against **real NVDA on a Windows runner in CI on every commit**, and driven by hand with **real VoiceOver on macOS** — which is what found the group chatter, the announcements that cut each other off and the revealed text that could not be re-read, all since fixed. **JAWS remains unverified.** An axe-core scan, before and after the unlock, reports zero violations across WCAG 2.0/2.1/2.2 A and AA. **That is not a pass and not conformance:** axe covers roughly a third of WCAG and cannot judge whether the words handed to a screen reader are the words on the screen, which is the whole question here. Beside it, `npm run test:style` measures the drawn wrapper — contrast, hit targets, overflow, perceivable boundaries — inside seventeen deliberately hostile host pages (Tailwind Preflight, `button { all: unset }`, forced-colors, 10px and 24px roots, RTL, four light/dark combinations); sixteen come back clean and one is a documented known limit, where the host's own body text is already below the contrast line and the wrapper, which inherits the host's text colour on purpose, cannot be more legible than the page it sits in. That settles seventeen hosts and says nothing about the eighteenth. There is no published test page.

Better ideas here are the most useful contribution anyone can make to this project. Meanwhile: don't wrap navigation, form labels, or essential interactive text.

## Version

```jsx
import { VERSION } from "@shieldfont/react";   // re-exported from @shieldfont/core
console.log(VERSION);   // "0.3.0" — the package version
```

Use it to confirm which encoder you're running. It is **not** a dictionary
stamp: the fonts bundled here are deliberately version-neutral (their name table
reads `Version 1.0`, so nothing in your served bytes names a dictionary
generation), and the shipped mappings carry their own `_meta.version`, currently
`0.1.0`. Read a mapping's generation with `mappingMeta()` from
[`@shieldfont/core`](https://www.npmjs.com/package/@shieldfont/core) rather than
inferring it from `VERSION`.

## License

AGPL-3.0-or-later. The bundled default fonts use **Optik, © Playtype, used
with Playtype's permission** — whether or not the word substitutions are
active (which is what allows `<NonShield>`), provided the use stays within
the ShieldFont packages and tooling. They are **not** under OFL. The SIL Open Font License 1.1 applies only to
fonts you build yourself from the OFL base fonts (Inter, Syne Mono, Young Serif).
See [NOTICE](./NOTICE).
