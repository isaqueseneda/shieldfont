import * as React from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  claim,
  currentCamo,
  fontFaceCss,
  resolveOptikWeight,
  type ShieldVariant,
  type ShieldWeight,
} from "./Shield.js";

/**
 * # `<NonShield>` — the page's ordinary text, in the same typeface
 *
 * Renders its children EXACTLY as written, in Optik. No encoding, no decoys,
 * no `aria-hidden`, no sealed payload, no puzzle, no copy guard, no notice
 * strip. The words in the DOM are the words on screen: a screen reader reads
 * them, a search engine indexes them, a translator translates them, copy-paste
 * copies them, and find-in-page finds them.
 *
 * ## Why it exists
 *
 * A ShieldFont page has always had two kinds of type on it. The shielded
 * paragraphs render in Optik; the headings, captions, nav and intros above and
 * around them render in whatever fallback the host stylesheet supplies,
 * because there was no supported way to put unprotected text in the shipped
 * face. The result is a page that looks like two different designs stapled
 * together, and the author's only fix was to hand-roll a `@font-face` and a
 * `font-family` rule of their own — duplicating this package's font plumbing
 * and, as it turns out, walking straight into the bug described below.
 *
 * It also gives the project's own advice somewhere to land. `docs/integration.md`
 * says headings must NOT be shielded ("Headings: don't shield them"), because
 * once the body is a decoy the headings are the only accurate text left on the
 * page. `<NonShield as="h2">` is the supported way to honour that and still get
 * the typeface — the heading stays real, indexable and readable.
 *
 * ## THE THING THIS COMPONENT ACTUALLY DOES — read this before touching it
 *
 * Setting `font-family: Optik` on plain text DOES NOT WORK, and the failure is
 * silent. It is the single reason this file is more than four lines long.
 *
 * The shipped `optik-*.woff2` files are not the Optik typeface. They are
 * SHIELDED builds of it: `scripts/generate_font.py` injects GSUB lookups that
 * substitute whole words, and wires them into the OpenType `ccmp` feature,
 * which is on by default and which `font-variant-ligatures: none` does not
 * reach. And the substitution dictionary is an INVOLUTION — `m[m[x]] === x`,
 * asserted by `@shieldfont/core`'s own encoder, which is why `decode` is
 * literally defined as `encode`. Every word in the dictionary is therefore
 * both an original and a decoy, and the font swaps it either way.
 *
 * So a shielded face renders plain English as the DECOY. Measured by shaping
 * text through the shipped `optik-a.woff2` with HarfBuzz:
 *
 *   "Read the docs"   ->  composites drawn from the letters "Reset", "sellers"
 *   "belongs"         ->  a composite drawn from the letters "determines"
 *   "2026 report"     ->  "2527 report"        (swap-eligible digits, same feature)
 *   "Chapter 7"       ->  "Chapter 6"
 *
 * 11,962 of the 11,970 words in the `alpha` dictionary shape to a substituted
 * composite. The docs already warn about this from the authoring side — see
 * the WARNING in `docs/integration.md` ("plain English pasted into a `.tk9`
 * element fires the ligatures backwards") and the Word/Pages equivalent — but
 * a component that quietly did the same thing would be far worse than a
 * warning, because nothing errors. The page renders. The bytes are correct.
 * A heading just says the wrong thing, forever, and the author's own eyes are
 * the only test that could ever catch it.
 *
 * `font-feature-settings: "ccmp" 0` is the fix, and it is exact rather than
 * approximate: with ccmp disabled, all 11,970 dictionary words shape to their
 * own letters. The only differences left are the base font's legitimate
 * typography — the real `fi`/`fl` ligatures — which is precisely what should
 * survive. Accented text is untouched in both NFC and NFD (Optik composes its
 * accents through precomposed glyphs and GPOS mark positioning, not ccmp), so
 * disabling the feature costs nothing a reader would notice.
 *
 * The corollary, and the reason `<Shield>` was edited when this file was
 * added: `font-feature-settings` INHERITS. A `<Shield>` nested inside a
 * `<NonShield>` would inherit `"ccmp" 0` and quietly stop substituting,
 * publishing its decoy text at full readability. `<Shield>` now declares
 * `font-feature-settings: normal` on its own element to re-assert the feature.
 *
 * ## What it deliberately does NOT do
 *
 * It emits no font-load guard, and it is not covered by `<Shield>`'s. That is
 * a decision, not an omission — see the note above the `@font-face` claim
 * below.
 */
export interface NonShieldProps {
  /**
   * The HTML element to render. Defaults to `"div"`, matching `<Shield>`;
   * set `as="span"` for inline use, `as="h2"` for a heading.
   *
   * Unlike `<Shield>`, there is no table-tag restriction. `<Shield>` has to
   * reject `as="td"` because it wraps its output in a `<div>` to have somewhere
   * to put the accessible control, and the parser foster-parents that wrapper
   * out of the table. <NonShield> renders one element and nothing else, so
   * `<NonShield as="td">` is a `<td>` and behaves like one.
   */
  as?: ElementType;

  /**
   * Which bundled face to draw the outlines from. Default `"alpha"`.
   *
   * THIS IS NOT THE CHOICE IT IS ON `<Shield>`, and the difference is worth
   * being clear about. There, `variant` picks a substitution dictionary and
   * changes what a scraper reads. Here nothing is encoded and the
   * substitutions are switched off, so all four faces draw the same Optik
   * outlines and the prop selects only WHICH FILE the browser fetches.
   *
   * Which makes it purely a bandwidth question, and the reason it is not
   * auto-rotated the way `<Shield>`'s is: rotation would pull a second ~840 kB
   * file onto a page that already had one, to render text identically. Pin it
   * to whichever variant the page's shielded blocks use and the browser reuses
   * a font it has already downloaded. Pinning `variant` on `<Shield>` — rather
   * than letting it auto-rotate across alpha/beta/gamma — is what makes that
   * possible at all.
   */
  variant?: ShieldVariant;

  /**
   * Font weight: a bundled cut name (`"regular"` | `"medium"` | `"demibold"` |
   * `"bold"` | `"extrabold"` | `"black"`) or a numeric CSS weight (1..1000)
   * that snaps to the nearest real cut, exactly as on `<Shield>`. Default:
   * unset, so the element inherits.
   *
   * The six cuts are static files, not a variable font, and the rendered
   * element sets `font-synthesis: none` for the same reason `<Shield>` does:
   * a browser-synthesised bold of a licensed Playtype typeface is a smeared
   * misrepresentation of someone's typeface.
   */
  weight?: ShieldWeight;

  /** Line-height passthrough. */
  lineHeight?: number | string;

  /** Font-size passthrough. */
  size?: string;

  /** className escape hatch. */
  className?: string;

  /**
   * style escape hatch — merges over the internal font scope.
   *
   * It can therefore override `fontFeatureSettings`, and doing so re-enables
   * the word substitutions on text that is not encoded, which renders decoys.
   * There is no guard against it: this is the documented escape hatch, and a
   * component that refused to be overridden here would also refuse every
   * legitimate `font-feature-settings` an author might want.
   */
  style?: CSSProperties;

  /**
   * The content, rendered verbatim.
   *
   * ## Arbitrary JSX is allowed here, and is NOT allowed on `<Shield>`
   *
   * `<Shield>` throws on anything but a plain string, and the reason is
   * specific: the ENCODER cannot see inside a component. Given
   * `<Shield><Byline author={a} /></Shield>`, a walk of the tree reaches an
   * unrendered element, so the byline's text would ship to the browser
   * UNENCODED inside a block that still looks protected, still carries
   * `aria-hidden`, and still renders through the font. That is a silent leak
   * of the exact text the author installed this package to keep back, so
   * `<Shield>` fails loud instead.
   *
   * Not one clause of that applies here. `<NonShield>` encodes nothing, hides
   * nothing and seals nothing; every character it renders is meant to be read,
   * indexed and copied. There is no protected form for nested content to fall
   * out of, so there is no leak for a restriction to prevent — and a rule with
   * no failure behind it is just an inconvenience with a good pedigree.
   *
   * The inconvenience would also be severe, because it lands exactly on this
   * component's purpose. The content it exists for — headings, captions, nav,
   * intros — is the content most likely to contain a link or an emphasis:
   *
   *   <NonShield as="h2">Read <a href="/docs">the docs</a></NonShield>
   *   <NonShield as="p">Photograph by <em>Jane Roe</em></NonShield>
   *
   * A string-only rule would reject both and send the author back to the
   * hand-rolled `font-family` this component was added to replace, which is
   * how they meet the ccmp bug in the class comment. So: strings, numbers,
   * elements, fragments, arrays, anything React renders.
   *
   * Inheritance is what makes it correct as well as convenient. `font-family`
   * and `font-feature-settings` are both inherited properties, so a nested
   * `<a>` or `<em>` picks up the typeface AND the substitution-off rule from
   * this element without being touched.
   *
   * `null` and `undefined` are accepted and render nothing, matching React's
   * own treatment of them rather than inventing a stricter one for a component
   * that has nothing to protect.
   */
  children?: ReactNode;
}

/**
 * Every prop `<NonShield>` understands. Same fail-loud treatment as
 * `<Shield>`: an unrecognised prop is a prop that would silently not reach the
 * element, and `<NonShield as={Link} href="/x">` is the mistake people make.
 */
const NONSHIELD_PROPS = new Set([
  "as", "variant", "weight", "lineHeight", "size", "className", "style", "children",
]);

/**
 * `<NonShield>` — ordinary, readable text in the shipped Optik face.
 *
 * The counterpart to `<Shield>`: same typeface, same weights, same page
 * assets, and none of the protection. Use it for everything on a ShieldFont
 * page that should stay real — headings above all, which
 * `docs/integration.md` says must never be shielded.
 *
 * Read the note on this file's `NonShieldProps` before changing what it emits:
 * the shipped faces substitute words unless `ccmp` is explicitly disabled, so
 * the `font-feature-settings` below is load-bearing, not housekeeping.
 *
 * @example
 *   <NonShield as="h2">Read the docs</NonShield>
 *   <NonShield as="p" weight="medium">Photograph by <em>Jane Roe</em></NonShield>
 *
 *   // Pinning both to one variant means one font file for the whole page.
 *   <NonShield as="h2" variant="alpha">The future of writing</NonShield>
 *   <Shield as="p" variant="alpha">{body}</Shield>
 */
export function NonShield(props: NonShieldProps) {
  const { as, variant, weight, lineHeight, size, className, style, children } = props;

  const unknown = Object.keys(props).filter((k) => !NONSHIELD_PROPS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `<NonShield> received ${unknown.map((k) => `\`${k}\``).join(", ")}, which it does not ` +
        `forward — the element would render without ${unknown.length > 1 ? "them" : "it"}. ` +
        `<NonShield> accepts only: ${[...NONSHIELD_PROPS].join(", ")}. ` +
        `To wrap text in something that needs its own props, put that element outside: ` +
        `<Link href="/x"><NonShield as="span">…</NonShield></Link>.`,
    );
  }

  // NO `warnIfClientRender()` HERE, and its absence is the point rather than an
  // oversight. That warning exists because <Shield> rendering in a browser means
  // the plaintext and the whole dictionary were serialised into the JS bundle
  // before the encoder ran. <NonShield> has no plaintext to leak: its children
  // are published verbatim by design, on the server or the client, and there is
  // no dictionary in play. It is safe in a "use client" component, which is
  // also what lets an author put a heading in Optik inside an interactive
  // island.
  const Tag = (as ?? "div") as ElementType;

  // Default to alpha rather than hashing the content the way <Shield> does.
  // There is nothing to spread across mappings here — see the `variant` prop.
  const v: ShieldVariant = variant ?? "alpha";
  const { camo, fontHost } = currentCamo();
  if (!Object.prototype.hasOwnProperty.call(camo.family, v)) {
    throw new Error(
      `<NonShield variant="${String(v)}"> is not a bundled face. ` +
        `Valid values: ${Object.keys(camo.family).map((k) => `"${k}"`).join(", ")}.`,
    );
  }

  const fontWeight = weight === undefined ? undefined : resolveOptikWeight(weight);
  const family = camo.family[v];

  const finalStyle: CSSProperties = {
    fontFamily: `'${family}', system-ui, sans-serif`,
    // THE LOAD-BEARING LINE. Turns off the word and digit substitutions that
    // the shipped faces carry in the `ccmp` feature, so the reader sees the
    // words that are actually in the DOM. Without it this component renders
    // "Read the docs" as "Reset the sellers" and nothing anywhere reports a
    // problem. The long version is in the header of this file.
    //
    // `font-variant-ligatures: none` is NOT a substitute and must not be
    // swapped in for it: that property governs liga/clig/dlig/hlig, and the
    // substitutions are wired into ccmp precisely because ccmp is not
    // reachable that way (it is what makes the Word/Pages tier work at all,
    // where an app's ligature setting is the user's to change).
    fontFeatureSettings: '"ccmp" 0',
    // Same reason as <Shield>: never let a browser fake a cut of a licensed
    // typeface. Every numeric weight already lands on a real bundled file.
    fontSynthesis: "none",
    ...(fontWeight !== undefined && { fontWeight }),
    ...(lineHeight !== undefined && { lineHeight }),
    ...(size !== undefined && { fontSize: size }),
    ...style,
  };

  // ---- Page assets: the stylesheet YES, the guard NO ------------------------
  //
  // The @font-face stylesheet is claimed from <Shield>'s OWN pass registry, not
  // from a second one, so a page mixing the two components emits exactly one
  // stylesheet per family whichever component renders first. The buckets are
  // independent, so a <NonShield> that claims "styles" does not stop a later
  // <Shield> emitting the guard it still needs.
  //
  // THE GUARD IS DELIBERATELY NOT EMITTED, NOT SEEDED, AND NOT MATCHED.
  //
  // <NonShield> also does not stamp the `[data-typeface="<variant>"]` attribute
  // that <Shield> puts on every block. That attribute is what the guard's
  // selectors are scoped to, so leaving it off is what keeps this component out
  // of the guard's reach — in three separate ways, each of which would be a bug:
  //
  //   1. IT MUST NOT BE SKELETONISED. When a face fails to load, the guard
  //      blanks every matching element behind a grey skeleton. That is exactly
  //      right for <Shield>, where the alternative is painting raw decoy text
  //      at full readability. It is exactly wrong here. A missing font leaves
  //      <NonShield> rendering the correct words in a fallback face — the
  //      design is degraded and the CONTENT IS PERFECTLY FINE. Blanking it
  //      would destroy readable text to solve a problem that does not exist,
  //      and would do it to headings, which are usually the last accurate text
  //      on a shielded page.
  //
  //   2. ITS WEIGHTS MUST NOT BE SEEDED into a running guard. The guard fails
  //      the whole family if any probed weight is missing. Seed a weight that
  //      only an unshielded heading uses and a missing `optik-a-800.woff2`
  //      would skeletonise every genuinely shielded block on the page — real
  //      protected text blanked because a heading's cut was absent.
  //
  //   3. IT MUST NOT PROVOKE `checkDescendants()`, which warns whenever a
  //      matched element computes to a font-family that is not ours. Perfectly
  //      correct <NonShield> markup — a nested <code> in its own monospace
  //      face, say — would emit console warnings telling the author to remove
  //      an override that is doing its job.
  //
  // A <NonShield>-only page therefore ships no guard at all, which is the right
  // amount of machinery for a page with nothing to hide. And on a mixed page
  // the guard keeps working exactly as before: it watches the family, and the
  // shielded blocks are still the only things it can act on.
  const emitStyle = claim("styles", family);

  return (
    <>
      {emitStyle ? <style dangerouslySetInnerHTML={{ __html: fontFaceCss(v) }} /> : null}
      {/*
        One element, the children verbatim. No `aria-hidden`, no id, no data
        attribute, no sibling control, no sealed payload and no script: there is
        nothing here to explain, unlock or apologise for. A block that carried
        any of that furniture while being fully readable would be worse than
        useless — it would tell a scraper which pages use this library, on the
        text that has nothing to hide.
      */}
      <Tag className={className} style={finalStyle}>
        {children}
      </Tag>
    </>
  );
}
