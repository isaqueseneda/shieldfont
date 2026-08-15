# Custom mappings: make ShieldFont yours

> **Naming reminder.** Throughout this page: *ShieldFont* (CamelCase) is the protocol; *ShieldFont Optik* is the flagship typeface; *a ShieldFont* is any base font that has been converted using the protocol. See the [introduction](./introduction.md#a-note-on-names-protocol-vs-typeface) for the full naming convention.

ShieldFont ships with three public mapping variants (`alpha`, `beta`, `gamma`) built against the *ShieldFont Optik* typeface. They are good defaults: free, benchmarked, and spread across your pages by `<Shield>`'s content-hash rotation. (That rotation picks one of the three per block of text; it is not a rotation over time, and no mapping is re-minted on a schedule.)

They are also **public**. Every published variant is on the CDN, and a sufficiently motivated scraper could collect all three and reverse-encode any page that uses them. For high-stakes content (manifestos, paywalled essays, investigative journalism, internal documentation) there is a stronger configuration: a mapping that is *yours alone*, never published, never shared with us.

Getting one takes about a minute. This page shows how, and is honest about what it does and does not buy you.

You can also vary the **base typeface**, independently of the mapping. That is a separate fork with its own guide: see [Custom faces](./custom-faces.md). The short version is that the choice of mapping is what protects your content, while the choice of base typeface is purely aesthetic and operational. Forking is the intended mode of use on both axes.

---

> **The one catch, before you start.** A custom mapping only *renders* correctly under a **matching font**. The shipped `alpha`/`beta`/`gamma`/`maxhide` fonts render only their own pairs, so a custom mapping needs its own freshly built font. Skip that step and your human readers see gibberish, silently. Every recipe below ends with a font build for exactly this reason.

---

## What stays private vs. what you ship

| File | Where it lives | What it is |
|---|---|---|
| `your-mapping.json` | **Private. Local disk only.** | The encoder dictionary. The thing scrapers cannot have. |
| `your-font.woff2` | Your CDN (or self-hosted) | The font binary. Its GSUB ligatures map encoded glyphs back to the originals, so the font itself is a decoder ring: anyone who downloads it can read the pairs back out. It is not a secret. |
| `your-font.css` | Your CDN | `@font-face` declaration. |
| Your encoded HTML | Your site | What scrapers actually scrape. A plausible decoy without the mapping. |

Here is the load-bearing caveat, stated plainly: **the encoding is invertible.** The font has to be handed to the browser to render your page, and its ligatures spell out encoded-glyph → original-glyph directly: the composite outlines are literally the original word's letters. Anyone who downloads the font can read the substitution table back out of it. We ran that attack against our own build, two independent ways:

- **Structural, no dictionary needed.** Join each composite glyph's outline components (the original word's letter glyphs) to the GSUB ligature table and you get decoy → original directly. Recovered **11,962 of 11,962 pairs, 0 errors**, in about forty lines of fontTools, against the shipped `optik-a.woff2`.
- **Name-hash dictionary attack — against the download-tier `.ttf`, not the web fonts.** Composite glyphs are named `word.<sha1(salt + "\0" + original)[:16]>`, and the salt is **derived per mapping** (`shieldfont/glyph-names/v1|<mapping id>`; see `GLYPH_NAME_SALT` in `scripts/generate_font.py`). Against an *unsalted* build, hashing a stock system word list plus naive inflections recovered **92.7%** of the pairs — which is what the salt exists to stop, by forcing that precompute to be redone per dictionary instead of once for every ShieldFont ever built. Two caveats in both directions: for a *published* mapping the salt is derivable anyway, since the dictionary ships in `@shieldfont/core`, so there it only removes the cross-mapping rainbow table (for a private mapping, deriving the salt needs the very dictionary the attacker wants). And the route does not exist on the web at all: every `.woff2` we emit has its `post` table dropped to format 3.0, so the shipped `optik-*.woff2` carry **no glyph names whatsoever** — check it with `TTFont(...)["post"].formatType`. Names survive only in the `.ttf` you install for Word and PDF, which keeps them so it is selectable in a font menu.

We quote no wall-clock time for either route, and you should be suspicious of anyone who does. Timing the parse of a font you already hold, with a tool you already wrote, measures the cheapest step and calls it the price of the attack. The steps that actually cost something come first: knowing the page is shielded, finding and fetching the right font, tying it to the right region of the page, and having built the inverter at all.

Closing the plaintext leak in the glyph names — then salting the hash, then dropping the names from every web font outright — raised the cost of the second route and did nothing to the first. A private mapping does **not** make the encoding one-way. What it does is narrower, and still worth doing: it stops an attacker from *reusing a precomputed public dictionary* (`alpha`/`beta`/`gamma`) to batch-decode your pages. They would have to invert *your* specific font, one target at a time. That raises the cost for the naive, scale-driven scrapers that grab HTML and move on. It is obscurity and friction, not a lock. The durable value is the meaning-loss the swap causes for any pipeline that ingests the decoy without inverting the font, plus the consent statement the whole gesture makes.

---

## Reseed: mint a private mapping from your own seed

This is the supported path, and it runs in seconds with the scripts in this repo.

`scripts/reseed_mapping.py` takes the shipped `alpha` word pool and **re-pairs it within its grammatical buckets** at a seed you choose. The same words get encoded, the same decoy vocabulary is used, but which word maps to which is unique to you.

Concretely, given a source mapping `M : plain → decoy` and your private seed:

1. The **set of plain words** is unchanged. The same words get encoded.
2. The **set of decoy words** is unchanged. The same filter-survival properties.
3. The **assignment between them is reshuffled**, constrained to stay inside each grammatical bucket: a noun never gets reassigned to a verb decoy, an adjective never to a noun. That constraint is what keeps the output reading as ordinary English instead of word salad.

**What it costs you: nothing.** Seconds, no GPU, no accounts. **What it buys you:** an attacker holding your encoded HTML cannot reach for a public `alpha`/`beta`/`gamma` dictionary and batch-decode it, because your pairings exist nowhere else.

**What it does not buy you:** read the same mechanism the other way. The font draws encoded-glyph X as the original glyph it was *paired with at font-build time*, so that pairing sits inside the font binary you served. Download the font, read the pairing out, and the seed is moot. Reseeding defeats *dictionary reuse*, not *font inversion*.

### The recipe

```bash
# 1. Mint a private mapping from your seed (seconds). Re-pairs the shipped
#    word pool in-bucket, so decoys stay grammatically matched. Output is the
#    flat {src:tgt} form that the encoder AND generate_font.py consume directly.
#    The script won't create the directory for you, so make it first.
mkdir -p mine
python3 scripts/reseed_mapping.py --seed 8675309 --out mine/mapping.json

# 2. Build a MATCHING font. Required: the shipped fonts render only their own
#    pairs. A random family name is your camouflage.
python3 scripts/generate_font.py \
  --base-path /path/to/your-typeface.ttf \
  --name "Custom A8F3" --prefix shieldfont-mine \
  --mapping-path mine/mapping.json
#    → public/fonts/shieldfont-mine.{ttf,woff2,css}

# 3. Verify the round-trip. Must be clean before you ship anything.
#    --mapping-id is NOT optional: the audit rebuilds each expected glyph name
#    from the same salted hash generate_font.py used, and that salt is derived
#    from the mapping id — which here is "mine", the --prefix minus
#    "shieldfont-". Leave it off and audit_font.py falls back to its default
#    ("m15en"), hashes with the wrong salt, and reports a clean build as a
#    wall of failures.
python3 scripts/audit_font.py --font public/fonts/shieldfont-mine.ttf \
  --mapping mine/mapping.json --mapping-id mine
```

Then keep `mine/mapping.json` off your servers, ship the font and CSS, and encode with the mapping (see [Pointing your code at a custom mapping](#pointing-your-code-at-a-custom-mapping) below).

**Store your seed.** The reseed is deterministic: the same seed and the same source pool always produce a byte-identical mapping. That is your backup. Lose the JSON and you can regenerate it from the seed alone; lose both and you cannot decode your own archived pages.

### Two limits worth knowing

**It reseeds the `alpha` pool, not `maxhide`.** The script needs a source pool carrying the bucket metadata, and that ships for the v18 pool only. `scripts/m15en_for_font.json` is a flat dictionary with no buckets, so pointing `--pairs` at it just errors out. There is no reseeded `maxhide` today.

**It skips the semantic veto.** The from-scratch build rejects a candidate pair when the decoy is too close in meaning to the original. Reseeding preserves the grammatical bucketing but does not re-run that check, so a small fraction of pairs may land closer in meaning than ideal. It also does not reproduce `beta` or `gamma` byte-for-byte: running it at `--seed 1` reproduces only 194 of `beta`'s 12,034 entries, because the shipped variants went through the full build pipeline (semantic veto, collision drops) that this script deliberately skips. What you get is an equivalent-quality mapping that is yours, not a copy of a shipped one.

### Writing a mapping by hand

You do not have to reseed. A mapping is just a flat JSON object of `{"plain": "decoy"}` pairs, written bidirectionally, and `encode()` and `generate_font.py` both take it as-is. A couple of hundred hand-picked nouns is a perfectly legitimate mapping: it encodes less of your page, but it is unique to you, it is quick to verify, and it leaves the rest of your prose readable to search crawlers. Build the matching font and audit it the same way.

Building a mapping *from scratch* (a new word pool, freshly bucketed, with the semantic veto applied) is how `alpha`/`beta`/`gamma` were produced, but that generation pipeline lives in the project's development repository and is not part of this release. Reseeding and hand-writing are what you can run here.

---

## Threat model

|  | alpha/beta/gamma as shipped | Your reseeded mapping |
|---|---|---|
| Setup time | Zero | Minutes |
| Mapping is public? | Yes | No |
| Resists bulk HTML scrapers (FineWeb-style) | Yes | Yes |
| Resists **dictionary reuse** (batch-decode from a precomputed public map) | No, the mapping is public | Yes, your decoys are seed-unique |
| Resists an attacker who **downloads and inverts your font** | No, the font is the codebook | No, the font is the codebook |
| Resists OCR / headless-rendering attacks | No | No |
| Mapping survives if the ShieldFont project disappears | Yes (local cache) | Yes |

Neither column defeats **font inversion**, OCR, or screen-recording. The font is a self-decoding codebook: hand it to a browser and you hand it to anyone, and a scraper that bothers to read it recovers your words directly (we did exactly this against our own shipped file: all 11,962 pairs, 0 errors, no dictionary required). What that takes is an attacker who already knows the page is shielded, fetches the right font, ties it to the right region of the page, and has already built the inverter, which is **one-time engineering** of one to three engineer-weeks. Mass scraping does none of that: it fetches many sites without examining any of them individually. What reseeding buys is narrower still: no *precomputed public dictionary* decodes you, so bulk scrapers that don't stop to invert per-site get a plausible decoy, and the one cost that does scale with adoption is the number of separate fonts an attacker has to invert.

Neither column changes the SEO reality either: encoded text is `aria-hidden` decoy in the DOM, so search engines index the decoy and you can't tell Googlebot from an AI scraper. **Don't wrap content you want ranked** (a small noun-only mapping limits, but does not eliminate, this). Copy-paste yields the encoded form, and screen readers don't read protected regions in normal linear or heading navigation rather than voicing a decoy — reading down the page, a screen reader is never handed the scrambled version, and our NVDA test asserts that. Screen review and touch exploration work differently and we have no automated coverage of them; [#2](https://github.com/isaqueseneda/shieldfont/issues/2) reported a decoy could be reached that way and we have not reproduced it, and [#9](https://github.com/isaqueseneda/shieldfont/issues/9) is the standing ask if you can test it properly. In React, `<Shield>` puts a real alternative beside the hidden block: the words encrypted in the page for the reader to unlock, never a link, since that would hand your words to any scraper that follows it (the costs, including the JavaScript requirement and the focus indicator a sighted keyboard user loses, are in [`plain-text-mode.md`](./plain-text-mode.md)). Outside React you have to set `aria-hidden` and supply that alternative yourself. **A private mapping changes none of the accessibility arithmetic:** the real words still stay out of the page source, which is the whole mechanism, so an audit will flag every block you wrap, and the [accessibility warning](../README.md#accessibility) applies to a mapping you minted yourself exactly as it applies to `alpha`. The rest of what wrapping breaks for a human reader — including forced fonts, which nothing detects — is in [what protecting a block breaks](./integration.md#what-protecting-a-block-breaks). That is friction we accept; see [`docs/integration.md`](./integration.md) for the full v1 threat model.

---

## Pointing your code at a custom mapping

**`@shieldfont/core` encodes with any mapping.** `encode()` takes the mapping as its second argument, so a bring-your-own dictionary needs no special API:

```js
import { encode, decode, loadMappingFromString, mappingMeta } from "@shieldfont/core";
import { readFileSync } from "node:fs";

const mine = loadMappingFromString(readFileSync("./mine/mapping.json", "utf8"));
const encoded = encode("Plain English here.", mine);   // encode with YOUR mapping
const back    = decode(encoded, mine);                 // bijective round-trip

mappingMeta(mine); // → { mappingId, version, variant, pairs, seed } | null
                   //   (null for a BYO mapping with no _meta block)
```

- `encode(text, mapping)` / `decode(text, mapping)`: the bidirectional primitive; any `Record<string,string>` mapping works.
- `loadMappingFromString(json)`: parse a mapping-JSON string into a `Mapping`.
- `mappingMeta(mapping)`: read the `_meta` provenance the build step stamps into the shipped `alpha`/`beta`/`gamma`/`maxhide` mappings. It returns `null` for a hand-rolled mapping, which is a useful reminder that you are off the shipped variants and need a matching font.

**`@shieldfont/react` ships four built-in variants only**: `alpha`, `beta`, `gamma`, `maxhide` (plus `setFontHost()` to self-host and `setCamouflage()` to randomize the family name). There is **no `setMapping()`**: a first-class bring-your-own-mapping path through `<Shield>` is not shipped yet. Today, encode custom content with `@shieldfont/core` at build time and serve your matching custom font yourself.

For static HTML embeds, swap the `@font-face` `src:` URL to point at your CDN copy of the matching font.

---

## Licensing

The code is AGPL-3.0 (see [LICENSE](../LICENSE)). Font binaries are a separate question, and which terms apply depends on the base typeface you build against. The full rundown lives in [Custom faces](./custom-faces.md), together with the recipe for building on a typeface of your own.

Worth knowing regardless of licensing: building your own mapping is the configuration the project actually wants you in. A private mapping protects your content better than a public one, and it costs a minute.

---

## See also

- [`benchmark/`](../benchmark/), the reproducible benchmark and what the numbers do and don't support
- [`docs/custom-faces.md`](./custom-faces.md), building on a base typeface of your own
- [`docs/concealment.md`](./concealment.md), choosing a delivery tier and a variant
- [`docs/integration.md`](./integration.md), the deployment guide
- [`MAPPINGS.md`](../MAPPINGS.md), how the shipped mappings were arrived at
