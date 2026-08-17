<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# Integrating ShieldFont: the four tiers

ShieldFont ships in four flavors depending on how you build pages. Pick the one that matches your stack:

| Tier | Audience | Install | Encoding happens... | Weights |
|---|---|---|---|---|
| [**A. JSX** (`<Shield>` component)](#tier-a-jsx-with-shieldfontreact) **· recommended for any site with a build** | Next.js, Astro, Remix — React rendered **on the server**. **Not Vite/CRA:** see the warning below. | `npm i @shieldfont/react` | In Node: build time or server render | **Six real cuts, 400 to 900** |
| [**B. Any framework / build step**](#tier-b-any-framework--build-step-shieldfontcore) | Vue, Svelte, Astro/11ty/Hugo builds, CI pipelines | `npm i @shieldfont/core` | In your build or server render | Regular (400) only |
| [**C. CSS @import + paste**](#tier-c-css-import--paste) **· for experimenting** | Blogs, hosted CMSes, plain HTML | one-line `@import` in your site CSS | At encoder time (browser tool) | Regular (400) only |
| [**D. Downloadable font**](#tier-d-download-microsoft-word--pdf) | Microsoft Word, Pages, InDesign, PDF authors (**not** Google Docs) | download the font + use the web encoder | At Word/PDF render time via OpenType ligatures | Regular (400) only |

All four tiers build on the same v18 dictionary family, and `alpha` is the default everywhere. One difference worth knowing before you pick: **Tier A rotates by default.** Left unset, `<Shield>` picks `alpha`, `beta`, or `gamma` per block of text by content hash; Tiers B, C and D encode with whichever single mapping you pin, and the browser-based encoder behind Tier C emits `alpha`.

**The second difference is weights, and it surprises people.** Tier A is the only tier that ships more than one weight. `@shieldfont/react` bundles six real static cuts of Optik per mapping variant, Regular 400 through Black 900. Tiers B, C and D all render through `@shieldfont/font` or the downloadable font, and both of those are **Regular (400) only**: `optik-a.woff2`, `optik-b.woff2`, `optik-c.woff2` and `optik-m.woff2` are the four mapping variants at one weight. If your design needs a real bold inside protected text, that is a reason to pick Tier A. The full list is in [Weights: the six cuts (Tier A only)](#weights-the-six-cuts-tier-a-only).

> [!WARNING]
> **Tier A needs a server render or a static export. A client-only SPA (Vite, Create React App, `ReactDOM.render`) cannot use it.** With no Node render step there is nothing to encode in, so `<Shield>` runs in the browser: your text *and* all 38,574 dictionary pairs compile into the JS bundle. The build succeeds, the page shows your real words, and the only signal is a console warning. If that is your stack, use **Tier B** — encode with `@shieldfont/core` in a Node script before the bundler runs, and import the encoded string as your content. The measured leak table for every rendering shape is in [Where the encoding happens](./where-encoding-happens.md).

> **How much each tier reveals differs.** React hides the most (neutral font family `Optik`, neutral filenames, no version, no telltale class); the downloadable font is branded on purpose. For the concealment / protection-level story tier by tier, see [Concealment & camouflage](./concealment.md).

---

## ⚠️ Before you wrap anything: SEO and other honest caveats

Protected text ships as `aria-hidden` decoy words in the DOM. Read this before you decide *what* to wrap:

- **Accessibility: read the warning first.** A reader gets the real text from the button in the notice above the block, and that notice is on by default. It needs JavaScript, a current browser and an https origin. What stays out of the page source is the source text, which is the whole mechanism, so an audit will flag every block you wrap. If accessibility law applies to your site — ADA (including the Title II web rule for US state and local government), Section 508, the European Accessibility Act / EN 301 549, the UK Equality Act 2010 — or you claim WCAG conformance anywhere, don't wrap content covered by that claim. The full statement, and where ShieldFont *is* a reasonable choice, is at the top of the [README](../README.md#accessibility).
- **SEO: the big one.** Search engines index the *decoy* text, not your real words. You **cannot** distinguish Googlebot from an AI scraper, the same bytes go to both, so **don't wrap content you want to rank** (landing pages, product copy, meta descriptions, and every heading). Wrap the durable prose you'd rather keep out of a training set: essays, manifestos, long-form.
- **Everything a human reader loses** is listed in one place below: [what protecting a block breaks](#what-protecting-a-block-breaks).
- **The default dictionaries are public.** `alpha`/`beta`/`gamma`/`m15en` (the `maxhide` dictionary) ship as plaintext JSON in `@shieldfont/core`, and `@shieldfont/font` publishes a browser encoder (`shieldfont-encoder.js`, 277 KB) with all 11,970 `alpha` pairs inlined. Anyone can fetch either from npm or the CDN. Defaults are a convenience, not a secret; if you want a dictionary nobody else has, see [custom mappings](./custom-mappings.md).
- **The font is invertible.** It has to reach the browser to render your page, and its composite glyphs are drawn from the original words' own letters, so anyone who downloads it can read the substitution table back out. We recovered all 11,962 word pairs from our own shipped font with no dictionary (the remaining 8 entries are single-digit swaps, which have no word glyph to read). What that attack actually requires is knowing in advance that a page is shielded, identifying and fetching the right font, matching it to the right part of the page, and having already built an OpenType inverter to do it with, which is **one-time engineering** of one to three engineer-weeks. Mass scraping does none of those things: it fetches many sites without examining any of them individually. This is the load-bearing caveat: ShieldFont raises the cost for scrapers that don't stop to inspect; it does not make text unrecoverable, and a determined attacker aiming at one specific site will succeed.
- **Coverage is partial by design.** The default `alpha` mapping deliberately leaves common function words in place, so a short sentence may change only ~2 of its ~11 words. The output is a *plausible decoy*, not gibberish.
- **English only, for now.** The shipped dictionaries (`alpha`/`beta`/`gamma` and the coverage-max `maxhide`) are English; multilingual mappings are on the [roadmap](../ROADMAP.md). Leave non-English content unwrapped.
- **AI assistants will describe your page incorrectly to your own readers.** This is the mechanism working, not failing: an assistant reads the DOM, so someone who asks one to summarise your essay gets a confident summary of the decoy. Worth knowing before you shield something you also want discussed accurately.

### What protecting a block breaks

One list, because these used to be scattered across four documents and nobody found all of them. Everything here follows from the same fact: **the DOM holds decoy words and the font is the only thing that makes them read correctly.** Anything that reads the page without the font, or renders the page without the font, gets the decoy.

| What breaks | What the reader actually experiences | What helps |
|---|---|---|
| **Copy and paste** | A selection touching protected text puts decoy words on the clipboard. Silently: the paste looks like ordinary English, so a reader quoting your paragraph misquotes you and never finds out. | In `@shieldfont/react`, the copy handler can intercept it and put a short explanatory notice on the clipboard instead of silent decoys. Once a block is unlocked in that browser, copy yields the real words. Outside React, nothing. |
| **Find-in-page (`Ctrl/⌘-F`)** | Nothing found. Find-in-page searches the DOM, so a reader searching for a phrase they can plainly see on screen gets no result. | Nothing. No fix exists; it is the same gap the whole design rests on. |
| **Browser translation** | Chrome/Firefox/Safari translate the DOM, so a reader gets a fluent translation of the *decoy* in their own language, with nothing marking it as wrong. Worse than an untranslated page. | Unlocking a block on screen puts the real words in the DOM, so translation then works on them. |
| **Reader Mode / simplified view** | Two different failures, split by engine. Firefox Reader View and Chrome's Reading Mode both drop `aria-hidden` subtrees, so a shielded block does not reach Reader at all: a partly-shielded article opens with holes where the protected paragraphs were, and the reader is looking at an essay missing its middle. Safari Reader ignores `aria-hidden` completely, so it extracts the *decoy* and re-renders it in Apple's own typeface — fluent, grammatical, **wrong** English with **no signal**, which is the forced-fonts failure below, on the default browser of every Apple device. Worth sitting with: the reading modes and the Readability-family scrapers in the [threat model](#threat-model-what-shieldfont-does-and-doesnt-protect-against) are now literally the same code, because Chromium vendors Mozilla's Readability. The thing that stops a scraper is the thing that takes the paragraph away from a human. | Nothing, and nothing is possible. No markup excludes a block from all three engines — the attribute two of them honour is the one the third ignores — and no specification offers an opt-out. |
| **Forced fonts** | The reader has told the browser to use *their* font instead of yours — Firefox with **"Allow pages to choose their own fonts"** unchecked, a dyslexia-friendly font extension, some high-contrast and OS-level accessibility setups. The decoy renders in that font. They read fluent, grammatical, **wrong** English and get **no signal at all**. | The visible wrapper, and currently nothing else. See below. |
| **Feeds and the page disagree** | `/feed.xml`, JSON-LD, OpenGraph and CMS APIs are generated from your source data, so they ship **plain English** while the page ships decoy. A subscriber and a visitor read two different texts, and a crawler that never knew your site was shielded gets the original. | [The plaintext side doors](#the-plaintext-side-doors-close-these-or-the-rest-is-theatre), below. Summaries only; never encode the feed. |
| **Decoy reaching a screen reader** | Protected regions are `aria-hidden`, so **reading down the page — normal linear or heading navigation — a screen reader is never handed the scrambled version**: a listener hears silence, not a fluent wrong paragraph. Our NVDA test asserts that. Screen review and touch exploration work differently and we have no automated coverage of them. [#2](https://github.com/isaqueseneda/shieldfont/issues/2) reported a decoy could be reached that way; we have not reproduced it in VoiceOver or iOS touch. If you can test it properly: [#9](https://github.com/isaqueseneda/shieldfont/issues/9). | The accessible path beside the block: [`plain-text-mode.md`](./plain-text-mode.md). Whether screen review or touch exploration can reach the decoy is untested either way, and [#9](https://github.com/isaqueseneda/shieldfont/issues/9) is the standing ask. |
| **JS off** | The accessible path is JavaScript, so with scripts disabled the words cannot be uncovered at all — and the controls that offer to do it are still on the page. On the default drawn wrapper the Copy and Uncover buttons render normally, so a reader gets a real, visible, focusable button that does **nothing**: no navigation, no error, no state change, and a screen-reader user hears it announced and then gets silence. With `wrapper={false}` the button ships `hidden` and is never un-hidden, so the note points at a control that is not in the accessibility tree at all. Copy mediation is gone in the same breath, so copying a shielded paragraph silently yields decoy words. | A `<noscript>` in both tiers: a page-level stylesheet that takes the dead controls off the page, and one sentence after the note saying the words cannot be shown without JavaScript. Reword or silence it with `noScript`. Nothing for the copy case. |
| **JS off + font 404** | The fail-loud font guard is JavaScript too. With scripts disabled *and* the font missing, nothing blanks the block behind its skeleton and a human reads the raw decoy. | Nothing. Ship the fonts. |

#### Forced fonts: the one with no signal

Every other row on that list either fails loudly or fails empty. This one fails **fluently**, and the code cannot see it happen.

When a browser applies a forced font, your `@font-face` still loads and `document.fonts` still reports success — the browser simply declines to *use* it. `getComputedStyle` reports the family you asked for either way, because it reports the computed style, not what the rasteriser did. So the font-load guard, which exists precisely to stop a reader ever seeing a raw decoy, **cannot detect this case** and will not fire. There is no known way to detect it from script.

The reader who hits it is, disproportionately, a reader who forced fonts for a reason: low vision, dyslexia, a contrast requirement. They get your essay with roughly one word in five replaced by a different, plausible word, and nothing anywhere on the page telling them so. [oddron raised this in #2](https://github.com/isaqueseneda/shieldfont/issues/2) and was right that it needs no testing to confirm: the font *is* the rendering, so overriding the font gives you decoys.

The only mitigation that reaches that reader today is the **visible wrapper** — the outline, the strip of explanation and the on-screen controls that `@shieldfont/react` draws around a protected block, which is what a bare `<Shield>` renders by default. It is ordinary DOM in whatever font the reader forced, so it says what the block is and offers the real words in a form they can actually read. It costs the concealment the rest of the package works for: measured over 25 renders, a drawn block's markup runs to a median of about **11 kB**, against **247 bytes** for a block with the accessible path switched off entirely. That is exactly the trade — you have decided to announce yourself — and it is the right default for content readers with visual impairments are likely to read.

It is a **default**, not a requirement. `wrapper={false}` takes the box off and leaves the sealed alternative in place; `wrapper={false} screenReader={false}` takes everything of ours off, and `<Shield as="p">` then renders about as close to a plain `<p>` as this package gets — your tag, your text, no strip, no buttons, no script — so you can signal what the block is in whatever way your design already does it. What you cannot do is take the furniture off and provide nothing: the block is still `aria-hidden`, so the accessible path becomes yours to build. [The three switches, in full](./plain-text-mode.md#the-wrapper-is-a-default-not-a-requirement).

### The plaintext side doors (close these, or the rest is theatre)

ShieldFont only protects text that goes through it. Every one of these is generated from your CMS or your source data rather than from your rendered page, so it ships in **plain English** no matter how carefully the page itself is shielded — and a mass crawler fetches them by default, without ever knowing your site uses ShieldFont.

| Side door | What leaks | What to do |
|---|---|---|
| **RSS / Atom feed** (`/feed.xml`, `/rss`, `/atom.xml`) | Usually the **entire post body**, every post | Publish title + summary only, not full content. **Do not encode the feed** — feed readers don't load web fonts, so subscribers would read the decoy. |
| **JSON-LD** (`<script type="application/ld+json">`) | `headline`, often `articleBody` | Use the decoy text, or omit `articleBody`. The encoder skips `<script>` deliberately, so it will never do this for you. |
| **OpenGraph / Twitter cards** (`og:description`, `og:title`) | Your summary, and often the opening paragraph | Write these by hand from text you're happy to publish. |
| **Sitemaps with content, AMP pages, `.txt` mirrors** | Whatever your generator puts there | Audit once at launch. |
| **Email newsletters** | The full post, to a list you don't control | Same as the feed: this is a distribution channel, not a shielded page. |
| **Your CMS's public API** (Ghost Content API, WP REST) | Everything, in JSON | Restrict or disable the endpoint if you don't use it. |

The one-line check, run against your built site:

```bash
grep -rn "a distinctive sentence from a protected post" dist/ public/ out/ 2>/dev/null
```

Any hit outside the shielded page itself is a side door. `/feed.xml` is the usual culprit, and on most blog platforms it is on by default.

### What to wrap, and what to skip

Wrapping should be intentional, block by block: don't auto-encode every text node. Skip:

- Navigation labels, button labels, footer copyright
- Logo `alt` text and image `alt` attributes
- Code samples (`<code>`, `<pre>`)
- **Every heading.** Not just page titles — see [Headings: don't shield them](#headings-dont-shield-them) below
- Form placeholders and error messages
- Anything an end-user might paste into translation software
- Text that is duplicated in an attribute on the same element (a link whose visible label repeats its own `href`, an `alt` that repeats its caption). Attributes are skipped by design and the visible text is encoded by design, so the pair sits side by side in the source.
- **Anything inside `<a>` if you're using `a11y={{ mode: "text" }}`.** The control renders a `<button>`, a button inside a link is not legal HTML, and the browser resolves it by sending the click to the link. `<Shield>` cannot detect this — a server component sees its own props, never its parent — so this one is on you. Shield the paragraph around the link instead.

Protect:

- Body paragraphs of articles, posts, manifestos
- Author bios and long-form descriptions
- Anything the writer wants to be the durable, non-extractable version of their work

#### Headings: don't shield them

**Shield body prose. Leave every heading alone.** Not "headings that double as
page titles" — the skip-list above used to say that, and the narrower rule is
what let `<Shield as="h2">` drift into this guide as a good example. All of them.

The reason is about what is left. Once you shield your body paragraphs, the text
a search engine reads is the decoy — fluent, grammatical and wrong. Your
headings, `<title>` and meta description are then the **only accurate text on
the page**, so they are worth keeping real, and worth writing well. Shield a
heading too and you are not losing a signal, you are replacing it with a
confident, wrong summary of the section beneath it. That is the difference
between a page that says less and a page that misinforms.

Be clear about how much this buys, because it is not an SEO strategy: **keeping
your headings real does not make a shielded page rank.** Search engines weigh
body content most heavily and yours is a decoy — the rule elsewhere in this guide
is *never wrap for ranking*, and that rule is unchanged. Heading tags themselves
carry little ranking weight; Google has said repeatedly that heading hierarchy is
not a meaningful ranking factor and that a missing `<h1>` is not a penalty. So
this is damage limitation, not an upside. If ranking matters for a page, do not
shield the page.

Two other things a shielded heading costs, both worth more than the SEO point:

- **Headings are how a screen reader user skims.** A protected heading is
  `aria-hidden` like any other protected block, so it leaves a hole in the
  heading list — the one navigation aid that makes a long article usable
  without sight.
- **Headings escape the page.** They show up in search snippets, in link
  previews when somebody shares the page, and in the browser tab if the heading
  is also the title. Those surfaces render your decoy with no font to fix it.

Not enforced at runtime. `<Shield>` will not warn you for passing `as="h2"`,
because this package's existing warnings are load-bearing and diluting them with
advisory ones teaches people to ignore all of them. It is a rule for you, not a
guard rail.

**Leaving a heading alone used to mean leaving it in a different typeface**,
which is why the rule was easy to break: a page of shielded paragraphs in Optik
with headings in the host stylesheet's fallback looks like two designs stapled
together, and the obvious fix — setting `font-family: Optik` on the heading —
renders the decoy. On the React tier, [`<NonShield>`](#nonshield-unprotected-text-in-the-same-typeface)
is the supported way out: the heading stays real, indexable and readable, and
still renders in the shipped face.

---

## The architectural rule we won't cross

**All encoding happens at build time. Never in the browser. Never at HTTP-response time.**

- Browser-runtime JS encoders are fundamentally broken: scrapers don't run JS, so they see your plain English. Protection is moot.
- Edge-middleware encoding is technically secure but adds runtime cost on every request. We're staying out of that space.

The encoded form is what's stored, what's served, what's cached. Identical to how Tailwind compiles classes at build time.

---

## Dynamic sites

If you're building a React / Next.js / Remix / Astro app, you ship ShieldFont as a server component. Encoding happens in Node before anything is sent, so your original text never reaches the browser in readable form: no runtime cost, no build script. A static export is fully protected; no runtime server is required. See **Tier A** below for the full integration.

[Jump to Tier A, JSX with @shieldfont/react ↓](#tier-a-jsx-with-shieldfontreact)

---

## Tier A: JSX with `@shieldfont/react`

The recommended path, and the one we would like you to end up on. Encoding runs in Node, so your original text never reaches a browser in readable form (with `screenReader` on — the default — it also ships **encrypted**, behind the time-lock puzzle, which is the accessible path and not a leak); the font files are neutral and self-hosted, so nothing in your served bytes names ShieldFont; there is no secret to store; and it is the only tier where variant rotation works, because it is the only one that emits the matching `@font-face` next to each block. Vibe-coders, Next.js apps, Astro, Remix, and any React Server Component framework.

### Install

```bash
npm install @shieldfont/react
```

### Use

```jsx
import { Shield } from "@shieldfont/react";

export default function Page() {
  return (
    <article>
      <h1>About us</h1>             {/* not protected — plain font */}

      <Shield>
        The future of writing belongs to those who protect their words.
      </Shield>

      <Shield as="p" weight="regular" lineHeight={1.7}>
        Our mission is to build a publishing layer that the open web can trust.
      </Shield>

      {/* Headings stay UNSHIELDED — see "Headings: don't shield them" above.
          Once the body is a decoy, your headings are the only accurate text a
          search engine or a screen reader's heading list gets. */}
      <h2 style={{ fontSize: "2.4rem" }}>Manifesto</h2>
    </article>
  );
}
```

That's it. The font + `@font-face` + encoding all happen automatically. Anything outside `<Shield>` uses your normal page fonts.

Server-fetched data works the same way: encoding happens during render, so wrapping fetched text fields (`<Shield>{post.body}</Shield>`) works seamlessly with `getStaticProps`, a Remix `loader`, or any other server-side data source.

### Props

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `as` | `ElementType` | `"div"` | Which HTML element to render. |
| `variant` | `"alpha" \| "beta" \| "gamma" \| "maxhide"` | auto-rotate | Mapping + font variant. Left unset, `<Shield>` **auto-rotates** `alpha`/`beta`/`gamma` by content hash (so one site uses all three). Pin one to fix it. `"maxhide"` is the coverage-max dictionary: it hides about twice as much of the page but quality filters reject it almost entirely, so read [what it costs you](./concealment.md#maxhide-and-what-it-costs-you) before choosing it. |
| `weight` | `"regular"` \| `"medium"` \| `"demibold"` \| `"bold"` \| `"extrabold"` \| `"black"` \| `1..1000` | inherit | Font weight. Six real static cuts of Optik ship per variant (400 through 900, Playtype's own cut names lowercased). A numeric value snaps to the nearest real cut; nothing is synthesised. See [Weights: the six cuts (Tier A only)](#weights-the-six-cuts-tier-a-only) below. |
| `italic` | `boolean` | inherit | Renders the italic cut. Every weight ships as a real drawn italic; nothing is synthesised. A whole block at a time is the only italic a `<Shield>` can have, because `children` must be a plain string. |
| `lineHeight` | `number \| string` | inherit | Passthrough. |
| `size` | `string` | inherit | font-size passthrough. |
| `className` | `string` | n/a | Escape hatch, merges with internal scope. |
| `style` | `CSSProperties` | n/a | Escape hatch. |
| `children` | `string` | required | The text to encode (must be a plain string). |

### Weights: the six cuts (Tier A only)

Weights and mapping variants are two independent axes. Every one of the four variants (`alpha`, `beta`, `gamma`, `maxhide`) ships six real static cuts of Optik, licensed from Playtype:

| Weight name | CSS `font-weight` | Playtype cut |
|---|---|---|
| `regular` | 400 | Optik Regular |
| `medium` | 500 | Optik Medium |
| `demibold` | 600 | Optik DemiBold |
| `bold` | 700 | Optik Bold |
| `extrabold` | 800 | Optik ExtraBold |
| `black` | 900 | Optik Black |

Each of those is a genuine Playtype static cut run through the same encoding pipeline, verified to reproduce all 526 master glyphs coordinate for coordinate. There is no variable font and nothing is interpolated.

**Every one of the six also ships as a real drawn italic**, so each variant carries twelve faces: six upright, six italic. Both styles are declared **under the same family name**, which is what makes the italic reachable by ordinary CSS and not only by a prop — the `italic` prop, an author stylesheet, an italic ancestor, or an `<em>` / `<i>` / `<cite>` inside a `<NonShield>` all resolve to it with nothing to opt into. Nothing is ever synthesised: `font-synthesis: none` is set on every element the package renders, because a faux oblique smears Playtype's outlines and distorts the word composites enough to expose that decoys are in play. Inside a `<Shield>`, `italic` sets a whole block and is the only italic available, because `children` must be a plain string; for a phrase, close the shield and open another, or use `<NonShield>`. Full detail: [Italics in the `@shieldfont/react` README](../packages/react/README.md#italics).

**Encoding is identical at every weight.** For a given variant, the word substitution dictionary and the digit rules are byte-identical across all six cuts. Choosing a weight changes how the text looks and never what it encodes, so you can mix weights inside one page without thinking about it.

**A numeric weight resolves to a real cut.** Pass a number and it snaps to the nearest cut that actually ships, so `weight={470}` renders through Medium (500). `<Shield>` also sets `font-synthesis: none`, so the browser never fakes a bold out of Regular: a synthesised weight would distort the ligature composites enough to give away that decoys are in play. What you request is always one of the six files above.

```jsx
<Shield weight="bold">Rendered with the real Bold (700) cut.</Shield>
<Shield weight={470}>Snaps to the real Medium (500) cut.</Shield>
```

**What it costs.** One file per weight per variant. Each `alpha` / `beta` / `gamma` cut is roughly 825 KB of woff2 and each `maxhide` cut is roughly 215 KB, and a page downloads only the cuts it actually renders. Declaring six faces is free; a page that uses only Regular fetches only Regular.

The `OPTIK_WEIGHTS` export, the exact numeric bands each face claims, and what an unknown weight name throws are all in the [`@shieldfont/react` README](../packages/react/README.md#weights-what-actually-ships).

> **This is a Tier A feature and only a Tier A feature.** `@shieldfont/font` (Tiers B and C) and the downloadable font (Tier D) ship **Regular only**. See [the CSS tier's note](#tier-c-css-import--paste) below.

### `<NonShield>`: unprotected text in the same typeface

`<NonShield>` renders its children **exactly as written**, in Optik. Nothing is
encoded, nothing is `aria-hidden`, there is no sealed payload, no puzzle, no
decoys, no copy guard and no notice strip. The words in the DOM are the words on
screen: a screen reader reads them, a search engine indexes them, a translator
translates them, copy-paste copies them, and find-in-page finds them.

```jsx
import { Shield, NonShield } from "@shieldfont/react";

<article>
  <NonShield as="h2">The future of writing</NonShield>
  <Shield as="p" variant="alpha">{body}</Shield>
  <NonShield as="p" size="0.9rem">Photograph by <em>Jane Roe</em></NonShield>
</article>
```

It exists for one reason: a ShieldFont page has always had two kinds of type on
it. The shielded paragraphs render in Optik, and the headings, decks, captions
and nav around them render in whatever fallback your stylesheet supplies,
because there was no supported way to put unprotected text in the shipped face.
It is also where [Headings: don't shield them](#headings-dont-shield-them)
finally lands: `<NonShield as="h2">` honours that rule and still gets the
typeface.

Unlike `<Shield>`, it accepts **arbitrary JSX** — links, `<em>`, fragments,
numbers, `null`. There is no encoder to blind here, so there is nothing for a
nested component's text to fall out of. `font-family` and
`font-feature-settings` are both inherited, so a nested `<a>` picks up the
typeface and the substitution-off rule without being touched.

#### Why this is not a `font-family` rule you could have written yourself

> [!WARNING]
> **The shipped `optik-*.woff2` files are not the Optik typeface. They are
> *shielded builds* of it, and setting `font-family: Optik` on ordinary text
> renders the decoy.** The failure is completely silent.

`scripts/generate_font.py` injects the word-substitution lookups into the
OpenType **`ccmp`** feature — which is on by default, and which
`font-variant-ligatures: none` does not reach (that property governs
`liga`/`clig`/`dlig`/`hlig`). The substitution dictionary is an **involution**:
`m[m[x]] === x`, which is why `decode` in `@shieldfont/core` is literally
defined as `encode`. Every word in the dictionary is therefore both an original
and a decoy, and the font swaps it either way. Measured by shaping text through
the shipped `optik-a.woff2` with HarfBuzz:

The generated table has an explicit compatibility order: required `ccmp`
(falling back to `locl` only when a base face lacks `ccmp`) fires the word
lookup before base compatibility lookups; required `rlig` then performs the
class/boundary fire-then-revert restoration; optional `calt`, `dlig`, and
`liga` are not dependencies. Consequently disabling discretionary or
contextual ligatures does not disable the generated rules, while disabling the
required source feature intentionally disables them for clients that need
plain text.

| You write | A shielded face draws |
|---|---|
| `Read the docs` | composites built from the letters `Reset`, `sellers` |
| `belongs` | a composite built from the letters `determines` |
| `2026 report` | `2527 report` |
| `Chapter 7` | `Chapter 6` |

11,962 of the 11,970 words in the `alpha` dictionary shape to a substituted
composite. This is the same trap the
[Tier C paste warning](#step-2-per-paragraph-paste-anywhere-in-body-content) and
the [Word/Pages warning](#tier-d-download-microsoft-word--pdf) describe, met from
the other direction — and a component that quietly did it would be far worse
than either warning, because nothing errors. The page renders, the bytes are
correct, and a heading just says the wrong thing.

`<NonShield>` renders a **different file**: `optik-n.woff2`, the *neutral cut*.
Same Optik outlines, same metrics, same weights, both styles — and no
substitution lookups in it at all. It is ~35 KB against a shielded cut's
~840 KB, because it carries the 526 real glyphs and none of the ~35,900 word
composites, so a page with shielded prose and unshielded headings pays almost
nothing for the second family.

> [!CAUTION]
> **`font-feature-settings: "ccmp" 0` is NOT a way to do this, and used to be.**
> Disabling the feature is exact in HarfBuzz, Blink and Gecko — and **WebKit
> ignores it entirely**, because Safari applies `ccmp` unconditionally. Every
> spelling was tested against a shipped cut and all of them still painted the
> decoy: `"ccmp" 0`, `"ccmp" off`, `-webkit-font-feature-settings`,
> `font-variant-ligatures: none`, `font-variant: none`, and
> `"ccmp" 0,"calt" 0,"liga" 0,"clig" 0` together. Text set that way reads
> correctly to an author on Chrome and as scrambled words to every Safari
> reader. **Use the neutral cut. There is no CSS alternative.**

`<Shield>` still declares `font-feature-settings: normal` on its own element,
because that property **inherits** and a stylesheet of your own that turns
`ccmp` off across a page would otherwise stop the substitutions and publish
your decoy text at full readability, with nothing logged and nothing on screen
to show it.

**Outside React there is no `<NonShield>`, but there is the same file.** Tiers B
and C ship it as `optik-n.woff2` under the family **`"Optik Text"`**, with a
ready `.tk9-t` class in `shieldfont.css`. Put unencoded text in that class, not
in `.tk9`:

```html
<h2 class="tk9-t">A heading, in the same typeface, saying what it says</h2>
<p class="tk9">…encoded text…</p>
```

#### Props

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `as` | `ElementType` | `"div"` | Which element to render. No table-tag restriction: `<NonShield>` renders one element and no wrapper, so `as="td"` is a `<td>`. |
| `variant` | `"alpha" \| "beta" \| "gamma" \| "maxhide"` | n/a | **Deprecated and ignored.** It used to pick which shielded file to fetch. There is one neutral cut now, so whatever you pass you get `optik-n`. An unbundled value still throws. |
| `weight` | one of the six cut names, or `1..1000` | inherit | Same six real cuts and the same nearest-cut snapping as `<Shield>`; `font-synthesis: none` for the same reason. |
| `italic` | `boolean` | inherit | Renders the italic cut. Often unnecessary here: this component takes arbitrary JSX, so a nested `<em>` resolves on its own. |
| `lineHeight` / `size` / `className` / `style` | | inherit / n/a | Passthroughs. `style` merges **over** the internal scope, so it can override `fontFamily` — and pointing this component at a *shielded* family is the one override that silently renders decoys. |
| `children` | `ReactNode` | | Rendered verbatim. Arbitrary JSX allowed. |

Any other prop **throws**, the same fail-loud treatment `<Shield>` gives an
unrecognised prop.

#### What it deliberately does not do

- **`variant` does not auto-rotate, and there is nothing for it to spread.**
  `<Shield>` rotates across `alpha`/`beta`/`gamma` because the mapping changes
  what a scraper reads; here nothing is encoded and the file is always the
  neutral cut. Pinning `<Shield>` to one variant does **not** get the page down
  to a single font download: the neutral cut is a different file under a
  different family, so any page mixing the two fetches two faces — one shielded
  cut at ~840 KB and `optik-n` at ~35 KB. Pinning still saves the *second* and
  *third* shielded cut that auto-rotation would pull in.
- **It emits no font-load guard, and it is not covered by `<Shield>`'s.** It
  does not stamp the `data-typeface` attribute the guard's selectors are scoped
  to. That is deliberate: when a face fails to load, `<Shield>`'s guard blanks
  every matching block behind a skeleton, which is right when the alternative is
  painting raw decoys and wrong here — a missing font leaves `<NonShield>`
  rendering **the correct words in a fallback face**, so the design is degraded
  and the content is fine. Seeding its weights into the guard would also let a
  missing `optik-a-800.woff2` used by one heading skeletonise every genuinely
  shielded block on the page.
- **It shares the `@font-face` stylesheet with `<Shield>`.** A page mixing the
  two emits exactly one stylesheet per family, whichever component renders
  first, and a `<NonShield>` that renders first does not starve `<Shield>` of
  its guard.
- **It is safe in a `"use client"` component.** There is no plaintext to leak
  and no dictionary in play, so it emits none of `<Shield>`'s client-render
  warning.

### Host the font (required: self-host by design)

The React component is **self-host only**: it never points at a public CDN it
doesn't control. Reason: a typography-based defense must *fail loud*, never
silent. If the font can't load, a bundled 4-second guard blanks protected text —
the words go transparent behind a striped grey skeleton, and it logs a console
error naming the family and the host it tried. There is no substitute message,
and it must never fall back to showing the raw decoy. A
CDN you don't own can vanish and break that guarantee, so you serve the font
yourself.

Copy the font files bundled inside the package:

```bash
cp node_modules/@shieldfont/react/fonts/optik-*.woff2 public/fonts/
```

> The React tier bundles its **own** version-neutral fonts (name table reads
> `Version 1.0`), so nothing in your served bytes names a dictionary version. That
> is why it doesn't reuse `@shieldfont/font`, whose fonts embed the version as the
> CDN tier's one deliberate tell.

The default `fontHost` is `/fonts`, which matches the copy above. Serve them
elsewhere? Point Shield at it:

```jsx
// somewhere in your app's bootstrap (server-side)
import { setFontHost } from "@shieldfont/react";
setFontHost("/static/shieldfont"); // your own path or your OWN CDN — not jsDelivr
```

> **Shipping less font.** A full ShieldFont carries its whole dictionary — about
> 825 KB of woff2 per variant. `scripts/subset_font.py` prunes a built font to
> the words your own content can actually trigger (a 2,000-word vocabulary lands
> around 197 KB). It is a build-time tool, not wired into this package, and it
> emits a matching pruned mapping you **must** encode with. See
> [shrinking the font](./custom-faces.md#shrinking-the-font-to-what-your-site-actually-uses).

> [!IMPORTANT]
> **Serving the font from a different origin? It needs CORS headers.** Fonts are
> fetched under the same cross-origin rules as `fetch()`, so a font on
> `assets.example.com` used by `www.example.com` is **blocked unless the response
> carries `Access-Control-Allow-Origin`** — and the failure is quiet: the request
> shows `200` in curl and in the network panel, the browser discards it anyway,
> and the reader gets whatever your fallback stack renders. On the React tier the
> load guard catches this and blanks the block; on the CDN and Documents tiers
> **there is no guard, so the reader silently reads the decoy.**
>
> Same-origin paths like `/fonts/...` are unaffected — this only applies when the
> host differs. If you use a separate asset domain or bucket, set:
> `Access-Control-Allow-Origin: https://your-site.example` (or `*`), and confirm
> with `curl -I -H "Origin: https://your-site.example" <font-url>` that the header
> comes back.

**How the filenames decode.** The letter picks the mapping variant: `optik-a`
is alpha (the default), `optik-b` is beta, `optik-c` is gamma, `optik-m` is
maxhide. The weight is the
suffix: the Regular cut keeps the bare name (`optik-a.woff2`) and every heavier
cut carries its numeric weight (`optik-a-500.woff2` through
`optik-a-900.woff2`), which is why the `cp` above uses a glob. Six weights
across four variants is 24 files. The React tier keeps these filenames and the
font family (`Optik`) neutral, so nothing in your served bytes names ShieldFont.

### Verify it's working

After running `next build` (or `astro build` or whatever), scrape your own page:

```bash
curl https://your-site.com/some-protected-page | grep 'data-typeface'
```

You should see encoded text in the HTML, not the original English. Open the same URL in a browser: humans see the original because the font reverses the encoding visually.

### Restrictions

- **Children must be a plain string, and anything else throws.** Nested JSX, a number, or an array from `{interpolation}` all raise an error rather than rendering. This is deliberate: the encoder cannot see inside your own components, so a best-effort walk would ship their text unencoded inside a block that still looks protected. That is a silent leak, so `<Shield>` fails loud. For mixed content (text plus a link, say), split it into separate `<Shield>` instances.
- **Server components only.** There is no client component. Rendering `<Shield>` in a `"use client"` file compiles your plaintext *and* the full substitution dictionary into the JS bundle, and passing unencoded text into a client component as a prop leaks it into the served HTML and RSC payload. Both fail silently in production: the rendered page still looks encoded.

---

## Blogs and static sites

If your site is a blog, a hosted CMS (WordPress / Ghost / Squarespace), or plain HTML where you control the site's CSS but don't run a build step, you use the **CSS @import + paste** flow. Drop one `@import` line into your site's CSS once, then paste encoded paragraphs anywhere in your body content. See **Tier C** below.

If your site is an SSG (Astro / 11ty / Hugo / Jekyll) with a real build pipeline, call `@shieldfont/core` directly in your build: encode plain English, or use the comment-marker helpers to keep your source-of-truth in the file. See **Tier B**.

[Jump to Tier C, CSS @import + paste ↓](#tier-c-css-import--paste) · [Jump to Tier B, any framework ↓](#tier-b-any-framework--build-step-shieldfontcore)

---

## Tier B: Any framework / build step (`@shieldfont/core`)

Not on React? The encoder is a **zero-dependency JavaScript library** you call
yourself: in a Vue/Svelte/Angular server render, an Astro/11ty/Hugo build hook, a
Vercel/Cloudflare build step, anywhere the encoding runs **before the HTML reaches
the browser**. (The CLI that used to live here was only ever a thin wrapper around
this library; call the library directly instead.)

### Install

```bash
npm install @shieldfont/core
```

### Encode

```js
import { encode, alpha } from "@shieldfont/core";

const text = "The future of writing belongs to those who write it.";
const html = `<p class="tk9">${encode(text, alpha)}</p>`;
// → <p class="tk9">The future of writing determines to those who sell it.</p>
```

Then load the font once with ten lines of `@font-face` (self-host from
`@shieldfont/font`, or the CDN bundle in Tier C below). Add `class="tk9"` to any
element you want rendered through the protection font.

> **One weight on this tier.** `@shieldfont/font` ships Regular (400) only —
> an upright and an italic per mapping variant, and no other weight. Protected
> text renders at Regular however you style it, so keep bold and heavier type
> outside the shielded blocks; `font-style: italic` does work. The six real
> cuts (Regular 400 through Black 900) exist in `@shieldfont/react` and nowhere
> else: see [Weights: the six cuts](#weights-the-six-cuts-tier-a-only).

### Keep your plain-English source as the source of truth

For static HTML in git, `@shieldfont/core` ships comment-marker helpers: `buildHtml` (re-derive the decoy from a `<!-- shield: … -->` source comment,
idempotently), `checkHtml` (verify round-trip; fail CI on mismatch), and
`shipHtml` (strip every comment before deploy so the shipped HTML carries zero
signal). A ~12-line build script replaces the old CLI entirely.

👉 **Full recipe (encode, `@font-face`, and the marker-based build script) is in
[Use anywhere](./use-anywhere.md).**

---

## Tier C: CSS @import + paste

> ⚠️ **This is the least concealed tier, and an educational one: for learning
> ShieldFont and for pages with no build step. [Tier A](#tier-a-jsx-with-shieldfontreact)
> is the recommended route for a site you're shipping.** The `@shieldfont/font` URL sits in your stylesheet, so anyone reading your CSS knows the page is shielded and with which dictionary. Everyone on this tier shares the same `alpha` mapping, so one precomputed table decodes all of them at once. And there is no rotation, because there is no component to run it. It is a real, working install and the protection it applies is the same protection everywhere else, but if you can run a build step, move to [Tier A](#tier-a-jsx-with-shieldfontreact) or [Tier B](#tier-b-any-framework--build-step-shieldfontcore): both drop the package URL, and both let you mint a mapping nobody else holds. See [Concealment & camouflage](./concealment.md) for the full comparison.

The lowest-friction path for blogs, hosted CMSes (WordPress, Ghost, Squarespace), and anyone who controls their site's CSS but doesn't have a build step. Two pastes: one is permanent site setup, one is per protected paragraph.

### Step 1: One-time install (paste into your site's CSS)

```css
@import url('https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css');
```

Where to put it depends on your platform:

- **WordPress**: Appearance → Customize → Additional CSS (Customizer plan and above), or your theme's `style.css`.
- **Ghost**: Settings → Code injection → Site header (or the Custom CSS field if your theme exposes one).
- **Squarespace**: Design → Custom CSS (this panel is available on every plan; the Code Injection panel is gated to Business+ but you don't need it for this).
- **Plain HTML / static sites**: either drop the `@import` into your existing stylesheet, or use `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css">` in `<head>`. The `<link>` form is marginally faster (parses in parallel with HTML): prefer it if you have `<head>` access.

This stylesheet declares `@font-face` for `'Optik'` and ships a `.tk9` utility class.

> **Regular only, and this is the tier where people expect otherwise.** The
> shielded files behind that stylesheet, `optik-a.woff2`, `optik-b.woff2`,
> `optik-c.woff2` and `optik-m.woff2`, are the four mapping variants at
> **weight 400**. There is no Medium, DemiBold, Bold, ExtraBold or Black on this
> tier. Asking for `font-weight: bold` on a `.tk9` element does
> not fetch a heavier file, because there isn't one: the browser draws a
> synthetic bold of the Regular cut, which distorts the composite glyphs. Add
> `font-synthesis: none` to your own `.tk9` rule if you would rather it stayed
> at Regular. If you need real weights inside protected text, that is what
> [Tier A](#tier-a-jsx-with-shieldfontreact) is for: it bundles
> [six real cuts per variant](#weights-the-six-cuts-tier-a-only), Regular 400
> through Black 900.
>
> **Italic does ship here, and it is the one style axis that does.** Each of
> those four files has an `-italic` companion (`optik-a-italic.woff2` and so
> on), at Regular, declared under the same family name as its upright — so
> `<em>`, `<i>`, `<cite>` and a plain `font-style: italic` inside a `.tk9`
> element resolve to a real drawn italic with nothing to opt into. The neutral
> cut ships both styles too (`optik-n.woff2`, `optik-n-italic.woff2`). What you
> cannot have on this tier is a *bold* italic, for the same reason you cannot
> have a bold: the cut does not exist.

> **Which dictionary version?** On the CDN tier the font family and filenames stay neutral, but the font stamps the **dictionary generation** it was built for into its own version field: the one deliberate tell of this tier. Encoded text only reads back correctly under a font whose version matches the dictionary that encoded it, so if you (or a collaborator) re-render a page later, read the font's version to pair it with the right dictionary. See [Checking your font version](./concealment.md#checking-your-font-version).

### Step 2: Per-paragraph paste (anywhere in body content)

Encode your text in the [encoder](https://shieldfont.org/encoder) (paste plain English on the left, copy the encoded text on the right), then paste the result into your post body:

```html
<p class="tk9">
  …encoded text from the encoder…
</p>
```

That's the entire embed. No `<link>`, no inline `style`, no `<script>`: just a paragraph with a class. This shape survives the strictest CMS sanitizers, including WordPress KSES for non-admin authors.

> [!WARNING]
> **Paste the *encoded* text, never your plain English.** The mapping is its own
> inverse, so plain English pasted into a `.tk9` element fires the ligatures
> backwards: you see a *decoy* on screen while the page source holds your real
> words — the exact opposite of what you wanted, with no error to warn you. If a
> paragraph looks subtly wrong on screen, that is the symptom. Encode first.

**No internet, or you'd rather not paste your draft into a web page?** The same
encoder ships inside the `@shieldfont/font` package as a plain ES module, so you
can run it locally as a one-off authoring tool. Save this as `encode.html`, open
it in your browser, and use it exactly like the hosted one:

```html
<textarea id="in" rows="8" cols="60">Paste your plain English here.</textarea>
<button onclick="go()">Encode</button>
<textarea id="out" rows="8" cols="60"></textarea>
<script type="module">
  import { encode, alpha } from "https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont-encoder.js";
  window.go = () => {
    document.getElementById("out").value =
      encode(document.getElementById("in").value, alpha);
  };
</script>
```

This is an *authoring tool*: you copy its output into your CMS by hand. It is
**not** a way to encode your live pages — encoding in a visitor's browser
protects nothing, because the page you served already contained your plain
English. See [Where the encoding happens](./where-encoding-happens.md).

### Where this works, and where it doesn't

| Platform | Step 1 (CSS @import) | Step 2 (paragraph paste) |
|---|---|---|
| Self-hosted WordPress | ✅ Customizer or theme `style.css` | ✅ |
| WordPress.com (Premium+) | ✅ CSS Customizer | ✅ |
| Ghost | ✅ Code Injection / Custom CSS | ✅ |
| Squarespace (any plan) | ✅ Custom CSS panel | ✅ |
| Static HTML / SSG | ✅ Your own stylesheet | ✅ |
| **Substack** | ✗ no custom CSS/HTML in posts | ✗ |
| **Medium** | ✗ no custom CSS/HTML in posts | ✗ |

Substack and Medium are out by platform policy: they don't accept custom CSS or HTML in user content at all. For now, the only ShieldFont path that reaches those audiences is exporting protected PDFs (Tier D).

### Why single-variant on this tier

The React route (Tier A) rotates between three variants (alpha / beta / gamma) so adversarial scrapers can't fingerprint protected pages by font-family name. That rotation depends on the React component running at SSR time. The CSS tier doesn't have one, there's no JavaScript involved, so it ships one variant. If you need rotation, use `@shieldfont/react`.

---

## Tier D: Download (Microsoft Word / PDF)

For journalists, document authors, anyone sending PDFs through email.

**Where this works.** Microsoft Word, Pages, and InDesign all render the substitutions: they ride the OpenType `ccmp` feature rather than `liga`, so an app's ligature setting doesn't affect them. **Google Docs cannot use this tier at all**, because it cannot load custom fonts. Draft in a desktop app and export, or use another tier.

You need two things, both on the site:

| What | Where |
|---|---|
| The font | <https://shieldfont.org/fonts/shieldfont-alpha.ttf> (also linked from the homepage) |
| The encoder | <https://shieldfont.org/encoder> |

The download is a **Regular (400)** cut, and it is the only cut. Word, Pages and
InDesign will still offer you a bold button, but there is no bold cut to switch
to, so they draw a synthetic bold that distorts the composite glyphs. Set
headings and emphasis in an ordinary font and leave the shielded paragraphs at
Regular. Real weights ship in [Tier A](#weights-the-six-cuts-tier-a-only) only.

**Workflow:**

1. Install `shieldfont-alpha.ttf` on your system (double-click → *Install*, or drop it into Font Book on macOS).
2. **Encode your text first.** Open the [encoder](https://shieldfont.org/encoder), paste your plain English, and copy the **encoded** output.
3. Paste the **encoded** text into Word / Pages / InDesign, then set the font on those paragraphs. **In the font menu it is called `ShieldFont Optik`** — that is the family name inside the file, so it is what you search for. (The `maxhide` download is `ShieldFont Optik Max`.) If you don't see it, quit and reopen the app: Word only rescans fonts at launch. The font's GSUB ligatures render the encoded words back to glyphs *shaped like the originals*, so a human reading the page sees your original English, while the document's underlying text stream stays the encoded decoy.
4. Export to PDF. The decoy (encoded) form is what's stored in the PDF's text layer; readers still see the original through the font.
5. Email the PDF. If your recipient's email provider scrapes attachments to train AI models, the encoded text is useless training data.

> ⚠️ **Don't type plain English straight into the document.** The mapping is an involution, so typing plaintext fires the ligatures in reverse: you'd see the *decoy* on screen while the file quietly stores your real words (the exact opposite of the protection you want). Always encode first, then paste the encoded text.

For documents you'll edit later, also keep a plain-English source copy somewhere (the encoder decodes as well as encodes, but a source file is cheaper than a round trip).

---

## Versioning

Every CDN URL we publish is **version-pinned and immutable**. No "latest" channels: silently upgrading the mapping would break existing encoded content.

```
✅ https://cdn.jsdelivr.net/npm/@shieldfont/font@0.3.5/shieldfont.css
❌ https://cdn.jsdelivr.net/npm/@shieldfont/font@latest/shieldfont.css
```

Upgrading to a new mapping version is opt-in: re-run your `@shieldfont/core` build (Tier B), bump the npm package (Tier A), regenerate your snippet (Tier C), or re-download (Tier D).

## Threat model: what ShieldFont does and doesn't protect against

**Defends:**
- Naive HTML scrapers (`curl + regex`, `requests + BeautifulSoup`, trafilatura, readability-lxml)
- Bulk dataset pipelines that read `innerText` without rendering fonts
- Email attachment scrapers (PDF/DOCX exports keep encoded text)
- Copy-paste into text-only tools

**Does not defend:**
- **Anyone who downloads the font and inverts it.** The font is a self-decoding codebook: 11,962 of 11,962 pairs recovered from the shipped file, no dictionary needed. It takes an attacker who knows the page is shielded, fetches the right font, matches it to the right part of the page, and has already built the inverter (one to three engineer-weeks of OpenType work). Bulk crawlers do none of that; someone targeting you will. A private mapping raises the per-site cost of this attack; nothing removes it.
- Headless browsers that fully render fonts (Playwright, Puppeteer)
- OCR on rendered pages or screenshots
- Vision-language models reading screenshots
- Frequency analysis on a large corpus (per-deploy seed rotation is on the [roadmap](../ROADMAP.md), not shipped; note that changing a seed also requires rebuilding a matching font)

Our framing: **ShieldFont raises the cost of extraction; it doesn't promise zero extraction.**

---

## Next steps

- For any non-React stack: [Use anywhere](./use-anywhere.md): call `@shieldfont/core` in your build or server render.
- For AI co-pilots: drop [`docs/CLAUDE.md`](./CLAUDE.md) (or the [`AGENTS.md`](../AGENTS.md) that ships in every package) into your project so Claude / Cursor / GPT / Aider follow the convention by default.
- For new framework adapters: the wire format (comment markers) is documented in [`@shieldfont/core`](../packages/core/README.md); list your adapter in [`ADAPTERS.md`](../ADAPTERS.md).
- For mapping internals: see [`MAPPINGS.md`](../MAPPINGS.md) for the M0 → M15 evolution and the [white paper](https://shieldfont.org/white-paper).
