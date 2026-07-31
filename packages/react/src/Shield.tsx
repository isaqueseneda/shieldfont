import { encode, alpha, beta, gamma, m15en } from "@shieldfont/core";
import { DEFAULT_SECONDS, sealText } from "@shieldfont/core/puzzle";
import * as React from "react";
import { solverScript } from "./solver.js";
import {
  isValidElement,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

/**
 * The three shipped variants. Each identifies BOTH the encoding mapping AND
 * the font file used at render time. alpha/beta/gamma are independent re-seeds
 * of the v18 pool — rotating them per-page/per-region makes large-scale
 * fingerprinting harder for adversarial scrapers.
 */
export type ShieldVariant = "alpha" | "beta" | "gamma" | "maxhide";

/** Rotation period length. `"monthly"` is CALENDAR-aligned, not 30 days. */
export type RotatePeriod = "monthly" | "weekly" | "daily";

// ---- Weights ----------------------------------------------------------------
//
// Do not confuse the mapping variants with weights. optik-a/b/c/m are MAPPING
// variants (alpha/beta/gamma/maxhide); the WEIGHT axis is orthogonal: each
// variant ships six real static cuts of Optik (Playtype's own uprights,
// Regular through Black), encoded through the same pipeline. There is no
// variable font and no synthesised weight anywhere: every file is built from
// one genuine master, and browsers never fake a bold because the six
// @font-face declarations tile the whole 1..1000 weight range (see
// WEIGHT_BANDS) and the rendered element sets `font-synthesis: none`. A
// smeared faux bold of a licensed Playtype typeface would also distort the
// word-ligature composites badly enough to expose that decoys are in play.
//
// The registry names are Playtype's own cut names, lowercased. Adding a
// weight means: build the cut through scripts/generate_font.py (per mapping
// variant), drop it in `fonts/` under the `<prefix>-<weight>.woff2` naming
// rule, and add one entry here plus its band in WEIGHT_BANDS —
// fontFaceCss() picks it up from the registry.

/**
 * The weights for which a real bundled Optik cut exists — all six of
 * Playtype's upright cuts, one shielded build per mapping variant.
 */
export const OPTIK_WEIGHTS = {
  regular: 400,
  medium: 500,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

/** A named weight with a real bundled Optik face. */
export type OptikWeightName = keyof typeof OPTIK_WEIGHTS;

/**
 * What the `weight` prop accepts: a bundled weight name, or a numeric CSS
 * font-weight (1..1000), which SNAPS to the nearest real cut before it is
 * written to the rendered element's style. See {@link resolveOptikWeight}.
 */
export type ShieldWeight = OptikWeightName | number;

/**
 * Configuration for time-based variant rotation. Every field has a default, so
 * `rotate` / `setRotation({})` is a complete configuration.
 */
export interface RotateConfig {
  /** Period length. Calendar-aligned for `"monthly"`. Default `"monthly"`. */
  period?: RotatePeriod;
  /** UTC period-0 anchor, ISO date. Default `"2026-01-01T00:00:00Z"`. */
  epoch?: string;
  /** Per-site string mixed into the period hash. Default `""`. */
  salt?: string;
  /**
   * Variants to rotate through. Default `["alpha", "beta", "gamma"]`.
   * `"maxhide"` is always filtered out — see {@link setRotation}.
   */
  pool?: ShieldVariant[];
  /**
   * Pin the clock. A `Date` or ISO string is an instant (its period index is
   * computed); a number IS the period index. Use it to rebuild a past period
   * byte-for-byte. Default: render time.
   */
  at?: Date | string | number;
}

/**
 * The accessible alternative rendered next to (never inside) a shielded block.
 *
 * `"text"`  — the ORIGINAL words, encrypted into the page behind a time-lock
 *             puzzle. A button decodes them in the reader's browser.
 * `"audio"` — a build-time-synthesised recording of the ORIGINAL words.
 * `"none"`  — an explicit, auditable opt-out; renders nothing and warns not at all.
 *
 * NO PLAIN-TEXT URL IS RENDERED ANYWHERE, and `"text"` is not a return to one.
 * The 0.2.0 shape was `{ mode: "text", href }` — a link to the original words,
 * sitting in the HTML beside the encoded ones, which any scraper reads for the
 * cost of following it. That, and the audio mode's `transcript` link, were
 * removed for a single reason: a URL cannot be offered to a screen reader
 * without being offered to everyone else.
 *
 * What replaces it inverts that. The words ship in the page but ENCRYPTED, and
 * the key is not in the page either — it is the answer to a puzzle that takes a
 * deliberate, tunable amount of the reader's CPU to grind out (default 20
 * seconds; see {@link DEFAULT_SECONDS} in `@shieldfont/core/puzzle` for how that
 * number was chosen against the cost of OCR). Nobody is denied the text. The
 * accessible path simply stops being the CHEAPEST path into it, which is the
 * only property that ever mattered.
 *
 * What it does not fix, said plainly: a crawler that wants the words can still
 * render the page and OCR the pixels for less than the puzzle costs. OCR is the
 * floor on this package's protection and no amount of cryptography raises it.
 * And a reader who needs this waits twenty seconds for words every other reader
 * already has, which is unequal access however carefully it is engineered.
 */
export type ShieldA11y =
  | {
      mode: "text";
      /**
       * Grind time in seconds on a reference laptop. Default
       * {@link DEFAULT_SECONDS} (20). Accepted range 5..120.
       *
       * READ THIS BEFORE RAISING IT. Difficulty is bounded ABOVE by the cost of
       * OCR, not by paranoia: a crawler that finds this puzzle dearer than
       * rendering the page and reading the pixels simply reads the pixels. Past
       * roughly 20 seconds you are buying no protection at all and charging it
       * entirely to disabled readers. Lower it for short blocks if anything.
       */
      seconds?: number;
      /** Overrides the default explanatory sentence for this block. */
      note?: string;
      /**
       * Where the unlocked words go.
       *
       * `"hidden"` (default) puts them in the page for assistive technology
       * only, clipped off-screen, and leaves the encoded block on screen
       * untouched. A sighted reader sees nothing happen — no layout shift, no
       * second copy of the text — because they can already read the block
       * through the font.
       *
       * `"visible"` replaces the encoded block with the plain words on screen.
       * Costs a layout shift, and buys selection, copy-paste and browser
       * translation of the real text for everyone.
       *
       * Note this is NOT `aria-label`. An accessible name is announced as one
       * unbroken string, cannot be navigated by word or sentence, and is
       * prohibited on the generic elements this renders — so a paragraph
       * delivered that way is close to unusable. Both modes ship real text.
       */
      reveal?: "hidden" | "visible";
      /**
       * Overrides the button's accessible name. The default names the element
       * type and its position ("Show the plain text for paragraph 2"), which is
       * what stops several blocks on one page sounding identical.
       *
       * Whatever you pass, do NOT put the protected words in it. The button
       * label ships in the HTML, so a label quoting the text you are hiding
       * hands it to any scraper for free.
       */
      label?: string;
      /**
       * Hide the control visually while keeping it in the accessibility tree
       * (clip-path, never `display:none` — that would remove it from the tree,
       * which is the exact bug this prop exists to fix).
       *
       * **Defaults to `true` for this mode.** A sighted reader can already read
       * the block through the font, so an on-screen widget explaining an
       * unlocking mechanism is, to them, attached to text that looks fine.
       *
       * Pass `false` to put it back on screen. Do that if you need WCAG 2.2 SC
       * 2.4.7: while hidden, a sighted keyboard user Tabs into a control they
       * cannot see and their focus indicator disappears.
       */
      visualHidden?: boolean;
    }
  | {
      mode: "audio";
      /** URL of the audio file. Synthesise it AT BUILD TIME — see the docs. */
      src: string;
      /** Overrides the default explanatory sentence for this block. */
      note?: string;
      /**
       * Hide the control visually while keeping it in the accessibility tree.
       * Defaults to `false` HERE — unlike the text variant, which defaults to
       * `true`. A player nobody can see is a player nobody can press.
       */
      visualHidden?: boolean;
    }
  | { mode: "none" };

/**
 * Props for the <Shield> server component.
 */
export interface ShieldProps {
  /**
   * The HTML element to render. Defaults to `"div"` because most protected
   * regions are block-level paragraphs/headings/quotes; explicitly set
   * `as="span"` for inline use.
   */
  as?: ElementType;

  /**
   * Pin the encoding/font variant. Leave UNSET (default) to AUTO-ROTATE across
   * `"alpha"`/`"beta"`/`"gamma"` by content hash — a site then uses all three
   * mappings, so no single mapping dominates (harder for scrapers to learn).
   * Pin `"alpha" | "beta" | "gamma"` for a fixed one, or `"maxhide"` for the
   * M15 maximum-coverage dictionary (encodes a higher share of common words).
   *
   * Note: mixing variants on one page loads one font per variant used
   * (roughly 825 KB each). Pin a single variant if you want just one font per page.
   */
  variant?: ShieldVariant;

  /**
   * Font weight. Accepts a bundled weight name (`"regular"` | `"medium"` |
   * `"demibold"` | `"bold"` | `"extrabold"` | `"black"` — Playtype's six
   * upright cuts, all of which ship as real shielded builds; see
   * {@link OPTIK_WEIGHTS}) or a numeric CSS font-weight (1..1000). Default:
   * unset (the element inherits its `font-weight`).
   *
   * These are six static cuts, not a variable font, so a number that is not
   * one of them SNAPS to the nearest cut and the element is given that
   * resolved value: `weight={470}` emits `font-weight:500`, `weight={620}`
   * emits `600`. Exact midpoints round UP (`450` -> `500`). Nothing is ever
   * synthesised, so the strokes on screen are always Playtype's own.
   *
   * {@link resolveOptikWeight} is the same resolution as a standalone
   * function, for code that wants to know what a number will become.
   */
  weight?: ShieldWeight;

  /** Line-height passthrough. */
  lineHeight?: number | string;

  /** Font-size passthrough. */
  size?: string;

  /** className escape hatch — merges with the internal scope class. */
  className?: string;

  /** style escape hatch — merges with the internal font-family scope. */
  style?: CSSProperties;

  /**
   * Time-based variant rotation. Omitted, or `false`, keeps today's behaviour
   * (content-hash auto-rotation). `true` uses the defaults; pass a
   * {@link RotateConfig} to tune period, epoch, salt or pool.
   *
   * Precedence, highest first: an explicit `variant` prop (always pins), then
   * this prop, then module-level {@link setRotation}, then the content hash.
   *
   * ONLY SAFE WHERE THE `@font-face` TRAVELS WITH THE HTML — which is exactly
   * what `<Shield>` does. See {@link setRotation} for the full honesty note and
   * for why the CDN paste-in tier does not get this feature.
   */
  rotate?: boolean | RotateConfig;

  /**
   * The accessible alternative for this block. Rendered OUTSIDE the
   * `aria-hidden` region and BEFORE it in DOM order, so a screen-reader user
   * reaches it before the silence.
   *
   * `{ mode: "text" }` is the recommended one and needs nothing from you: the
   * original words are encrypted into the page at build time and a button
   * decodes them in the browser. `{ mode: "audio", src }` wants a file you
   * synthesised yourself. `{ mode: "none" }` is an explicit, auditable opt-out.
   * Omitting `a11y` entirely logs one development-time warning per process.
   *
   * No mode renders a link to a plain-text copy. See {@link ShieldA11y}.
   *
   * @example
   *   <Shield a11y={{ mode: "text" }}>{body}</Shield>
   *   <Shield a11y={{ mode: "text", seconds: 10 }}>{shortPullQuote}</Shield>
   *   <Shield a11y={{ mode: "audio", src: "/audio/post-1.mp3" }}>{body}</Shield>
   *   <Shield a11y={{ mode: "none" }}>{body}</Shield>
   */
  a11y?: ShieldA11y;

  /**
   * The content to encode. MUST be a plain string.
   *
   * Anything else throws. Nested JSX is rejected rather than walked, because
   * a walk cannot see inside your own components: their text would ship to
   * the browser unencoded inside a block that still looks protected. That is
   * a silent leak, so <Shield> fails loud instead. Split mixed content into
   * separate <Shield> instances.
   */
  children: string;
}

// Each variant maps to its own injective mapping AND its own font file.
// alpha/beta/gamma are independent re-seeds of the v18 pool (the auto-rotation
// pool); `maxhide` is the M15 maximum-coverage dictionary (opt-in only, still
// backed by the m15en mapping exported from @shieldfont/core).
/**
 * Every prop `<Shield>` understands. Anything else is rejected rather than
 * silently discarded — see the check at the top of the component.
 */
const SHIELD_PROPS = new Set([
  "as", "variant", "weight", "lineHeight", "size",
  "className", "style", "rotate", "a11y", "children",
]);

const MAPPINGS: Record<ShieldVariant, Record<string, string>> = {
  alpha: alpha as Record<string, string>,
  beta: beta as Record<string, string>,
  gamma: gamma as Record<string, string>,
  maxhide: m15en as Record<string, string>,
};

// The DEFAULT injected font-family per variant. NEUTRAL by design: the React
// package is the "fully hidden" surface, so nothing it writes into the SSR HTML
// says "ShieldFont". These match the react-tier woff2's neutral name table
// ("Optik"). The BRANDED names ("ShieldFont Optik" / "ShieldFont MaxHide") live
// only in the download-tier font name tables (public site .ttf / MS Word) and
// in packages/font's paste-in CDN CSS — never here. Override per project with
// setCamouflage({ familyName }) — see setCamouflage() below.
const FONT_FAMILY: Record<ShieldVariant, string> = {
  alpha: "Optik",
  beta: "Optik Beta",
  gamma: "Optik Gamma",
  maxhide: "Optik Max",
};

const FONT_FILE: Record<ShieldVariant, string> = {
  alpha: "optik-a",
  beta: "optik-b",
  gamma: "optik-c",
  maxhide: "optik-m",
};

/**
 * Camouflage state — every SSR-visible fingerprint can be overridden by
 * the host project via setCamouflage(). The defaults below are the
 * branded values and remain unchanged for projects that don't call
 * setCamouflage at all (backward-compatible).
 *
 * Why this exists: every page rendered with the default branded values
 * carries the same recognizable fingerprints (`data-typeface`,
 * `font-family: 'Optik'`, `optik-a.woff2`,
 * `__shieldfont_guard__`, console.error('[shieldfont] ...'). A scraper that
 * indexes one ShieldFont-protected page knows what to look for on every
 * other one. Per-project hash camouflage breaks that pattern — each project
 * picks its own 4-char hash at setup time and bakes it into every literal,
 * so two projects' source HTML have no shared signature.
 *
 * Pick any random 4-8 char hash and call setCamouflage({ hash }) once in your
 * root layout — every SSR-visible literal derives from it, so two projects share
 * no signature.
 */
interface CamouflageState {
  /** Font-family per variant. */
  family: Record<ShieldVariant, string>;
  /** Font filename prefix per variant (no extension). */
  file: Record<ShieldVariant, string>;
  /** Data attribute name on the rendered <Tag>. */
  attrName: string;
  /** Window-level idempotency flag name for the guard script. */
  guardFlag: string;
  /** Console message prefix for guard errors/warnings. */
  logPrefix: string;
}

const camo: CamouflageState = {
  family: { ...FONT_FAMILY },
  file: { ...FONT_FILE },
  // NEUTRAL default: nothing in the SSR-visible DOM says "shield". The data
  // attribute stamped on every rendered element is a generic-looking
  // "data-typeface"; setCamouflage({ hash }) further randomises it per project
  // to "data-typeface-<hash>".
  attrName: "data-typeface",
  guardFlag: "__tf_guard__",
  logPrefix: "[typeface]",
};

/**
 * Options for setCamouflage. All fields optional.
 *
 * Passing `{ hash }` alone is the recommended path — every other field
 * gets a deterministic, generic-sounding default derived from the hash:
 *
 *   hash: "a8f3" =>
 *     family:    "Optik a8f3"
 *     file:      "font-a8f3" + variant suffix
 *     attrName:  "data-typeface-a8f3"  (still per-project unique, but
 *                                       indistinguishable from a normal
 *                                       BEM/utility data attr in HTML)
 *     guardFlag: "__fg_a8f3__"
 *     logPrefix: "[typeface a8f3]"
 *
 * Override any individual field if you want a different name.
 */
export interface CamouflageOptions {
  /** 4-8 character random token. Pick any hex-ish string; it just needs to be unique per project. */
  hash?: string;
  /** Override the public font-family literal. Per variant or global. */
  familyName?: string | Partial<Record<ShieldVariant, string>>;
  /** Override the font filename prefix. Per variant or global. */
  filePrefix?: string | Partial<Record<ShieldVariant, string>>;
  /** Override the data attribute name placed on every Shield-rendered element. */
  attrName?: string;
  /** Override the window-level idempotency flag for the guard script. */
  guardFlag?: string;
  /** Override the console.error/warn prefix used by the guard script. */
  logPrefix?: string;
}

/**
 * Apply camouflage to every SSR-visible literal. Call once at module load
 * time — from a one-line import in your root layout.
 *
 * @example
 *   // app/layout.tsx — pick any random 4-8 char hash
 *   import { setCamouflage } from "@shieldfont/react";
 *   setCamouflage({ hash: "a8f3" });
 *
 * @example  Per-key override (advanced):
 *   setCamouflage({
 *     hash: "a8f3",
 *     familyName: "Mercury Display",
 *     attrName: "data-body",
 *   });
 */
export function setCamouflage(opts: CamouflageOptions): void {
  const hash = (opts.hash ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

  if (hash) {
    const variants: ShieldVariant[] = ["alpha", "beta", "gamma", "maxhide"];
    for (const v of variants) {
      // Default family from hash: short, generic-sounding, still unique per project.
      camo.family[v] = `Optik ${hash}${v === "alpha" ? "" : " " + v[0].toUpperCase() + v.slice(1)}`;
      camo.file[v] = `font-${hash}${v === "alpha" ? "" : "-" + v}`;
    }
    camo.attrName = `data-typeface-${hash}`;
    camo.guardFlag = `__fg_${hash}__`;
    camo.logPrefix = `[typeface ${hash}]`;
  }

  // Apply explicit overrides on top.
  if (opts.familyName !== undefined) {
    if (typeof opts.familyName === "string") {
      camo.family.alpha = camo.family.beta = camo.family.gamma = camo.family.maxhide =
        opts.familyName;
    } else {
      Object.assign(camo.family, opts.familyName);
    }
  }
  if (opts.filePrefix !== undefined) {
    if (typeof opts.filePrefix === "string") {
      camo.file.alpha = camo.file.beta = camo.file.gamma = camo.file.maxhide = opts.filePrefix;
    } else {
      Object.assign(camo.file, opts.filePrefix);
    }
  }
  if (opts.attrName) camo.attrName = opts.attrName;
  if (opts.guardFlag) camo.guardFlag = opts.guardFlag;
  if (opts.logPrefix) camo.logPrefix = opts.logPrefix;
}

// ---- Per-render-pass emission registry --------------------------------------
//
// The @font-face <style> and the font-load guard <script> are PAGE-level
// assets, but <Shield> is a leaf component, so N shields on a page emit N
// identical copies of both (~3.7 kB a pair). De-duplicating them needs the one
// thing React does not hand a server component for free: state scoped to the
// current render pass and to nothing wider.
//
// There are exactly two places to get that safely:
//
//   1. React's `cache()`. Under React Server Components the renderer installs a
//      cache dispatcher, so a cache()d factory returns ONE object per render
//      pass, isolated per request and safe under concurrency. That covers the
//      Next.js App Router, this package's primary target.
//   2. {@link withShieldRenderPass}, an explicit opt-in wrapper for the
//      synchronous SSR renderers. `renderToString` / `renderToStaticMarkup`
//      install no cache dispatcher (verified on React 18 AND 19 — cache()
//      silently stops memoising and returns a fresh value per call), so RSC's
//      automatic path cannot help them.
//
// A bare module-level Set is NOT one of them, and neither is a
// microtask-scoped one. A static export that renders page after page in a
// single synchronous loop would emit the assets on the first page only and
// ship every later page with no @font-face and no guard: invisible in the
// HTML, catastrophic on screen, since the reader then sees the raw decoy text
// in a fallback font. So when neither scope above is available, <Shield> falls
// back to emitting per instance exactly as it always has. Bigger, never broken.

interface PassRegistry {
  /** Families whose @font-face <style> this pass has already emitted. */
  styles: Set<string>;
  /** Families whose guard bootstrap <script> this pass has already emitted. */
  guards: Set<string>;
  /** `family|weight` pairs already seeded into this pass's guard. */
  weights: Set<string>;
  /** Whether this pass has already emitted the puzzle solver script. */
  solvers: Set<string>;
  /** Whether this pass has already spent its one long explanatory note. */
  notes: Set<string>;
  /**
   * Monotonic counter behind the element IDs the puzzle control needs.
   *
   * IDs must be unique within a document, and a content hash alone is not:
   * two `<Shield>`s wrapping the same sentence hash identically, and the
   * solver would then hide the wrong block on reveal. The counter
   * disambiguates them.
   *
   * It lives HERE, in pass scope, rather than at module level, because a
   * module counter would advance across requests and hand the same tree
   * different IDs on server and client — a hydration mismatch on every page
   * that uses `withShieldRenderPass` around a hydrated render. Pass scope is
   * exactly the lifetime an ID needs.
   */
  seq: number;

  /**
   * Per-noun counters for the spoken ordinal, keyed by the word a reader
   * actually hears ("heading", "paragraph", "quote").
   *
   * `seq` cannot do this job. It counts every block on the page, so a page of
   * h2 / p / h2 announced "heading 1", "paragraph 2", "heading 3" — and a
   * listener looking for the second heading hears a number that does not exist
   * on the page. That is precisely the confusion the label was added to fix.
   */
  nouns: Map<string, number>;
}

function newPassRegistry(): PassRegistry {
  return {
    styles: new Set(),
    guards: new Set(),
    weights: new Set(),
    solvers: new Set(),
    notes: new Set(),
    seq: 0,
    nouns: new Map(),
  };
}

/** The scope opened by {@link withShieldRenderPass}, if one is open. */
let explicitPass: PassRegistry | null = null;

type CacheFn = <T>(fn: () => T) => () => T;

/**
 * React's `cache`, when the running React exports it (React 19 and the RSC
 * canaries). Read defensively rather than imported by name: a static
 * `import { cache } from "react"` is a hard module-resolution error on React
 * 18, which this package still supports.
 */
const reactCache: CacheFn | undefined = (() => {
  const mod = React as unknown as { cache?: CacheFn; default?: { cache?: CacheFn } };
  if (typeof mod.cache === "function") return mod.cache;
  const viaDefault = mod.default?.cache;
  return typeof viaDefault === "function" ? viaDefault : undefined;
})();

const cachedPass: (() => PassRegistry) | undefined = reactCache
  ? reactCache(newPassRegistry)
  : undefined;

/**
 * The registry for the render pass in flight, or `null` when there is no pass
 * scope and every <Shield> must therefore emit its own assets.
 */
function currentPass(): PassRegistry | null {
  if (explicitPass) return explicitPass;
  if (cachedPass) {
    // React's cache() documents itself as falling through to the raw factory
    // when no cache dispatcher is installed, so two calls in a row return the
    // SAME object only while a real RSC render pass is in flight. Comparing
    // identity is the only reliable way to tell the two situations apart —
    // `typeof cache === "function"` is true in both.
    const first = cachedPass();
    if (first === cachedPass()) return first;
  }
  return null;
}

/**
 * Claim `key` in one of the registry's buckets for this render pass. Returns
 * `true` when the caller owns the claim and should emit the markup, which is
 * unconditionally the case when no pass scope is active.
 */
function claim(bucket: "styles" | "guards" | "weights" | "solvers" | "notes", key: string): boolean {
  const pass = currentPass();
  if (!pass) return true;
  if (pass[bucket].has(key)) return false;
  pass[bucket].add(key);
  return true;
}

/**
 * A document-unique ID for one shielded block, for the puzzle control to point
 * at. Deterministic within a render pass; see {@link PassRegistry.seq}.
 *
 * Outside a pass scope there is no counter to draw on, so the hash stands
 * alone. Two identical strings shielded on one page would then share an ID,
 * and the consequence is contained: the solver hides whichever block the
 * document reaches first, so one block keeps showing its (correct, font-
 * rendered) decoy under the revealed text instead of disappearing. Cosmetic,
 * and it cannot happen under RSC, which is where this component lives.
 */
function blockIdFor(encoded: string, noun: string): { id: string; ordinal: number } {
  const pass = currentPass();
  const base = `${camo.attrName}-${hashString(encoded).toString(36)}`;
  // The ordinal doubles as the button's disambiguator ("paragraph 2"), so it is
  // 1-based: it is spoken to a person, not used as an index. It counts within
  // its own noun, while the id keeps using the page-wide `seq` — the id has to
  // be unique across the document, the ordinal has to match what a reader
  // counts as they move down the page.
  if (!pass) return { id: base, ordinal: 1 };
  const n = pass.seq++;
  const seen = (pass.nouns.get(noun) ?? 0) + 1;
  pass.nouns.set(noun, seen);
  return { id: `${base}-${n}`, ordinal: seen };
}

/**
 * Give a SYNCHRONOUS server render one shared <Shield> asset scope, so the
 * @font-face <style> and the font-load guard <script> are emitted once for the
 * page instead of once per <Shield>.
 *
 * React Server Components get this automatically (see the note above), so
 * Next.js App Router users never need this function. It exists for the
 * renderers that install no React cache dispatcher:
 *
 * @example
 *   import { renderToString } from "react-dom/server";
 *   import { withShieldRenderPass } from "@shieldfont/react";
 *
 *   const html = withShieldRenderPass(() => renderToString(<App />));
 *
 * Wrap ONE render call, and only a synchronous one. `renderToPipeableStream`
 * and friends return before the tree has finished rendering, so the scope
 * closes early and later shields fall back to emitting their own assets. That
 * costs bytes and never correctness, which is the trade this whole mechanism
 * is built around: a shield that emits its assets twice is merely large, a
 * shield that emits none is a page of visible decoy text.
 */
export function withShieldRenderPass<T>(render: () => T): T {
  const outer = explicitPass;
  explicitPass = newPassRegistry();
  try {
    return render();
  } finally {
    explicitPass = outer;
  }
}

/**
 * Where the @font-face URLs point. SELF-HOSTED ONLY by design.
 *
 * The React component does NOT ship a default CDN. Reason: a typography-based
 * scraping defense MUST fail loudly, never silently. If the font cannot
 * load — bad URL, network failure, deleted CDN release — readers would
 * otherwise see the encoded gibberish on screen, with no clear signal that
 * anything is wrong. That is the worst possible outcome for a privacy tool.
 *
 * Self-hosting fixes this:
 *   1. The font ships with your build, never disappears.
 *   2. If it ever does fail to load, the bundled font-load guard (below)
 *      detects it within a few seconds and visibly replaces every
 *      protected element with "Content unavailable" — never with the
 *      raw decoy text.
 *
 * Setup (one time, in your app's `public/` directory or equivalent):
 *
 *   cp node_modules/@shieldfont/react/fonts/*.woff2 public/fonts/
 *
 * These woff2 files ship inside THIS package on purpose — their name tables are
 * version-neutral ("Version 1.0"), so the served bytes reveal no dictionary
 * version. The React tier bundles its own copy rather than reusing
 * @shieldfont/font, whose fonts embed the dictionary version (`Version 18.0`) as
 * the CDN tier's deliberate pairing tell. Keeping them separate is what makes the
 * React surface fully hidden.
 *
 * Default `fontHost` is `/fonts`, which assumes the copy step above. Override
 * with `setFontHost('/your-path')` if you serve them somewhere else.
 */
const DEFAULT_HOST = "/fonts";
let fontHost = DEFAULT_HOST;

/**
 * Point Shield at a different self-hosted location.
 *
 * @example
 *   setFontHost("/fonts");                  // default — public/fonts/
 *   setFontHost("/static/shieldfont");      // a different subdirectory
 *   setFontHost("https://cdn.your-org.com/shieldfont"); // your OWN CDN, not jsDelivr
 *
 * Do NOT pass a public CDN URL you don't control — the package deliberately
 * removed its default CDN to prevent silent breakage in production.
 */
export function setFontHost(url: string): void {
  fontHost = url.replace(/\/+$/, ""); // strip trailing slashes
}

/**
 * The `font-weight` band each real cut claims in its @font-face.
 *
 * The bands tile 1..1000 with no gaps, so ANY numeric CSS weight matches
 * exactly one declared face and no browser can be tempted to synthesise a
 * weight. Synthetic bolding is never acceptable here: beyond smearing a
 * licensed Playtype typeface, it would distort the word-ligature composite
 * glyphs and visibly expose that decoys are in play. `font-synthesis: none` on
 * the rendered element is the belt-and-braces for the same rule (and covers
 * faux italic too).
 *
 * These bands and {@link resolveOptikWeight} say the same thing twice, on
 * purpose. The component now snaps a number to a real cut BEFORE it writes
 * `font-weight`, so in practice every value that reaches the CSS is already
 * the exact centre of its band. The bands still matter for the weights
 * <Shield> never sees: one that arrives by inheritance or from the host
 * project's own stylesheet. Keep the two in step when editing either;
 * test/weight.test.ts asserts they agree on every integer in 1..1000.
 */
const WEIGHT_BANDS: Record<number, string> = {
  400: "1 449",
  500: "450 549",
  600: "550 649",
  700: "650 749",
  800: "750 849",
  900: "850 1000",
};

/**
 * The real cuts, ascending. Derived from {@link OPTIK_WEIGHTS} rather than
 * written out again, so adding a cut to the registry changes the snapping with
 * it and there is no second list to forget.
 */
const OPTIK_CUTS: readonly number[] = Object.values(OPTIK_WEIGHTS)
  .slice()
  .sort((a, b) => a - b);

/**
 * The nearest real cut to `value`, with exact midpoints rounding UP.
 *
 * The tie-break is not a free choice: the @font-face bands above already round
 * midpoints up (450 sits in the 500 band, 550 in the 600 band, and so on), and
 * the two resolutions have to agree exactly or the number <Shield> emits would
 * render as a different cut than the number an author typed used to. Iterating
 * ascending and accepting a later cut on `<=` is what implements that.
 *
 * The `Math.round` is the same agreement rule applied to FRACTIONAL input, and
 * it is load-bearing rather than tidy-up. The bands are integer-delimited, so a
 * value like 449.5 falls in the one-unit gap between "1 449" and "450 549" and
 * no band contains it. Browsers resolve that gap by rounding to the nearest
 * integer first (verified in Chrome: 449.2 matches the 400 face, 449.5 and
 * 449.9 match the 500 face), whereas raw nearest-cut arithmetic would send all
 * three to 400 because 449.5 is 49.5 away from 400 and 50.5 away from 500.
 * Rounding first reproduces what the browser already did.
 */
function nearestCut(value: number): number {
  // Half-up, matching both the band midpoints and the browser's own rounding.
  const target = Math.round(value);
  let best = OPTIK_CUTS[0] as number;
  let bestDistance = Math.abs(best - target);
  for (const cut of OPTIK_CUTS) {
    const distance = Math.abs(cut - target);
    // `<=`, not `<`: the cuts are ascending, so taking the later one on a tie
    // is what rounds an exact midpoint up.
    if (distance <= bestDistance) {
      best = cut;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The bundled filename for one variant at one weight. The Regular (400) file
 * keeps the historical bare name (`optik-a.woff2`); every other cut carries a
 * numeric suffix (`optik-a-700.woff2`). Same rule for camouflaged prefixes.
 */
function weightFile(prefix: string, numeric: number): string {
  return numeric === 400 ? `${prefix}.woff2` : `${prefix}-${numeric}.woff2`;
}

/**
 * Build the @font-face CSS for a given variant: one face per bundled weight,
 * all under the variant's single family name. Lives in a <style> tag inserted
 * into the JSX.
 *
 * React does NOT de-dupe identical <style> tags in SSR output — not under
 * React 18, and not under React 19 without the `precedence` prop that hoists
 * them into <head>. The de-duplication is ours, per render pass, and it is
 * best-effort by design: see the PassRegistry note above.
 *
 * Browsers only download a face when text actually resolves to its band, so
 * declaring six faces costs no extra bytes on a single-weight page. That holds
 * only as long as nothing else asks for a band nobody uses, which is exactly
 * the mistake the font-load guard used to make (it probed a bare `1em` font
 * shorthand, i.e. weight 400, and pulled Regular onto every page).
 */
function fontFaceCss(variant: ShieldVariant): string {
  const file = camo.file[variant];
  const family = camo.family[variant];
  // woff2 only — universally supported and keeps the bundled package small
  // (~1 MB/cut vs ~5 MB for the TTF).
  //
  // font-display:block (NOT swap): with swap the browser paints the encoded
  // decoy text in a fallback font first, so readers see gibberish until the
  // ShieldFont face loads (FOUT). block keeps the text invisible during the
  // short block period, matching the CDN path — no gibberish flash. The 4s
  // font-load guard below covers the case where the face never loads.
  //
  // Each face claims its WEIGHT_BANDS range so arbitrary numeric weights snap
  // to the nearest real cut; nothing is ever synthesised (see WEIGHT_BANDS).
  return Object.values(OPTIK_WEIGHTS)
    .slice()
    .sort((a, b) => a - b)
    .map(
      (numeric) =>
        `@font-face{font-family:'${family}';src:url('${fontHost}/${weightFile(file, numeric)}') format('woff2');font-weight:${WEIGHT_BANDS[numeric]};font-style:normal;font-display:block;}`,
    )
    .join("");
}

/**
 * Resolve a `weight` prop value to the real cut it will render as.
 *
 * This is the whole weight contract in one function, exported so a consumer or
 * a test can ask what a number becomes without rendering anything:
 *
 * ```js
 * resolveOptikWeight("demibold"); // 600
 * resolveOptikWeight(470);        // 500
 * resolveOptikWeight(450);        // 500  (exact midpoints round UP)
 * ```
 *
 * A NAME must be a key of {@link OPTIK_WEIGHTS} (Playtype's six upright cut
 * names, lowercased) and resolves to its numeric value.
 *
 * A NUMBER must be a valid CSS font-weight (1..1000) and snaps to the nearest
 * cut in {@link OPTIK_WEIGHTS}, so the value <Shield> writes into
 * `font-weight` is always a weight a real bundled file exists for. Six static
 * cuts cannot honour 470, and pretending otherwise was the old behaviour's
 * only real flaw: the number went out untouched and the snapping happened
 * invisibly, inside the browser's font matching, where an author could not see
 * it. Resolving here makes it a property of the component instead.
 *
 * Anything else throws a RangeError rather than emitting invalid or misleading
 * CSS: same fail-loud treatment as the rotation config. Snapping is a
 * convenience for real weight values, NOT a reason to accept garbage, so NaN,
 * Infinity and anything outside 1..1000 still throw. `470` is imprecise and
 * gets helped; `NaN` is a bug and gets reported.
 */
export function resolveOptikWeight(weight: ShieldWeight): number {
  if (typeof weight === "string") {
    // Widened lookup: the type system only admits OPTIK_WEIGHTS keys, but a
    // plain-JS caller can pass any string, so validate at runtime too.
    const numeric = (OPTIK_WEIGHTS as Record<string, number>)[weight];
    if (numeric === undefined) {
      throw new RangeError(
        `${camo.logPrefix} unknown weight name ${JSON.stringify(weight)}. Bundled Optik ` +
          `weights: ${Object.keys(OPTIK_WEIGHTS).join(", ")}. Numeric CSS weights ` +
          `(1..1000) are also accepted, and snap to the nearest bundled cut.`,
      );
    }
    return numeric;
  }
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 1 || weight > 1000) {
    throw new RangeError(
      `${camo.logPrefix} weight must be a bundled weight name ` +
        `(${Object.keys(OPTIK_WEIGHTS).join(", ")}) or a number in 1..1000, ` +
        `got ${String(weight)}.`,
    );
  }
  return nearestCut(weight);
}

/**
 * The `undefined`-tolerant form used by the render path: an omitted prop stays
 * omitted, so the element inherits its `font-weight` exactly as before.
 */
function resolveWeight(weight: ShieldWeight | undefined): number | undefined {
  return weight === undefined ? undefined : resolveOptikWeight(weight);
}

/**
 * The font-load guard. Inlined into the page so it runs the moment the
 * browser parses it, with no React hydration dependency.
 *
 * Watches `document.fonts` for the ShieldFont family AT EVERY WEIGHT THE PAGE
 * ACTUALLY USES. If any of those faces fails to register and load within 4
 * seconds, it visibly replaces every element carrying `[data-typeface]` (the
 * default camo attr) with a "Content unavailable" message and logs a clear
 * console error pointing at the configured fontHost. The replacement is a
 * stylesheet rather than a DOM rewrite, so React hydration cannot put the
 * decoy back (see `fail()`).
 *
 * This is the difference between "silently leaking your decoys to readers"
 * and "obviously broken in a way that the page owner notices on day one."
 *
 * The weight set is what makes this correct, and it used to be the bug. The
 * guard probed `document.fonts.load('1em "' + FAMILY + '"')`: a CSS font
 * shorthand with no weight defaults to 400, so it only ever asked about the
 * Regular face. A page whose only shielded block was bold therefore (a) passed
 * the guard while painting raw decoy text in the fallback font, because a
 * missing `optik-a-700.woff2` was never probed, and (b) downloaded Regular for
 * nothing. `checkDescendants()` does not cover it either: it only walks
 * descendants, and it compares font-family, which still says "Optik". With six
 * cuts per variant a deploy now has 24 files to get right instead of 4, so the
 * blind spot was 6x more reachable than the day it was written.
 *
 * Weights come from two places, deliberately overlapping:
 *   - the SSR seed(s), emitted from the `weight` prop <Shield> resolved, so the
 *     real download starts immediately rather than at DOMContentLoaded;
 *   - a DOM sweep of every `[ATTR]` element's COMPUTED font-weight, which is
 *     the only way to catch weights that come from inheritance or a stylesheet
 *     rather than from the prop.
 *
 * Per family, not per instance: the window flag holds a registry keyed by
 * family name, so a page mixing variants gets one live watcher per family
 * instead of one watcher total that only ever checked whichever variant
 * happened to render first. A second bootstrap for a family already being
 * watched hands over its seed weight and stands down; a seed script that beat
 * its bootstrap out of a streamed response parks its weight in a queue the
 * bootstrap drains.
 *
 * Notes on the emitted source, which carries no comments of its own (they
 * would be bytes on every page, and prose about decoys is exactly the
 * signature `setCamouflage` exists to erase):
 *
 * - `probe(w)` puts the weight in front of the size, `'700 1em "Optik"'`.
 *   Omit it and the shorthand means 400, which was the whole bug. The
 *   disjoint WEIGHT_BANDS mean one weight matches exactly one real cut, so a
 *   probe downloads that cut and no other. Engines disagree about a failed
 *   face — some reject the promise, some resolve with the FontFace parked in
 *   `status: "error"` — so both are treated as failure, and `anyErrored()`
 *   sweeps the whole set afterwards for a face that failed outside any weight
 *   probed.
 * - `sweepDom()` matches the FIRST family in each element's computed
 *   font-family exactly rather than by substring, so the "Optik" watcher does
 *   not adopt weights belonging to "Optik Beta" and pull down cuts of its own
 *   that nobody asked for.
 * - `settle()` starts the 4s clock, NOT the parse. The sweep waits for the
 *   DOM, and a page slow to reach DOMContentLoaded with a perfectly good font
 *   must not be declared broken. If it finds no shielded element and had no
 *   SSR seed, it falls back to probing Regular, this guard's historical
 *   behaviour.
 * - `fail()` blanks the page with a STYLESHEET rather than by rewriting text.
 *   Rewriting looked simpler and did not survive contact with hydration: the
 *   script runs while the document is still parsing, React hydrates a moment
 *   later, finds text it did not render, throws hydration error #418 and puts
 *   the decoy straight back on screen — the guard then logs a failure the
 *   reader never sees, which is the precise outcome it exists to prevent
 *   (observed in a real Next.js App Router page, not deduced). A rule keyed on
 *   the data attribute is invisible to reconciliation, covers shields streamed
 *   in after it ran, and cannot be undone by a re-render.
 * - `checkDescendants()` is the success-path warning: it walks each protected
 *   region and reports any descendant rendering in a font-family that is not
 *   ours, since an override font has no GSUB ligature table and will show the
 *   encoded text on screen.
 */
function fontGuardScript(
  family: string,
  host: string,
  seedWeight: number | null,
  variant: ShieldVariant,
): string {
  const flag = camo.guardFlag;
  const attr = camo.attrName;
  const failedAttr = `${attr}-failed`;
  const prefix = camo.logPrefix;
  return `(function(){
if (typeof window === 'undefined' || typeof document === 'undefined') return;
var FLAG   = ${JSON.stringify(flag)};
var FAMILY = ${JSON.stringify(family)};
var HOST   = ${JSON.stringify(host)};
var ATTR   = ${JSON.stringify(attr)};
// One guard is emitted per FAMILY, and auto-rotation puts two or three families
// on a normal page. Selecting on the bare attribute made every guard inspect
// every OTHER variant's elements too, which produced two bugs on the default
// configuration: a stream of console warnings claiming beta's blocks were using
// "the wrong font" (they were using beta's font, correctly), and — far worse —
// one variant's font 404ing blanked the blocks belonging to variants that had
// loaded fine. Scope every lookup to this guard's own variant.
var SEL    = '[' + ATTR + '=' + ${JSON.stringify(JSON.stringify(variant))} + ']';
var FAILED = ${JSON.stringify(failedAttr)};
var PFX    = ${JSON.stringify(prefix)};
var SEED   = ${seedWeight === null ? "null" : String(seedWeight)};
var TIMEOUT_MS = 4000;
var FALLBACK = 'Content unavailable — the font failed to load.';
var reg = window[FLAG] || (window[FLAG] = {});
var prev = reg[FAMILY];
if (prev && prev.seed) { if (SEED !== null) prev.seed(SEED); return; }
reg[FAMILY] = { seed: seed, queued: null };
var done = false;
var probes = [];
var seen = {};
function fail(reason){
  if (done) return; done = true;
  console.error(
    PFX + ' Font "' + FAMILY + '" failed to load (' + reason + '). ' +
    'Replacing every ' + SEL + ' element with a fallback message. ' +
    'Verify the font is reachable at ' + HOST + '/.'
  );
  var css =
    SEL + '{font-size:0!important;line-height:0!important;}' +
    SEL + '::before{content:' + JSON.stringify(FALLBACK) + ';' +
    'display:inline-block;font:italic 1rem/1.5 system-ui,sans-serif;opacity:0.65;}';
  var sheet = document.createElement('style');
  sheet.setAttribute(FAILED, '1');
  sheet.appendChild(document.createTextNode(css));
  (document.head || document.documentElement).appendChild(sheet);
  var els = document.querySelectorAll(SEL);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    el.setAttribute('aria-label', FALLBACK);
    el.setAttribute(FAILED, '1');
  }
}
function checkDescendants(){
  var roots = document.querySelectorAll(SEL + ':not([' + FAILED + '])');
  var warnings = 0;
  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    // The protected element ITSELF, then its descendants. Checking only
    // descendants was the whole bug: our font-family arrives as an inline
    // style, which loses to any author !important, so a theme rule such as
    // "article p { font-family: Georgia !important }" painted raw decoys to
    // every reader while this guard, whose entire job is to catch exactly
    // that, stayed silent -- the element carrying the override was the root.
    var all = [root];
    var kids = root.querySelectorAll('*');
    for (var n = 0; n < kids.length; n++) all.push(kids[n]);
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      var hasText = false;
      for (var k = 0; k < el.childNodes.length; k++) {
        if (el.childNodes[k].nodeType === 3 && el.childNodes[k].textContent.trim()) {
          hasText = true; break;
        }
      }
      if (!hasText) continue;
      var family = window.getComputedStyle(el).fontFamily || '';
      if (family.indexOf(FAMILY) === -1 && warnings < 5) {
        console.warn(
          PFX + ' <' + el.tagName.toLowerCase() + '> inside protected region uses ' +
          'font-family "' + family + '" instead of "' + FAMILY + '". ' +
          'Its text will render as encoded gibberish (no ligature table). ' +
          'Either remove the override, or move the element outside the protected region.'
        );
        warnings++;
      }
    }
  }
  if (warnings >= 5) console.warn(PFX + ' ' + warnings + '+ font-family overrides found in protected regions; only first 5 logged.');
}
function pass(){
  if (done) return; done = true;
  setTimeout(checkDescendants, 50);
}
function probe(w){
  probes.push(document.fonts.load(w + ' 1em "' + FAMILY + '"').then(function(faces){
    if (!faces || faces.length === 0) throw new Error('no @font-face declared for weight ' + w);
    for (var i = 0; i < faces.length; i++) {
      if (faces[i].status === 'error') throw new Error('the weight-' + w + ' face failed to load');
    }
  }));
}
function seed(w){
  w = Math.round(Number(w));
  if (!isFinite(w) || w < 1 || w > 1000 || seen[w]) return;
  seen[w] = true;
  probe(w);
}
function firstFamily(value){
  return String(value || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}
function sweepDom(){
  var els = document.querySelectorAll(SEL);
  for (var i = 0; i < els.length; i++) {
    var cs = window.getComputedStyle(els[i]);
    if (firstFamily(cs.fontFamily) !== FAMILY) continue;
    seed(cs.fontWeight);
  }
}
function anyErrored(){
  var bad = false;
  try {
    document.fonts.forEach(function(ff){
      if (!bad && firstFamily(ff.family) === FAMILY && ff.status === 'error') bad = true;
    });
  } catch (e) {}
  return bad;
}
function settle(){
  sweepDom();
  if (!probes.length) seed(400);
  Promise.all(probes).then(function(){
    if (anyErrored()) fail('a declared face for this family is in error state');
    else pass();
  }, function(e){ fail(String((e && e.message) || e)); });
  setTimeout(function(){ if (!done) fail('timeout after ' + TIMEOUT_MS + 'ms'); }, TIMEOUT_MS);
}
if (!document.fonts || !document.fonts.load) {
  fail('document.fonts API not supported');
  return;
}
if (prev && prev.queued) { for (var q = 0; q < prev.queued.length; q++) seed(prev.queued[q]); }
if (SEED !== null) seed(SEED);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settle);
else settle();
})();`;
}

/**
 * The companion to the guard bootstrap: registers ONE more weight with a
 * watcher that some earlier <Shield> already started for this family.
 *
 * Only reachable when a render pass scope is active (RSC, or
 * {@link withShieldRenderPass}), because that is the only time a second
 * <Shield> skips emitting a bootstrap of its own. Kept deliberately tiny —
 * a few hundred bytes against the bootstrap's few kilobytes — and it parks the
 * weight in a queue if it somehow runs first, which streamed-out-of-order
 * Suspense boundaries make possible.
 */
function fontWeightSeedScript(family: string, weight: number): string {
  const flag = JSON.stringify(camo.guardFlag);
  const fam = JSON.stringify(family);
  return (
    `(function(){var r=window[${flag}]||(window[${flag}]={});var s=r[${fam}]||(r[${fam}]={});` +
    `if(s.seed)s.seed(${weight});else (s.queued||(s.queued=[])).push(${weight});})();`
  );
}

// ---- Auto-rotation ----------------------------------------------------------
// When <Shield> has no explicit `variant`, pick one of alpha/beta/gamma by
// hashing the content. Deterministic (SSR-safe, reproducible builds, works in
// client components too) yet spreads all three mappings across a site's content
// so no single mapping dominates. `maxhide` is never auto-selected.
const AUTO_POOL: ShieldVariant[] = ["alpha", "beta", "gamma"];

function hashString(s: string): number {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function autoVariant(seed: string): ShieldVariant {
  return AUTO_POOL[hashString(seed) % AUTO_POOL.length] ?? "alpha";
}

/** Collect the plain-text content of a React node tree (for the auto seed). */
function collectText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return collectText(props.children);
  }
  return "";
}

// ---- Time-based rotation ----------------------------------------------------
//
// Auto-rotation above spreads the three mappings ACROSS a page. Rotation spreads
// them across TIME as well, by mixing a period index into the same content hash.
// Read setRotation()'s doc comment before reaching for this: what it buys is
// narrow and easy to oversell.

const DEFAULT_EPOCH = "2026-01-01T00:00:00Z";
const WEEK_MS = 604_800_000;
const DAY_MS = 86_400_000;

/**
 * Module-level rotation, set by {@link setRotation}. `false` (the default) means
 * "no time component" — <Shield> keeps the pure content-hash auto-rotation.
 */
let rotation: RotateConfig | false = false;

/**
 * Parse a Date or ISO string and reject an invalid one LOUDLY.
 *
 * An unparseable epoch would otherwise yield `NaN` period indices, which hash
 * to a stable-but-meaningless variant: every block would look fine and would
 * silently stop rotating. Same failure class the font-load guard exists to
 * prevent, so it gets the same treatment.
 */
function parseInstant(value: Date | string, field: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(
      `${camo.logPrefix} rotation \`${field}\` is not a valid date: ${JSON.stringify(value)}. ` +
        `Pass a Date or an ISO 8601 string (e.g. "2026-03-01T00:00:00Z").`,
    );
  }
  return d;
}

/**
 * The period index of an instant, relative to the configured epoch.
 *
 * `"monthly"` is CALENDAR-aligned, not 30-day blocks: "the March font" has to
 * mean March. `"weekly"` / `"daily"` are fixed-length windows measured from the
 * epoch instant.
 *
 * Everything is UTC. A build machine in Sao Paulo and one in Copenhagen must
 * agree, or two deploys of the same commit emit different HTML.
 *
 * @example
 *   periodIndex(new Date("2026-03-15T00:00:00Z"));            // 2  (monthly)
 *   periodIndex("2026-03-15", { period: "daily" });           // 73
 */
export function periodIndex(at: Date | string = new Date(), cfg: RotateConfig = {}): number {
  const epoch = parseInstant(cfg.epoch ?? DEFAULT_EPOCH, "epoch");
  const instant = parseInstant(at, "at");
  switch (cfg.period ?? "monthly") {
    case "weekly":
      return Math.floor((instant.getTime() - epoch.getTime()) / WEEK_MS);
    case "daily":
      return Math.floor((instant.getTime() - epoch.getTime()) / DAY_MS);
    case "monthly":
    default:
      return (
        (instant.getUTCFullYear() - epoch.getUTCFullYear()) * 12 +
        (instant.getUTCMonth() - epoch.getUTCMonth())
      );
  }
}

/**
 * The variants a rotation may actually select.
 *
 * `"maxhide"` is ALWAYS filtered out, even when a caller passes it explicitly.
 * It is the M15 maximum-coverage dictionary: a different trade (much higher
 * swap rate, correspondingly lower readability of the decoy) that an author
 * opts into per block with `variant="maxhide"`. Rotating INTO it would change
 * the character of a page's text on a calendar boundary, unannounced. Pinning
 * it stays available; drifting into it does not.
 *
 * Unknown variant names are dropped too, so a plain-JS caller cannot produce an
 * undefined mapping at render time. An empty result falls back to the default
 * pool rather than throwing — a misconfigured pool must not take a page down.
 */
function rotationPool(pool?: ShieldVariant[]): ShieldVariant[] {
  const cleaned = (pool ?? AUTO_POOL).filter(
    (v) => v !== "maxhide" && Object.prototype.hasOwnProperty.call(MAPPINGS, v),
  );
  return cleaned.length > 0 ? cleaned : AUTO_POOL;
}

/**
 * Resolve `cfg.at` to a period index.
 *
 *   - a **number** IS the period index (no clock consulted at all)
 *   - a **Date or ISO string** is an INSTANT, whose period index is computed
 *   - **undefined** falls back to `now`
 *
 * The number form is what lets an author rebuild a past period: pin the index
 * and the output is byte-identical however many years later, with no stored
 * key and no backup.
 */
function resolvePeriod(cfg: RotateConfig, now: Date): number {
  const at = cfg.at;
  if (typeof at === "number") {
    if (!Number.isFinite(at)) {
      throw new RangeError(
        `${camo.logPrefix} rotation \`at\` must be a finite period index, got ${String(at)}.`,
      );
    }
    // Normalise -0 to 0 so it stringifies into the hash key identically.
    const p = Math.trunc(at);
    return p === 0 ? 0 : p;
  }
  return periodIndex(at ?? now, cfg);
}

/**
 * The variant for one block, given the rotation config and the block's content.
 *
 * The period is mixed INTO the content hash, never used instead of it. Flipping
 * a whole site to one variant per period would be strictly worse than doing
 * nothing: a scraper fingerprinting by font file would see exactly one font per
 * site per period, a cleaner signal than three. Mixing keeps the within-page
 * spread AND reassigns every block at the boundary.
 *
 * With the default three-variant pool, `1 - 1/3` — about two thirds — of blocks
 * change variant at each boundary. That is the honest number; quote it.
 *
 * NUL separators, not spaces, so `salt="ab"` + period `1` cannot collide with
 * `salt="a"` + period `b1`.
 */
export function variantFor(
  content: string,
  cfg: RotateConfig = {},
  at: Date = new Date(),
): ShieldVariant {
  const pool = rotationPool(cfg.pool);
  const period = resolvePeriod(cfg, at);
  const key = `${cfg.salt ?? ""}\u0000${period}\u0000${content}`;
  return pool[hashString(key) % pool.length] ?? pool[0] ?? "alpha";
}

/**
 * Turn on time-based variant rotation for every `<Shield>` in the process.
 * Call once at module load, from your root layout. Pass `false` to turn it off.
 *
 * ### What this does NOT do
 *
 * **Rotation does not defeat font inversion, and does not slow it down.** All
 * three mappings are published in `@shieldfont/core`; all three fonts ship in
 * this package and on the CDN; and every served block names its own variant
 * twice, in the `data-typeface` attribute value and in the `@font-face` `src`
 * filename. An attacker who inverts once holds all three tables forever and can
 * read straight off the HTML which one a block used. Anyone who re-reads the
 * variant per crawl is entirely unaffected by this feature.
 *
 * ### What it does buy, stated exactly
 *
 * **A cached substitution table decays silently.** A scraper that inverted the
 * font once and stored the table decodes the next period into plausible English
 * that is wrong. Nothing throws, nothing 404s, nothing looks broken — so there
 * is no error to trigger a retry, and no signal that the cache went stale. With
 * the default three-variant pool, about two thirds of blocks change variant at
 * each boundary.
 *
 * The second-order effect is the point: because an outsider cannot tell which
 * sites rotate, a pipeline that wants to be correct has to re-verify every
 * shielded site on every crawl instead of solving it once. The cost being added
 * is recurring attention, not compute. Do not put a dollar figure on it.
 *
 * ### Where it is safe
 *
 * ONLY where the `@font-face` travels in the same bytes as the encoded text —
 * which is exactly what `<Shield>` does, and why the CDN paste-in tier does not
 * get this feature. A Tier B/C page with one hand-written global `@font-face`
 * would rotate its text away from its stylesheet and paint raw decoys on
 * screen. Static exports are safe: their HTML is frozen with its own inline
 * `@font-face`, so a built page renders correctly forever.
 *
 * Variant rotation needs no font rebuild — all four fonts already ship. True
 * per-seed rotation would need one font build per period; that is a roadmap
 * item, not this.
 *
 * ### Rebuilding a past period
 *
 * Pin the clock. A number IS the period index, so period 14 rebuilt in 2029 is
 * byte-identical to period 14 built in 2027 — no stored key, no backup:
 *
 * @example
 *   // app/layout.tsx — rotate monthly, salted per site
 *   import { setRotation } from "@shieldfont/react";
 *   setRotation({ period: "monthly", salt: "example.com" });
 *
 * @example
 *   setRotation({ period: "monthly", at: 14 });          // rebuild period 14
 *   setRotation({ period: "monthly", at: "2026-03-15" }); // rebuild March 2026
 *   setRotation(false);                                   // back to content hash
 */
export function setRotation(config: RotateConfig | false): void {
  if (config === false) {
    rotation = false;
    return;
  }
  const next: RotateConfig = { ...config };
  // Validate NOW, at config time, rather than on the first render: a bad epoch
  // or a bad `at` is a setup error, and the earliest possible throw is the
  // cheapest one to debug.
  resolvePeriod(next, new Date());
  rotation = next;
}

/**
 * Resolve the variant for one block. Precedence, highest first:
 *
 *   1. an explicit `variant` prop — always pins, including to `"maxhide"`
 *   2. the per-instance `rotate` prop (`false` opts this block out of rotation)
 *   3. module-level {@link setRotation}
 *   4. the content hash (the original behaviour)
 */
function resolveVariant(
  variant: ShieldVariant | undefined,
  rotate: boolean | RotateConfig | undefined,
  content: string,
): ShieldVariant {
  if (variant) {
    // A near-miss reached the encoder as an undefined mapping and died there
    // with `Cannot convert undefined or null to object` — a stack with no
    // mention of the prop that caused it. `variant="Alpha"` and
    // `variant="max-hide"` are exactly the mistakes a person makes, and
    // TypeScript does not catch either one in a JS codebase or behind a cast.
    if (!Object.prototype.hasOwnProperty.call(MAPPINGS, variant)) {
      throw new Error(
        `<Shield variant="${String(variant)}"> is not a mapping. ` +
          `Valid values: ${Object.keys(MAPPINGS).map((v) => `"${v}"`).join(", ")}. ` +
          `Note the dictionary is "maxhide", not "m15en" — that is the internal name.`,
      );
    }
    return variant;
  }
  if (rotate === true) return variantFor(content);
  if (rotate === false) return autoVariant(content);
  if (rotate) return variantFor(content, rotate);
  if (rotation !== false) return variantFor(content, rotation);
  return autoVariant(content);
}

// ---- "use client" footgun guard (fires in production too) -------------------
// This warning was previously dev-only, to keep any brand string out of
// production bundles. Measured, that trade did not pay: it made the single
// worst misuse fail SILENTLY in production, which is the opposite of this
// package's stated fail-loud principle.
//
// It costs nothing to keep. The guard only fires when <Shield> renders in a
// browser, and in that case the bundle ALREADY contains the plaintext and all
// ~38,000 dictionary pairs — camouflage is long gone. Used correctly (server
// components only), this module never reaches the client bundle at all, so the
// string does not ship either. Loud on failure, invisible when correct.

let warnedClientRender = false;

/**
 * <Shield> is a SERVER component: it must encode on the server / at build time.
 * If it runs in the browser instead — imported into a `"use client"` module, or
 * used in a client-only React app (Vite/CRA) — the original plaintext children
 * are serialized into the RSC/JS payload BEFORE the encoder runs, so view-source
 * leaks the very text you meant to protect, and the page itself looks fine. A
 * scraping defense must fail loud, so this warns whenever it runs in a browser,
 * in production as well as development (see the note above on why the dev-only
 * gate was removed). Deduped to one message per process to avoid console spam.
 */
function warnIfClientRender(): void {
  if (warnedClientRender) return;
  if (typeof window === "undefined") return; // server / build render: correct path
  warnedClientRender = true;
  console.warn(
    `${camo.logPrefix} <Shield> is rendering in the browser. It is a server ` +
      `component: encoding must run on the server / at build time. When <Shield> ` +
      `runs on the client, the original plaintext children are serialized into the ` +
      `payload BEFORE encoding — so view-source can leak the text you meant to ` +
      `protect. Render <Shield> from a Server Component: remove any "use client" ` +
      `boundary above it, and don't use it in a client-only Vite/CRA app (encode ` +
      `at build time with @shieldfont/core instead).`,
  );
}

// ---- Accessibility ----------------------------------------------------------
//
// The encoded block stays `aria-hidden="true"`. That is deliberate and correct:
// the HTML holds a decoy, so un-hiding it makes a screen reader voice fluent,
// grammatical, WRONG English with nothing to signal that anything is off — worse
// than silence, because it does not announce itself as broken.
//
// But silence is not a fix either. Either way, what a sighted reader perceives
// is not programmatically determinable, which fails WCAG 2.2 SC 1.3.1 on any
// reading. Under the EU Accessibility Act or the ADA Title II web rule that is a
// procurement blocker, not an ethics question.
//
// So the fix is not to un-hide. It is to put a REAL alternative next to the
// block, outside the hidden subtree and before it in DOM order, so linear
// navigation reaches the alternative before the silence. That is `a11y`.
//
// NO URL IS RENDERED ANYWHERE. Two things shipped in 0.2.0 and both were
// removed: a `mode: "text"` that linked a URL serving the original words, and
// an optional `transcript` link on the audio mode. Same reason for both, worth
// stating once: a URL cannot be offered to a screen reader without being
// offered to everyone else, and the same crawl that reads the decoy reads the
// link beside it. One line of scraper code follows it — so a block carrying
// either was strictly LESS protected than an unwrapped one, while looking
// protected. No author opts into that knowingly.
//
// WHAT REPLACED IT, and it is built: `mode: "text"` now ships the words
// ENCRYPTED in the page, behind a time-lock puzzle the reader's own browser
// grinds out on request (see @shieldfont/core/puzzle and ./solver.ts). Nobody
// is denied the text. The accessible path simply stops being the CHEAPEST path,
// which is the only property that ever mattered — difficulty is bounded above
// by what OCR would cost a crawler, so past that it buys nothing and is paid
// for entirely by disabled readers waiting longer.
//
// WHAT IT STILL COSTS, said straight:
//
//   - `mode: "audio"` on its own fails WCAG 2.2 SC 1.2.1 (Level A). The text
//     mode does not rescue it; they are separate alternatives an author picks
//     between, not a pair. Ship audio alone and there is still no answer to
//     1.2.1.
//   - The text mode needs JavaScript, BigInt, crypto.subtle and a secure
//     origin. It is the one part of this package that does not survive JS being
//     off, and the font does the rest of the work without any of it.
//   - The control is invisible by default, so a SIGHTED keyboard user Tabs into
//     something they cannot see and loses their focus indicator — WCAG 2.2 SC
//     2.4.7. Deliberate; `visualHidden: false` puts it back on screen.
//   - A reader who needs this waits while everyone else reads immediately. That
//     is unequal access however carefully it is engineered, and calling it
//     solved would be a lie.
//
// Nearly every detail of the markup below was settled by listening to it with a
// real screen reader rather than by reasoning about the spec. Where that is
// true, the comment says which sentence changed the code.

/**
 * Visually-hidden via CLIP-PATH, never `display:none`.
 *
 * `display:none` (and `visibility:hidden`) remove a node from the accessibility
 * tree as well as from the page — which is the exact bug this whole prop exists
 * to fix. Clipping keeps the control focusable and announced while taking it out
 * of the visual layout.
 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Default explanatory prose. Real sentences, not a label: "Listen" alone tells
 * a screen-reader user nothing about WHY the article is missing.
 *
 * One string rather than the per-mode table this used to be: `"audio"` is the
 * only mode that renders anything, so a lookup keyed on the mode was a table
 * with one row.
 */
const A11Y_NOTE = {
  audio:
    "This section is hidden from assistive technology because its text is encoded. The same words are available as audio below.",
  // Short on purpose. The first version ran to thirty-three words and opened
  // with "hidden from assistive technology", which is jargon addressed to the
  // wrong audience — the listener does not care what the mechanism is called,
  // they care that a paragraph is missing and that there is a way to get it.
  // Tested by ear: the long version was heard as noise to skip past.
  text: "This text is scrambled and is not read aloud. Unlock the real words with the button below.",
} as const;

/**
 * The note every text-mode block after the FIRST one on a page gets.
 *
 * The long note explains the whole situation, which a reader needs once and not
 * again. Measured with a screen reader over a two-block page: the full sentence
 * is spoken in its entirety for every block, so a six-block article makes
 * somebody listen to the same thirty-three words six times before they can
 * reach any of the content. That is not thoroughness, it is an obstacle.
 *
 * Falls back to the long form outside a render-pass scope, since without one
 * there is no way to know whether this block is the first.
 */
const A11Y_NOTE_REPEAT = "Scrambled text. Unlock the real words below.";

/**
 * Tags for which `<Shield>` renders an INLINE alternative wrapper. A `<div>` or
 * `<p>` sibling emitted next to an inline `<Shield as="span">` inside a
 * paragraph would make the browser close the enclosing `<p>` early and reflow
 * the document, so phrasing content gets phrasing-content siblings.
 */
const INLINE_TAGS = new Set(["span", "a", "em", "strong", "b", "i", "u", "small", "code", "label"]);

let warnedMissingA11y = false;

/** Dev only: bundlers and Node both expose NODE_ENV; neither is guaranteed. */
function isProduction(): boolean {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.NODE_ENV === "production";
}

/**
 * Omitting `a11y` entirely gets ONE development-time warning per process —
 * deliberately a warning and not an error, because an error would break every
 * existing install on upgrade. `{ mode: "none" }` silences it: an explicit,
 * auditable opt-out is a decision someone made, which is all we are asking for.
 *
 * The message recommends `mode: "text"` first, because it is the one that asks
 * nothing of the author. What it must never do again is suggest pointing `a11y`
 * at a plain-text URL: that was this package telling authors to publish the
 * original words at a crawlable address beside the encoded ones, which undid
 * the thing they installed it for. `a11y-warning.test.ts` asserts the message
 * names the mode and never the word `href`.
 */
function warnIfNoA11y(): void {
  if (warnedMissingA11y || isProduction()) return;
  warnedMissingA11y = true;
  console.warn(
    `${camo.logPrefix} <Shield> rendered with no \`a11y\` prop. The encoded block is ` +
      `aria-hidden, so assistive technology reads NOTHING there — what a sighted reader ` +
      `perceives is not programmatically available (WCAG 2.2 SC 1.3.1). Pass ` +
      `a11y={{ mode: "text" }}: it needs nothing from you, seals the original words into ` +
      `the page at build time, and lets a reader who needs them decode them in their own ` +
      `browser. Or a11y={{ mode: "audio", src }} with a file synthesised AT BUILD TIME. ` +
      `Pass a11y={{ mode: "none" }} to opt out explicitly and silence this. Do NOT reach ` +
      `for browser speechSynthesis: it needs your original text in the browser, which is ` +
      `the leak this package exists to prevent.`,
  );
}

/**
 * Build the accessible alternative. Returns `null` for `{ mode: "none" }` and
 * for an omitted prop (after warning), so the caller can render it or not.
 *
 * An explanatory sentence and an `<audio>` element, and that is the whole
 * output. There is no branch on the mode (`"none"` returns early and the union
 * has nothing else in it) and there is no `<a>` anywhere: the removed `"text"`
 * mode and the removed `transcript` link were both a URL to the original words
 * sitting in the HTML, which any scraper that follows it reads for free. See
 * the section note above.
 *
 * Native `<audio controls>`, not a custom button: zero JavaScript, keyboard
 * operable and labelled for free, survives a static export, and hands the user
 * the download and speed controls they already know. `preload="none"` so it
 * costs nothing until someone presses play.
 */
function renderA11y(
  a11y: ShieldA11y | undefined,
  inline: boolean,
  plain: string,
  blockId: string,
  tag: string | null,
  ordinal: number,
): ReactNode {
  if (!a11y) {
    warnIfNoA11y();
    return null;
  }
  if (a11y.mode === "none") return null;

  const attr = camo.attrName;
  const Wrap = (inline ? "span" : "div") as ElementType;
  const Note = (inline ? "span" : "p") as ElementType;
  // DEFAULT for the text mode: the whole control is screen-reader-only.
  //
  // A sighted reader can already read the block perfectly — the font does that
  // work — so a note and a button explaining an unlocking mechanism are, to
  // them, an unexplained widget attached to text that looks fine. The audio
  // mode keeps its player on screen, because a player nobody can see is a
  // player nobody can press.
  //
  // KNOWN COST, and it is a real one: a sighted person navigating by keyboard
  // without a screen reader will Tab into a control they cannot see, and their
  // focus indicator vanishes (WCAG 2.2 SC 2.4.7). The standard remedy is the
  // skip-link pattern — clipped until focused, visible while focused — which
  // this deliberately does NOT do, because it was asked to be invisible.
  // `visualHidden: false` restores an on-screen control.
  const hideWrap = a11y.visualHidden ?? a11y.mode === "text";
  const wrapStyle = hideWrap ? VISUALLY_HIDDEN : undefined;
  // Only the text mode repeats per block often enough to be worth shortening,
  // and only after this pass has spent its one full explanation.
  const firstOfPage = a11y.mode !== "text" || claim("notes", "long");
  const note = a11y.note ?? (firstOfPage ? A11Y_NOTE[a11y.mode] : A11Y_NOTE_REPEAT);

  // Bare data attributes as hooks for the solver script. Names derive from the
  // camouflage attr, so a project that called setCamouflage({ hash }) has no
  // shared signature with any other project here either.
  const groupMark = { [`${attr}-group`]: "" } as Record<string, string>;

  // NO `role="group"` and no `aria-label` on this wrapper. Both were here to
  // "associate" the note with the button, and measured against real VoiceOver
  // they bought nothing and cost a great deal. Landing on the button produced:
  //
  //   "…button. Accessible alternative, group. You are currently on a button
  //    inside of a group. To click this button press Control-Option-Space. To
  //    exit this group press Control-Option-Shift-Up-Arrow."
  //
  // — roughly twenty words of scaffolding per block, in front of a control
  // whose own name already says what it does. A note followed by a button reads
  // perfectly well as two plain siblings, so they are two plain siblings.
  // `role="presentation"` on top of removing the group role. Dropping
  // `role="group"` stopped the page ASKING to be a group; VoiceOver announced
  // the plain <div> as one anyway ("…wrong English. Group. Done. You are
  // currently on a group."), because that is what it does with a container
  // holding several children. Presentation takes the box itself out of the
  // accessibility tree and leaves its contents exactly where they were.
  return (
    <Wrap className={`${attr}-alt`} role="presentation" style={wrapStyle} {...groupMark}>
      <Note className={`${attr}-alt-note`}>{note}</Note>
      {a11y.mode === "audio" ? (
        <audio controls preload="none" src={a11y.src} aria-label="Audio version" />
      ) : (
        renderPuzzle(
          a11y.seconds,
          blockId,
          plain,
          inline,
          tag,
          a11y.reveal ?? "hidden",
          a11y.label,
          ordinal,
        )
      )}
    </Wrap>
  );
}

/**
 * The time-lock plain-text control: a button, a progress bar, a live region,
 * an empty output element, and the sealed payload.
 *
 * Every piece of this is load-bearing for someone:
 *
 * - The `<button>` ships `hidden`. The solver script unhides it only after
 *   confirming this browser has BigInt and `crypto.subtle` (the latter is
 *   absent on insecure origins, a real deployment mistake). A control that
 *   cannot work is worse than no control, and worst of all for a reader who
 *   cannot see that pressing it did nothing.
 * - `<progress>` stays IN the accessibility tree rather than being
 *   `aria-hidden`. It does not announce on its own, so it costs a screen-reader
 *   user nothing, and it lets them query exact progress on demand instead of
 *   waiting for the next milestone.
 * - The live region is `aria-live="polite"` with NO role. `role="status"` made
 *   screen readers announce a bare "status" per block on the way past; moving
 *   to a plain `<p>` traded that for "paragraph", so it is a `<span>` now and
 *   silent until it has something to say. Politeness is the other half:
 *   `assertive` would interrupt whatever the reader is listening to, repeatedly,
 *   for a background task they were told to keep reading through.
 * - The output element ships `tabIndex={-1}` and the solver promotes it to `0`
 *   once it has content, making it a real Tab stop. Focus alone was not enough:
 *   it announced only the element's role and never the words, and Tab then
 *   skipped straight past them, so a reader who wanted the text again had no way
 *   back to it. It is also its own `aria-live` region, so arriving speaks it.
 * - The payload is `<script type="application/json">`, not a data attribute:
 *   it can be several kilobytes, and attribute values get escaped into
 *   unreadable soup in view-source.
 *
 * The sealed JSON is emitted with `<` escaped. Neither base64 nor a decimal
 * BigInt can contain `</script`, so this cannot currently fire — it is here so
 * that a future field carrying freer text cannot silently turn into an HTML
 * injection.
 */
const TAG_NOUN: Record<string, string> = {
  h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
  p: "paragraph", blockquote: "quote", li: "list item", figcaption: "caption",
};

/**
 * The button's accessible name.
 *
 * Every block used to render the identical sentence, which sounds fine on a
 * one-block demo and is unusable on a real article: a screen reader announces
 * "Show the plain text, up to about 20 seconds" once per block with nothing
 * distinguishing them, so a reader who wants the third one has to activate
 * buttons until they guess right. Measured over a two-block page before this
 * existed; the two buttons were indistinguishable by ear.
 *
 * The name is built from the element type and this block's position on the
 * page, both of which the component already knows. It deliberately does NOT
 * quote the protected words: the label ships in the HTML, so a label containing
 * the text would hand it to any scraper for free — the exact bypass the whole
 * mode exists to close.
 */
/** The word a reader hears for this element. Also the ordinal's counter key. */
function nounFor(tag: string | null): string {
  return (tag && TAG_NOUN[tag]) ?? "section";
}

function puzzleLabel(tag: string | null, ordinal: number, seconds: number): string {
  return `Unlock the plain text for ${nounFor(tag)} ${ordinal} (up to ${seconds} seconds)`;
}

/**
 * The two elements the solver WRITES TEXT INTO are rendered with an empty
 * `dangerouslySetInnerHTML` rather than as empty JSX elements. Nothing is
 * injected — the payload is a constant empty string — and the point is not what
 * it puts in but what it tells React: an element with `dangerouslySetInnerHTML`
 * has no child fibers, so React neither hydrates nor reconciles anything inside
 * it, and the solver's writes stop being React's business.
 *
 * Without this the script and the hydration pass fight over the same nodes. The
 * solver runs at parse time (see ./solver.ts), so on a return visit — where the
 * plain text comes straight out of localStorage, before any button is pressed —
 * `out` and the status line already hold text by the time React arrives to
 * hydrate two elements it rendered EMPTY. React does not tolerate that: it
 * either throws a hydration error and re-renders the subtree, or quietly deletes
 * the text node it did not create. The second outcome is the dangerous one,
 * because it deletes exactly the words a disabled reader waited for, leaves no
 * console error behind, and cannot self-correct — `wire()` has already stamped
 * the button, so the next sweep returns early and the text never comes back.
 *
 * This is the same lesson the font-load guard learned one screen up: anything
 * that touches the DOM before hydration has to be invisible to reconciliation.
 * The guard's answer was a stylesheet; here it is an opaque container.
 *
 * The ATTRIBUTE writes around these elements (`hidden`, `display`, `tabindex`,
 * the `-wired` stamp) are untouched by this and still mismatch. React warns
 * about those in development and never patches them, so they cost noise in `next
 * dev` and nothing in production. Fixing them means moving the visibility flips
 * to a stylesheet keyed off `document.documentElement` — the one node React
 * never owns — which is a larger change than this one and not a correctness fix.
 */
const EMPTY_HTML = { __html: "" };

function renderPuzzle(
  seconds: number | undefined,
  blockId: string,
  plain: string,
  inline: boolean,
  tag: string | null,
  reveal: "hidden" | "visible",
  label: string | undefined,
  ordinal: number,
): ReactNode {
  const attr = camo.attrName;
  const solveAttr = `${attr}-solve`;
  const Note = (inline ? "span" : "p") as ElementType;
  const target = seconds ?? DEFAULT_SECONDS;
  const sealed = sealText(plain, { seconds: target });

  // The revealed words go into the SAME element type the shield itself uses, so
  // <Shield as="h2"> reveals into an <h2>. Without this the output was always a
  // <p>, which silently dropped the heading: the words came back but the
  // document outline did not, and heading navigation — the single most-used
  // way a screen-reader user moves around a page — skipped straight past it.
  // Only string tags can be mirrored; a custom component gets the neutral
  // fallback, since we cannot know what it renders or whether it would accept
  // the attributes this element needs.
  const Out = (tag ?? (inline ? "span" : "p")) as ElementType;

  const buttonMark = {
    [solveAttr]: "",
    [`${solveAttr}-for`]: blockId,
  } as Record<string, string>;

  // `hidden` AND an inline `display:none`. The attribute alone is only a
  // default-stylesheet rule, so one ordinary line of a host project's CSS —
  // `progress { display: block }` in a reset, say — silently un-hides all of
  // this and puts a dead button and an empty progress bar on every page. An
  // inline style outranks any author rule that is not `!important`, and the
  // solver's show() clears both together. Found by looking at a real page; no
  // markup assertion would have caught it.
  const OFF: CSSProperties = { display: "none" };

  return (
    <>
      {/*
        "up to N seconds" — a ceiling, not an estimate. `seconds` is a
        difficulty budget denominated on a deliberately slow reference device,
        so a current desktop finishes well inside it (measured in Chrome, the
        20-second default completes in 7.6 s) while an old phone may take
        longer. "about" was dropped from this string after hearing it read
        aloud: "up to about twenty seconds" is four words to say something two
        can, and the live status line replaces it with a real per-device
        measurement within ~80 ms of the press anyway.
      */}
      <button type="button" hidden style={OFF} className={`${attr}-alt-btn`} {...buttonMark}>
        {label ?? puzzleLabel(tag, ordinal, target)}
      </button>
      <progress
        max={100}
        value={0}
        hidden
        style={OFF}
        aria-label="Decoding progress"
        {...({ [`${attr}-bar`]: "" } as Record<string, string>)}
      />
      {/*
        `aria-live` WITHOUT `role="status"`. Both create a polite live region and
        both announce updates, but the role also puts a named landmark in the
        tree — so a screen reader passing an as-yet-empty one says the bare word
        "status" for no reason, once per block. Confirmed with a screen reader
        over a two-block page: two spurious "status" announcements before the
        reader reached any content. `aria-atomic` so a progress update is read
        as a whole rather than diffed against the previous one.

        A <span> rather than the block <Note>, for the same reason one step
        further: an empty <p> is still announced as "paragraph" on the way past.
        Removing the role got rid of "status" and left "paragraph" behind. A
        span carries no boundary, so an unused live region is silent — which is
        what an unused live region should be.
      */}
      <span
        aria-live="polite"
        aria-atomic="true"
        className={`${attr}-alt-status`}
        {...({ [`${attr}-status`]: "" } as Record<string, string>)}
        dangerouslySetInnerHTML={EMPTY_HTML}
      />
      {/*
        `aria-live` on the OUTPUT, not just on the status line. Moving focus
        here was supposed to be enough, and measured with a screen reader it was
        not: the focus landed and announced the bare word "paragraph", never the
        words themselves, so a reader pressed the button, heard "Done", and then
        could not find what they had just waited for. Making the output its own
        polite region means filling it speaks it. It is the same element either
        way, so the text stays navigable and re-readable afterwards rather than
        being a one-shot announcement.

        In `"hidden"` reveal the clip styles are baked in HERE rather than
        applied by script, so the element is already off-screen the instant it
        is un-hidden — no frame where a paragraph of text flashes into the
        layout. The solver only clears `display`, which leaves the clipping in
        place. `display:none` and `visibility:hidden` are both wrong for this:
        each would remove the words from the accessibility tree, which is the
        entire thing being delivered.
      */}
      <Out
        tabIndex={-1}
        hidden
        aria-live="polite"
        style={reveal === "hidden" ? { ...VISUALLY_HIDDEN, ...OFF } : OFF}
        className={`${attr}-alt-out`}
        {...({ [`${attr}-out`]: reveal } as Record<string, string>)}
        dangerouslySetInnerHTML={EMPTY_HTML}
      />
      <script
        type="application/json"
        {...({ [`${attr}-data`]: "" } as Record<string, string>)}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sealed).replace(/</g, "\\u003c") }}
      />
    </>
  );
}

/**
 * `<Shield>` — encoder + font scope in one component. Render it from a SERVER
 * component: the plaintext must never reach the browser. Rendering it in a
 * `"use client"` file, or passing unencoded text into a client component as a
 * prop, leaks the original text (and the whole dictionary) into the bundle.
 *
 * Whatever string you pass as children gets encoded with the variant's
 * mapping and rendered inside an element using the ShieldFont font
 * family. The encoded text is what reaches the browser — scrapers
 * reading the HTML source see the encoded form; humans rendering the
 * page through the font see the original.
 *
 * @example
 *   <Shield>The future of writing belongs to those who write it.</Shield>
 *
 *   <Shield as="h1" weight="regular" size="3rem">
 *     Manifesto
 *   </Shield>
 */
export function Shield(props: ShieldProps) {
  const {
    as,
    variant,
    weight,
    lineHeight,
    size,
    className,
    style,
    rotate,
    a11y,
    children,
  } = props;

  // Fail loud in dev if this server component is being rendered on the client
  // (a "use client" boundary or a client-only React app ships the plaintext).
  warnIfClientRender();

  // <Shield> is not a polymorphic pass-through: it renders a known set of
  // attributes and DROPS everything else. That silence is the problem — the
  // natural mistake is `<Shield as={Link} href="/post">`, where `href` vanishes
  // and you get either a dead link or an unrelated crash from inside the
  // component, with nothing pointing at the cause. Name what is being dropped.
  const unknown = Object.keys(props).filter((k) => !SHIELD_PROPS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `<Shield> received ${unknown.map((k) => `\`${k}\``).join(", ")}, which it does not forward — ` +
        `the element would render without ${unknown.length > 1 ? "them" : "it"}. ` +
        `<Shield> accepts only: ${[...SHIELD_PROPS].join(", ")}. ` +
        `To wrap protected text in something that needs its own props, put that element ` +
        `outside: <Link href="/post"><Shield as="span">…</Shield></Link>.`,
    );
  }

  // Children must be a plain string. Anything else (nested JSX, an array from
  // `{interpolation}`, a number) is rejected rather than encoded best-effort:
  // the encoder cannot see inside your own components, so their text would
  // ship unencoded inside a block that still looks protected. Throwing is the
  // only way that failure is visible.
  if (typeof children !== "string") {
    throw new Error(
      "<Shield> children must be a plain string. Nested JSX would leak unencoded text into the HTML. " +
        "Split mixed content into separate <Shield> instances.",
    );
  }

  // Tags whose only legal parent is a table part. <Shield> wraps its output in
  // a <div> when it needs a sibling for the a11y control, and a <div> is not
  // legal inside <tr> — so the HTML parser foster-parents the wrapper out of
  // the table, leaves the mirror element behind as a phantom extra cell, and
  // the shielded cell disappears from the accessibility tree entirely.
  //
  // This is self-detectable (the component can see its own `as`), so it throws.
  // Its sibling failure — a <Shield> with a11y nested inside an <a>, where the
  // rendered <button> is illegal and the click navigates instead of unlocking —
  // is NOT: a server component sees its props, never its parent. That one can
  // only be documented; see "what to wrap, and what to skip".
  const TABLE_CONTEXT_TAGS = new Set([
    "td", "th", "tr", "thead", "tbody", "tfoot", "caption", "colgroup", "col",
  ]);
  if (typeof as === "string" && TABLE_CONTEXT_TAGS.has(as.toLowerCase())) {
    throw new Error(
      `<Shield as="${as}"> is not supported: the browser moves our wrapper out of the table, ` +
        `which drops the cell from the accessibility tree and leaves a stray one behind. ` +
        `Put a plain <${as}> in your markup and shield its contents instead: ` +
        `<${as}><Shield as="span">…</Shield></${as}>`,
    );
  }

  const Tag = (as ?? "div") as ElementType;
  // Resolve the variant. Precedence, highest first: an explicit `variant` prop
  // (always pins), then this instance's `rotate`, then module-level
  // setRotation(), then the content hash — which spreads alpha/beta/gamma across
  // a page so no single mapping dominates.
  const v: ShieldVariant = resolveVariant(variant, rotate, collectText(children));
  const mapping = MAPPINGS[v];

  const content: ReactNode = encode(children, mapping);

  // Resolve the weight prop to a real cut: a bundled weight name becomes its
  // numeric value ("regular" -> 400), and a number snaps to the nearest cut
  // (470 -> 500), so what lands in `font-weight` below is always a weight a
  // bundled file exists for. Undefined stays undefined, so the element
  // inherits its font-weight (the old behaviour).
  const fontWeight = resolveWeight(weight);

  const finalStyle: CSSProperties = {
    fontFamily: `'${camo.family[v]}', system-ui, sans-serif`,
    // Never let the browser fake a weight or an oblique: a synthetic bold
    // smears the licensed typeface AND distorts the word-ligature composites
    // enough to expose that decoys are in play. The @font-face weight bands
    // already leave no gap for weight synthesis; this also covers faux italic.
    fontSynthesis: "none",
    ...(fontWeight !== undefined && { fontWeight }),
    ...(lineHeight !== undefined && { lineHeight }),
    ...(size !== undefined && { fontSize: size }),
    ...style,
  };

  // Dynamic data-* attribute name. Value carries the variant; some
  // SSR runtimes elide empty-string attributes when spreading, so we
  // keep a stable token here. Camouflage already handles fingerprinting
  // by randomising the attribute *name*.
  const dataAttrProps: Record<string, string> = { [camo.attrName]: v };

  // Only the puzzle mode needs to address this block by ID (to hide it once the
  // plain text is on screen), so only that mode pays for one. Claiming an ID
  // unconditionally would advance the pass counter for every shield on the page
  // and stamp IDs into markup that has no use for them.
  const usesPuzzle = a11y?.mode === "text";
  const { id: blockId, ordinal } = usesPuzzle
    ? blockIdFor(content as string, nounFor(typeof Tag === "string" ? Tag : null))
    : { id: "", ordinal: 1 };

  // The accessible alternative. Built here so it lands OUTSIDE the aria-hidden
  // subtree and BEFORE it in DOM order (see the a11y section above).
  //
  // `children` — the ORIGINAL words — is handed over on purpose. It is what the
  // puzzle mode seals, and sealing is the one place in this component where the
  // plaintext is legitimately in play: it goes in, ciphertext comes out, and
  // only the ciphertext reaches the JSX. Nothing here puts the plaintext in the
  // markup, and `puzzle.test.ts` asserts it.
  const alt = renderA11y(
    a11y,
    typeof Tag === "string" && INLINE_TAGS.has(Tag),
    children,
    blockId,
    typeof Tag === "string" ? Tag : null,
    ordinal,
  );

  // Claim this page's font assets. Inside a render pass scope the first
  // <Shield> of a family emits them and the rest emit nothing; with no scope
  // every instance emits its own, which is bigger but never broken. See the
  // PassRegistry note near the top of this file.
  const family = camo.family[v];
  const emitStyle = claim("styles", family);
  const emitGuard = claim("guards", family);
  const weightKey = fontWeight === undefined ? null : `${family}|${fontWeight}`;

  // The guard's weight coverage. The bootstrap carries this instance's weight
  // as its seed; a later instance at a DIFFERENT weight hands its own to the
  // already-running watcher instead of starting a second one.
  let seedScript: string | null = null;
  if (emitGuard) {
    if (weightKey) claim("weights", weightKey);
  } else if (weightKey && claim("weights", weightKey)) {
    seedScript = fontWeightSeedScript(family, fontWeight as number);
  }

  // The puzzle solver is page-level, not per-block: it sweeps for every solve
  // button in the document and wires each one. Emitting it per instance would
  // repeat ~5 kB per shield, and the script's own window flag would make every
  // copy after the first a no-op anyway.
  const emitSolver = usesPuzzle && claim("solvers", "solver");

  return (
    <>
      {/*
        The @font-face declarations, once per family per render pass. React
        de-dupes NOTHING here on its own, so this is the only thing standing
        between a six-shield page and six identical copies.
      */}
      {emitStyle ? <style dangerouslySetInnerHTML={{ __html: fontFaceCss(v) }} /> : null}
      {/*
        Font-load guard: replaces protected text with "Content unavailable" if
        any weight the page uses fails to load within 4s of the DOM being
        ready. One watcher per family, keyed on a window-level registry, so
        instances that share a family share its watcher.
      */}
      {emitGuard ? (
        <script
          dangerouslySetInnerHTML={{
            __html: fontGuardScript(family, fontHost, fontWeight ?? null, v),
          }}
        />
      ) : null}
      {/* This instance's weight, handed to the watcher an earlier one started. */}
      {seedScript ? <script dangerouslySetInnerHTML={{ __html: seedScript }} /> : null}
      {/*
        The time-lock solver, once per page. Wires every solve button in the
        document, including ones that stream in later.
      */}
      {emitSolver ? (
        <script
          dangerouslySetInnerHTML={{
            __html: solverScript({
              attr: camo.attrName,
              flag: `${camo.guardFlag}s`,
              logPrefix: camo.logPrefix,
              storePrefix: `${camo.attrName}-`,
            }),
          }}
        />
      ) : null}
      {/*
        The accessible alternative, OUTSIDE the aria-hidden region and BEFORE
        it, so linear navigation reaches it before the silence. Null when the
        author passed `{ mode: "none" }` or omitted `a11y` (which warns in dev).
      */}
      {alt}
      {/*
        aria-hidden is deliberate: the HTML here holds a decoy, and voicing a
        decoy is worse than voicing nothing — it is fluent, wrong, and gives the
        listener no signal that anything is off. The alternative is the `a11y`
        prop above: either audio synthesised AT BUILD TIME, or the time-lock
        text mode, whose plaintext is sealed at build time and opened by the
        reader's own browser. Browser speechSynthesis is not an option: on the
        rendered page it would voice the decoy, and on the original it would
        require shipping your plaintext to the browser — the exact leak this
        file warns about a hundred lines up.

        `id` is present only in the puzzle mode, which needs to address this
        block to hide it once the real words are on screen.
      */}
      <Tag
        {...dataAttrProps}
        id={blockId || undefined}
        className={className}
        style={finalStyle}
        aria-hidden="true"
      >
        {content}
      </Tag>
    </>
  );
}

/**
 * Encode a plain string for cases where the user wants the encoded string
 * without the JSX wrapper (e.g. for use in `<title>`, `<meta>`, or other
 * places where you can't render JSX).
 *
 * The second argument is a VARIANT NAME (`"alpha" | "beta" | "gamma" | "maxhide"`),
 * NOT a mapping object — `encodeText` looks the mapping up for you. Omit it to
 * auto-rotate by content hash. (Do not confuse this with the lower-level
 * `encode(text, mapping)` from `@shieldfont/core`, which takes a mapping object;
 * passing a string there silently returns plaintext.)
 *
 * @example
 *   import { encodeText } from "@shieldfont/react";
 *   <title>{encodeText("My Site Title", "alpha")}</title>   // pinned variant
 *   <title>{encodeText("My Site Title")}</title>            // auto-rotated
 */
export function encodeText(text: string, variant?: ShieldVariant): string {
  return encode(text, MAPPINGS[variant ?? autoVariant(text)]);
}
