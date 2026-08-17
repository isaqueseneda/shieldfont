<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# The plain-text mode

`a11y={{ mode: "text" }}` gives a screen-reader user the real words of a
shielded block. The words ship inside the page, encrypted, and the reader's own
browser grinds out the key on request — a few seconds of work on a desktop,
once, per block.

## Where this stands

First of all this is a new challenging approach and it is in an early stage and
we don't yet have all the answers.

Accessibility is a complicated and unsolved problem everywhere in the world, and
this project can only 80/20 it. What follows is what we chose, what it costs,
and where it is still wrong — not a claim to have solved anything.

**Nobody is shut out. Everyone pays a little instead of a few paying
everything.** Some readers spend a few extra seconds on copy and paste. A
reader using assistive software waits a few seconds for words everyone else
already has. That second cost is the one that bothers us and the one we most
want to fix. We built it this way because the alternative was a page that works
perfectly for most people by failing completely for a few.

**But some things would have been unacceptable.** A screen reader reading out
gibberish. Someone using a custom face — dyslexia-friendly, high-contrast,
larger — getting scrambled text and never being told that is what happened. Both
of those fail quietly: the reader has no way to know something changed, so they
assume they misread it or that the writer slipped.

That is why the wrapper exists, and why it is the default. It is the arrangement
where nobody is left guessing.

**We do not want to be prescriptive about accessibility.** You know your
audience and your application, and you may reach it in ways this library does
not offer — pairing a shielded block with an audio reading, for instance. The
role of these docs is to give you a few things to think about if you want to do
something of your own. If you want a ready-to-go packaged solution, the full
wrapper is here, with its limitations stated.

---

**Since 0.3.2 this is on by default, and it draws something.** A bare
`<Shield>` now renders an outline round the block and a strip carrying one
sentence and two buttons. Earlier versions drew nothing and put the control
off-screen where only a screen reader could reach it; that arrangement is still
one prop away — `wrapper={false}` — and the section below says why it stopped
being the default.

This page explains what each switch does, what it costs, what it does not fix,
and how the numbers were chosen.

```tsx
import { Shield } from "@shieldfont/react";

<Shield>{body}</Shield>
```

That is the whole API. Nothing to generate, nothing to host, no server.

---

## The three switches

`screenReader`, `wrapper` and `copyPaste` are three independent props. There is
no `tier`, `level` or `mode` prop that bundles them, and no name for any
particular combination of the three. There used to be four such names in these
docs and they were deleted: a reader had to memorise which switches each name
stood for before they could use it, and the switches say the same thing with
nothing to memorise.

| Prop | Accepts | Default | What it does |
|---|---|---|---|
| `screenReader` | `boolean \| { seconds? }` | **on**, unconditionally | Ships the original words sealed behind the puzzle, and the control that opens them. The other two stand on this one. |
| `wrapper` | `boolean \| ShieldNotice` | **on wherever `screenReader` is on** | Draws the outline and the strip on screen. Never on an inline tag. |
| `copyPaste` | `boolean \| { notice? }` | **on wherever `screenReader` is on** | Puts a short sentence on the clipboard instead of silent decoy words. |

### The wrapper is a default, not a requirement

**It ships on because clarity is worth more than concealment.** A reader who
meets a protected block should be able to tell what it is and get the real
words, and the drawn wrapper is the only mitigation that reaches the reader
whose browser forced its own font — where the decoy renders fluently and
nothing in the page can detect it. That is a deliberate trade, and it is
described in full in [concealment](./concealment.md): the wrapper's own prose
is a string a crawler can match on, and camouflage cannot reach it.

**You can switch it off and signal accessibility your own way.** Nothing about
the protection depends on our furniture:

```tsx
// nothing drawn; the sealed alternative and its control stay, clipped off-screen
<Shield wrapper={false}>{body}</Shield>

// nothing of ours at all — you own the accessible path
<Shield wrapper={false} screenReader={false}>{body}</Shield>
```

With the second, `<Shield as="p">` renders **as close to a plain `<p>` as this
package gets**: your tag, your className, your text, no outline, no strip, no
buttons, no sealed payload, no script. Measured over 25 renders that is a
median **247 bytes** of markup against about **11 kB** for a drawn block. Put
your own summary, disclosure, link or note wherever your design wants it.

Two honest caveats before you take that route. `screenReader={false}` means the
block is `aria-hidden` with **no alternative behind it** — the accessible path
becomes entirely yours to build, and "I'll add it later" is a page that is
inaccessible now. And `wrapper={false}` on its own leaves our control real and
focusable but clipped off-screen, so a sighted keyboard user Tabs into
something they cannot see and loses their focus indicator. Pass
`visualHidden: false` to put a control back on screen, or turn `screenReader`
off too and provide your own.

Two things in that Default column are worth reading twice.

**`wrapper` and `copyPaste` follow whatever `screenReader` resolved to, not the
literal value `true`.** Both of them open the seal `screenReader` ships, so
neither means anything without it, and asking for either with it off throws.
Defaulting them to a literal `true` would have made a bare
`<Shield screenReader={false}>` — a legitimate choice, made deliberately —
throw on its own defaults.

**`wrapper` is not drawn on an inline tag.** `<Shield as="span">`, and the same
for `a`, `em`, `strong`, `b`, `i`, `u`, `small`, `code` and `label`, keeps the
clipped off-screen control instead. The wrapper is a block-level box, and a
`<div>` dropped mid-paragraph closes the paragraph early, splits the host
sentence around a bordered box, and leaves the parsed DOM not matching the server
HTML. That case is silent because it is reachable by a `<Shield>` nobody edited:
every existing `<Shield as="span">` would otherwise have grown a box on upgrade.
Passing `wrapper` *explicitly* on an inline tag throws.

```tsx
<Shield>{body}</Shield>                                        // all three on
<Shield wrapper={false}>{body}</Shield>                        // nothing drawn
<Shield wrapper={false} copyPaste={false}>{body}</Shield>      // and copy left alone
<Shield screenReader={false}>{body}</Shield>                   // no seal at all
```

`explain` was the 0.3.0 and 0.3.1 spelling of `wrapper`. Passing it now throws,
naming `wrapper` in the message. The value is unchanged — same boolean, same
object — so the fix is the key and nothing else.

### What each configuration does

| | **Default** *(all three on)* | **`wrapper={false}`** | **`wrapper={false}`<br>`copyPaste={false}`** | **`screenReader={false}`** |
|---|---|---|---|---|
| **Screen readers** | Reads the sentence on its own focus stop, then two named buttons. Pressing Uncover grinds the puzzle and the real words are announced. | Identical. The control is real and focusable, clipped off-screen — a listener cannot tell it from the default. | Identical again. | **Nothing.** The block is `aria-hidden` with no alternative. A reader passes it in silence and is never told there was anything there. |
| **Missing font** | The strip's sentence swaps to the font-missing wording, the paragraph becomes a skeleton, and the same Uncover button is right there. | The clipped control un-clips itself and draws the identical row — shield, sentence, Uncover — with no box around it. | Same. | **Decoy words, in a fallback face.** Fluent, grammatical, wrong English, with nothing on screen to say so. |
| **localStorage** | One key per block once solved, holding the puzzle's **answer** — a number, not your text — plus the time it was last used. Reopening is instant. Entries untouched for 30 days are swept on the next page load, so the store cannot grow forever; the eraser in the demo bar clears them all now. | Same. | Same. | **Nothing stored.** There is no puzzle, so there is no answer to keep. |
| **What you pass** | Nothing; all three default on. | `wrapper={false}` and nothing else. `copyPaste` is independent of the wrapper, so it stays on. | Both, explicitly. | `screenReader={false}`; the other two throw if passed, because there is nothing for them to open. |

### What each configuration costs

| | **Default** | **`wrapper={false}`** | **`wrapper={false}`<br>`copyPaste={false}`** | **`screenReader={false}`** |
|---|---|---|---|---|
| **On screen** | An outline and a strip. | Nothing. | Nothing. | Nothing. |
| **Markup, one block** | 32 elements, ~11 kB | 17 elements, ~9 kB | 17 elements, ~9 kB | 1 element, 247 bytes |
| **Matchable English** | The whole sentence, the button words, the clipboard notice. | The note and the button name (`"scrambled"`, `"Uncover the plain text"`), plus the clipboard notice. | The note and the button name. | **None.** Nothing a crawler can pattern-match on. |
| **Copy & paste** | A selection touching protected text lands a short notice saying how to get the real words. | Same. | **Decoy words, silently.** The reader pastes fluent nonsense into their notes and finds out later, or never. | Decoy words, silently. |
| **What it still costs a reader** | The real text comes from the Uncover button in the notice. That needs JavaScript, a current browser, an https origin and a few seconds of the reader's own CPU. The source text stays out of the page source, so an audit will flag the block. | Same, and the control is clipped off-screen: a sighted keyboard user Tabs into something they cannot see and loses their focus indicator. | Same. | **No alternative at all.** The block is `aria-hidden` with nothing beside it, so building that path is yours. Rules such as the EU Accessibility Act and the ADA Title II web rule set requirements a site has to meet on exactly that point. |

> **The machine-checkable part is checked; the rest is not machine-checkable.**
> `node scripts/axe-audit.mjs` reports zero violations across both the drawn
> wrapper and the off-screen control, before and after the unlock. A clean axe
> run is not conformance: axe covers roughly a third of WCAG and cannot judge
> whether the words a screen reader is handed are the words on the screen, which
> is the whole question here. What stays out of the page source is the source
> text, and that is the mechanism rather than a defect waiting to be patched —
> the [accessibility warning](../README.md#accessibility) has the full statement.

### Why all three default on

The wrapper did not, in 0.3.0 and 0.3.1. A bare `<Shield>` drew nothing, on the
reasoning that the wrapper's plain English is the one thing `setCamouflage()`
cannot rename — it renames attributes and font families, not prose — and so
should be opted into deliberately.

That reasoning is intact. The conclusion changed, because of who pays.

This library exists to deter **bots**. Turning any one of the three off spends a
**human's** time to do it, and there is a different human behind each:

- `screenReader={false}` — the reader on a screen reader, who hears silence
  where a paragraph was;
- `wrapper={false}` — the reader using their own typeface, dyslexia-friendly,
  high-contrast or larger, whose stylesheet overrides ours and turns the page to
  gibberish with nothing on screen to say so;
- `copyPaste={false}` — the reader who selects a quote for a translator or their
  notes and gets fluent nonsense with nothing to explain it.

With all three on, none of those three is worse off, and each is one prop away
from being switched back. A crawler is no closer to the words with the wrapper
drawn than without it: the seal is identical either way, and what the wrapper
adds is a sentence and two buttons — an obstacle to concealment, never to the
seal.

**`copyPaste={false}` is documented rather than recommended.** Its distinguishing
behaviour is that copying gives a human decoy words with no notice, which costs a
person something and costs a crawler nothing.

**`screenReader={false}` is documented rather than hidden.** It is a real choice
with a real reason — maximum concealment, no signature at all — and a library
that hid its worst option would not be trustworthy about its best one. Know what
you are choosing: the block ships `aria-hidden` with nothing beside it, and
accessibility law reaches sites in several countries. Check yours.

### One thing no switch fixes

A reader who forces their own font can be **detected**, but only partly. If a
user stylesheet or an extension replaces the family for the whole block, the
substitution is measurable: the shielded face and the fallback produce different
text widths, and identical widths mean ours was not used. Note that
`document.fonts.check()` does **not** catch this — the face is loaded, just
unused, so it answers "yes" while the reader looks at gibberish.

What cannot be detected is **per-glyph fallback**: the face used for most of a
run with one missing character silently substituted. No page-visible API reports
the font actually used to draw a glyph. `CSS.getPlatformFontsForNode` knows, and
is DevTools-protocol only; `queryLocalFonts()` needs a permission prompt and
answers a different question — what is installed, not what was used.

This is the strongest argument for leaving `wrapper` on. A drawn control does not
need to detect anything: it is already there when the reader needs it.

---

## The problem it solves

A shielded block holds a decoy. The HTML says one thing, the font draws
another. Reading the decoy aloud would be worse than silence — it is fluent,
grammatical, *wrong* English, and nothing about it announces itself as broken —
so `<Shield>` marks the block `aria-hidden="true"` and assistive technology
skips it in linear and heading navigation.

**Reading down the page, a screen reader is never handed the scrambled
version.** Our NVDA test asserts that. Screen review and touch exploration work
differently and we have no automated coverage of them.
[#2](https://github.com/isaqueseneda/shieldfont/issues/2) reported a decoy could
be reached that way; we have not reproduced it in VoiceOver or iOS touch. If you
can test it properly:
[#9](https://github.com/isaqueseneda/shieldfont/issues/9).

Skipping is not a fix either. On its own it leaves a reader with nothing at all
where a sighted reader has a paragraph, which is why something has to stand
beside the block.

**The obvious answer is a link to a plain-text copy, and it does not work.**
That shipped in 0.2.0 as `{ mode: "text", href }` and was removed, because a URL
cannot be offered to a screen reader without being offered to everyone else. The
same crawl that reads the decoy reads the link sitting beside it. One line of
scraper code turned a protected block into an unprotected one, so a page using
the accessibility feature was *less* protected than a page that ignored it.

The replacement inverts the trade. The words are in the page, but closed. Nobody
is denied them. The accessible path simply stops being the **cheapest** path.

---

## How it works

It works like a CAPTCHA. Plenty of sites ask you to prove you are not a robot
before they show you something, and this is the same idea with the work moved
off the person and onto the machine. There is nothing to see, nothing to hear
and nothing to solve. You press a button, your browser does a few seconds of
arithmetic, and the text appears.

At build time, each block gets its own **time-lock puzzle** (Rivest–Shamir–Wagner,
1996):

1. Pick two random primes, multiply them to get a number `n`.
2. Define the key as: start at 2 and square it, over and over — 1,680,000 times
   at the default — keeping only the remainder after dividing by `n`.
3. Encrypt the block's real text with that key.
4. Ship `n`, the step count, and the ciphertext. Throw the primes away.

To get the key you have to do all 1,680,000 squarings. Each one needs the
answer to the one before it, so **the work cannot be split up**. A crawler with
a thousand GPUs still pays 1,680,000 sequential steps per block. Their only
advantage is a faster single core — and better software: OpenSSL's hand-written
Montgomery assembly does about 1,737,000 squarings/second where V8's BigInt in a
warmed worker does about 667,000. That 2.6x gap is not going away, and the step
count is set against it. It does not change the step count either way: `t` is
derived from the ATTACKER's rate, and the reader's rate only decides how long
they wait.

**The build is cheap because it holds a trapdoor.** Knowing the two primes
collapses the tower into two ordinary modular exponentiations. Measured, median
of twelve runs: **64 ms to seal one payload** that costs the reader a 14-second
budget to open.

A block is **four** payloads, not one — the real text plus three decoys — so a
block costs **261 ms**, and a two-hundred-block site adds about **52 seconds**
of single-threaded sealing to your build. This paragraph used to say "a few
seconds", which was true when a block was one payload and wrong by a factor of
ten afterwards. If that matters for your build, it parallelises: the payloads
within a block are independent and so are the blocks.

### Four payloads ship, one of them yours

A block does not carry one sealed blob. It carries **four**: the reader's words,
plus three holding scrambled filler drawn at random from six public-domain works
(Austen, Shelley, Melville, Doyle, Wells, Kafka). All four are padded to a
common byte width, so ciphertext length says nothing about which is which, and
the filler is run through the same word substitution the visible block uses, so
it matches nothing anywhere and carries the same statistical fingerprint.

The reader pays nothing for this: the browser is **told** which payload is the
block's own and grinds exactly one. What it costs is an attacker who was
skipping the page entirely — fetching the HTML, regexing out every
`{n, t, iv, ct}` blob and grinding them natively, with one script that works on
every site using this library. That attacker now pays four times over.

**It is a speed bump, not a wall, and the docs will not claim otherwise.** The
position of the real payload is derived from the block key by a rule that ships
in the page, so anyone who reads the emitted script learns it. With no server
there is no fact we hold that they cannot. And the corpus is fixed and public,
so anyone who solves a payload can run the public `decode()` over the result and
match it against those six books, which marks it as filler immediately. The
decoys raise a bulk attacker's cost; they do not create ambiguity.

Which paragraphs get drawn is **random**, via Web Crypto. It used to be derived
from the camouflage attribute and the block key — both printed in the page,
using two public exports — so the decoys could be recomputed straight from the
markup with no CPU and the real payload found by elimination. A reviewer
demonstrated it on eight blocks out of eight.

That asymmetry is the entire reason for choosing this over a hash chain. A hash
chain is equally sequential, but the builder pays exactly what the solver pays,
so the same two hundred blocks at the 14-second default would cost the better
part of an hour to build.

### Freshness

Every block gets its own primes, on every build. Nothing is seeded, nothing is
reused, and there is no way to pin it. So:

- Solving one block teaches an attacker nothing about the next one.
- **Every redeploy invalidates every solution anyone has already computed.**

The same property expires your readers' cached solutions. That is the intended
trade and it is symmetric — it is precisely what expires the crawler's cache.

### The cache persists between visits, which a demo page will not want

Until the next deploy, a solved block stays solved in that reader's browser. The
key is your camouflage attribute plus the first 40 characters of the block's
ciphertext, in `localStorage`, and the solver checks it before it does anything
else — so a returning reader gets their words instantly and never sees the
button.

The stored value is the answer followed by a dot and the time it was last used.
Every read refreshes that stamp, and each page load sweeps anything under your
prefix that has gone 30 days untouched. Without the sweep the store only grew:
ciphertext is re-minted on every build, so each deploy orphaned every key from
the one before it and nothing ever collected them. A page a reader actually
returns to is never swept, because using it is what resets the clock.

That is the right behaviour on a real site, and the wrong behaviour on any page
whose job is to SHOW the protection: a demo, a preview, a screenshot for a
README. Load it twice and the second visit renders plain text, which
demonstrates nothing, and a visitor who copies it gets your real words rather
than the decoys. If you run such a page, clear the keys before the solver runs:

```html
<!-- Demo pages only. Never ship this on a page you actually want protected. -->
<script>
  for (const k of Object.keys(localStorage))
    if (k.startsWith("data-typeface-")) localStorage.removeItem(k);
</script>
```

Use your own `attrName` prefix there if you called `setCamouflage`. Put it
before `<Shield>` renders, so it runs ahead of the solver's first sweep.

---

## How hard, and why

The default is `seconds: 14`. That number is chosen against the cost of OCR, and
the reasoning matters more than the figure.

**A crawler that wants your words never has to touch this puzzle.** It can
render the page and read the pixels. Measured 2026-08: render plus OCR is about
**5.0 CPU-seconds for a real article page** — Tesseract costs ~2.7 ms per *word*
(it tracks text volume, not pixels), a real page carries ~750 words once nav,
sidebar, comments and footer are counted, and a measured 12% of pages need a
retry. That is the floor on ShieldFont's protection, it exists whether or not
this feature does, and no amount of cryptography raises it.

So the target is not "expensive". The target is **not dearer than OCR**, and the
budget is per *block*, because that is what gets sealed. Five blocks on a page
means a page's worth of OCR divided five ways:

```
budget/block = 5.0 CPU-s ÷ 5 blocks       = 1.00 CPU-s
t            = 0.97 × 1.00 × 1,737,000    ≈ 1,680,000 squarings
crawler pays = 1,680,000 ÷ 1,737,000      = 0.97 CPU-s, i.e. 97% of the floor
```

97% rather than 100% on purpose: the 5.0 CPU-s figure is a measurement, not a
constant, and overshooting it is the one direction with no upside.

This also means **difficulty has a ceiling, and 14 sits at it**. Past the OCR
cost, a crawler just takes the cheaper door, so extra difficulty buys nothing at
all and is paid for entirely by disabled readers waiting longer. `sealText`
refuses anything above 30 seconds and anything below 1 — a sanity bound against
a typo, not a security threshold.

**These numbers replaced an earlier set that was wrong in three places at
once.** The old default of 20 seconds was reasoned from ~3 CPU-seconds of OCR
per page, an assumption that server cores run 3-4x a laptop on bignum work
(they do not — they are equal to slightly slower), and a per-*page* costing of a
per-*block* mechanism. Together those billed a crawler about ten times the OCR
floor, and disabled readers paid for all of it.

### Measured numbers

| | |
|---|---|
| Sealing one payload | ~64 ms (median of twelve runs) |
| Sealing one block | ~261 ms |
| Payloads per block | 4 — one real, three decoys |
| Modulus | 2048-bit |
| Default step count | 1,680,000 sequential squarings |
| Warmed Chrome worker, Apple Silicon, `seconds: 10` | **~1.8 s** |
| Warmed Chrome worker, Apple Silicon, `seconds: 14` (the default) | **~2.5 s** |
| Reference rate used for labelling | 120,000 squarings/second |
| V8 BigInt, warmed worker, measured | ~667,000 squarings/second |
| OpenSSL Montgomery assembly, measured | 1,737,000 squarings/second |

**The two reader-side rows are one machine**, and are stated that way on
purpose: Chrome 151 on an Apple M1 Max, macOS 15.7, timed inside the same blob
Worker the solver builds, warmed the same way, medians of eleven runs (1.78–1.82 s
and 2.49–2.54 s). A reader on a phone or in Safari may be several times slower,
which is why the solver measures the device at run time rather than trusting any
figure printed here. The `seconds: 10` row previously read 4.0 s; it dated from
the 5,000,000-step calibration and was impossible under the current one, since a
smaller budget cannot outlast a larger.

The reference rate is an **honest median** — roughly a mid-range phone, or
Safari, which trails V8 on BigInt — not a fast desktop. `seconds` is therefore a
**budget denominated on an ordinary device**, not a promise about yours: a
current desktop finishes well inside it, an old phone may exceed it. The button
says "up to 14 seconds" for that reason — a ceiling, not a point estimate — and
within about 80 ms of a press the live status line replaces it with a real
measurement taken on the actual device.

The rate used to be 250,000 and this file called that "deliberately
conservative". It was not: V8 BigInt on an Apple M1 Max does about 667,000
squarings/second, so the old figure was 96% of one of the fastest consumer cores
in existence, described as a slow one. Every author who reasoned from it was
told their readers would wait N seconds and their readers waited longer. The
number moved **down**, so the same `seconds` now buys fewer steps: that is the
correction, not a weakening.

A larger modulus is *not* more secure here. It makes each squaring slower, so
the same wait buys fewer sequential steps and the puzzle gets **cheaper** for the
crawler. 2048 bits is the sweet spot.

---

## What the reader hears

> **This section describes a block with `wrapper={false}`** — the off-screen
> control. It was written when that was the default. With the wrapper on, the
> same control is drawn in a visible strip; everything below about what is
> *spoken* applies to both, and everything about what is *not drawn* applies only
> with the wrapper off.

Everything below was shaped by listening to it. The first version passed its
markup tests and was unpleasant to use; most of these decisions exist because of
a specific sentence heard in a real VoiceOver session.

### With the wrapper off, the control is invisible

The note and the button are clipped off-screen and left in the accessibility
tree. A sighted reader can already read the block perfectly — the font does that
work — so a note explaining an unlocking mechanism, attached to text that looks
fine, is an unexplained widget and nothing else.

That argument holds for the reader who can see the words. It does not hold for
the reader whose custom typeface has turned them to gibberish, or who reaches
for copy-paste, and that is why the wrapper exists and is now drawn by default.

### The cost of that: keyboard focus disappears

**A sighted person navigating by keyboard, without a screen reader, will Tab
into a control they cannot see, and their focus indicator will vanish.** That
follows directly from clipping the control off-screen, which is what
`wrapper={false}` asks for: invisibility was the requirement.

The standard remedy is the skip-link pattern — clipped until focused, visible
while focused — and it is **not implemented**. If you need a focus indicator on
that control, pass `visualHidden: false`, or leave `wrapper` at its default, and
the control is on screen for everyone.

### Where the words go

`reveal` decides that, and the default hides them too.

- **`"hidden"` (default).** The unlocked words are put into the page for
  assistive technology, clipped off-screen. The encoded block stays on screen,
  untouched. Nothing visibly changes; there is no layout shift and no second
  copy of the text for a sighted reader to be confused by.
- **`"visible"`.** The plain words replace the encoded block on screen. Costs a
  layout shift, and buys selection, copy-paste and browser translation of the
  real text for everybody.

Both modes ship **real text**, not an accessible name. `aria-label` was the
tempting shortcut and it is the wrong tool: a name is announced as one unbroken
string, cannot be navigated by word or sentence, and is prohibited on the
generic elements this renders. A paragraph delivered that way is close to
unusable.

The revealed element **mirrors the shield's own tag**. `<Shield as="h2">`
reveals into an `<h2>`, so heading navigation — the way most screen-reader users
move around a page — still finds it. An earlier cut always used a `<p>` and
silently dropped the outline. (A custom component in `as` cannot be mirrored, so
it falls back to `<p>`, or `<span>` inline.)

### Every button has the same name, on purpose

> Uncover the original text (up to 14 seconds)

**This inverted in 0.3.2 and the reason is worth stating.** The name used to
carry the element type and the block's position — "Unlock the plain text for
paragraph 2" — so that a listener meeting four buttons could tell them apart.
Then unlocking became page-wide: pressing any one button opens every block. Four
different names would describe four different actions where there is one.

**The button name now carries no noun and no ordinal at all.** It is the same
string on every block, because one press is the same action on every block.

The noun and the ordinal still exist — `heading`, `paragraph`, `quote`, `list
item`, `caption`, or **section** for anything else including the default
`<div>`, each counted within its own kind so a page of h2 / p / h2 announces
"heading 1", "paragraph 1", "heading 2" — but they are only used if you supply a
group name for the wrapper. Nothing generates them into the button.

`label` overrides the whole string. **Never put the protected words in it.** The
label ships in the HTML, so a label quoting the text you are hiding hands it to
any scraper for free — the same free bypass as the `href` that was removed.

### The note is said once

The first text-mode block on a page gets the full explanation:

> If you use a screen reader, custom font, or translator, please uncover the
> text before reading.

Every block after it gets the short form:

> Scrambled text. Uncover the original below.

Measured over a multi-block page, the full sentence is spoken in its entirety
for every block, so a six-block article makes somebody listen to the same
explanation six times before reaching any content. That is not thoroughness, it
is an obstacle. `note` overrides the sentence for one block.

### How much it says while it works

1. The button is pressed. The work starts in a background thread, so the page
   stays scrollable and the screen reader stays usable.
2. Within about 80 ms the status line gives the measured estimate — "About 10
   seconds." — and, for waits of twenty seconds or more, adds "You can keep
   reading."
3. Interim updates are planned from that **measured** duration, not fixed:
   under 6 s, none at all; under 20 s, halfway only; 20 s and over, quarters.
   Fixed quarters on a four-second decode meant each update cut off the one
   before it — VoiceOver read the estimate back as "working this" before 25
   percent killed it.
4. The words arrive. In hidden mode the status line says "Done."; in visible
   mode, "Done. The text is shown below."
5. The **answer** is cached in that browser — a number, not your article. On a
   return visit the words are already there, the status line says "The text is
   ready.", and nothing takes focus.

Details that matter, and why:

- **The revealed element is its own polite live region**, so filling it speaks
  it. Moving focus there was supposed to be enough and was not: focus landed and
  announced the bare element role, never the text, so a reader pressed the
  button, heard "Done", and then could not find what they had waited for.
- **The revealed element becomes a real Tab stop** (`tabindex="0"`) once it has
  content — it ships at `-1` so an empty element is not a stop. This exists
  because of one sentence from a VoiceOver session: *"I kept pushing tab, and I
  couldn't re-read the text."* Tab moves between controls, the words were not
  one, and after the announcement finished there was no way back to them.
- **The status line is a bare `<span>` with `aria-live="polite"` and no role.**
  `role="status"` also puts a named landmark in the tree, so a screen reader
  passing an empty one says the word "status" for no reason, once per block —
  two spurious announcements on a two-block page before the reader reached any
  content. Removing the role left an empty `<p>` announcing "paragraph", so it
  is a `<span>`. `aria-atomic="true"` so an update is read whole rather than
  diffed against the previous one.
- **No `role="group"`, and the wrapper is `role="presentation"`.** The group
  role was there to "associate" the note with the button. What it actually
  produced on landing was roughly twenty words of scaffolding per block —
  "…button. Accessible alternative, group. You are currently on a button inside
  of a group. To exit this group press…" — in front of a control whose own name
  already says what it does. Dropping the role stopped the page *asking* to be a
  group; VoiceOver announced the plain `<div>` as one anyway, so the wrapper is
  presentational too. A note followed by a button reads perfectly well as two
  plain siblings.
- **The live region is polite, never assertive.** Assertive would interrupt
  whatever they are listening to, repeatedly, for a background task they were
  explicitly told to keep reading through.
- **The progress bar stays in the accessibility tree.** `<progress>` does not
  announce on its own, so exposing it costs a screen-reader user nothing and
  lets them query exact progress on demand. Sighted users get a smooth bar,
  screen-reader users get milestones they can listen through.
- **The button ships hidden** and is revealed by script only after it confirms
  the browser has `BigInt` and `crypto.subtle`. A control that cannot work is
  worse than no control, and worst of all for someone who cannot see that
  pressing it did nothing. When the check fails, no button ever appears and the
  status line says why.

---

## The options

```tsx
<Shield
  as="p"
  a11y={{
    mode: "text",
    seconds: 14,          // 1..30, default 14
    reveal: "hidden",     // "hidden" (default) | "visible"
    label: undefined,     // overrides the button's accessible name
    note: undefined,      // overrides the explanatory sentence
    noScript: undefined,  // overrides the <noscript> sentence; "" emits none
    visualHidden: true,   // default true
  }}
>
  {body}
</Shield>
```

| Option | Default | What it does |
|---|---|---|
| `seconds` | `14` | Grind time on the reference device. Range 1..30. Read "How hard, and why" before raising it. |
| `reveal` | `"hidden"` | `"hidden"` puts the words in the page for assistive technology only; `"visible"` replaces the encoded block on screen. |
| `label` | *"Uncover the original text (up to N seconds)"* | The button's accessible name — the same on every block, because one press uncovers them all. Must not quote the protected words. |
| `note` | the sentence above | The explanatory sentence for this block. |
| `noScript` | *"Uncovering it needs JavaScript…"* | The `<noscript>` sentence that retracts `note` when scripts are off. `""` emits none. Never put a URL in it. |
| `visualHidden` | `true` | Clips the whole control off-screen while keeping it in the accessibility tree. `false` puts it on screen. |

> **These five — `reveal`, `visualHidden`, `label`, `note` and `noScript` —
> configure the OFF-SCREEN control, so they apply only where
> `wrapper={false}`.** Passing any
> of them together with the drawn wrapper throws, naming the ones it found and
> what to use instead. Until 0.3.2 they were ignored in silence, which meant a
> page that set them and changed nothing else rendered differently on upgrade
> with nothing to say so. Wording moves to `wrapper={{ text }}` and
> `wrapper={{ noScript }}`; the off-screen
> control itself is `wrapper={false}`. The wrapper takes a `className` of its
> own — `wrapper={{ className }}`, applied to the frame `<div>` — because
> `<Shield className>` already lands on the encoded block and on the revealed
> output, and widening it to the frame would have retargeted stylesheets that
> already exist.

---

## Requirements and edge cases

**JavaScript is required**, along with `BigInt` and `crypto.subtle`. The rest of
ShieldFont works with JavaScript off — the font does that work — so this is the
one part that does not. It fails differently on the two tiers, and both failures
are quiet. The drawn wrapper renders its Copy and Uncover buttons normally — no
`hidden`, no dimming — so a reader gets a real, visible, focusable button that
does nothing at all: no navigation, no error, no state change. With
`wrapper={false}` the button ships `hidden` and is only un-hidden by the solver
after its capability check, so the note points at a control that is not in the
accessibility tree. Copy mediation is gone in the same breath, so copying a
shielded paragraph yields decoy words with nothing marking them.

Both tiers ship a `<noscript>` for this. A page-level one carries a stylesheet
that takes the dead controls off the page, in no language at all; a per-block
one carries one sentence, directly after the note, saying the words cannot be
shown without JavaScript and what to do about it. Reword it with `noScript`
(`wrapper={{ noScript }}` on the drawn tier, `a11y.noScript` on the clipped one),
or set it to `""` to emit nothing.

**`crypto.subtle` is absent on insecure origins.** Plain `http://` (other than
localhost) has no Web Crypto, so the control reports that it needs an https
connection rather than claiming the browser is too old.

**A strict Content-Security-Policy may forbid `blob:` workers.** The script
falls back to running on the main thread in short slices with a yield between
them. Slower, but the page keeps responding.

**Per-page numbering needs a render-pass scope.** Under React Server Components
you get one for free, and `withShieldRenderPass()` provides one for the
synchronous `renderToString` renderers. Without a scope there is no way to know
which block is which, so every block is numbered 1 and every block gets the long
note. It still works; it is just louder.

**Styling: do not un-hide the parts.** The button, progress bar and output ship
with both the `hidden` attribute and an inline `display:none`. A single line in
a CSS reset — `progress { display: block }` — is enough to override the
attribute alone and put a dead button and an empty progress bar on every page.
The inline style outranks any author rule that is not `!important`; the script
clears both together when it reveals something. If you write `!important` rules
against these elements, you will break them.

In `reveal: "hidden"` the output element also carries the clipping styles
inline, so it is already off-screen the instant it is un-hidden. Do not fight
them with `display` or `visibility` — either would remove the words from the
accessibility tree, which is the entire thing being delivered.

Style the parts with the class names, all derived from your camouflage
attribute: `…-alt` (wrapper), `…-alt-note`, `…-alt-btn`, `…-alt-status`,
`…-alt-out`. The progress element carries no class, only the `…-bar` data hook
the script wires it by. None of this is visible at all unless you set
`visualHidden: false`.

---

## What was tested, and with what

- **`@guidepup/virtual-screen-reader`, driven by Playwright.** A real
  implementation of accessibility-tree semantics, not a markup assertion, run
  over multi-block pages in both reveal modes.
- **Real NVDA on a Windows runner, in CI on every commit.** `npm run
  test:a11y:nvda`.
- **Real VoiceOver on macOS, by hand.** This is what found the group chatter,
  the truncated announcements and the text nobody could get back to. Every
  decision in "What the reader hears" that cites a session came from here.
- **axe-core, `npm run test:axe`.** Scans both the drawn and the off-screen
  arrangements, before and after the unlock, and reports zero violations across
  its rulesets. **This is not a pass and not conformance.** axe covers roughly a
  third of WCAG, and it cannot judge whether the words handed to a screen reader
  are the words on the screen — which is the entire question here.
- **JAWS is untested.** Nobody has run this under it.
- **Screen review and touch exploration are untested**, by us or by any harness
  we have. [#9](https://github.com/isaqueseneda/shieldfont/issues/9) is the
  standing ask.
- **No published test page**, and no human-reviewed screen-reader recording.

The missing focus indicator under `wrapper={false}` described above is known and
unfixed. Do not read this list as a conformance claim.

---

## What this does not fix

Said plainly, because the launch should not claim otherwise:

- **It is not conformance, and it never becomes conformance.** With this mode
  on, the words are still obtainable rather than sitting in the page source:
  they arrive after a few seconds of the reader's CPU, with JavaScript. No
  auditor is obliged to accept that as equivalent and we do not ask them to.
  What this mode buys is that the words are always *reachable* by a human who
  wants them. That makes a protected page humane. It does not make it compliant.
  See [the accessibility warning](../README.md#accessibility).
- **A reader who forced their own font is not reached by any of this.** They see
  the decoy, rendered fluently, with no signal — and the font-load guard cannot
  detect the case. Only the visible wrapper reaches them:
  [forced fonts](./integration.md#forced-fonts-the-one-with-no-signal).
- **A crawler that wants the text still gets it, more cheaply, via OCR.** This
  feature stops the accessible path being a *shortcut*. It does not stop
  scraping, and it is not a wall.
- **A reader who needs this waits.** Everyone else gets the words instantly.
  That is unequal access however carefully it is engineered, and it is a
  compromise, not a solution.
- **Under `wrapper={false}`, keyboard users without a screen reader lose their
  focus indicator** on the clipped off-screen control. The skip-link remedy is
  not implemented; `visualHidden: false` is the workaround, and the default
  draws the control on screen anyway.
- **Once revealed, the plaintext is in the DOM.** A crawler that runs a real
  browser, presses the button and waits gets the words — having paid the cost,
  which is the deal.
- **Solve-once-and-republish is unaddressed.** Anyone who opens a block can post
  the text elsewhere. True of every scheme, including the font.
- **React only.** The paste-in CDN tier and `@shieldfont/core` ship none of
  this. Closing that gap needs a version that works without a React render.

If you work in accessibility engineering and see a better structure, this is the
highest-value contribution available in the project — starting with JAWS,
screen review and touch exploration. See
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Using the primitive directly

The puzzle is independent of React and is exported for tooling:

```js
import { sealText, solveText } from "@shieldfont/core/puzzle";

const sealed = sealText("The words to protect.", { seconds: 14 });
// → { n: "…", t: 1680000, iv: "…", ct: "…" }

solveText(sealed); // really does the work; takes as long as it promises
```

`sealText` is Node-only — it needs `node:crypto` for prime generation — and is
exported from `@shieldfont/core/puzzle` rather than the package index, so
bundling the core package for a browser never pulls it in.

`{ steps }` sets the step count directly, skipping the seconds range check. It
exists for tests and for tooling that has measured its own audience. It is not a
way to make a page feel faster.
