# `<Shield>` — every prop, in plain English

Assumes you know nothing about the docs. Every behaviour below was **verified by
rendering it**, not read off the types. Measured 2026-08-03 on 0.3.2.

```jsx
import { Shield } from "@shieldfont/react";

<Shield>The future of writing belongs to those who write it.</Shield>
```

That is a complete, correct usage. Every prop is optional.

---

## First: what the component actually does

You give it a sentence. It ships a page where:

- a **human sees your words**, drawn by a custom font;
- a **scraper reads different words** — fluent, grammatical, wrong;
- a **screen reader gets your real words**, sealed in the page, openable by a
  button.

The swap happens on your server at build time. Your plain sentence stays in your
source code; it never appears as readable text in the HTML.

---

## The three switches — this is the part that matters

These decide *what kind of protection* you get. **All three are on by default.**
There is no `tier`, `level` or `mode` prop, and no name for any combination —
just three independent on/off switches.

### `screenReader` — the big one

**Default: on.** Puts your real words in the page, **encrypted**, plus a control
that decrypts them in the reader's own browser.

Turning it off (`screenReader={false}`) makes the block a dead end: a screen
reader hears **nothing at all**, and your real words never enter the page in any
form. Measured: the whole block collapses to **1 element**, no buttons, no
sealed data.

> This prop is the reason the other two exist. Both follow it — turn this off and
> the other two turn off with it, because there is nothing left for them to do.

### `wrapper` — *(this used to be called `explain`)*

**Default: on.** Draws a visible box around your paragraph with one sentence of
explanation and two buttons — **Copy to clipboard** and **Uncover**.

**Why "explain" was a bad name:** it sounded like a comment or a tooltip. It
controls whether ShieldFont *draws something on your page*. That is what
`wrapper` says. **Passing `explain` now throws an error** telling you to use
`wrapper`.

Who it's for: it isn't only for screen-reader users. It reaches the reader whose
browser forces its own font (dyslexia settings, high contrast) — for whom the
page silently turns to gibberish with no other signal — and the reader who copies
a quote.

| | wrapper on (default) | `wrapper={false}` |
|---|---|---|
| On screen | outline + strip + 2 buttons | **nothing** |
| Buttons in markup | 2 | 1, clipped off-screen |
| Elements per block | 31 | 16 |

With `wrapper={false}` the control still exists and still works — it is simply
positioned off-screen where only assistive technology finds it.

### `copyPaste` — copy protection

**Default: on.** If someone selects your protected paragraph and presses ⌘C, they
get a short notice instead of the scrambled words:

> *"[This text is protected from AI bots and didn't copy correctly. Use "Uncover"
> next to it, then copy again.]"*

Turn it off and they silently get the decoys — fluent nonsense pasted into their
notes, which they may not notice for a long time. That is why it defaults on.

---

## Styling props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `as` | string | `"p"` | Which HTML tag to render. Verified: `as="h2"` renders `<h2>`. **But don't shield headings** — see the note at the end. |
| `weight` | number \| name | `400` | Font weight. Six real cuts ship; a number snaps to the nearest. Verified: `700`→700, `470`→**500**, `"demibold"`→600, `"bold"`→700. No fake bolds. |
| `lineHeight` | number | — | Line height. Verified: `2` → `line-height:2`. |
| `size` | string | — | Font size. Verified: `"2rem"` → `font-size:2rem`. |
| `className` | string | — | Your CSS class. **Lands on the text block and on the revealed text** — not on the wrapper. Verified: 2 elements. |
| `style` | object | — | Inline styles on the text block. Verified. |
| `variant` | `"alpha"` \| `"beta"` \| `"gamma"` \| `"maxhide"` | `"alpha"` | Which substitution dictionary. `maxhide` swaps the most words, including short ones like *at/by* and *is/was*. |
| `rotate` | object | — | Rotate variants automatically over time, so one site doesn't ship one fixed fingerprint. |

### Styling the wrapper itself

`className` deliberately does **not** touch the wrapper. Use:

```jsx
<Shield wrapper={{ className: "my-wrapper" }}>…</Shield>
```

Verified: reaches the frame element. It is separate because widening `className`
would have silently retargeted every existing stylesheet the day people upgraded.

---

## The object forms

Each switch takes `true`/`false`, or an object to configure it:

```jsx
<Shield
  screenReader={{ seconds: 14 }}   // how hard the puzzle is
  wrapper={{
    className: "my-wrapper",
    text: "Custom explanation sentence.",
    position: "top",               // "top" | "bottom" | "both"
    labels: { show: "Reveal", copy: "Copy" },
  }}
  copyPaste={{ notice: "Custom clipboard message." }}
>
  …
</Shield>
```

**`seconds`** is the only one worth thinking hard about. It's how long the
reader's browser grinds before it can show the real words.

- Default **14**, accepted range **1–30**. Outside that, it throws.
- Verified: `seconds: 5` produces 600,000 steps; the default produces 1,680,000.
- Real wait in Chrome at the default: **about 2.5 seconds**.
- **Do not raise it to "harden" your page.** A scraper that doesn't want to wait
  can screenshot your page and OCR it for about the same cost. Past that point
  extra difficulty buys you nothing and is paid entirely by disabled readers.

---

## Things that throw

Deliberately loud rather than silently ignored:

| You wrote | What happens |
|---|---|
| `explain={false}` | **Throws** — renamed to `wrapper` |
| any unknown prop | **Throws** — it is not forwarded to the DOM |
| non-string children (`<strong>`, a component) | **Throws** — the encoder cannot see inside them |
| `seconds: 60` | **Throws** — outside 1–30 |
| `copyPaste` with `screenReader={false}` | **Throws** — nothing for the notice to point at |

---

## Two things the props don't tell you

**Don't shield headings.** `<Shield as="h2">` works, but once your body text is a
decoy, your headings are the only accurate text a search engine gets — shield one
and you feed it a confident, wrong summary. Use the sibling component instead:

```jsx
<NonShield as="h2">Your real heading</NonShield>
```

`<NonShield>` renders ordinary, readable text in the same typeface. You cannot
get this by setting `font-family` yourself — the shipped font carries the
substitutions inside it, so plain text set in it renders the **decoy**.

**A protected block fails WCAG 2.2 SC 1.3.1.** Always. That is the mechanism, not
a bug being worked around. These props make a protected page humane, not
compliant.

---

## A note on old prop names

Both old spellings of the wrapper prop now throw, naming `wrapper`:

- `explain` — the 0.3.2 name
- `notice` — the 0.3.0 name, which until now kept working as a *silent* alias
  while `explain` threw. The same mistake was loud in one spelling and silent in
  the other, and no document mentioned `notice` at all. Fixed.
