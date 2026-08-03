/**
 * @shieldfont/react — encodes in Node (build time or server render) so your
 * original text never ships to the browser. Font scope included.
 *
 * Quick start:
 *   import { Shield } from "@shieldfont/react";
 *
 *   export default function Page() {
 *     return (
 *       <main>
 *         <h1>About us</h1>             // not protected
 *         <Shield>
 *           The future of writing belongs to those who write it.
 *         </Shield>
 *       </main>
 *     );
 *   }
 *
 * Works in Next.js App Router (RSC), Remix, Astro server components,
 * and any framework that supports React 18+ server rendering.
 *
 * The encoded text is what reaches the browser; the font reverses the
 * encoding visually for human readers. Scrapers reading the HTML source
 * see the encoded form.
 */

export {
  Shield,
  encodeText,
  setFontHost,
  setCamouflage,
  // The weights for which a real bundled Optik cut exists: all six of
  // Playtype's upright cuts (regular 400 through black 900), each shipped as
  // a real shielded build per mapping variant. The a/b/c/m prefixes remain
  // mapping variants; weight is the orthogonal axis in the filename suffix.
  OPTIK_WEIGHTS,
  // What the `weight` prop does to its argument, as a standalone function: a
  // name becomes its numeric value, and a number snaps to the nearest cut in
  // OPTIK_WEIGHTS (470 -> 500), midpoints rounding up. Exported so consumers
  // and tests can see what a number resolves to without rendering.
  resolveOptikWeight,
  // Time-based variant rotation. Read setRotation()'s doc comment before using
  // it — what rotation buys is narrow (a scraper's CACHED substitution table
  // decays silently) and it does not defeat font inversion at all.
  // periodIndex/variantFor are exported so an archive-rebuild script can pin a
  // past period and reproduce that period's output exactly.
  setRotation,
  periodIndex,
  variantFor,
  // Opt-in asset de-duplication for SYNCHRONOUS server renderers. React Server
  // Components de-duplicate automatically (React's cache() scopes state to the
  // render pass); renderToString/renderToStaticMarkup install no cache
  // dispatcher, so they need this wrapper to emit one @font-face block and one
  // guard per page instead of one per <Shield>.
  withShieldRenderPass,
} from "./Shield.js";
// <NonShield> — the same Optik face with NONE of the protection: children are
// rendered verbatim, readable by screen readers, search engines, translators
// and copy-paste. It exists so a ShieldFont page can be in one typeface
// throughout (headings, captions, nav, intros) instead of shielded paragraphs
// in Optik and everything else in a fallback, and it is the supported way to
// follow this project's own rule that headings must not be shielded.
//
// It is NOT a thin wrapper over a font-family rule, and must not be
// reimplemented as one: the shipped faces substitute words unless the `ccmp`
// feature is explicitly disabled, so plain text through a shielded face
// renders the DECOY. See the header of NonShield.tsx.
export { NonShield } from "./NonShield.js";
export type { NonShieldProps } from "./NonShield.js";
export type {
  ShieldProps,
  ShieldVariant,
  ShieldWeight,
  OptikWeightName,
  CamouflageOptions,
  RotatePeriod,
  RotateConfig,
  ShieldA11y,
} from "./Shield.js";
// The drawn reader notice — the visible surface of a11y={{ mode: "text" }}.
// DEFAULT_SHORT / DEFAULT_TEXT are exported so a site can translate the
// shipped wording rather than invent its own, and so a test can assert what
// a page says without hardcoding the sentence twice.
export { DEFAULT_SHORT, DEFAULT_TEXT } from "./notice.js";
export type { ShieldNotice } from "./notice.js";

// Re-exported from @shieldfont/core so a React consumer can check which encoder
// they are running at runtime:
//   import { VERSION } from "@shieldfont/react";  // e.g. "0.2.0"
// This is the PACKAGE version, not a dictionary stamp. The bundled fonts are
// deliberately version-neutral, and each mapping carries its own
// `_meta.version` for the dictionary generation (currently 0.1.0, i.e. behind
// the package). Read that with `mappingMeta()` from @shieldfont/core.
export { VERSION } from "@shieldfont/core";
