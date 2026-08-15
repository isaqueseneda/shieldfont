/**
 * @shieldfont/core — pure encoding/decoding logic for ShieldFont.
 *
 * This package has zero runtime dependencies. It exports the same
 * primitives that every higher-level integration (the React component, a
 * framework adapter, your own build step) uses.
 *
 * Quick start:
 *   import { encode, alpha } from "@shieldfont/core";
 *   const encoded = encode("Publish your writing", alpha);
 *
 * For HTML documents containing shield markers, use the build/ship/check
 * helpers from the markers module — and finish with `assertShipped`, which is
 * the only one of them that can tell a protected page from an unprotected one:
 *   import { buildHtml, shipHtml, assertShipped } from "@shieldfont/core";
 */

import type { Mapping } from "./types.js";

/**
 * The @shieldfont/core **package** release version.
 *
 * This is NOT a dictionary stamp, and it is expected to differ from
 * `_meta.version`. Each mapping carries its own `_meta.version` / `mappingId`
 * marking the *dictionary generation*, which only moves when the word pairs are
 * rebuilt, so a patch release that ships no new dictionary leaves the mappings
 * on the older stamp (today: package 0.3.0, mappings 0.1.0). The bundled fonts
 * are deliberately version-neutral and carry no mappingId at all.
 *
 * To learn which dictionary generation you are running, call
 * `mappingMeta(mapping)`. Do not infer it from VERSION.
 */
export const VERSION = "0.3.5";

export { encode, decode, encodeSegments } from "./encode.js";
export { encodeHtml, decodeHtml } from "./html.js";
export { buildHtml, shipHtml, checkHtml, assertShipped } from "./markers.js";
export type { CheckResult } from "./markers.js";
export { loadMappingFromString, parseMappingId, mappingMeta } from "./mapping.js";
// Build-time only — the corpus the decoy payloads are drawn from. It never
// reaches a browser; what ships is sealed ciphertext, the same size whatever
// text went into it. See decoy-corpus.ts for why it is Austen and why it must
// be run through the encoder before it is sealed.
export { DECOY_CORPUS, decoyParagraphs } from "./decoy-corpus.js";
export type { Mapping, MappingId, Segment } from "./types.js";

// Bundled mapping variants (JSON-imported constants). Each corresponds to a
// built font of the same name — see MANIFEST.json for provenance. Add new
// variants here as their fonts are built (generate_font.py emits the injective
// mapping into ./mappings/<variant>.json).
//   alpha  — v18 production, 11,970 injective pairs (the default; CDN + package)
//   beta   — v18 re-seed 1, 12,034 pairs (package only)
//   gamma  — v18 re-seed 2, 12,036 pairs (package only)
//   m15en  — the "coverage-maxing" mapping (2,534 pairs); backs React
//            `variant="maxhide"` and the shieldfont-maxhide.* font
// The JSON now carries a `_meta` provenance block, so its inferred type is not
// a bare Record<string,string>. Cast to Mapping for the public API (encode()
// ignores `_meta`; read it at runtime via mappingMeta()).
import alphaJson from "./mappings/alpha.json" with { type: "json" };
import betaJson from "./mappings/beta.json" with { type: "json" };
import gammaJson from "./mappings/gamma.json" with { type: "json" };
import m15enJson from "./mappings/m15en.json" with { type: "json" };

export const alpha = alphaJson as unknown as Mapping;
export const beta = betaJson as unknown as Mapping;
export const gamma = gammaJson as unknown as Mapping;
export const m15en = m15enJson as unknown as Mapping;

/**
 * @deprecated Misnomer — this constant is the **m15en** mapping (React
 * `variant="maxhide"`), NOT the v18 "alpha". Kept only so existing imports don't
 * break. Use `m15en` (this exact mapping, backing the `maxhide` variant) or
 * `alpha` (the v18 production default) instead.
 */
export const M15EN_ALPHA = m15enJson as unknown as Mapping;
