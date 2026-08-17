<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# Where the encoding happens (and how it leaks)

There is exactly one rule in ShieldFont:

> **Your original text must never ship to the browser in readable form.**

Everything else is detail. This page shows what that means in practice, because
the two ways people break it both *look correct* and both fail **silently in
production**.

The qualifier is load-bearing and is not a loophole. With `screenReader` on —
the default in `@shieldfont/react` — each block also ships its real words
**encrypted**, sealed behind a time-lock puzzle the reader's browser has to
grind out. That is the accessible path. It is ciphertext, it never matches the
grep below, and removing it is not how you satisfy the rule.

We did not reason this out. We built five real apps against the published
packages and grepped the output for the plaintext. The results are below.

## The test

Eleven words, chosen so that **not one of them survives encoding**. If any of
them appears anywhere in a build, it is a real leak, not a coincidence:

```
plain   : confidential manuscript quick lazy dog treasure guarded knowledge stolen scraped robot
encoded : guilty visa wise logistic rabbit currency geared quantity took cruised barrier
```

## The results

| How you render | Served HTML | JS bundle | Protected? |
|---|---|---|---|
| `<Shield>` in a **Server Component**, static export | clean | clean | **yes** |
| `<Shield>` in a **Server Component**, SSR | clean | clean | **yes** |
| `encode()` in a Node build script | clean | n/a | **yes** |
| `<Shield>` inside a `"use client"` file | clean | **leaks** | **no** |
| `<Shield>` in a client-only app (Vite, CRA) | empty shell | **leaks** | **no** |
| Server Component passing plain text **as a prop** to a client component | **leaks** | **leaks** | **no** |

## Don't call it "server side"

What matters is *where the encoding runs*, not whether you own a server:

> `<Shield>` encodes in Node, at build time or during server render, so the
> browser only ever downloads the encoded version.

"Server side" is the tempting shorthand, and it hides three real failures:

**You do not need a server.** A static export has none at all, and it was the
cleanest result in the table. This site is a static export.

**A Server Component is not automatically safe.** The last row above *is* a
server component. It hands unencoded text to a client component as a prop, so the
plaintext lands in the served HTML while the element on screen shows the encoded
version. It looks right in DevTools and is fully exposed in view-source.

**It points you at the check that passes.** In Next.js, client components are
still rendered on the server, so their HTML comes out encoded and clean. You view
source, see decoys, and conclude you are protected. The plaintext is sitting one
`<script src>` away in the bundle.

## The part that surprised us

When `<Shield>` runs in the browser, it does not only leak that one page. It
bundles the dictionary:

```
alpha   11970 pairs | in bundle: 11970 (100%)
beta    12034 pairs | in bundle: 12034 (100%)
gamma   12036 pairs | in bundle: 12036 (100%)
maxhide  2534 pairs | in bundle:  2534 (100%)
```

All 38,574 pairs, in plain text, e.g. `confidential:"guilty"`. One misplaced
`"use client"` publishes the decoder for **every** shielded page on your site,
not just the one that leaked.

## What to do

**React, Next.js, Astro, Remix.** Render `<Shield>` from a Server Component. Do
not put it in a `"use client"` file, and do not pass your unencoded text into a
client component as a prop. If a client component needs the text, encode first
and pass the encoded string.

**Everything else.** Call `encode()` from `@shieldfont/core` in your build step
or server render. See [Use anywhere](./use-anywhere.md).

**Never** write a browser-runtime encoder. Scrapers do not run JavaScript, so
they would read your plain English source and the whole exercise is pointless.

## How to check your own build

Do not trust a page that looks right. Grep for a sentence you know is protected:

```bash
npm run build
grep -rn "a sentence from your protected text" out/ .next/ dist/ 2>/dev/null
```

No output means no leak. Any output is the file that is exposing you. Check the
JS chunks too, not just the HTML: that is the case people miss.

**Pick your search string carefully, or you will scare yourself.** Only about one
word in four is swapped, so a *partial* match proves nothing either way — a
fragment like `"the future of"` survives encoding untouched and will match on a
perfectly protected page. Search for a **whole sentence containing several
content words**, or better, take a sentence and check a word you know is in the
dictionary:

```bash
# Does a word the dictionary definitely changes survive anywhere?
node -e "import('@shieldfont/core').then(({encode,alpha})=>{
  const s='YOUR SENTENCE HERE';
  console.log('encoded:', encode(s, alpha));
})"
```

If `encoded` differs from your sentence, grep for the **original**: any hit is a
real leak. If it comes back identical, that sentence has no dictionary words in
it and is not a useful canary — pick another.

`<Shield>` also warns in the console if it detects itself rendering in a browser,
in development **and** in production. If you see that warning, protection is
already gone on that page.
