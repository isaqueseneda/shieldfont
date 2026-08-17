<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# ShieldFont Next.js demo

The smallest possible Next.js App Router page using `@shieldfont/react`.

## Run it

```bash
cd examples/nextjs-demo
npm install
npm run dev
# Open http://localhost:3000
```

`npm run dev` first builds the workspace packages (this demo depends on
`packages/react` via `file:`, which npm symlinks, so its `dist/` has to exist)
and then copies the `.woff2` files into `public/fonts/` — the location
`<Shield>` requests by default. Both steps are wired to `predev`/`prebuild`, so
there is nothing to remember. If the fonts were missing the page would not fail
quietly: ShieldFont's own guard blanks every protected block, dropping the words
to transparent behind a striped grey skeleton and logging a console error, which
is the failure working as designed.

To verify the encoded text actually reaches the browser, scrape the page:

```bash
curl -s http://localhost:3000 | grep -o 'data-typeface="[a-z]*"'
```

The attribute is called `data-typeface`, not `data-shieldfont`: nothing in the
served markup names the tool. To see the substitution itself, search the HTML
for a phrase you know is on the page:

```bash
curl -s http://localhost:3000 | grep -c "belongs to those who protect"   # → 0
```

Zero hits: the original sentence is not in the response. Open the same page in a
browser and you read it normally, because the font draws the decoy words with
the shapes of the originals.

## How it works

`app/page.tsx` imports `<Shield>` from `@shieldfont/react`. Each `<Shield>` is a
React Server Component:

1. **In Node, during the server render** (or at build time for a static export),
   `<Shield>` encodes its children — a plain string — with one of the bundled
   dictionaries. Your original text never reaches the browser in readable form.
   (It does reach it **encrypted**: `screenReader` is on by default, so each
   block also ships its real words sealed behind a time-lock puzzle. That is
   ciphertext, which is why the `grep` above still returns zero.)
2. The encoded text is what gets serialized into the HTML response.
3. The component injects an `@font-face` `<style>` block plus a small font-load
   guard script.
4. The rendered element gets `data-typeface` and a `font-family` style scoped to
   the variant.

Which dictionary? By default `<Shield>` **rotates** across `alpha`, `beta` and
`gamma` by content hash, so no single mapping covers the whole page. Pass
`variant="alpha"` to pin one. (`maxhide` is opt-in only and never auto-selected.)

The browser fetches the font from `public/fonts/`, applies the GSUB ligatures,
and the visible text becomes the original meaning. A scraper reading the HTML
gets the decoy — and, beside it, a sealed payload it would have to grind
sequentially, per block, to recover anything.

You will also see a box drawn around the protected paragraph, with a sentence
and a Copy and an Uncover button. That is the `wrapper`, on by default since
0.3.2 and part of what a bare `<Shield>` renders; `wrapper={false}` removes it
and keeps the same control clipped off-screen.

## Accessibility

Every `<Shield>` here is bare — no `a11y` prop at all — because the accessible
path is on by default and the demo should show what the docs describe. (It used
to pass `a11y={{ mode: "text", seconds: 5 }}`, left over from when the path was
opt-in, which quietly demonstrated a 5-second puzzle against a real default of
14.) The encoded block is `aria-hidden`, so the alternative beside it is what a
screen-reader user reads, and an audit will flag every block you wrap. The
default mode seals the real words into the page and lets the reader's own
browser grind out the key; there is no URL for a scraper to follow. Read
[`docs/plain-text-mode.md`](../../docs/plain-text-mode.md) for the real limits,
including which screen readers are actually tested.

## What stays plain

Only elements wrapped in `<Shield>` are protected. The `<h1>` heading and the
meta `<p>` underneath stay in your normal page font.

The `<h2>` uses **`<NonShield>`**: real, indexable, readable words rendered in
the same Optik face as the shielded paragraph. Do not reach for
`font-family: Optik` to get that effect — the shielded `optik-a/b/c/m` builds
carry their substitutions in the `ccmp` feature, and the dictionary is an
involution, so plain English through one renders the **decoy** with nothing
anywhere reporting a problem.

`<NonShield>` does not switch that feature off. It loads a **different file**
under a **different family name**: `optik-n.woff2`, the neutral cut — the same
Optik outlines and metrics, built from the same statics, with no substitution
lookups in it at all — declared as `"Optik Text"`. Nothing to switch off means
nothing an engine can decline to switch off, and it is ~35 KB against the
shielded face's ~840 KB, because it carries the 526 real glyphs and none of the
word composites.

That used to be `font-feature-settings: "ccmp" 0`, and it was wrong for a year:
**WebKit ignores it.** Safari applies `ccmp` unconditionally and no CSS reaches
it — `"ccmp" off`, `-webkit-font-feature-settings`,
`font-variant-ligatures: none` and `font-variant: none` were all tested and
still painted the decoy.
Every heading in a `<NonShield>` looked perfect to an author on Chrome and read
as scrambled words to every Safari reader. If you find that CSS in an older
example, it is out of date.
