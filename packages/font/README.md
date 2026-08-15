# @shieldfont/font

The **no-build / CDN** distribution of ShieldFont: the web fonts, a paste-in
`shieldfont.css`, and a browser `shieldfont-encoder.js`.

- Building in Node? Use [`@shieldfont/core`](https://www.npmjs.com/package/@shieldfont/core).
- **Shipping a site?** Use [`@shieldfont/react`](https://www.npmjs.com/package/@shieldfont/react):
  the recommended route, and the only package that ships more than one font weight.
- **Static site / Wix / WordPress / plain HTML?** You're in the right place: a
  `<link>`/`@import` and no toolchain. This tier is for learning, and for pages
  where a build step isn't an option.

> [!CAUTION]
> **ShieldFont is a v0 alpha.** This package ships none of the screen-reader
> machinery `@shieldfont/react` has, so that part is yours to build. If the ADA
> (including the Title II web rule), Section 508, the European Accessibility Act
> / EN 301 549 or the UK Equality Act 2010 applies to your site, or you claim
> WCAG conformance anywhere on it, don't use this on content that claim covers.
> Details: [Accessibility](https://github.com/isaqueseneda/shieldfont#accessibility).

## Install via CDN (jsDelivr, served from npm: the repo can stay private)

```html
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css">
```
or in your CSS:
```css
@import url("https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css");
```
Always pin the version (`@0.3.5`), never `@latest`: a site that paste-installs a
URL is pinned to whatever it pasted.

## Three steps

1. **Encode** your text: the page source must hold the decoy words. Use the web
   encoder at <https://shieldfont.org/encoder>, or `encode()` from
   [`@shieldfont/core`](https://www.npmjs.com/package/@shieldfont/core) in a build step.
2. **Add** the CSS above.
3. **Wrap** the encoded text: `<p class="tk9">…encoded…</p>`.

`.tk9` renders the default **alpha** variant (what the web encoder emits).
`.tk9-b` / `.tk9-c` / `.tk9-m` pin the other variants (beta / gamma / maxhide) if you
encoded with one of them. The class is a neutral token: rename it in your own CSS if
you like.

## Weights: this package is Regular only

**This package ships one weight.** The shielded files in it, `optik-a.woff2`,
`optik-b.woff2`, `optik-c.woff2` and `optik-m.woff2`, are the four *mapping
variants* (alpha / beta / gamma / maxhide) at **Regular, `font-weight: 400`**.
The letter picks the dictionary, not the weight. There is no Medium, DemiBold,
Bold, ExtraBold or Black here.

So `font-weight: bold` on a `.tk9` element does not get you a bold ShieldFont.
There is no heavier file to fetch, so the browser draws a synthetic bold of the
Regular cut, and a synthesised weight distorts the composite glyphs enough to
give away that decoys are in play. Add `font-synthesis: none` to your own rule
if you would rather it stayed at Regular:

```css
.tk9 { font-synthesis: none; }
```

Set headings and bold emphasis in an ordinary font, and keep the shielded
paragraphs at Regular.

**Italic is the one style that does ship here.** Every file above has an
`-italic` companion at Regular — `optik-a-italic.woff2`,
`optik-b-italic.woff2`, `optik-c-italic.woff2`, `optik-m-italic.woff2`, and
`optik-n-italic.woff2` for the neutral cut. Each is declared under the *same*
family name as its upright, so `<em>`, `<i>`, `<cite>` and a plain
`font-style: italic` inside a `.tk9` element resolve to a real drawn italic
through ordinary CSS font matching, with nothing to opt into. (A family of its
own would have left them nothing to resolve to: these faces are always used
with `font-synthesis: none`, so the browser is not allowed to slant the upright
as a fallback — it would simply render upright, silently.) What you cannot have
on this tier is a **bold** italic, for the same reason you cannot have a bold.

**If you need real weights, use [`@shieldfont/react`](https://www.npmjs.com/package/@shieldfont/react).**
It bundles six genuine static cuts of Optik for every mapping variant:

| Weight name | CSS `font-weight` | Playtype cut |
|---|---|---|
| `regular` | 400 | Optik Regular |
| `medium` | 500 | Optik Medium |
| `demibold` | 600 | Optik DemiBold |
| `bold` | 700 | Optik Bold |
| `extrabold` | 800 | Optik ExtraBold |
| `black` | 900 | Optik Black |

Every cut encodes identically: for a given variant the word substitutions and
digit rules are the same at all six weights, so the weight changes only how the
text looks. Each of those six ships a real drawn italic as well, so that package
carries twelve faces per variant. There is no variable font anywhere in
ShieldFont, and nothing is ever synthesised.

## The encoder module (for tooling — never for your page content)

> [!WARNING]
> **Encoding in the browser protects nothing.** Scrapers read the HTML your
> server sent; they do not run JavaScript. If the encoding happens in the
> visitor's browser, then the page you served contained your **plain English**,
> and that is exactly what a crawler takes — while the page still looks
> protected to you. Encode before the HTML is served: in a build step, or with
> `@shieldfont/react` during server render. See
> [Where the encoding happens](https://github.com/isaqueseneda/shieldfont/blob/main/docs/where-encoding-happens.md).

The module is published so you can build **authoring tools** with it — an
encoder box, a preview pane, a CMS plugin that encodes before saving. In every
one of those the output is written back to your source, not rendered live to a
visitor.

```html
<!-- An authoring tool: paste text, copy the encoded result into your CMS. -->
<script type="module">
  import { encode, alpha } from
    "https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont-encoder.js";
  document.querySelector("#out").textContent = encode("Your text here", alpha);
</script>
```

## Honest limitations

- Protected text is a **decoy in the page source** → search engines index the
  decoy. Don't wrap content you need ranked. You can't tell Googlebot from an AI
  scraper.
- Rendering needs the font to load. `font-display:block` means readers never see
  the decoy flash; but a pure-CSS page has **no JavaScript fail-loud guard**, so
  if the font never loads the decoy eventually shows. Need fail-loud behavior?
  Use [`@shieldfont/react`](https://www.npmjs.com/package/@shieldfont/react).
- Copy-paste yields the decoy text. Screen readers need an alternative you
  supply yourself on this tier: set `aria-hidden` on the protected block and put
  the real words beside it in a form a scraper cannot just fetch. **Never link a
  plain-text copy** — a URL in the HTML is a one-line bypass. `@shieldfont/react`
  ships this as the `a11y` prop; the CDN tier does not.
- **Regular (400) only — one weight, both styles.** Bold, medium and the rest
  are a `@shieldfont/react` feature; nothing on this tier renders a heavier cut.
  A real italic *does* ship, at Regular, so `font-style: italic` works. See
  [Weights](#weights-this-package-is-regular-only) above.

## Versioning

Every font file self-reports its generation in the name table
(nameID 5 reads `Version 18.0`, the mapping generation the font was built
against). This npm package is versioned separately: currently `0.3.5`.

## License

Code: **AGPL-3.0-or-later** (`LICENSE`). Fonts: **Optik, © Playtype, used under
the ShieldFont–Playtype partnership.** The bundled default variants are **not**
under OFL (see `NOTICE`). SIL OFL 1.1 (`LICENSE-FONTS`) applies only to fonts you
build yourself from the OFL base fonts.
