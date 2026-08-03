import { encode, alpha, beta, gamma, m15en } from "@shieldfont/core";
import type { Mapping } from "@shieldfont/core";
import { DEFAULT_SECONDS, sealText } from "@shieldfont/core/puzzle";
import { sealWithDecoys } from "./decoys.js";
import * as React from "react";
import { solverScript } from "./solver.js";
import {
  altCss,
  DEFAULT_TEXT,
  ICONS,
  clipboardNotice,
  copyGuardScript,
  groupName,
  noticeCss,
  noticeScript,
  resolveNotice,
  standaloneClipboardNotice,
  type ShieldNotice,
} from "./notice.js";
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
 * `"none"`  — an explicit, auditable opt-out; renders nothing and warns not at all.
 *
 * `"audio"` WAS REMOVED IN 0.3.2 and is not coming back. It took a `src` and
 * rendered a native `<audio controls>` pointing at a recording the author had to
 * synthesise and host themselves, which is the whole problem: it was the one
 * mode that asked for work outside the build, so almost nobody did it, and a
 * mode nobody configures is not an accessible alternative. Worse, the ones who
 * did configure it were not covered either — audio-only content with no text
 * alternative fails WCAG 2.2 SC 1.2.1 (Level A), and the text mode never
 * rescued it because the two were separate alternatives an author chose
 * BETWEEN, not a pair. So it charged the author real work for an alternative
 * that did not stand up as one. `{ mode: "text" }` asks nothing of them and
 * ships words rather than sound, so 1.2.1 does not arise for it — which is not
 * a conformance claim for anything else in this package; read the warning in
 * the README. Passing `{ mode: "audio" }` is a type error now, and an author who
 * wants a recording can put an `<audio>` element beside the block themselves.
 * Nothing here ever stopped them, and doing it by hand at least makes the
 * transcript their decision rather than this library's omission.
 *
 * NO PLAIN-TEXT URL IS RENDERED ANYWHERE, and `"text"` is not a return to one.
 * The 0.2.0 shape was `{ mode: "text", href }` — a link to the original words,
 * sitting in the HTML beside the encoded ones, which any scraper reads for the
 * cost of following it. That was removed for a single reason: a URL cannot be
 * offered to a screen reader without being offered to everyone else.
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
       * **Defaults to `true`.** A sighted reader can already read the block
       * through the font, so an on-screen widget explaining an unlocking
       * mechanism is, to them, attached to text that looks fine.
       *
       * Pass `false` to put it back on screen. Do that if you need WCAG 2.2 SC
       * 2.4.7: while hidden, a sighted keyboard user Tabs into a control they
       * cannot see and their focus indicator disappears.
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
   * `{ mode: "text" }` is the default and needs nothing from you: the original
   * words are encrypted into the page at build time and a button decodes them
   * in the browser. `{ mode: "none" }` is an explicit, auditable opt-out.
   * Omitting `a11y` entirely logs one development-time warning per process.
   *
   * No mode renders a link to a plain-text copy. See {@link ShieldA11y}.
   *
   * @example
   *   <Shield a11y={{ mode: "text" }}>{body}</Shield>
   *   <Shield a11y={{ mode: "text", seconds: 10 }}>{shortPullQuote}</Shield>
   *   <Shield a11y={{ mode: "none" }}>{body}</Shield>
   */
  a11y?: ShieldA11y;

  /**
   * Draw the reader-facing notice: an outline enclosing this block, with a
   * strip carrying one short sentence and two buttons ("Uncover",
   * "Copy to clipboard"). Requires `a11y={{ mode: "text" }}` — it is the visible surface of
   * that mode, and does nothing without a sealed payload to open.
   *
   * `true` uses every default; pass a {@link ShieldNotice} to change the copy,
   * the labels, or whether the strip repeats at the bottom.
   *
   * SETTING THIS REPLACES the clipped control. `visualHidden` stops applying,
   * because there is no longer anything hidden to reveal — which is the point.
   * See the header of `notice.ts` for why the clipped default did not survive
   * contact with issue #2.
   *
   * @example
   *   <Shield a11y={{ mode: "text" }} notice>{body}</Shield>
   *   <Shield a11y={{ mode: "text" }} notice={{ position: "top" }}>{pullQuote}</Shield>
   *   <Shield a11y={{ mode: "text" }} notice={{ short: "Protegido de bots de IA." }}>{body}</Shield>
   */
  notice?: ShieldNotice | boolean;

  // ---- THE THREE INDEPENDENT SWITCHES -------------------------------------
  //
  // These three used to be one prop, which was a mistake: they are separate
  // features with separate costs, and bundling them meant an author could not
  // take the cheap one without the expensive one. Every one of them trades
  // some concealment for some access, and the sizes of those trades are very
  // different — so each says its own price in its own doc comment. Read them.
  //
  // ---- AND THE FOUR TIERS THEY MAKE ---------------------------------------
  //
  // The switches are the mechanism; these four are the names for the
  // combinations anyone actually ships. They are the vocabulary used by the
  // demo, by docs/plain-text-mode.md, and by every comment below. There is no
  // `tier` prop — naming a thing is not the same as adding an API for it, and
  // three orthogonal switches say more than one enum ever could.
  //
  //   FULL          screenReader · explain · copyPaste          ← the default
  //                 An outline round the block and a strip carrying the
  //                 sentence and the controls. A reader who needs a screen
  //                 reader, their own reading face, or a translator can SEE
  //                 that something is different and act on it without knowing
  //                 anything about this library.
  //
  //   INVISIBLE     screenReader · copyPaste · explain={false}
  //                 Nothing drawn. The control is real, focusable and clipped
  //                 off-screen, and a copy that would have been silently wrong
  //                 lands a sentence on the clipboard instead. Everything FULL
  //                 does for a listener, nothing it does for an eye.
  //
  //   MINIMAL       screenReader · explain={false} · copyPaste={false}
  //                 The clipped control and nothing else. A human who selects
  //                 and copies gets decoy words with no explanation — which is
  //                 a cost paid by a person, not by a crawler, and is the
  //                 reason this tier is documented rather than recommended.
  //
  //   SEALED SHUT   screenReader={false}
  //                 One element, 274 bytes, no script and no sentence anyone
  //                 can match on. Also: aria-hidden with no alternative, which
  //                 fails WCAG 2.2 SC 1.3.1 on any reading. It is here because
  //                 pretending it is not a choice people make would be a lie,
  //                 and because a library that hides its worst option is a
  //                 library you cannot trust about its best one.
  //
  // WHY THE DEFAULT MOVED TO FULL. It was SEALED-adjacent for 0.3.0 and 0.3.1
  // — a bare <Shield> drew nothing — on the reasoning that the wrapper's plain
  // English is the one thing setCamouflage() cannot rename, so it should be
  // opted into. That reasoning is intact; the conclusion changed. This library
  // exists to deter bots, and every tier below FULL spends a human's time to
  // do it: the screen-reader user who hears silence, the reader whose custom
  // face turns the page to gibberish, the person who copies a quote and pastes
  // nonsense into their notes. FULL is the only tier where none of those three
  // is worse off, and it is one prop away from any of the others.

  /**
   * Ship the original words for assistive technology, sealed behind the
   * time-lock puzzle. **Default `true`.**
   *
   * The cheapest of the three, and the one to leave alone — but "cheap" is
   * relative and the exact figures are worth having. Measured on one block,
   * markup only, excluding the page-level font CSS and scripts:
   *
   *   screenReader:false   1 element,    247 bytes,  no identifying strings
   *   screenReader:true   17 elements,  3537 bytes,  "Scrambled", "Uncover",
   *                                                  "the original text"
   *
   * So it is NOT signature-free, and an earlier version of this comment
   * claimed it was. The default note ({@link A11Y_NOTE}) says "scrambled" and
   * the generated button name says "Uncover the original text (up to N
   * seconds)" — both are matchable, and `setCamouflage()` cannot reach either, because it
   * renames attributes and font families, not prose. Override `note` and
   * `label` if that matters more to you than a reader recognising the control.
   *
   * What it buys is the difference between a block a screen reader skips in
   * silence and one a reader can actually get the words out of. Turning it off
   * is a real choice with a real cost — the region becomes `aria-hidden` with
   * no alternative, which fails WCAG 2.2 SC 1.3.1 on any reading, and under the
   * EU Accessibility Act or the ADA Title II web rule that is a procurement
   * blocker rather than an ethics question.
   *
   * Set it to `false` only if you have decided that and can say why.
   */
  screenReader?: boolean | { seconds?: number };

  /**
   * Draw the explanation wrapper: an outline enclosing the text with a strip
   * carrying the sentence and the controls. **Default `true`** wherever there
   * is a seal to open — this is the FULL tier. `explain={false}` gives you
   * INVISIBLE; see the tier note above.
   *
   * THIS IS THE EXPENSIVE ONE, and the name is deliberate — it is not called
   * `accessibility`, because what it is is an explanation, and what it does is
   * make the page announce itself. It says "protected from AI bots" in plain
   * English, on screen, in the HTML, once per block. Every word of that is a
   * string a crawler can match on, and `setCamouflage()` cannot reach any of
   * it: hashes rename attributes and font families, not prose.
   *
   * So the honest framing is a trade, not an upgrade. You gain a reader who can
   * see that something is different and act on it — the person from issue #2
   * who uses "an assistive technology called copy-paste" and could not find a
   * control that was never drawn. You lose the property that your protected
   * pages look like everyone else's pages.
   *
   * The size of the loss, measured on one block, markup only:
   *
   *   screenReader only      17 elements,  3537 bytes
   *   explain position:"top" 30 elements,  5128 bytes
   *   explain position:"both" 55 elements, 7685 bytes
   *
   * The second strip is 25 elements and 2.6 kB of that, and it duplicates every
   * control and every sentence. On a short block prefer `"top"`.
   *
   * MEASURE AGAIN BEFORE QUOTING THESE. Every figure above was wrong until
   * 0.3.2 — wrong in BOTH directions, by up to 55% — because they were written
   * once and then argued from for two releases while the markup moved under
   * them. Reproduce with: render one block, strip the page-level <style> and
   * <script> (those are per page, not per block), keep the sealed JSON, count
   * `<tag` openings and bytes. A number nobody can reproduce is worse than no
   * number in a file that argues from numbers.
   *
   * Two things soften it and neither eliminates it: the wording is yours to
   * change ({@link ShieldNotice.short}/{@link ShieldNotice.text}), and a wrapper
   * that also appears above UNPROTECTED text stops being evidence of anything.
   *
   * `explain={false}` gives you exactly what shipped in 0.3.0 and 0.3.1: a
   * clean block with the accessible path present but not drawn. That was the
   * default then and is not now; the tier note above says why the trade was
   * made the other way.
   *
   * Requires {@link screenReader} — there is nothing to reveal without a seal.
   */
  explain?: ShieldNotice | boolean;

  /**
   * Mediate copy-paste. **Default `true`** wherever there is a seal. It is
   * independent of {@link explain}: turning the wrapper off does not turn this
   * off, because a silently-wrong paste is a cost paid by a person and by no
   * crawler at all. `copyPaste={false}` with `explain={false}` is MINIMAL.
   *
   * Middling cost. It never disables selection — `user-select:none` would break
   * the exact reader this was built for. What it does is narrower: a selection
   * that touches still-protected text puts a short notice on the clipboard
   * instead of silent decoy words, and (when {@link explain} is on) the strip
   * carries a Copy button that grinds the puzzle first.
   *
   * The camouflage cost is one sentence: the clipboard notice ships in the HTML
   * as an attribute, and it names the mechanism the same way the wrapper does.
   * Turn it off and a copied paragraph is silently wrong, which is worse for a
   * person and no obstacle at all to a crawler — so the default follows
   * `explain` rather than being independently off.
   *
   * WORKS ON ITS OWN as of 0.3.2. It used to be accepted and silently inert
   * without {@link explain}, which this comment admitted and which is the
   * failure class this file fails loud on everywhere else. `copyPaste` with no
   * wrapper now emits a page-level `copy` listener and marks each protected
   * block with the clipboard sentence — one attribute per block, one small
   * shared script per page, and no new elements. What a reader gets instead of
   * a button they can see is a sentence naming the control that is already
   * there: `<Shield>` renders the accessible alternative immediately before the
   * block, so Tab and a screen reader both reach it.
   *
   * REQUIRES {@link screenReader}, and throws without it. With no seal there is
   * no path to the words in any browser, so interception could only ever put a
   * dead end on someone's clipboard — a worse outcome than the wrong paste it
   * replaces, and the "punishing the reader" shape this package has already
   * rejected once. For the same reason the listener stands down at runtime when
   * a browser cannot open the seal at all (no `BigInt`, no `crypto.subtle`, an
   * insecure origin): no path, no notice.
   *
   * It still defaults to whatever `explain` is, so nothing changes for anyone
   * who never names it, and the all-off tier is untouched.
   */
  copyPaste?: boolean | { notice?: string };

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
  "className", "style", "rotate", "a11y", "notice",
  "screenReader", "explain", "copyPaste", "children",
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
var ALT    = '[' + ATTR + '-group]';
var PFX    = ${JSON.stringify(prefix)};
var SEED   = ${seedWeight === null ? "null" : String(seedWeight)};
var TIMEOUT_MS = 4000;
// The sentence the STRIP shows and the name the BLOCK carries are not the same
// string, and used to be. The strip sits above the words, so "the text below"
// points at them correctly; the block IS the words, so on the block the same
// sentence points at whatever comes next. It also named the Uncover button,
// which the tiers without a wrapper do not have. Self-referential, and true on
// every tier.
var BROKEN = 'This text isn\\'t showing correctly.';
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
    SEL + '{color:transparent!important;-webkit-text-fill-color:transparent;' +
    'text-shadow:none!important;user-select:none;' +
    'background-origin:content-box;background-clip:content-box;' +
    'background-repeat:repeat-y;background-size:100% 1.6em;' +
    'background-image:linear-gradient(180deg,transparent 0,transparent .46em,' +
    'rgba(128,128,128,.20) .46em,rgba(128,128,128,.20) 1.1em,transparent 1.1em);}' +
    '@supports (height:1lh){' + SEL + '{background-size:100% 1lh;' +
    'background-image:linear-gradient(180deg,' +
    'transparent 0,transparent calc((1lh - 1em)/2 + .16em),' +
    'rgba(128,128,128,.20) calc((1lh - 1em)/2 + .16em),' +
    'rgba(128,128,128,.20) calc((1lh - 1em)/2 + .80em),' +
    'transparent calc((1lh - 1em)/2 + .80em));}}' +
    ALT + '{position:static!important;width:auto!important;height:auto!important;' +
    'margin:0!important;overflow:visible!important;clip-path:none!important;' +
    'white-space:normal!important;}';
  var sheet = document.createElement('style');
  sheet.setAttribute(FAILED, '1');
  sheet.appendChild(document.createTextNode(css));
  (document.head || document.documentElement).appendChild(sheet);
  var els = document.querySelectorAll(SEL);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    el.setAttribute('aria-label', BROKEN);
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
var DOC = document.documentElement;
if (DOC && DOC.hasAttribute && DOC.hasAttribute(ATTR + '-simulate-fail')) {
  fail('simulated');
  return;
}
if (!document.fonts || !document.fonts.load) {
  fail('document.fonts API not supported');
  return;
}
if (prev && prev.queued) { for (var q = 0; q < prev.queued.length; q++) seed(prev.queued[q]); }
if (SEED !== null) seed(SEED);
function unfail(){
  done = false;
  var sheets = document.querySelectorAll('style[' + FAILED + ']');
  for (var i = 0; i < sheets.length; i++) sheets[i].parentNode.removeChild(sheets[i]);
  var marked = document.querySelectorAll(SEL + '[' + FAILED + ']');
  for (var j = 0; j < marked.length; j++){
    marked[j].removeAttribute(FAILED);
    marked[j].removeAttribute('aria-label');
  }
}
try {
  if (DOC && typeof MutationObserver === 'function') {
    new MutationObserver(function(){
      if (DOC.hasAttribute(ATTR + '-simulate-fail')){ done = false; fail('simulated'); }
      else unfail();
    }).observe(DOC, { attributes: true, attributeFilter: [ATTR + '-simulate-fail'] });
  }
} catch (e) {}
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
// NO URL IS RENDERED ANYWHERE. 0.2.0 shipped a `mode: "text"` that linked a URL
// serving the original words, and it was removed. The reason is worth stating
// once: a URL cannot be offered to a screen reader without being offered to
// everyone else, and the same crawl that reads the decoy reads the link beside
// it. One line of scraper code follows it — so a block carrying one was strictly
// LESS protected than an unwrapped one, while looking protected. No author opts
// into that knowingly.
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
 * Default explanatory prose, spoken once per page before the control. A real
 * sentence, not a label: a bare verb tells a screen-reader user nothing about
 * WHY the paragraph they wanted is missing.
 *
 * One string rather than the per-mode lookup this used to be. `"none"` renders
 * nothing at all, so `"text"` is the only mode with a note to pick, and a table
 * with one row is just the row.
 *
 * Short on purpose. The first version ran to thirty-three words and opened with
 * "hidden from assistive technology", which is jargon addressed to the wrong
 * audience — the listener does not care what the mechanism is called, they care
 * that a paragraph is missing and that there is a way to get it. Tested by ear:
 * the long version was heard as noise to skip past.
 */
const A11Y_NOTE = DEFAULT_TEXT;

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
const A11Y_NOTE_REPEAT = "Scrambled text. Uncover the original below.";

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
    `${camo.logPrefix} <Shield> is rendering with the accessible alternative turned OFF ` +
      `(screenReader={false}, or a11y={{ mode: "none" }}). The encoded block is aria-hidden, so ` +
      `assistive technology reads NOTHING there — what a sighted reader perceives is not ` +
      `programmatically available (WCAG 2.2 SC 1.3.1). That is a defensible choice only if you ` +
      `made it deliberately. The default is screenReader={true} (equivalently a11y={{ mode: "text" }}), ` +
      `which seals the original words ` +
      `into the page at build time and lets a reader who needs them decode them in their own ` +
      `browser. Do NOT reach for browser speechSynthesis instead: it needs your original text in ` +
      `the browser, which is the leak this package exists to prevent.`,
  );
}


/**
 * Build the accessible alternative. Returns `null` for `{ mode: "none" }` and
 * for an omitted prop (after warning), so the caller can render it or not.
 *
 * An explanatory sentence and the time-lock control, and that is the whole
 * output. There is no branch on the mode — `"none"` returns early and the union
 * has nothing else in it — and there is no `<a>` anywhere: the removed 0.2.0
 * `{ mode: "text", href }` was a URL to the original words sitting in the HTML,
 * which any scraper that follows it reads for free. See the section note above.
 */
function renderA11y(
  a11y: ShieldA11y | undefined,
  inline: boolean,
  plain: string,
  mapping: Mapping,
  blockId: string,
  tag: string | null,
  ordinal: number,
): ReactNode {
  // Both branches are now an explicit opt-out: `undefined` only reaches here
  // when screenReader was set false, because otherwise the caller substitutes
  // a text-mode config. So the warning fires for a decision someone made,
  // never for a default they never saw.
  if (!a11y || a11y.mode === "none") {
    warnIfNoA11y();
    return null;
  }

  const attr = camo.attrName;
  const Wrap = (inline ? "span" : "div") as ElementType;
  const Note = (inline ? "span" : "p") as ElementType;
  // DEFAULT: the whole control is screen-reader-only.
  //
  // A sighted reader can already read the block perfectly — the font does that
  // work — so a note and a button explaining an unlocking mechanism are, to
  // them, an unexplained widget attached to text that looks fine.
  //
  // KNOWN COST, and it is a real one: a sighted person navigating by keyboard
  // without a screen reader will Tab into a control they cannot see, and their
  // focus indicator vanishes (WCAG 2.2 SC 2.4.7). The standard remedy is the
  // skip-link pattern — clipped until focused, visible while focused — which
  // this deliberately does NOT do, because it was asked to be invisible.
  // `visualHidden: false` restores an on-screen control.
  const hideWrap = a11y.visualHidden ?? true;
  const wrapStyle = hideWrap ? VISUALLY_HIDDEN : undefined;
  // The long note is spent once per render pass; every block after the first
  // gets the short form. See {@link A11Y_NOTE_REPEAT} for why.
  const firstOfPage = claim("notes", "long");
  const note = a11y.note ?? (firstOfPage ? A11Y_NOTE : A11Y_NOTE_REPEAT);

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
      <span {...({ [`${attr}-say`]: "" } as Record<string, string>)}>
        <span aria-hidden="true" {...({ [`${attr}-icon`]: "on" } as Record<string, string>)}>
          <Icon d={ICONS.shield} />
        </span>
        <Note
          className={`${attr}-say-full`}
          {...({ [`${attr}-alt-note`]: "", [`${attr}-say-full`]: "" } as Record<string, string>)}
          tabIndex={0}
          role="note"
        >
          {/*
            NO aria-label. It held this same sentence, so the string was in the
            DOM twice: browse mode reads the content, focus reads the name, and
            some assistive technology reads both.
            
            The deciding argument is narrower and worse than duplication.
            Attribute text is skipped by browser translation — so the one
            sentence whose entire job is to tell a translator user to uncover
            the text was being delivered in the single form a translator cannot
            reach. The text node is translated; the label was not.
          */}
          {note}
        </Note>
      </span>
      {renderPuzzle(
        a11y.seconds,
        blockId,
        plain,
        mapping,
        inline,
        tag,
        a11y.reveal ?? "hidden",
        a11y.label,
        ordinal,
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

function puzzleLabel(_tag: string | null, _ordinal: number, seconds: number): string {
  // NO ORDINAL. It used to say "for paragraph 2", which was right when every
  // block had its own control and a reader had to tell them apart by ear. The
  // control is page-wide now — one press uncovers every protected block — so
  // naming one paragraph would describe a scope the button does not have.
  return `Uncover the original text (up to ${seconds} seconds)`;
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

/**
 * A Lucide glyph. `d` is always a module constant from {@link ICONS}, never
 * anything an author supplies, so the inner HTML is not a surface.
 */
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/** Inline `display:none` — see ActionButton's `off`. */
const OFF: CSSProperties = { display: "none" };

/**
 * The status glyph — a shield while the text is protected, a crossed shield
 * once it is not. Both ship; the script swaps which is hidden.
 *
 * aria-hidden on both: the sentence beside them already says which state this
 * is, and the live region announces the change. A third telling is noise to
 * the reader who needs the first two.
 */
function StateIcons({ attr }: { attr: string }) {
  return (
    <>
      <span aria-hidden="true" {...({ [`${attr}-icon`]: "on" } as Record<string, string>)}>
        <Icon d={ICONS.shield} />
      </span>
      <span hidden aria-hidden="true" {...({ [`${attr}-icon`]: "off" } as Record<string, string>)}>
        <Icon d={ICONS.shieldOff} />
      </span>
    </>
  );
}

/**
 * One control. Every button in the notice is this, so a change to the shape of
 * a button is a change in one place — which is what stopped being true when
 * the clipped path grew its own copy.
 *
 * `label` is the VISIBLE word, or nothing for an icon-only control. `name` is
 * what a screen reader says, and it must begin with `label` where there is one
 * (WCAG 2.2 SC 2.5.3) so a speech-input user can say what they can see.
 */
function ActionButton({
  attr,
  act,
  icon,
  label,
  name,
  primary,
  hidden: isHidden,
  off,
  extra,
}: {
  attr: string;
  act: string;
  icon: string;
  label?: string;
  name: string;
  primary?: boolean;
  hidden?: boolean;
  /**
   * Belt AND braces for a control that must not be visible yet: the `hidden`
   * attribute is only a default-stylesheet rule, so one line of a host
   * project's CSS (`button { display: inline-block }` in a reset) un-hides it
   * and puts a dead button on every page. The inline style cannot be beaten
   * except deliberately, with !important — which is exactly how the script
   * reveals it.
   */
  off?: boolean;
  extra?: Record<string, string>;
}) {
  const marks = {
    [`${attr}-act`]: act,
    ...(primary ? { [`${attr}-primary`]: "" } : {}),
    ...(extra ?? {}),
  } as Record<string, string>;
  return (
    <button
      type="button"
      hidden={isHidden}
      style={off ? OFF : undefined}
      aria-label={name}
      {...marks}
    >
      <Icon d={icon} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

/**
 * The loading state: the line that says what is happening, over the bar that
 * says how far along it is. Absolutely positioned by the stylesheet so it
 * covers the sentence rather than displacing it — the row's height is then the
 * sentence's height in every state, and pressing the button cannot move the
 * page under the reader.
 */
function LoadingRow({ attr, lead }: { attr: string; lead: boolean }) {
  return (
    <span
      hidden
      {...({ [`${attr}-prog`]: "" } as Record<string, string>)}
      {...(lead ? {} : { "aria-hidden": "true" as const })}
    >
      {/*
        The bar is aria-hidden. NVDA ships "Progress bar output: Beep" ON and
        this is driven ~200 times across the wait; the spoken estimate carries
        the same information without the tones.
      */}
      {/*
        NO aria-label. The bar is aria-hidden on the line above, so a name on
        it is a string nothing can ever read — and it was not a short one:
        "Decoding progress, protected from AI bots", once per block, in the
        HTML. That is the most expensive kind of dead code this package ships,
        because setCamouflage() renames the attribute around a sentence and can
        never touch the sentence. `labels.progress` still exists and still
        names the clipped tier's bar, which is not aria-hidden.
      */}
      <progress max={100} value={0} aria-hidden="true" />
      <span {...({ [`${attr}-est`]: "" } as Record<string, string>)}>Loading text…</span>
    </span>
  );
}

/**
 * One strip of the notice — the same markup top and bottom, because a reader
 * who reaches the end of a long passage should get the same controls, not a
 * cut-down copy of them.
 *
 * Every string the script needs later is parked on the strip as a data
 * attribute rather than baked into the emitted JavaScript. That keeps the
 * script identical for every page (one cache entry, one signature) and keeps
 * ALL author-supplied prose inside React's JSX escaping.
 *
 * ## The same PIXELS top and bottom. Not the same accessibility tree.
 *
 * `position: "both"` used to render two byte-identical strips, and both landed
 * in the accessibility tree whole. Read linearly, one protected paragraph then
 * sounded like this:
 *
 *   Protected from AI bots. / What does this mean?, button / This text is
 *   If you use a screen reader, custom font, or translator the text below might
 *   or a translator? The original is one press away. / Original text, button /
 *   Copy, button / [silence — the paragraph itself] / Protected from AI bots. /
 *   What does this mean?, button / The text below is scrambled to protect it from AI
 *   bots. Uncover it to use a screen reader, a custom font, or a translator."
 *   one press away. / Original text, button / Copy, button
 *
 * Forty-odd words of explanation twice, with the actual content — the thing the
 * reader came for — as a silent gap in the middle. Multiply by six paragraphs.
 *
 * The duplicated BUTTONS are fine and worth keeping: top-and-bottom controls
 * are an ordinary pattern, both sets drive the same state, and pressing either
 * is correct. What was not fine was duplicating the PROSE, which carries no
 * action and cannot be skipped past without also skipping the controls. So the
 * bottom strip keeps every pixel and gives up its share of the tree: its
 * sentence, its status chip and its toast are `aria-hidden`, and it renders
 * neither the info button nor the clipped full explanation at all. What reaches
 * a listener at the bottom of the box is three buttons, which is what a
 * repeated toolbar should be.
 */
function NoticeStrip({
  where,
  firstOnPage,
  attr,
  notice,
  ordinal,
  noun,
}: {
  where: "top" | "bottom";
  /** True only for the lead strip of the FIRST notice on the page. */
  firstOnPage: boolean;
  attr: string;
  notice: ReturnType<typeof resolveNotice>;
  ordinal: number;
  noun: string;
}) {
  /** The strip that owns the explanation. The other one is furniture. */
  const lead = where === "top";
  /**
   * Every action button's accessible name ends with the block it acts on.
   *
   * This is the lesson `puzzleLabel` learned in the older clipped path and the
   * drawn notice then dropped on the floor: a six-paragraph article rendered
   * TWELVE buttons named exactly "Original text", so a reader pulling up a list
   * of form controls — NVDA's Insert+F7, VoiceOver's rotor, JAWS's Insert+F5,
   * the fastest way any of them moves around a page — got a column of identical
   * rows and no way to tell which paragraph any of them belonged to.
   *
   * The visible label stays the first thing in the name, so SC 2.5.3 (Label in
   * Name) holds: speech-input users can still say "click Original text".
   */
  // Every control's NAME carries the fact, not just the verb. A name is the one
  // thing a screen reader never suppresses; the full sentence rides along as
  // the description, which many readers never hear at default verbosity. So
  // "Get text" becomes "Get text, protected from AI bots, paragraph 2" — the
  // reader learns what this is from the control itself, however they arrived.
  // THE WHOLE SENTENCE GOES IN THE NAME, on the first block of the page.
  //
  // Three placements were tried and only this one is actually heard:
  //
  //   a real text node      Tab cannot reach prose at all, and arrowing onto it
  //                         makes VoiceOver read its own chrome first ("you are
  //                         currently on a selectable text") around the words.
  //   aria-describedby      a DESCRIPTION is supplementary; VoiceOver and NVDA
  //                         both suppress it at default verbosity, so a reader
  //                         lands on the button and hears the action only.
  //   the NAME              never suppressed. A control without a name is
  //                         unusable, so no screen reader is free to skip it.
  //
  // It is long, and that is the trade being made deliberately: a sentence a
  // reader hears is worth more than a shorter one they do not. Only the FIRST
  // block on the page pays it — every block after says the short gist instead,
  // because a nine-paragraph article that recites the whole explanation before
  // every button is an obstacle, not an accommodation.
  //
  // Action and position lead, so the reader knows what they have landed on
  // before the explanation starts.
  // The spoken name may elaborate on the visible label, but it must BEGIN with
  // it — SC 2.5.3, so "click Uncover" works in voice control. An author who
  // renames the button without renaming its long form gets their own words
  // back rather than a name that no longer matches what they can see.
  const spokenShow = notice.labels.showLong.startsWith(notice.labels.show)
    ? notice.labels.showLong
    : notice.labels.show;
  const named = (label: string) =>
    notice.labels.gist
      ? `${label === notice.labels.show ? spokenShow : label}, ${notice.labels.gist}`
      : label === notice.labels.show
        ? spokenShow
        : label;
  const openSay = "You are now reading the original text.";
  // The chip's first words, before the device has been measured. Same string
  // the script writes once it has a number, so the wording never changes under
  // the reader mid-wait — only a duration is appended.
  const cfgMeasuring = "Loading text…";
  const strip = {
    [`${attr}-strip`]: where,
    // THE FULL SENTENCE ONCE PER PAGE, A SHORT ONE AFTER.
    //
    // The clipped tier has done this since 0.3.0 (A11Y_NOTE_REPEAT) and the
    // drawn tier never did, so a four-block article read the same twenty-one
    // words four times before a listener reached any content. Measured over a
    // real accessibility tree: 273 spoken words for a locked four-block page,
    // of which 63 were this sentence repeating. The reason the long version
    // exists is so a reader can recognise themselves in it — "if you use a
    // screen reader, custom font, or translator" — and they only need to
    // recognise themselves once.
    //
    // The VISIBLE text is unchanged: every strip still shows the full sentence,
    // because a sighted reader arriving at block four has not necessarily seen
    // block one, and the strip is the only thing telling them what the box is.
    // This is the spoken name only.
    [`${attr}-locked-say`]: notice.text,
    [`${attr}-locked-name`]: firstOnPage ? notice.text : notice.repeat,
    [`${attr}-broken-say`]: notice.brokenText,
    [`${attr}-open-say`]: openSay,
    // TWO ATTRIBUTES DELETED HERE, and one of them mattered.
    //
    // `-measuring` held "Loading text…" and `-progress-label` held a whole
    // sentence — "Showing the original text for paragraph 2" — one per block,
    // in the HTML, in English. The emitted script reads NEITHER: the loading
    // line is rendered directly into `-est`, and the progress bar is
    // aria-hidden so it has no name to give. They were paid for on every
    // wrapped block and consumed by nothing.
    //
    // A stray English sentence is the most expensive kind of dead code this
    // package can ship. setCamouflage() renames the attribute around it and
    // cannot touch the sentence inside, so it is a fingerprint that survives
    // every measure taken against fingerprints.
    // The tooltip has something to say in BOTH states. While protected it
    // explains why copy behaves oddly; once open it explains that it no longer
    // does, and how to go back — which is the question a reader actually has
    // at that point.
  } as Record<string, string>;

  return (
    <div {...strip}>
      <span {...({ [`${attr}-say`]: "" } as Record<string, string>)}>
        {/*
          The state, as a glyph, leading the sentence it describes. A shield
          while the text is protected; a CROSSED shield once the original is on
          screen — the pair reads as one thing switched off, where a checkmark
          would have read as a task completed, which is the wrong idea for a
          state the reader can switch back.
          Both are aria-hidden: the sentence beside them already says which
          state this is, and the live region announces the transition, so a
          third telling is noise to the reader who needs the first two.
        */}
        <StateIcons attr={attr} />
        {/*
          THE WHOLE SENTENCE, VISIBLE, IN THE BAR.

          This replaced a short teaser plus an info button that revealed the
          rest. Three reasons it went:

          1. The maintainer asked for it: "put the whole sentence in there, no
             abridged sentence hidden into an info icon anymore."
          2. It is the only arrangement where the explanation exists in exactly
             ONE place. The teaser version had the same forty words in the
             frame's accessible name, in the tooltip, and in a clipped copy, and
             keeping those three from being announced twice took a synchroniser
             that had already got it wrong once.
          3. An explanation behind a disclosure is an explanation most people
             never read, and the readers who need this one most — screen reader,
             custom font, translator — are the least likely to hover an icon.

          The frame's accessible name is now a SHORT identifier, because this
          node is read on entry anyway; putting the sentence in both is the
          double-announcement the maintainer asked us to stop.
        */}
        {/*
          NO id. It carried `${blockId}-say` so "the controls can point their
          description at it" — nothing ever did: there is not one
          aria-describedby in this file. An id nobody references is a byte on
          every block and a hook the next person will assume is load-bearing.
        */}
        <span
          {...(lead
            ? { tabIndex: 0, role: "note" as const }
            : { "aria-hidden": "true" as const })}
          className={`${attr}-say-full`}
          {...({ [`${attr}-say-full`]: "" } as Record<string, string>)}
        >
          {/*
            TWO HALVES: one for eyes, one for ears, and only ever one of them in
            the accessibility tree.

            An aria-label on this element does not work, and trying it is what
            produced the worst output yet. The reader walks INTO a note and reads
            its contents, so a label plus visible children got BOTH announced —
            the short sentence and then the long one, back to back.

            So the visible half is aria-hidden and the spoken half is clipped.
            On the first block of a page they carry the same words; after that
            the spoken one shortens, because a listener meets the blocks in order
            and only needs to recognise themselves in "if you use a screen
            reader, custom font, or translator" once. A sighted reader arriving
            at block four may not have seen block one, so the visible sentence
            never shortens.

            NEITHER HALF SHIPS `hidden`, and that is deliberate. The clipped one
            did, so the script could un-hide it — and the script runs before
            React hydrates, so React found an attribute in its server HTML that
            was gone from the DOM and reported a mismatch it "won't patch up".
            The server already renders the right words into both halves; the
            script only ever repaints them on a state change. Nothing has to be
            mutated before hydration, so there is nothing to disagree about.

            With JavaScript off this is still correct: the visible half is
            aria-hidden and the clipped half is not, so exactly one of them is in
            the accessibility tree either way.
          */}
          <span aria-hidden="true" {...({ [`${attr}-seen`]: "" } as Record<string, string>)}>
            {notice.text}
          </span>
          <span
            className={`${attr}-clipped`}
            {...({ [`${attr}-heard`]: "" } as Record<string, string>)}
          >
            {lead ? notice.text : notice.repeat}
          </span>
        </span>
        {/*
          Copy confirmation, laid OVER the sentence rather than beside it, so
          the strip never changes height when it appears. aria-hidden because
          the live region already announces the same fact — this is the visual
          half of an announcement that is already being made properly.
        */}
        {/*
          THE LOADING STATE, laid over the sentence for the same reason the
          toast is: the sentence keeps its height while the bar covers it, so
          pressing the button cannot move the row under the reader's cursor.
        */}
        <LoadingRow attr={attr} lead={lead} />
        <span aria-hidden="true" {...({ [`${attr}-toast`]: "" } as Record<string, string>)}>
          Copied to clipboard
        </span>
      </span>
      <span {...({ [`${attr}-acts`]: "" } as Record<string, string>)}>
        <ActionButton
          attr={attr}
          act="copy"
          icon={ICONS.copy}
          name={named(notice.labels.copy)}
        />
        {/*
          NO RESTORE BUTTON. It offered to put the protected version back once
          the original was on screen — a control whose whole function is to take
          away the words the reader just waited for. A reload restores
          protection for anyone who wants it.
        */}
        <ActionButton
          attr={attr}
          act="show"
          primary
          icon={ICONS.eye}
          label={notice.labels.show}
          name={
            // The wait is mentioned ONCE per page, not once per block: a reader
            // meeting this for the first time needs to know the button costs
            // them a few seconds, and the same reader on paragraph nine does
            // not. The live region still reports the measured estimate on every
            // block — this is only the warning before it.
            firstOnPage
              ? `${named(notice.labels.show)}, takes a few seconds`
              : named(notice.labels.show)
          }
        />
      </span>
    </div>
  );
}

function renderPuzzle(
  seconds: number | undefined,
  blockId: string,
  plain: string,
  mapping: Mapping,
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
  // Same arrangement as the drawn tier — see decoys.ts. `blockId` is the
  // position marker and must match what the emitted solver derives, or the
  // browser grinds a decoy and fails to decrypt with nothing useful to say.
  const sealed = sealWithDecoys(plain, mapping, target, camo.attrName, blockId);

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
      <span {...({ [`${attr}-acts`]: "" } as Record<string, string>)}>
        {/*
          The SAME subcomponent the drawn strip uses, not a lookalike. This
          button was hand-rolled here and drifted: no icon, a different type
          size, a different shape, different padding. One <ActionButton> means
          the clipped control and the strip control cannot disagree again — a
          change to the shape of an uncover button is a change in one place.
        */}
        <ActionButton
          attr={attr}
          act="show"
          primary
          hidden
          off
          icon={ICONS.eye}
          label={label ?? "Uncover"}
          name={label ?? puzzleLabel(tag, ordinal, target)}
          extra={buttonMark}
        />
      </span>
      {/*
        aria-hidden, and the reasoning is the one the wrapper's progress bar
        already carries — it was simply never ported to this path. "It does not
        announce on its own" is true of VoiceOver, the only reader this path has
        ever been tested against. NVDA ships "Progress bar output: Beep" ON by
        default and plays a rising tone on every value change, and the solver
        drives roughly 200 of them across a 5-20 second wait. That is twenty
        seconds of beeping over the top of the polite live region trying to
        explain what is happening. Nothing is lost by hiding the bar: the
        estimate and the milestones are spoken by the status line.
      */}
      <progress
        max={100}
        value={0}
        hidden
        style={OFF}
        aria-hidden="true"
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
        // An ARRAY, same as the drawn tier — see decoys.ts.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(sealed.payloads).replace(/</g, "\\u003c"),
        }}
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
    notice,
    screenReader,
    explain,
    copyPaste,
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
  // ---- RESOLVE THE THREE SWITCHES ----------------------------------------
  //
  // `a11y` and `notice` are the 0.3.x spellings and still work; `screenReader`
  // / `explain` / `copyPaste` are the ones that separate the three costs. Where
  // both are given the NEW prop wins, because it is the more specific
  // statement of intent.
  //
  // The default for `screenReader` is TRUE, and that is a deliberate change of
  // posture: a block whose alternative is opt-in ships inaccessible for every
  // author who never read the docs, which is most of them. `a11y:{mode:"none"}`
  // and `screenReader:false` are the two ways to say no, and both are explicit.
  // ONE DERIVATION, USED EVERYWHERE. This used to be computed twice — once here
  // as `srExplicit` (new prop wins) and once further down as `effectiveA11y`
  // (old prop wins) — and the two disagreed. The throws were keyed on the
  // first; what actually rendered came from the second. Three configurations
  // fell through the gap, all verified:
  //
  //   copyPaste + screenReader + a11y:{mode:"none"}
  //     -> no seal, no control, but the clipboard sentence shipped anyway:
  //        a greppable English string naming the mechanism, on a block with
  //        nothing for it to do.
  //   screenReader:false + a11y:{mode:"text"}
  //     -> rendered a seal AND a control despite the switch being off, and the
  //        block got no `id`, so the control pointed at nothing.
  //   notice:true + screenReader:false
  //     -> silently no wrapper and no throw, because the guard tested `explain`
  //        before `notice` had been folded into it.
  //
  // Deriving the config once and keying everything — guards, seal, render — off
  // that single value is what closes all three. Precedence is unchanged and is
  // still what the comment above documents: the newer, more specific prop wins.
  // `screenReader` MERGES OVER `a11y`, it does not replace it. This used to
  // rebuild `{ mode: "text", seconds }` from scratch whenever `screenReader`
  // was present, which silently threw away `reveal`, `label`, `note` and
  // `visualHidden` from an `a11y` object sitting right beside it. Adding
  // `screenReader` to be explicit about a config you already had is an entirely
  // reasonable edit, and it quietly changed the rendered page with no warning
  // and no throw — the exact failure class the guards below exist to close.
  const srObj = typeof screenReader === "object" ? screenReader : undefined;
  const base: ShieldA11y | undefined =
    a11y !== undefined && a11y.mode === "text" ? a11y : undefined;
  const resolvedA11y: ShieldA11y | undefined =
    screenReader !== undefined
      ? screenReader === false
        ? undefined
        : { ...(base ?? {}), mode: "text", seconds: srObj?.seconds ?? base?.seconds }
      : a11y !== undefined
        ? a11y
        : { mode: "text" };
  const usesPuzzle = resolvedA11y?.mode === "text";
  const srSeconds = resolvedA11y?.mode === "text" ? resolvedA11y.seconds : undefined;
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
  // The DRAWN notice replaces the clipped control entirely — rendering both
  // would give a screen reader two ways to do the same thing, one of which it
  // would announce as an unexplained extra button.
  // The same treatment for `copyPaste`, and for a stronger reason than
  // `explain` has. A wrapper with no seal is a control that does nothing; copy
  // mediation with no seal is a control that does something WRONG — it takes a
  // reader's paste away and hands back a sentence pointing at a way out that
  // does not exist on this page. "Punishing the reader" was rejected once
  // already, and shipping it silently is how it would come back.
  //
  // Keyed on `usesPuzzle` — the single resolved config — rather than on the two
  // spellings `explain` checks, so it fires for every way of saying "no seal".
  if (copyPaste !== undefined && copyPaste !== false && !usesPuzzle) {
    throw new Error(
      `${camo.logPrefix} <Shield> was given copyPaste with the accessible path turned off. ` +
        `Copy mediation replaces a paste with a sentence telling the reader how to get the ` +
        `real words, and without a seal there is nothing for that sentence to point at. ` +
        `Either remove screenReader={false} / a11y={{ mode: "none" }}, or remove copyPaste.`,
    );
  }

  // THE DEFAULT IS THE WRAPPER. `explain` used to default to false and this
  // line read `explain !== undefined ? explain : notice` — a bare <Shield>
  // drew nothing, on the reasoning that the wrapper's plain English is the one
  // thing setCamouflage() cannot hide and so should be opted into.
  //
  // That reasoning is still true and the trade has been made the other way,
  // deliberately. The wrapper is now FULL, the recommended tier, because the
  // three people this library keeps meeting — someone on a screen reader,
  // someone using a custom reading face, someone reaching for a translator —
  // cannot act on a control that was never drawn, and a page that silently
  // gives them the wrong words is a page that failed them to inconvenience a
  // crawler. The tiers below the default are all still one prop away, and the
  // table in docs/plain-text-mode.md is what they cost.
  //
  // `notice` is the legacy spelling and still wins where it is passed.
  // Defaulting to `usesPuzzle`, NOT to `true`. The guard below throws when a
  // wrapper is asked for with no seal to open, and `true` would have made
  // <Shield screenReader={false}> — the Sealed tier, a legitimate choice —
  // throw on its own default. The tier with nothing to reveal draws nothing.
  const explainProp =
    explain !== undefined ? explain : notice !== undefined ? notice : usesPuzzle;

  // FAIL LOUD on the combinations that cannot mean anything. Both are keyed on
  // `usesPuzzle` — the single resolved config — so they fire for every spelling
  // of "off" (screenReader:false, a11y:{mode:"none"}) and for every spelling of
  // the thing being asked for (explain OR notice).
  if (explainProp !== undefined && explainProp !== false && !usesPuzzle) {
    throw new Error(
      `${camo.logPrefix} <Shield> was given ${explain !== undefined ? "explain" : "notice"} ` +
        `(the visible wrapper) with the accessible path turned off. The wrapper's buttons ` +
        `open the sealed original, so without a seal there is nothing for them to do and no ` +
        `wrapper is drawn. Either remove screenReader={false} / a11y={{ mode: "none" }}, or ` +
        `remove ${explain !== undefined ? "explain" : "notice"}.`,
    );
  }
  // NO SECOND copyPaste GUARD HERE. There were two, with the same condition and
  // different wording; the earlier one always fired and this one was
  // unreachable, so its message could drift indefinitely without any test
  // noticing — copy.test.ts asserts on the wording of the live one.
  // AN INLINE SHIELD NEVER GETS THE DRAWN WRAPPER, even now that the wrapper is
  // the default. The frame is a <div> containing <div> strips and a whole
  // paragraph of furniture; dropped inside a <p>, the parser closes the
  // paragraph early, the host sentence is torn in two with a bordered box
  // between the halves, and the parsed DOM stops matching the server HTML —
  // a hydration mismatch on top of a broken layout.
  //
  // This did not matter while `explain` was opt-in: nobody asks for a box round
  // three words mid-sentence. It matters enormously as a default, because every
  // <Shield as="span"> that already exists would get one without being changed.
  // Inline blocks keep the clipped control, which is phrasing content and fits
  // where they sit. Explicitly asking for `explain` on an inline tag throws
  // below rather than being silently ignored.
  const inlineTag = typeof as === "string" && INLINE_TAGS.has(as);
  if (inlineTag && explain !== undefined && explain !== false) {
    throw new Error(
      `${camo.logPrefix} <Shield as="${as}"> cannot draw the explanation wrapper. ` +
        `The wrapper is a block-level box — a <div> with strips and buttons — and putting ` +
        `one inside a paragraph splits the sentence around it and breaks hydration. Use a ` +
        `block tag, or drop explain to keep the off-screen control this tag already has.`,
    );
  }
  const wantsNotice =
    !inlineTag && explainProp !== undefined && explainProp !== false && usesPuzzle;
  const cfg = wantsNotice
    ? resolveNotice(explainProp === true ? {} : (explainProp as ShieldNotice))
    : null;
  // COPY MEDIATION IS INDEPENDENT OF THE WRAPPER, and defaults on wherever
  // there is a seal. It used to follow `explain` — `: wantsNotice` — which
  // made `explain={false}` quietly drop the clipboard notice as well, so the
  // tier called INVISIBLE was really MINIMAL and nobody could ask for the
  // middle rung. Writing the tier table in docs/plain-text-mode.md is what
  // surfaced it.
  //
  // Following `explain` was also backwards on the merits. A selection that
  // lands fluent, grammatical, WRONG English in someone's notes costs a human
  // something and costs a crawler nothing — it is the one behaviour in this
  // library that deters no bot at all. It should not be switched off as a side
  // effect of a decision about whether to draw a box.
  // ---- THE FOUR SETTINGS THE WRAPPER CANNOT HONOUR ------------------------
  //
  // `reveal`, `visualHidden`, `label` and `note` are read by renderA11y and
  // renderPuzzle, and those run only on the tiers with NO drawn wrapper. Since
  // 0.3.2 the wrapper is the default, so a page that set any of them and
  // changed nothing else got them silently ignored on upgrade: no error, no
  // warning, no visible difference until somebody noticed the behaviour they
  // had asked for was gone.
  //
  // THROWING RATHER THAN QUIETLY HONOURING THEM is the deliberate choice, and
  // it is worth saying why, because the other option was available.
  //
  // Three of the four cannot mean anything here. `visualHidden` says whether to
  // clip the control off-screen — the wrapper's entire purpose is to draw it.
  // `reveal` chooses between putting the words in the accessibility tree only
  // or replacing the block on screen; the wrapper always does the second.
  // `label` names a control the wrapper does not render, having its own named
  // buttons. Making them "work" would mean inventing a meaning for each, and an
  // invented meaning is a worse trap than an error.
  //
  // `note` is the one real loss: it renamed the sentence, and the wrapper has a
  // sentence. The upgrade path is one word — `explain: { text }` — and the
  // message below says so rather than making the author go and find it.
  //
  // The alternative was to accept them and map them across. It was rejected on
  // the grounds this file states everywhere else: a silent behaviour change is
  // the failure mode that costs the most and is noticed the latest.
  if (wantsNotice && a11y) {
    const inert = (["reveal", "visualHidden", "label", "note"] as const).filter(
      (k) => (a11y as Record<string, unknown>)[k] !== undefined,
    );
    if (inert.length) {
      const fix =
        inert.length === 1 && inert[0] === "note"
          ? `Move it to explain={{ text: … }}.`
          : `Move any wording to explain={{ text: … }}, and use explain={false} ` +
            `if you want the off-screen control these settings were written for.`;
      const one = inert.length === 1;
      throw new Error(
        `${camo.logPrefix} <Shield> was given a11y.${inert.join(", a11y.")} ` +
          `together with the drawn wrapper, which cannot honour ${one ? "it" : "them"}. ` +
          `${one ? `${inert[0]} configures` : `${inert.join(", ")} configure`} the ` +
          `OFF-SCREEN control, and the wrapper replaces that control with a visible ` +
          `one. Before 0.3.2 the wrapper was opt-in, so this never arose; it is the ` +
          `default now, and ${one ? "it was" : "they were"} being ignored in ` +
          `silence. ${fix}`,
      );
    }
  }

  const copyOn = copyPaste !== undefined ? copyPaste !== false : usesPuzzle;
  // Two sentences, because they are addressed to two different situations. With
  // a wrapper drawn there is a button on screen and the notice can name it;
  // without one, naming a button nobody can see is a self-contradiction, so the
  // standalone sentence describes the control that is actually there — clipped,
  // just before the block, reachable by Tab or a screen reader.
  const copyNoticeText =
    typeof copyPaste === "object" && copyPaste?.notice
      ? copyPaste.notice
      : cfg
        ? clipboardNotice(cfg.labels.show)
        : standaloneClipboardNotice();
  // Copy mediation on the tier with no frame to hang it off. `copyOn` alone is
  // not enough: inside a wrapper the notice script already owns the listener,
  // and two handlers on one selection would fight over the same clipboard.
  const copyStandalone = copyOn && usesPuzzle && !wantsNotice;
  const emitCopyJs = copyStandalone && claim("solvers", "copy-js");

  // With `screenReader` defaulting on, an author who passes nothing still gets
  // the sealed alternative — so the omitted-prop case has to resolve to a real
  // config rather than to `undefined`, which renderA11y treats as "opted out".
  const effectiveA11y: ShieldA11y | undefined = resolvedA11y;

  const alt = wantsNotice
    ? null
    : renderA11y(
        effectiveA11y,
        typeof Tag === "string" && INLINE_TAGS.has(Tag),
        children,
        mapping,
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
  // The clipped-control solver and the drawn notice are alternatives, never
  // both: each would wire the same sealed payload and race the other to reveal
  // it. `wantsNotice` shifts this page from one to the other.
  const emitSolver = usesPuzzle && !wantsNotice && claim("solvers", "solver");
  const emitAltCss = usesPuzzle && !wantsNotice && claim("styles", "alt-css");
  const emitNoticeCss = wantsNotice && claim("solvers", "notice-css");
  const emitNoticeJs = wantsNotice && claim("solvers", "notice-js");
  // First notice on the page? Only it mentions the wait. Same latch the
  // font assets use, so it is scoped to the render pass and never leaks
  // across requests.
  const firstOnPage = wantsNotice && claim("notes", "wait");

  // Sealed HERE for the notice path, rather than inside renderA11y, because the
  // frame owns the payload now. Same call, same guarantee: plaintext goes in,
  // ciphertext comes out, and only the ciphertext reaches the JSX.
  // SEALED AMONG DECOYS. Four payloads ship where one used to; the browser is
  // told which is the block's own and grinds exactly that one, so the reader
  // waits no longer than before. See decoys.ts for what this buys and — more
  // importantly — for the version of it that is broken (the same text under
  // three mappings, which a majority vote cracks).
  //
  // Seeded on the camouflage attribute, which is per project: two sites must
  // not draw the same decoys, or one afternoon's work yields a list of known
  // decoy ciphertexts good against everybody.
  const sealed = wantsNotice
    ? sealWithDecoys(
        children,
        mapping,
        srSeconds ?? DEFAULT_SECONDS,
        camo.attrName,
        blockId,
      )
    : null;

  if (wantsNotice && cfg) {
    const attr = camo.attrName;
    const noun = nounFor(typeof Tag === "string" ? Tag : null);
    // The revealed words go into the SAME element type the shield uses, so a
    // <Shield as="h2"> reveals into an <h2> and the document outline survives.
    const Out = (typeof Tag === "string" ? Tag : "p") as ElementType;
    const frameAttrs = {
      [`${attr}-frame`]: "",
      // Which of the sealed payloads is this block's own — as a KEY, not an
      // index. The emitted script derives the position from it the same way
      // decoys.ts did at build time. A hash, so it adds no English to the
      // markup; the clipped tier has carried the same thing as `-solve-for`
      // since 0.3.0.
      [`${attr}-for`]: blockId,
      // `role="group"` WITH A NAME, on the frame — and yes, this file argues a
      // hundred lines up for having taken `role="group"` off the OLD clipped
      // wrapper. Both are right, because they are not the same element.
      //
      // That wrapper held a sentence and a button and nothing else. It had no
      // visual boundary, nothing to be inside OF, and VoiceOver's twenty words
      // of "you are currently on a button inside of a group, to exit this group
      // press…" bought a reader nothing they could not already hear.
      //
      // This is a drawn box containing a whole paragraph, six buttons and two
      // strips of furniture, and the price of it having no boundary is that a
      // listener cannot tell the bottom strip of THIS block from the top strip
      // of the NEXT one. They sound identical, they are adjacent, and between
      // them sits an aria-hidden paragraph that makes no sound at all. Somebody
      // moving by controls has no way to know they have left the block they
      // thought they were acting on. A named group is exactly the fix for that:
      // entering says which block you are in, leaving says you have left it.
      //
      // The name carries the element type and the ordinal for the same reason
      // the buttons do — one block must not sound like the next. It also puts
      // the word "heading" in front of a <Shield as="h2">, which is the only
      // thing standing between a listener and a document outline with a silent
      // hole in it. That does not make the heading navigable (see the note
      // below the a11y section); it makes its absence audible, which is
      // strictly better than the silence it replaces.
      //
      // THE NAME IS AN IDENTIFIER, AND THIS COMMENT USED TO CLAIM OTHERWISE.
      // It said the name "now carries the DISCLAIMER", which the code has never
      // done — `labels.group` defaults to "Protected text", so what ships is
      // "Protected text, paragraph 2". The screen-reader audit caught the
      // mismatch by reading the name back off a real accessibility tree.
      //
      // Identifier is the right answer, and the reason is not "it was already
      // that way". The disclaimer IS spoken on entry — the sentence in the
      // strip is a `role="note"` and its own focus stop, which is what four
      // failed attempts finally produced. Putting the same sentence in the
      // group name means hearing it twice on the way into every block. A short
      // boundary plus a sentence on its own stop is one telling, in the right
      // order.
      //
      // WCAG 2.2: this is what makes SC 1.3.1 defensible rather than merely
      // argued, and it is the SC 2.4.6 story for the block as a whole.
      role: "group",
      // NO NAME BY DEFAULT, and the default used to be "Protected text,
      // paragraph 2".
      //
      // It was a worse version of the sentence that follows it. A listener does
      // not know what "protected text" means until the next phrase explains it,
      // so the label spent twelve words per block priming them for an
      // explanation they were about to get anyway — measured over a real
      // accessibility tree: 85 words to reach the second block with it, 73
      // without.
      //
      // The one argument for keeping it was telling block 3 from block 5. That
      // does not survive: while locked every block is SILENT, so there is
      // nothing to tell apart and nothing to choose between — uncovering is
      // page-wide, and nobody can want block 5 specifically when they cannot
      // read any of them. Once open, the words themselves distinguish them.
      //
      // It also dissolves a real bug rather than managing it. The name was set
      // once and never repainted, so a reader who waited several seconds for
      // their words heard the region call itself "Protected text" immediately
      // before reading them the thing it had just stopped protecting. With no
      // name there is no false claim to keep in sync.
      //
      // The BOUNDARY stays. role="group" with no name is still announced
      // ("grouping" / "out of grouping" on NVDA), which is what separates one
      // block's furniture from the next block's. Authors who want a name can
      // set labels.group, and labels.groupOpen if it should change on open.
      ...(cfg.labels.group
        ? { "aria-label": groupName(cfg.labels.group, noun, ordinal) }
        : {}),
      [`${attr}-guard`]: copyOn && cfg.copyGuard ? "1" : "0",
      ...(copyOn ? { [`${attr}-clip`]: copyNoticeText } : {}),
      // EVERY live-region announcement, parked on the element instead of baked
      // into the emitted script. Two reasons, and the second is the one that
      // forced it: an author can translate these, and the script stays free of
      // any sentence that identifies what this page is doing. A script reading
      // "Done. You are reading the original." is a signature that survives
      // setCamouflage() untouched — the same rule solver.ts and the font guard
      // already follow, and the reason they carry no comments either.
      [`${attr}-says`]: JSON.stringify({
        working: "Loading text…",
        keep: "You can keep reading.",
        pct: "percent.",
        // Arrives AFTER the words, not before them. The script moves focus to
        // the revealed text first and lets this land ~300 ms later, because a
        // focus move cancels speech in flight on every screen reader that has
        // a virtual buffer — so the old order (announce, then focus) delivered
        // this sentence to nobody. Reading as a confirmation-plus-next-step
        // rather than an introduction is what that ordering asks of it.
        done: "You are now reading the original text.",
        // THE FRAME'S NAME, IN BOTH STATES, so the script can repaint it.
        //
        // It could not before, and the result was the sharpest thing anyone has
        // reported about this component: a reader waits several seconds for
        // their words, and the last thing they hear first is the region calling
        // itself "Protected text" — which by then is false. Confirmed on real
        // NVDA, which reads the group name and the sentence in one breath:
        //
        //   "Protected text, heading 1, grouping, If you use a screen reader…"
        //
        // And it is not only heard on entry. Hiding the Uncover button on open
        // drops focus to <body>, then land() focuses the revealed text 120ms
        // later — so focus crosses INTO the group from outside, which is
        // exactly the transition a screen reader announces a container on.
        // paint() runs before land(), so the new name is in place first.
        // Only present when the author asked for a name; the script leaves the
        // frame alone when they are absent.
        ...(cfg.labels.group ? { group: groupName(cfg.labels.group, noun, ordinal) } : {}),
        ...(cfg.labels.groupOpen
          ? { groupOpen: groupName(cfg.labels.groupOpen, noun, ordinal) }
          : {}),
        err: "Something went wrong. You can try again.",
        copied: "The original is on your clipboard.",
        // The two toast lines. Same slot, opposite outcomes — green when the
        // clipboard got the real words, red when it got a notice instead,
        // because a paste that silently contains the wrong text is the failure
        // this whole guard exists to make visible.
        toastCopied: "Copied to clipboard",
        toastBlocked: "Copy blocked — uncover the text first",
        copyFail: "Copying didn’t work. Press Copy again.",
        clipped: `Copied a notice instead. Press “${cfg.labels.show}” to get the real words.`,
        // No `restored` and no `copiedShort`. The Restore button was removed
        // (see NoticeStrip) and nothing announces a short copy, so both were
        // strings shipped in the -says JSON on every block for a script that
        // never looks them up.
        insecure: "Showing the original needs a secure (https) connection.",
        incapable: "This browser can’t show the full text.",
      }),
    } as Record<string, string>;

    return (
      <>
        {emitStyle ? <style dangerouslySetInnerHTML={{ __html: fontFaceCss(v) }} /> : null}
        {emitGuard ? (
          <script
            dangerouslySetInnerHTML={{
              __html: fontGuardScript(family, fontHost, fontWeight ?? null, v),
            }}
          />
        ) : null}
        {seedScript ? <script dangerouslySetInnerHTML={{ __html: seedScript }} /> : null}
        {emitNoticeCss ? <style dangerouslySetInnerHTML={{ __html: noticeCss(attr) }} /> : null}
        {emitNoticeJs ? (
          <script
            dangerouslySetInnerHTML={{
              __html: noticeScript({
                attr,
                flag: `${camo.guardFlag}n`,
                logPrefix: camo.logPrefix,
                storePrefix: `${attr}-`,
                family,
              }),
            }}
          />
        ) : null}
        <div {...frameAttrs}>
          <NoticeStrip
            where="top"
            firstOnPage={firstOnPage}
            attr={attr}
            notice={cfg}
            ordinal={ordinal}
            noun={noun}
          />
          {/*
            The protected block. Still aria-hidden — a decoy read aloud is worse
            than silence, because it is fluent, grammatical and wrong. What
            changed is that the way OUT of the silence is now drawn on screen
            instead of clipped one pixel wide.
          */}
          <Tag
            {...dataAttrProps}
            id={blockId || undefined}
            className={className}
            style={finalStyle}
            aria-hidden="true"
            {...({ [`${attr}-block`]: "" } as Record<string, string>)}
          >
            {content}
          </Tag>
          {/*
            THERE IS NO FALLBACK PARAGRAPH HERE ANY MORE. A hidden <p> used to
            sit in this slot carrying a third copy of the notice sentence, to be
            swapped in for the block when the font-health probe reported the
            face missing. The skeleton took that job — the block keeps its box
            and its height and simply stops showing words — and the swap was
            deleted from the script long before the element was, so every drawn
            block has been shipping an element the script's first act is to
            hide. It cost an element, two stylesheet rules, and a full sentence
            of English prose in the markup, which is a camouflage signature no
            hash can rename.
          */}
          {/*
            Empty `dangerouslySetInnerHTML` so React neither hydrates nor
            reconciles what the script writes here. Without it, a return visit
            (plain text restored from localStorage before hydration) makes React
            delete the words a reader waited for, with no console error and no
            way to self-correct. Same lesson as the font guard's stylesheet.
          */}
          <Out
            hidden
            tabIndex={-1}
            style={{ ...finalStyle, fontFamily: "inherit" }}
            className={className}
            {...({ [`${attr}-out`]: "" } as Record<string, string>)}
            dangerouslySetInnerHTML={EMPTY_HTML}
          />
          <span
            aria-live="polite"
            aria-atomic="true"
            style={VISUALLY_HIDDEN}
            {...({ [`${attr}-status`]: "" } as Record<string, string>)}
            dangerouslySetInnerHTML={EMPTY_HTML}
          />
          <script
            type="application/json"
            {...({ [`${attr}-data`]: "" } as Record<string, string>)}
            dangerouslySetInnerHTML={{
              // An ARRAY now, not one object. Four payloads, one of them the
              // block's own; the emitted script derives which from the block id
              // rather than being told in an attribute, so an attacker has to
              // read the script instead of grepping for a marker.
              __html: JSON.stringify(sealed!.payloads).replace(/</g, "\\u003c"),
            }}
          />
          {cfg.position === "both" ? (
            <NoticeStrip
              where="bottom"
              firstOnPage={false}
              attr={attr}
              notice={cfg}
              ordinal={ordinal}
              noun={noun}
            />
          ) : null}
        </div>
      </>
    );
  }

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
      {emitAltCss ? <style dangerouslySetInnerHTML={{ __html: altCss(camo.attrName) }} /> : null}
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
        Copy mediation without the wrapper: one page-level listener, no state,
        no sweep, no observer, and no markup beyond the sentence already parked
        on the block below. It is emitted only when `copyPaste` asked for it, so
        a page that never mentions the prop is byte-identical to 0.3.1.
      */}
      {emitCopyJs ? (
        <script
          dangerouslySetInnerHTML={{
            __html: copyGuardScript({
              attr: camo.attrName,
              flag: `${camo.guardFlag}c`,
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
        prop above: the time-lock text mode, whose plaintext is sealed at build
        time and opened by the reader's own browser. Browser speechSynthesis is
        not an option: on the
        rendered page it would voice the decoy, and on the original it would
        require shipping your plaintext to the browser — the exact leak this
        file warns about a hundred lines up.

        `id` is present only in the puzzle mode, which needs to address this
        block to hide it once the real words are on screen.

        The `-clip-say` attribute is the ENTIRE per-block cost of standalone copy
        mediation: one sentence, present only when `copyPaste` is on. The
        listener finds its blocks by querying for this attribute at copy time,
        which is also why blocks that stream in later need no wiring. It is a
        string a crawler can match on, like every other author-facing sentence
        in this package — that trade is stated in the prop's own doc comment.
      */}
      <Tag
        {...dataAttrProps}
        id={blockId || undefined}
        className={className}
        style={finalStyle}
        aria-hidden="true"
        {...(copyStandalone
          ? ({ [`${camo.attrName}-clip-say`]: copyNoticeText } as Record<string, string>)
          : {})}
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
