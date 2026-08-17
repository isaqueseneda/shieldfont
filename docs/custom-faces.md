<!-- On the wording of commit 50311c1, see the message of the commit that added this line. -->
# Custom faces: bring your own typeface

> **Naming reminder.** Throughout this page: *ShieldFont* (CamelCase) is the protocol; *ShieldFont Optik* is the flagship typeface; *a ShieldFont* is any base font that has been converted using the protocol. See the [introduction](./introduction.md#a-note-on-names-protocol-vs-typeface) for the full naming convention.

A custom mapping and a custom face are two different forks. [Custom mappings](./custom-mappings.md) covers the first: a private dictionary nobody else has. This page covers the second: the typeface your ShieldFont is built on.

You can vary the **base typeface** independently of the mapping. The protocol is typeface-agnostic: `scripts/generate_font.py` accepts any base with **TrueType outlines** (`.ttf`), so you can build on Optik, on Inter, on EB Garamond, or on your own studio's typeface. (CFF/`.otf` fonts are rejected: convert to `.ttf` first; variable fonts are auto-instanced to their default.) The choice of mapping is what protects your content; the choice of base typeface is purely aesthetic and operational. Forking is the intended mode of use on both axes.

---

## The recipe

`scripts/generate_font.py` is a one-command builder: point it at a base TTF, give it a name and a mapping, get back a font binary that obeys the protocol:

```bash
pip3 install -r requirements.txt

python3 scripts/generate_font.py \
  --base-path /path/to/your-typeface.ttf \
  --name "ShieldFont YourTypeface" \
  --prefix shieldfont-yourtypeface \
  --mapping-path scripts/v18alpha_for_font.json \
  --artifact-dir build-artifacts \
  --deterministic --source-date-epoch 0

# Audit the build (optional but recommended). --mapping-id must match the id
# the build used, or the audit hashes the expected glyph names with the wrong
# salt and fails on a correct font. Here that id is "yourtypeface": the
# --prefix minus "shieldfont-", because this mapping file carries no
# `_meta.mappingId` of its own. audit_font.py defaults to "m15en".
python3 scripts/audit_font.py --font public/fonts/shieldfont-yourtypeface.ttf \
  --mapping public/fonts/shieldfont-yourtypeface.map.json \
  --mapping-id yourtypeface \
  --artifact-dir build-artifacts \
  --web-font public/fonts/shieldfont-yourtypeface.woff2
```

On Windows x64, the same workflow is available without installing Python:

```powershell
.\dist\shieldfont-cli.exe generate_font `
  --base-path .\your-typeface.ttf `
  --name "ShieldFont YourTypeface" `
  --prefix shieldfont-yourtypeface `
  --mapping-path .\scripts\v18alpha_for_font.json `
  --artifact-dir .\build-artifacts

.\dist\shieldfont-cli.exe audit_font `
  --font .\public\fonts\shieldfont-yourtypeface.ttf `
  --mapping .\public\fonts\shieldfont-yourtypeface.map.json `
  --artifact-dir .\build-artifacts `
  --web-font .\public\fonts\shieldfont-yourtypeface.woff2
```

Run each command with `--help` for the full forwarded upstream parameter set.

Outputs land in `public/fonts/` as `.ttf`, `.woff2`, `.map.json`, and a ready
`@font-face` CSS. The `--mapping-path` argument decides which dictionary the
font decodes. The example above uses the shipped `alpha` pool; to build against
a private mapping instead, mint one first and pass its path (see [Custom
mappings](./custom-mappings.md)).

The pairing rule from the mappings guide applies unchanged here: a page renders correctly only under a font built from the same mapping that encoded it. Changing the base typeface never changes the pairs; changing the mapping always requires a new font build.

### Flags, identity, and deterministic output

The build identity includes the mapping, source font, compatibility settings,
and safe digests of any `--document-nonce` or `--tenant-id`. The raw values are
not written to logs, file names, manifests, or browser artifacts. Use
`--cache-key` only for an already-opaque cache label; it is also never logged
raw. `--glyph-name-salt` is optional for private mappings and must be repeated
to reproduce the same glyph names.

Useful build flags:

| Flag | Purpose |
|---|---|
| `--deterministic` | Require the pinned in-process HarfBuzz backend. |
| `--source-date-epoch N` | Set reproducible OpenType timestamps; `0` is a useful fixed value. |
| `--artifact-dir DIR` | Emit the canonical artifact set and hash-complete manifest. |
| `--script-langsys SCRIPT[:LANG]` | Bound generated substitutions to explicit OpenType scopes; repeatable. |
| `--supported-mark-set ID` / `--supported-marks ...` | Bound combining-mark handling. |
| `--gsub-optimization auto\|format2\|format3` | Evaluate or select the deterministic GSUB boundary representation. |
| `--json-out PATH` | Write machine-readable diagnostics without mapping words, nonces, or tenant values. |

The canonical artifact roles are deliberate:

| Artifact | Role | Publish? |
|---|---|---|
| `mapping.json`, `font-web.woff2` | Public encoder/font pair | Yes, when needed by the browser. |
| `mapping.audit.json`, `mapping.audit.csv`, `font-audit.ttf` | Private reverse/audit material | No. Keep local or in restricted storage. |
| `shaping-audit.json`, `performance.json`, `security-report.md` | Verification evidence | No browser delivery; publish only after review if appropriate. |
| `build-manifest.json` | Public-role inventory and hashes | Treat paths and contents as public metadata. |

`SOURCE_DATE_EPOCH` or `--source-date-epoch` is the only supported timestamp
input for deterministic artifacts. The tools do not invent timestamps in
canonical metadata. A build can still contain required font license and family
records; those are not mapping data.

### Scripts, languages, and combining marks

The builder normalizes mapping words to Unicode NFC and keeps the base
`ccmp`/`locl`, GPOS, and GDEF data intact. For a multilingual font, restrict
the generated lookup activation explicitly:

```bash
python3 scripts/generate_font.py ... \
  --script-langsys latn:ENG \
  --script-langsys cyrl:RUS \
  --script-langsys cyrl:UKR \
  --script-langsys cyrl:BEL \
  --script-langsys cyrl:SRB \
  --supported-mark-set basic-mn-v1
```

Use `--script-langsys-map scopes.json` for a JSON object/list of the same
selectors. Three-letter OpenType language tags are serialized with their
required trailing byte. Supported combining marks are bounded and filtered
through GDEF; unsupported marks are intentionally a shaping boundary. When
the HTML document has no `lang`, content tooling falls back to `dflt` rather
than guessing a language.

### Feature order and compatibility

Generated substitutions use three explicit stages:

1. **Required source stage**: `ccmp` is preferred, with `locl` as the
   compatibility fallback when a base face has no `ccmp` record. The generated
   fire lookups are inserted before the base face's lookups, preserving the
   placement used by Word, WebKit, and other clients that apply compatibility
   features early.
2. **Required restoration stage**: `rlig` runs after the fire stage. Its class
   and boundary lookups invoke the internal `MultipleSubst` reversal lookup,
   so the order is always fire -> class/boundary check -> restore.
3. **Optional stage**: `calt` (and discretionary `dlig`/`liga`) is not required
   by ShieldFont. Disabling optional ligatures does not disable the generated
   word rules.

The builder prints the feature and lookup IDs, compatibility fallback choice,
subtable byte budgets, and GDEF caret counts/ranges without printing mapping
words. This makes an audit able to compare engines while keeping diagnostics
safe.

---

## Shrinking the font to what your site actually uses

A full ShieldFont carries every pair in its dictionary: ~12,000 source words × 3 case variants ≈ 36,000 composite glyphs, about **825 KB** of woff2 (5 MB as `.ttf`). Almost no site uses more than a fraction of that vocabulary, so `scripts/subset_font.py` reads your own content, works out which pairs it can actually trigger, and drops the rest:

| Vocabulary kept | woff2 |
|---|---|
| 500 pairs | ~82 KB |
| 2,000 pairs | ~197 KB |
| 5,000 pairs | ~402 KB |
| full dictionary | ~825 KB |

A typical site with 2,000 distinct swappable words ships **197 KB instead of about 1 MB**.

```bash
python3 scripts/subset_font.py \
  --font public/fonts/shieldfont-alpha.ttf \
  --mapping public/fonts/shieldfont-alpha.map.json \
  --content 'app/**/*.tsx' --content content/ \
  --out public/fonts/shieldfont-alpha-subset \
  --keep-min 500 --report \
  --artifact-dir build-artifacts/subset \
  --source-date-epoch 0
```

It also accepts `--wordlist top-2000.txt` or piped content (`--stdin --format html`). `--css` writes a matching `@font-face`.

> [!IMPORTANT]
> **Encode with the emitted `<out>.map.json`, and nothing else.** Every run writes the mapping *pruned to match the font*. If the encoder still knows a pair the font no longer carries, it writes that decoy into your HTML, the font has no rule for it, and **the reader sees raw gibberish** — a silent failure that looks fine to you and is broken for everyone else. Encoding with the pruned mapping makes an uncovered word fall back to plain text instead: unprotected, but correct. That is why the mapping is an *output* of this tool rather than something you are trusted to trim yourself.

**When your content changes**, three cases, only one of which hurts:

- **Rebuild font + mapping together** → correct, full coverage.
- **Rebuild neither** → correct. New words are absent from the pruned mapping, so the encoder leaves them alone and they ship as plain text. You lose protection on the new words; nothing breaks.
- **New font with a stale mapping** (or with the full dictionary as the encoder mapping) → **broken.** Readers see raw decoys.

Guard the third case in CI. Each run writes `<out>.subset.json` with a `contentHash` over every input file and a `subsetId` over the kept words, and stamps the same `subsetId` into the pruned mapping's `_meta`. Re-run the tool and diff the manifest: if `contentHash` moved, the font and its mapping must be rebuilt and deployed **together**. `--keep-min N` buys headroom for words your content does not have yet — insurance, not a safety net.

**Two things to know before you reach for this:**

- **It is not wired into the npm packages.** `@shieldfont/react` bundles the full fonts, and there is no prop or flag that subsets them. This is a build-time tool you run yourself against a built font, and then self-host the output.
- **Subset per site, not per page.** A font per URL defeats HTTP caching and gives every page a distinct font fingerprint, which is the opposite of what [concealment](./concealment.md) is trying to achieve.

Subsetting also accepts `--inventory` as an orchestration alias for
`--content`, `--reserve-aliases N` or repeated `--reserve-alias WORD` for
future coverage, and `--document-nonce`/`--tenant-id` for cache-isolated
identities. Only digests enter subset manifests and diagnostics. The emitted
`<out>.map.json` remains the only encoder mapping for the subset; do not
replace it with the private audit mapping or the original full mapping.

Why `pyftsubset` alone will not do this: GSUB layout closure walks the ligature table and pulls every word composite straight back in, so the font stays at ~36k glyphs at every vocabulary size. The layout rules have to be pruned first — and symmetrically across all five lookups, or a half-fired substitution is left un-revertible. That is the work this script does.

---

## Naming

Recommended naming for community-built ShieldFonts: keep `ShieldFont` as the prefix, then add a name **of your own choosing** — *ShieldFont Optik*, *ShieldFont Vellum*, *ShieldFont YourFoundry*. Same CamelCase everywhere, including the font's internal name table; context tells you whether the word means the protocol or a specific typeface.

> [!WARNING]
> **Do not name your build after the typeface you built it on.** Open font licences generally reserve the original name: Inter, Syne and Young Serif each declare a *Reserved Font Name* in [`LICENSE-FONTS`](../LICENSE-FONTS), and OFL §3 forbids using a Reserved Font Name in a Modified Version — §5 terminates the licence if you do. So a font called "ShieldFont Inter" breaches the very licence that let you build it, and the breach is in the font binary's own name table, where anyone can read it.
>
> Name it after your project or your foundry, and credit the base typeface in the font's *Description* field (nameID 10) and in your documentation. That is the field designed for exactly this, and it carries no naming restriction.

---

## Licensing

The code is AGPL-3.0 (see [LICENSE](../LICENSE)). Font binaries are a separate question, and which terms apply depends on the base typeface you build against. Fonts you generate from an OFL base font (Inter, Syne Mono, Young Serif) are OFL-1.1. The shipped default variants are built on **Optik** (© [Playtype](https://playtype.com)), distributed in ShieldFont's shielded form with Playtype's permission: not OFL, and not for standalone use as a typeface. [NOTICE](../NOTICE) has the details for both cases. Check it before redistributing any font binary.

---

## See also

- [`docs/custom-mappings.md`](./custom-mappings.md), a private mapping to build your face against
- [`docs/introduction.md`](./introduction.md), the naming convention and the thesis behind forking
- [`README.md`](../README.md), the same recipe with the full generator-flag table
