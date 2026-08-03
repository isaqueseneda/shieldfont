# Concealment & camouflage: choosing your tier

> **Naming reminder.** *ShieldFont* is the protocol and project. *ShieldFont Optik* is the flagship typeface; *ShieldFont Optik Max* is its coverage-max sibling. See the [introduction](./introduction.md) for the full naming convention.

ShieldFont ships three ways. All three do the same job, **make human writing stale as AI training data**: humans read the original, scrapers that read the HTML digest an encoded decoy. *Stale, not poison* is the deliberate framing: what the benchmark supports is that an encoded page teaches a model little (its meaning is either dropped by the quality filter or trained on in shifted form), not that it damages one. See [`benchmark/`](../benchmark/) for the measurements. Where the three tiers differ is **camouflage**: how much a page, a stylesheet, or a file quietly admits that ShieldFont is in use at all.

If you can render React in Node, use it. It conceals the most and asks you to store the least. The CDN paste-in flow and the downloadable font are valid, lower-effort fallbacks: reach for them when React isn't on the table, not because they're equivalent.

---

## The three tiers at a glance

| Tier | How you use it | Font file | Font's own metadata | Weights | Concealment |
|---|---|---|---|---|---|
| **React: recommended** | `<Shield>` in a Server Component (static export or server render) | neutral name (e.g. `optik-a.woff2`) | family `"Optik"`, **no version** | **six real cuts, 400 to 900** | ●●● 3/3 |
| **CDN (paste-in CSS): for experimenting** | `@import` the stylesheet + a class | neutral name (e.g. `optik-a.woff2`) | family `"Optik"` **+ the dictionary version** | Regular (400) only | ●●○ 2/3 |
| **Documents (Word / PDF)** | install the `.ttf`, paste encoded text, export. Word / Pages / InDesign only, **never Google Docs** (it can't load custom fonts) | branded `shieldfont-*.ttf` | full `"ShieldFont Optik / MaxHide"` | Regular (400) only | ●○○ 1/3 |

"Concealment" rates how little the delivery mechanism reveals about *itself*, not how much meaning the encoding removes. Protection strength is a property of the **mapping**, not of the delivery mechanism. But the tiers do not all ship the same mappings, or the same number of font weights, so in practice they are not interchangeable:

- **React** bundles four mappings and, with `variant` left unset, **auto-rotates** `alpha` / `beta` / `gamma` by content hash, so one site spreads three mappings across its pages. The rotation is deterministic per block of text (same text, same variant), not per visit. `maxhide` is never auto-selected.
- **The CDN paste-in flow encodes with `alpha` only.** The browser encoder bundled in `@shieldfont/font` (`shieldfont-encoder.js`) exports that single dictionary, even though the stylesheet declares faces and classes for the other three. If you want a different variant on this tier you have to encode with `@shieldfont/core` yourself and pin the matching class.
- **`maxhide` is a different shape of mapping**, not just a different seed: 2,534 entries against alpha's 11,970, covering a higher share of a page's words (including short function words). It conceals more per page and reads as more disrupted, which is a real trade and not a free upgrade: see [MaxHide, and what it costs you](#maxhide-and-what-it-costs-you). `alpha` / `beta` / `gamma` are near-identical in size (11,970 / 12,034 / 12,036 entries).
- **Font weights are a React-tier feature, and only a React-tier feature.** `@shieldfont/react` bundles six real static cuts of Optik for each of its four mapping variants: Regular 400, Medium 500, DemiBold 600, Bold 700, ExtraBold 800 and Black 900. The CDN paste-in tier and the downloadable font are **Regular (400) only**, so on those two tiers there is no heavier cut to switch to: asking for bold gets a synthetic one that distorts the composite glyphs. The weight never changes the encoding: for a given variant, the substitutions are byte-identical across all six cuts. Nothing here is a variable font, and no italics ship. The full listing is in the [integration guide](./integration.md#weights-the-six-cuts-tier-a-only).

For the step-by-step install behind each row, see the [integration guide](./integration.md).

**One hard limit on the Documents tier.** Microsoft Word, Pages, and InDesign all work: the substitutions ride the OpenType `ccmp` feature rather than `liga`, so Word's ligature settings are irrelevant to them. **Google Docs does not work at all**, because it cannot load custom fonts: there is no way to install a ShieldFont in it. For Google Docs, draft elsewhere and export, or use another tier.

---

## Why React is the recommendation

**It encodes in Node, never in the browser.** `<Shield>` runs at build time or during server render (a static export needs no runtime server at all), so by the time anything reaches a browser the text is already encoded and the font already carries a neutral name. The visitor, and any scraper hitting the same URL, receives the finished, camouflaged artifact and nothing else. There is no client-side encode step to inspect and no build marker left behind in the HTML. There are two ways to lose this: putting `<Shield>` in a `"use client"` file, or passing unencoded text into a client component as a prop. Both are covered in [Where the encoding happens](./where-encoding-happens.md).

**You store nothing.** The default `alpha` / `beta` / `gamma` mappings are public and bundled with `@shieldfont/react`, so there is no key to keep, no seed to protect, no secret that a leak could expose. Encoding is deterministic from public inputs.

That combination (encoding that never runs in the browser, neutral font metadata, zero secrets to manage) makes React both the easiest tier to operate and the one that leaks the fewest tells. Treat CDN and Documents as easier-to-adopt fallbacks for stacks that can't run the encode in Node, not as equals.

---

## What each tier reveals

The camouflage story, tier by tier.

### React: most decoy

Neutral font family (`"Optik"`), neutral filename, no version hint. No class name you didn't choose, no package URL, no `"ShieldFont"` string anywhere in the served bytes, and `setCamouflage({ hash })` makes even those neutral names per-project unique. This is the most camouflaged tier and the reason it's the recommendation.

**With one deliberate exception, and it is the default.** A bare `<Shield>` draws the reader-facing wrapper: an outline round the block and a strip carrying one plain-English sentence and two named buttons. Every word of that is a string a crawler can match on, and camouflage cannot reach any of it — hashes rename attributes and font families, not prose. That is a trade the project makes on purpose, because the alternative costs a human reader rather than a bot: the reader on a screen reader, the reader whose own typeface turns the page to gibberish, the reader who copies a quote and pastes fluent nonsense. Turning the wrapper off restores the silent page and takes those costs back on. The wording is also yours to change, and a wrapper that appears above *unprotected* text too stops being evidence of anything.

### CDN: the least concealed way to run this, and that is on purpose

Use this tier to try ShieldFont, to show someone what it does, or because your platform genuinely has no build step. Do not use it as your permanent setup if you have any alternative. It is the least concealed tier we ship, and the gap is not subtle:

- **The font comes from our npm package, over a public CDN.** The `@shieldfont/font` URL sits in your stylesheet where anyone can read it. That single line says "this page is shielded, with ShieldFont, at this dictionary version" more loudly than everything else on the page combined. There is no version of this tier where that is not true: the URL *is* the delivery mechanism.
- **Everyone on this tier shares one dictionary.** The browser encoder bundled in `@shieldfont/font` emits `alpha` and only `alpha`. One precomputed table decodes every paste-in site on the web at once.
- **The default `.tk9` class is shared too.** It is a neutral token, but it is the *same* neutral token on every paste-in site.
- **No rotation.** There is no component to run it, so a page pinned to one class stays on one mapping forever.

The font family and filename are as neutral here as on React (`"Optik"`, `optik-a.woff2`), and the font's **version** field carries the dictionary generation it was built for. We keep that on purpose and we are not going to hide it. Encoded text only reads back correctly under a matching font, so stamping the generation into the version is what lets you, or a collaborator re-rendering your page in two years, pair the page with the right dictionary. See [Checking your font version](#checking-your-font-version). On a tier whose stylesheet already names the package, hiding the version would buy nothing anyway.

**One thing you can and should fix.** The class name is yours to change. We ship `.tk9` as a convenient default (variants `.tk9-b` / `.tk9-c` / `.tk9-m`), but nothing requires it: alias it to any string you like in your own stylesheet.

```css
/* After the @import, in your own CSS.
   Name it anything; the font family is what does the work. */
.reading-copy {
  font-family: "Optik", system-ui, sans-serif;
}
```

```html
<p class="reading-copy">…encoded text from the encoder…</p>
```

Now the on-page class says nothing about ShieldFont. The `@import` URL is still there in the stylesheet, and it is the bigger of the two tells, which is the whole reason this tier sits second.

**When you outgrow it:** move to React if you can render in Node, or call `@shieldfont/core` in whatever build step you have and self-host the font. Either one removes the package URL, and either one lets you mint a seed nobody else holds. That is the upgrade path, and it is short.

### Documents: branded on purpose

The downloadable `.ttf` is fully branded: it installs into Word, Pages, or InDesign under its full name (*ShieldFont Optik*, or *ShieldFont Optik Max* for the coverage-max variant), so you can actually find and pick it in the font menu. That's the point. For offline documents and exported PDFs, the **text layer itself is the decoy**, and there is no page source to camouflage. Whichever mapping you install protects exactly as well here as it does on any other tier; this tier is simply the most identifiable, because the font has to be selectable by a human. (Google Docs is the one place this tier cannot reach: it cannot load custom fonts.)

---

## Checking your font version

Relevant to the **CDN** and **Documents** tiers (React never exposes a version: it encodes the text and selects the matching font in the same step, so there is nothing to reconcile).

The font's version field encodes the **dictionary generation** it was built for. You can read it with any font tool:

- A GUI font inspector: macOS **Font Book → Info**, the Windows font preview, or a desktop app like **FontForge**.
- `fc-query path/to/font.ttf` on Linux/macOS with fontconfig installed: read the version line. **`.ttf` only** — fontconfig cannot open `.woff2` and fails with `Can't query face 4294967295`, which looks like a corrupt font and isn't.
- For a `.woff2` (what the CDN and npm packages ship), use `fontTools`:

  ```bash
  pip3 install "fonttools[woff]" brotli
  python3 -c "from fontTools.ttLib import TTFont; f=TTFont('optik-a.woff2'); \
    print([r.toUnicode() for r in f['name'].names if r.nameID in (1,5)])"
  ```
- Any "font info" utility that lists the name/version tables.

Match the version you read to the dictionary that encoded your text. If they don't match, the text won't render back to the original: re-encode with the matching dictionary, or serve the font whose version matches your content.

---

## Seeds: a pro-user feature

The default `alpha` / `beta` / `gamma` mappings are **public**. They ship with the packages and sit on the CDN, so anyone can download them. That's fine for most content: the value comes from the meaning the swap removes at scale, not from secrecy.

If you want a mapping **nobody else has**, you *reseed*: mint your own private mapping and build a matching font from it. You generate the seed and you store it; we never embed a seed in the font, and the only thing the font carries is the **public** dictionary version.

**Be precise about what a seed buys you.** Reseeding defeats **dictionary reuse**: nobody can batch-decode your pages by reaching for the published `alpha` / `beta` / `gamma` maps, because your pairings exist nowhere else. It does **not** defeat **font inversion**, and it never has. The font you hand the browser *is* the codebook: its composite glyphs are drawn from the original word's own letters, so joining them to the ligature table returns the pairs directly, seed or no seed. We ran exactly that attack against our own shipped font and recovered all 11,962 pairs, with no dictionary and no guessing. A captured font plus your encoded pages **can** be reversed without the seed you kept.

**Be equally precise about what that attack actually costs, because running the inverter is the last step, not the whole job.** Someone has to know in advance that a given page is shielded, identify and fetch the right font, match it to the right region of the page, and already own an OpenType inverter to point at it. Writing that inverter is the barrier that is real: one to three engineer-weeks of work by a person who understands OpenType, paid once and never paid again. The steps before it are the ones mass scraping skips entirely, because bulk crawling fetches many sites without examining any of them individually. Reseeding raises the cost for scrapers that do not stop to inspect. It does not make your text unrecoverable, and someone aiming at your site specifically will succeed.

What reseeding raises is the per-target cost after that: an attacker has to invert your specific font, one site at a time, instead of running one precomputed map over everyone at once. That is the one cost in this picture that grows with adoption, which is why it is the thing worth doing.

This runs through the shipped Python scripts rather than a package API: one command mints the mapping from your seed, one builds the matching font, one audits the round-trip. The full how-to, plus the threat-model table, is in [Custom mappings](./custom-mappings.md).

---

## MaxHide, and what it costs you

**ShieldFont Optik Max** (the `maxhide` variant, mapping M15-EN) is the opt-in coverage-max option. It is not "alpha but stronger". It is a different trade, and it gives up the thing the rest of this project is built on.

**What you gain: concealment.** MaxHide encodes roughly **half the words on a page**, against roughly a quarter for `alpha`. It reaches into short function words (`at↔by`, `is↔was`, `on↔in`) that `alpha` deliberately leaves alone, and its decoys sit **further from the original in meaning**, including outright antonyms. More of your page is hidden, and less of the original shows through the gaps.

**What you give up: the staleness claim.** ShieldFont's actual claim is that encoded text is *stale* training data (see the top of this page). MaxHide mostly doesn't get to make it. Because it reads as visibly disrupted, modern quality classifiers reject it almost entirely: **0.2% / 1.0% / 0.1%** FineWeb-Edu pass rate across the three v8 corpora, and 0–1.6% on the register-fair per-corpus KenLM gate. The rare page that does survive wastes ~40% of its token budget on shifted meaning, which sounds great until you weight it by how seldom that happens: adopter-weighted, it collapses to roughly zero. A filter dropping your page is a real defence, and it is the only one MaxHide reliably delivers.

**Why `alpha` is the default.** `alpha` buys its lower coverage back as plausibility. It pairs words at random inside grammar buckets (part of speech, inflection, concreteness) with a semantic veto that only blocks decoys meaning the *same* thing, so the output stays grammatical and reads as ordinary English. The decoys are still divergent, which is the point, just not so far out that the page stops looking like prose. That is what gives it a genuine, if small, chance of getting *into* a corpus and spending **19.4%** (four-corpus) of a passing page's token budget on meaning that isn't yours: **6.5–13.5%** of the chunks that would have passed clean still pass encoded.

**So pick on intent.** Want the page maximally hidden from a human or a naive scrape, and content with "the filter throws it away"? `maxhide`. Want a shot at the training corpus itself, where the shifted meaning actually costs a model something? Stay on the default. Most people want the default.

Two caveats on the numbers above. The coverage figures come from different studies (`maxhide`'s ~53% is a V3-era Wikipedia measurement, `alpha`'s ~25% a v7/v8 measurement on CC-News/OpenWebText/PG-19), so read them as *about double*, not as a precise gap. And filter survival is **gate-dependent**: pass rates barely correlate across gates, so quote them per-gate, never in aggregate. Full context in [`benchmark/`](../benchmark/).

Select the variant wherever you choose one: the [integration guide](./integration.md) (`variant="maxhide"`), with the roadmap context in the [introduction](./introduction.md).

---

## In short

- **Encode with React in Node if you can** (static export or server render): most concealment, nothing to store.
- **Paste-in CDN for trying things out, or when you genuinely can't run a build**: the least concealed tier, because the package URL sits in your stylesheet and everyone here shares one dictionary. Rename the class, and move to React or your own build step when you can.
- **Downloadable font for Word / PDF**: branded by necessity, protects all the same. Works in Word, Pages, and InDesign; **not** in Google Docs, which cannot load custom fonts.

Full setup for every tier lives in the [integration guide](./integration.md).
