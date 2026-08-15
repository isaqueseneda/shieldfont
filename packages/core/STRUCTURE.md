# Encoder structure (maintainer note): single source of truth

If you are looking for "the encoder," it is `src/encode.ts`. Everything else is
**generated** from this package. This doc exists so a stale copy is never mistaken
for the live one.

## The one rule: never hand-edit a generated encoder

| File | Role | Edit by hand? |
|---|---|---|
| `src/encode.ts` | **THE encoder logic** (encode/decode, tokenizer, digit rule, case) | ✅ this is the source |
| `src/mappings/<variant>.json` | word/digit mapping per variant | ❌ **emitted by `scripts/generate_font.py`** |
| `MANIFEST.json` | variant → its built font + provenance | ✅ (when a font is built) |
| `dist/**` | compiled package | ❌ `npm run build` |
| `../font/shieldfont-encoder.js` | CDN bundle (published as `@shieldfont/font`) | ❌ `scripts/build-encoder-cdn.sh` |
| `site/public/shieldfont-encoder.js` *(dev repo)* | site copy | ❌ generated: do not hand-maintain |
| `scripts/encode_site.py` *(dev repo)* | Python HTML-encoder mirror | ✅ but keep in parity with `encode.ts` |

**Why mappings are emitted, not written:** `generate_font.py` builds the font and
runs `make_injective` (drops many-to-one collisions), then writes
`src/mappings/<variant>.json`. The encoder therefore consumes the *exact* mapping
the font was built from: they can never drift. (This closed the old gap where the
font ran `make_injective` but the encoder build did not.)

## Naming: the `M15EN_ALPHA` landmine

The old bundled constant `M15EN_ALPHA` is a **misnomer**: it is the `m15en` mapping,
not the v18 `alpha`. It is kept only as a deprecated alias. Use:
- **`alpha`**: v18 production, 11,970 injective pairs (default going forward)
- **`m15en`**: the "coverage-maxing" variant (hidden in docs for heavy users)

## Edge cases live in the encoder, not the font

The font is a validated renderer; we do not rebuild it for edge cases.
- **P1, accented words:** Unicode tokenizer + NFC → `café`/`résumé` pass through whole.
- **F1, letter-flanked digits:** encoder pre-swaps digits with 0/2 letter-neighbours
  (font double-reverts those) so `H3O`, `C4H10`, `a3b` round-trip.

This rule applies to every future variant (β/γ …).

## Adding a variant

1. `python3 scripts/generate_font.py … --prefix shieldfont-<variant>`
   → auto-emits `src/mappings/<variant>.json`.
2. Export it in `src/index.ts`; add a `MANIFEST.json` entry.
3. `scripts/build-encoder-cdn.sh <variant>` → CDN bundle.
