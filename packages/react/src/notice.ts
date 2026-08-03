/**
 * The reader-facing notice — the visible half of the accessible plain-text path.
 *
 * ## Why this exists
 *
 * `a11y={{ mode: "text" }}` shipped in 0.3.0 with its control CLIPPED by
 * default (`visualHidden` defaults to `true`), on the reasoning that a sighted
 * reader can already read the block through the font, so an on-screen widget
 * would be attached to text that looks fine to them.
 *
 * Issue #2 killed that reasoning. A reader wrote in to say they use "an
 * assistive technology called copy-paste" — they can read the page, but not
 * comfortably, and their fix is to select the text and move it somewhere
 * legible. Shielded text defeats that, and the control that would have helped
 * them was drawn one pixel wide off the side of the screen. A control that
 * exists only in the accessibility tree serves screen-reader users and nobody
 * else, and screen-reader users are not the only people who need the words.
 *
 * So the notice is DRAWN. It is furniture: an outline enclosing the protected
 * text with a strip at the top (and optionally the bottom), carrying one short
 * sentence and two buttons.
 *
 * ## The three things this gets right that a bare button did not
 *
 * 1. **The box encloses the text.** A strip floating above a paragraph reads as
 *    "here is a notice". A strip on the edge of a box that CONTAINS the
 *    paragraph reads as "everything in here behaves differently, and this is
 *    the control for it". The second needs no explaining. It is also the only
 *    version where a font-load failure has somewhere to go: the outline itself
 *    turns amber, so the thing that changes is the thing enclosing the bad text.
 *
 * 2. **The full explanation is in the accessibility tree permanently**, not
 *    only when the tooltip is open. A disclosure nobody opens is a disclosure
 *    nobody reads, and the readers who most need this sentence — screen reader,
 *    custom font, translator — are the least likely to be hovering an info
 *    icon.
 *
 *    WHERE it is permanent moved in 0.3.2. It used to be a clipped copy sitting
 *    beside the short sentence; it is now the frame's own accessible NAME, so
 *    it is stated on the way IN to the group rather than found by whoever reads
 *    far enough. That is the one announcement every screen reader makes without
 *    being asked. The clipped copy stays in the markup and stays in step with
 *    the tooltip, but while the block is locked it is `aria-hidden`: the name
 *    already said those words, and saying them again two nodes later is the
 *    duplicate-prose bug this component spent a release removing.
 *
 *    So the invariant is unchanged in substance — the explanation reaches a
 *    listener exactly once per state — and only its carrier moved.
 *
 * 3. **The word "encoded" appears nowhere a reader can see.** It is jargon for
 *    a mechanism, addressed to an audience that only wants to know why copy
 *    behaves oddly and what to press about it.
 *
 * ## The font check is deduped WITHIN a probe, never ACROSS probes
 *
 * `FONTS` exists so that ten blocks sharing one family and weight cost one
 * `document.fonts.load` instead of ten. That is its whole job, and it must be
 * emptied at the start of every probe.
 *
 * Keeping it between probes broke the font-failure path outright, which is how
 * this comment came to be written. `probe()` runs again whenever the
 * `-simulate-fail` attribute changes — that is the entire mechanism behind the
 * demo's font-failure preview, and the closest thing there is to a test for a
 * real 404. With the cache persisting, the second probe returned the FIRST
 * probe's answer: the guard logged the failure, and every frame stayed in the
 * healthy state. No skeleton, no `-failed`, and the strip still telling readers
 * the text was fine while the page showed decoy words to everybody.
 *
 * `told` is cleared with it, so a genuine change of state gets a fresh console
 * message rather than being suppressed by a warning about the previous one.
 *
 * ## One malformed block must not take the page down
 *
 * The payload is parsed in a try, but `data.ct.slice(0, 40)` sat OUTSIDE it. An
 * empty array — from a CMS that post-processed the markup, a version skew, a
 * hand-edited export — parsed fine, produced `[]`, and threw on `.ct`. The throw
 * escaped the sweep loop, and the root had already been marked wired, so every
 * remaining block on the page was left dead with no way to retry. One mangled
 * paragraph silencing an entire article is the wrong blast radius for a library
 * whose failure philosophy is fail loud, fail CONTAINED.
 *
 * Two layers, and the second is the one that matters: the parsed payload is
 * shape-checked inside the try, and each block's construction and wiring is
 * wrapped in its own try/catch so the sweep always reaches the next block.
 * `solverScript` had the identical bug and gets the identical treatment.
 *
 * ## Standing down is STATE, not a one-time mutation
 *
 * A browser without `BigInt` or `crypto.subtle` gets `standdown()`: buttons
 * hidden, sentence swapped for one that says so. It used to do that by writing
 * to the DOM directly — and then `probe()` finished the font check, repainted
 * every frame, and `paintStrip` cheerfully wrote the locked sentence back over
 * it and un-hid the buttons. The reader was left with a control that could not
 * work and a sentence telling them to press it.
 *
 * Guarding that one call path would have left the same landmine for every
 * future repaint, and there are already two more (the simulate-fail observer,
 * and any later sweep). So being incapable is now a flag the RENDERER consults,
 * exactly like `state`. `standdown()` sets it and repaints; no repaint can
 * un-say it, including ones that do not exist yet.
 *
 * ## The copy handler covers EVERY selected block, and skips empty ones
 *
 * It used to stop at the first protected block a selection touched, splice that
 * one block's notice in, and set the result. Two failures came out of that on a
 * page with more than one protected paragraph:
 *
 *   - Select three protected paragraphs and the reader got the notice for the
 *     first and RAW DECOY WORDS for the other two. Fluent, grammatical, wrong
 *     English pasted into their notes with nothing marking it — which is the
 *     exact silent-wrong-paste failure this handler exists to prevent, and the
 *     reason `copyPaste` defaults on.
 *   - A block with no text made `src` the empty string, so `indexOf('')` was 0
 *     and `split('')` spliced the whole notice between every single character of
 *     the selection. A 19 kB clipboard from an empty paragraph. `copyGuardScript`
 *     already skipped empty blocks; this handler never got the same guard.
 *
 * Both are fixed by collecting every intersecting block and splicing each one's
 * own text. The single-block fallback — replace the whole selection when the
 * block's text is not found verbatim — is kept only for one hit, because a
 * partial selection of one block should still be caught, whereas applying it
 * across several would throw away the other blocks' substitutions.
 *
 * `ev.defaultPrevented` is checked first because a page mixing tiers runs this
 * handler AND `copyGuardScript`, both on `copy`, and whichever ran second used
 * to overwrite the other's `setData` outright. Now the first one to act wins and
 * the second stands down. A single selection spanning both tiers gets whichever
 * ran first, which is imperfect and not worth machinery to merge.
 *
 * ## What the emitted script does NOT carry
 *
 * Same rule as the font guard and the solver beside it: no comments, and no
 * word that would identify the mechanism. A project that called
 * `setCamouflage({ hash })` so its HTML shares no signature with any other
 * ShieldFont site would have that undone by one explanatory comment surviving
 * into the page. The explanations live here and stop at the compiler.
 */

/** Names the emitted script needs, all derived from the camouflage state. */
export interface NoticeNames {
  /** Base data-attribute name, e.g. `data-typeface-a8f3`. */
  attr: string;
  /** Window-level idempotency flag. */
  flag: string;
  /** console prefix for failures. */
  logPrefix: string;
  /** localStorage key prefix for solved blocks. */
  storePrefix: string;
  /** The font-family this notice's block renders in, for the health probe. */
  family: string;
}

/**
 * The notice's copy and shape. Every field has a default, so `notice` alone is
 * a complete configuration.
 */
export interface ShieldNotice {
  /**
   * DEAD SINCE THE STRIP TOOK THE WHOLE SENTENCE. This was an abridged line
   * drawn in the bar, with the full explanation behind an info button. Both
   * the teaser and the button are gone — the strip carries {@link text} in
   * full, on its own focus stop, because an abridged sentence plus a
   * disclosure is two things to find where one is needed.
   *
   * Kept in the type so an author who sets it does not get a build error. It
   * is filled in by resolveNotice and read by nothing.
   *
   * @deprecated Nothing reads this. Use {@link text}.
   */
  short?: string;

  /**
   * THE sentence. It is drawn in the strip and it is what a screen reader is
   * handed, because the strip's sentence is a `role="note"` and its own focus
   * stop — one string, one place, read once.
   *
   * This comment used to claim three jobs: the info button's disclosure, a
   * clipped second copy, and the frame's accessible name. None of the three
   * survive — there is no info button, no clipped copy, and the frame is named
   * by {@link ShieldNotice.labels.group}.
   *
   * That last job is the one to write for. A `role="group"` announces its name
   * when a listener enters it, so this sentence is now the first thing said
   * about a protected block rather than something a reader has to go looking
   * for. Entering the box should state the situation; the short sentence beside
   * the buttons is the on-screen summary of it.
   *
   * Write it for the ear. A screen reader is the main consumer of this string,
   * so it is read aloud far more often than it is read on screen.
   */
  text?: string;

  /**
   * What the strip SHOWS when the protective font did not load.
   *
   * Visual only. The accessible name keeps {@link text} unchanged, because a
   * screen-reader user is not affected by a missing font — they were never
   * reading the glyphs — and telling them about it is noise about a problem
   * they do not have.
   *
   * Default names the situation and the fix, and nothing else.
   */
  brokenText?: string;

  /**
   * The SPOKEN name of the sentence on every block after the first. Default
   * `"Scrambled text. Uncover the original below."`
   *
   * {@link text} is what every strip SHOWS, on every block, because a sighted
   * reader arriving at block four has not necessarily seen block one. This is
   * what a screen reader is handed from block two onward, and it is shorter for
   * the opposite reason: a listener meets the blocks in order, and the long
   * sentence exists so they can recognise themselves in it — "if you use a
   * screen reader, custom font, or translator" — which they need to do once.
   *
   * Measured before this existed: a locked four-block page spoke 273 words, 63
   * of them this sentence repeating. The clipped tier had solved it since
   * 0.3.0; the drawn tier had not.
   */
  repeat?: string;

  /**
   * `"top"` (default) draws the strip once, above the text.
   *
   * `"both"` repeats it at the end of the box, for a passage long enough that a
   * reader who finishes it would otherwise scroll back up to act. It is not the
   * default because on anything short it is pure redundancy — a second copy of
   * every control, 34 more elements and ~9 kB per block, and a second helping
   * of the same prose for anyone reading linearly.
   */
  position?: "top" | "both";

  /**
   * A class on the WRAPPER element — the drawn box that encloses the strip, the
   * sentence and the buttons. Merged onto the frame `<div>`; the emitted rules
   * are attribute-scoped and are not touched by it, so a project stylesheet can
   * override them from here without the package being rebuilt.
   *
   * IT IS HERE RATHER THAN ON `<Shield className>`, and the split is the whole
   * point of the field. `<Shield className>` already has a documented, shipped
   * meaning — it lands on the encoded block and on the element the revealed
   * words go into, i.e. on the TEXT — and widening it to also hit the wrapper
   * would silently change what every existing stylesheet does: a rule written
   * to set the article's measure and line-height would start applying to the
   * box and its two strips as well, on upgrade, with nothing to say so. Two
   * elements with genuinely different jobs need two hooks, and this is the one
   * for the furniture.
   *
   * `<NonShield>` is deliberately not given a second hook. It renders exactly
   * one element and has no furniture, so there is nothing to disambiguate and a
   * second name would only be a thing to get wrong.
   *
   * The live case this exists for: the Uncover button inherits colours from the
   * emitted stylesheet, which cannot know a host page's dark mode. A class here
   * gets a project's own tokens onto the box without patching the package.
   */
  className?: string;

  /** Button labels. Defaults are deliberately plain verbs, not jargon. */
  labels?: {
    /** Default `"Uncover"`. */
    show?: string;
    /**
     * The copy control's name. Default `"Copy to clipboard"`.
     *
     * The button is icon-only, so this is spoken and never drawn — which is why
     * it can afford to be the longer phrase. "Copy" alone is the convention on
     * screen, where a clipboard icon sits beside it and the target is obvious;
     * heard on its own, between a sentence about scrambled text and a button
     * called Uncover, "Copy" leaves open what is being copied and to where.
     */
    copy?: string;
    /**
     * The longer spoken form of {@link show}, e.g. `"Uncover the plain text"`
     * against a visible `"Uncover"`.
     *
     * It is USED ONLY IF IT STARTS WITH the visible label. WCAG 2.2 SC 2.5.3
     * (Label in Name) requires the accessible name to begin with the visible
     * words, because a speech-input user says what they can see — "click
     * Uncover" — and a name that does not contain it matches nothing. So an
     * author who renames `show` without renaming this gets their own label
     * back rather than a silently broken voice control.
     */
    showLong?: string;
    /** Default `"Restore"`. */
    restore?: string;
    /**
     * DEAD. There is no info button any more — the abridged sentence behind a
     * tooltip was replaced by the whole sentence in the strip, and the control
     * that revealed it went with it. Kept only so an author who set it does not
     * get a build error; it names nothing.
     *
     * @deprecated Nothing reads this.
     */
    info?: string;
    /**
     * Appended to every control's spoken name. **No default — off.**
     *
     * It was `"protected from AI bots"`, on every button, on every block. The
     * reasoning was sound and the result was not: descriptions are suppressed
     * at default verbosity, so the irreducible fact went into the NAME, which
     * is never suppressed. What that missed is that by the time a listener
     * reaches a button they have already been told — the sentence sits directly
     * above it and says the text is scrambled and what to do about it. The
     * suffix was a third telling of something already said twice, and it landed
     * on the words a reader most needs to hear cleanly.
     *
     * It also made NVDA's Elements List useless for these controls: eighteen
     * rows on a nine-block article, every one ending in the same four words,
     * and the list filters from the START of the string.
     *
     * Set it if your blocks appear without a visible sentence beside them.
     */
        gist?: string;
    /**
     * Names the FRAME, which is a `role="group"`. **Defaults to
     * `"Protected text"`** — a short identifier, not the explanation.
     *
     * The rendered name is `"<group>, <element> <n>"`, so the default is
     * `"Protected text, paragraph 2"`. Entering the group says which block you
     * are in; leaving it says you have left. That is the whole job.
     *
     * THIS DOC USED TO CLAIM THE DISCLAIMER WAS THE DEFAULT, and the code never
     * did it — a comment describing an intention somebody had and did not
     * finish, left sitting where it read as a specification. The argument for
     * it was real: entering a group is the one moment every screen reader
     * reliably says something, so spending it on a label is spending the only
     * guaranteed sentence in the block. What settled it was hearing the block:
     * the disclaimer is ALREADY spoken, on its own focus stop, because the
     * sentence in the strip is a `role="note"` a reader lands on. Putting it in
     * the group name too means hearing it twice on the way in, which is the
     * repetition this file spends most of its length removing.
     *
     * Set it to anything shorter, or longer if your blocks need it. It is not
     * derived from the protected words in either case — see the note on
     * {@link ShieldNotice.text}.
     */
    group?: string;

    /**
     * Names the frame ONCE THE WORDS ARE ON SCREEN. Default `"Original text"`,
     * rendered as `"Original text, <element> <n>"`.
     *
     * A second name exists because the first one stops being true. The frame is
     * named "Protected text" while it is protected; leaving it that way meant a
     * reader who waited several seconds heard the region call itself protected
     * immediately before reading them the thing it had just stopped protecting.
     * Real NVDA reads the group name and the sentence together, so the two
     * arrived in one breath saying opposite things.
     */
    groupOpen?: string;
    /**
     * Names the `<progress>` element. Default `"Decoding progress"`.
     *
     * The bar is `aria-hidden` (see {@link noticeCss} and the note in
     * Shield.tsx), so this is currently read by nothing. It is kept, and kept
     * translatable, because the decision to hide it is a judgement about one
     * screen reader's defaults rather than a property of the markup.
     */
    progress?: string;
  };

  /**
   * Intercept `copy` on the protected text. Default `true`.
   *
   * Selection itself is NEVER disabled — `user-select: none` would break the
   * exact reader who filed the issue. What this does is narrower: when a
   * selection actually touches still-protected text, the clipboard gets a short
   * notice instead of silent decoy words. Copying anything else on the page,
   * including this notice, is untouched.
   */
  copyGuard?: boolean;
}

/** Resolved form — every field present. */
export interface ResolvedNotice {
  short: string;
  text: string;
  brokenText: string;
  repeat: string;
  position: "top" | "both";
  /** Unset when the author gave none — `className={undefined}` emits nothing. */
  className?: string;
  labels: {
    show: string;
    copy: string;
    restore: string;
    info: string;
    group?: string;
    groupOpen?: string;
    progress: string;
    gist?: string;
    showLong: string;
  };
  copyGuard: boolean;
}

export const DEFAULT_SHORT = "Protected from AI bots.";

/**
 * The default full explanation.
 *
 * Named readers first-class on purpose. "Show plain text" asks someone to
 * decode a mechanism; naming the three situations that actually break — screen
 * reader, custom font, translator — lets a person recognise THEMSELVES in the
 * sentence, which is the only thing that makes them press the button.
 *
 * "to protect it from" rather than "to be protected from": the second stacks
 * two passives and reads badly aloud, which matters more here than on screen.
 */
export const DEFAULT_TEXT =
  "If you use a screen reader, custom font, or translator, please uncover the " +
  "text before reading.";

/**
 * What lands in the clipboard when a selection touches still-protected text
 * INSIDE A DRAWN WRAPPER — so it can point at a button the reader can see.
 */
export function clipboardNotice(showLabel: string): string {
  return (
    `[This text is protected from AI bots and didn’t copy correctly. ` +
    `Use “${showLabel}” next to it, then copy again.]`
  );
}

/**
 * The same sentence for a block with NO wrapper drawn — `copyPaste` on its own.
 *
 * It cannot say "use the button next to it", because on this tier there is no
 * button next to it: the control is real and focusable but clipped off-screen,
 * so a sentence that tells a sighted reader to look for something they cannot
 * see is worse than saying nothing. It has to be self-sufficient — what
 * happened, and what to do about it with no visible control in the picture.
 *
 * "Just before it" is a fact about the markup, not a hope: `<Shield>` renders
 * the accessible alternative immediately BEFORE the protected block in DOM
 * order, precisely so linear navigation reaches it first. Tab and a screen
 * reader both find it there.
 *
 * Deliberately does NOT mention the wrapper or suggest turning it on. This
 * string is read by someone who just lost a paste, not by the author.
 */
export function standaloneClipboardNotice(): string {
  return (
    `[This text is protected from AI bots, so what you copied is not what you ` +
    `read on screen. A control that shows the original sits immediately before ` +
    `this passage — reach it with the Tab key or your screen reader, show the ` +
    `text, then copy again.]`
  );
}

/**
 * Shown in place of the sentence when the protective font is missing.
 *
 * Says what is wrong in the READER's terms — the words on screen are not the
 * real ones — and points at the control. It deliberately does not say "font":
 * that names our mechanism, not their problem, and a reader who has just been
 * handed nonsense does not need a lesson in typography to get out of it.
 */
/** The spoken name of the sentence on blocks after the first. See `repeat`. */
export const DEFAULT_REPEAT = "Scrambled text. Uncover the original below.";

export const DEFAULT_BROKEN =
  "The text below isn’t showing correctly. Uncover the original to read it.";

export function resolveNotice(n: ShieldNotice | true): ResolvedNotice {
  const cfg: ShieldNotice = n === true ? {} : n;
  const l = cfg.labels ?? {};
  const text = cfg.text ?? DEFAULT_TEXT;
  return {
    short: cfg.short ?? DEFAULT_SHORT,
    text,
    brokenText: cfg.brokenText ?? DEFAULT_BROKEN,
    repeat: cfg.repeat ?? DEFAULT_REPEAT,
    position: cfg.position ?? "top",
    // NOT defaulted to "". React renders `className=""` as a literal empty
    // attribute, which is a byte of signature on every wrapper on the page for
    // a feature almost nobody uses. Left undefined so the attribute is absent.
    className: cfg.className,
    labels: {
      show: l.show ?? "Uncover",
      copy: l.copy ?? "Copy to clipboard",
      restore: l.restore ?? "Restore",
      info: l.info ?? "What does this mean?",
      gist: l.gist,
      showLong: l.showLong ?? "Uncover the original text",
      // Defaults to the full explanation, so an author who translates `text`
      // gets a translated group name for free and never has to discover that
      // the frame had a second, separate string to override.
      group: l.group,
      groupOpen: l.groupOpen ?? l.group,
      progress: l.progress ?? "Decoding progress",
    },
    copyGuard: cfg.copyGuard ?? true,
  };
}

/**
 * The frame's accessible name: the disclaimer, then which block it is.
 *
 * The trailing-punctuation trim is the whole reason this is a function. The
 * default disclaimer is three sentences and ends in a full stop, and appending
 * ", paragraph 2" to that produces "…one press away., paragraph 2" — which a
 * screen reader reads with the pause of a finished sentence and then an
 * orphaned fragment after it. Trimmed, the ordinal joins the last clause and
 * the whole name reads as one phrase.
 */
export function groupName(label: string, noun: string, ordinal: number): string {
  return `${label.replace(/[.!?…]+$/, "")}, ${noun} ${ordinal}`;
}

/**
 * Lucide icon paths (ISC). Inlined rather than imported: this package has one
 * dependency and is not taking a second for four `<path d>` strings, and a
 * consumer that does not use React icons should not be made to install them.
 *
 * 24x24, stroke-width 2, round caps — Lucide's own geometry, so they sit
 * correctly beside a project that already uses lucide-react.
 */
export const ICONS = {
  eye:
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  /** Lucide `shield` — the protected state. */
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  /** Lucide `shield-off` — protection stood down, the original on screen. */
  shieldOff:
    '<path d="m2 2 20 20"/><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"/><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1 1 0 0 1 1.52 0C14.51 4.32 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
} as const;

/**
 * The notice's stylesheet, emitted once per page.
 *
 * Every selector is keyed off the camouflaged data attribute, so a project that
 * picked its own hash shares no class names with any other ShieldFont site.
 * Colours are `currentColor` and transparent tints wherever possible so the
 * notice inherits the host page's palette instead of imposing one — the one
 * exception is the failure state, which has to be visibly abnormal.
 */
/**
 * The shared inner UI, written once and emitted per scope.
 *
 * The drawn wrapper and the clipped control are the same thing: a shield, a
 * sentence, an uncover button. The only real difference is that one sits in a
 * bordered box. They used to carry independent stylesheets, which is exactly
 * why they drifted apart — different button shapes, different type sizes, and
 * no shield on the clipped one at all.
 *
 * A comma list will not do this job: `[a],[b] .x` parses as `[a]` plus
 * `[b] .x`, so the descendant rules would silently apply to one root only.
 * Emitting the whole block once per scope is a few kilobytes of duplication
 * for a guarantee that the two can never diverge again.
 */
function innerCss(F: string, attr: string): string {
  return (
    // FIRST RULE, AND IT IS LOAD-BEARING. `[hidden]` is only a UA-stylesheet
    // rule, so ANY author `display` declaration outranks it — including the
    // ones a few lines below, which set display:inline-flex on the very
    // elements that ship `hidden` (the health chip, the restore button). The
    // result was a chip permanently reading "Font unavailable" and a Restore
    // button on a block nobody had revealed yet. Shield.tsx documents the same
    // trap for a stray `progress { display: block }` in a host reset; this is
    // that bug, introduced by our own stylesheet rather than someone else's.
    `${F} [hidden]{display:none !important;}` +
    // THE BOX IS SHARED. Both tiers draw the same outline in the same colour,
    // going amber when the font failed. The clipped tier used to have none —
    // the rule lived in noticeCss and only the drawn wrapper got it — and the
    // two tiers read as two different products stacked on one page.
    `${F}{position:relative;border:1px solid rgba(128,128,128,.32);border-radius:12px;}` +
    `${F}[${attr}-failed]{border-color:rgba(184,121,31,.55);}` +
    `${F} [${attr}-skeleton]{color:transparent !important;`+
    `-webkit-text-fill-color:transparent;text-shadow:none !important;`+
    `user-select:none;background-origin:content-box;background-clip:content-box;`+
    `background-repeat:repeat-y;background-size:100% 1.6em;`+
    `background-image:linear-gradient(180deg,transparent 0,transparent .46em,`+
    `rgba(128,128,128,.20) .46em,rgba(128,128,128,.20) 1.1em,transparent 1.1em);}` +
    `@supports (height:1lh){${F} [${attr}-skeleton]{background-size:100% 1lh;`+
    `background-image:linear-gradient(180deg,`+
    `transparent 0,transparent calc((1lh - 1em)/2 + .16em),`+
    `rgba(128,128,128,.20) calc((1lh - 1em)/2 + .16em),`+
    `rgba(128,128,128,.20) calc((1lh - 1em)/2 + .80em),`+
    `transparent calc((1lh - 1em)/2 + .80em));}}` +
    `${F} [${attr}-skeleton]::selection{background:transparent;}` +

    // The protected text and the revealed text are the author's own elements,
    // so the frame supplies the inset rather than expecting them to carry it.
    `${F} > [${attr}-block],${F} > [${attr}-out]{margin:0;padding:22px 18px;}` +
    `${F} [${attr}-strip]{position:relative;display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;` +
    `padding:10px 14px;background:rgba(128,128,128,.08);font-family:inherit;}` +
    `${F} [${attr}-strip="top"]{border-bottom:1px solid rgba(128,128,128,.18);border-radius:11px 11px 0 0;}` +
    `${F} [${attr}-strip="bottom"]{border-top:1px solid rgba(128,128,128,.18);border-radius:0 0 11px 11px;}` +
    `${F}[${attr}-failed] [${attr}-strip]{background:rgba(184,121,31,.12);}` +
    `${F} [${attr}-say]{position:relative;display:flex;align-items:center;gap:7px;`+
    `flex:1 1 0;min-width:0;min-height:36px;}` +
    `${F} [${attr}-acts]{min-height:30px;flex:0 0 auto;justify-content:flex-end;}` +
    // 13px, not `.82rem`, for the reason the buttons are 11px: a rem is the
    // host's root font size and a 10px-root host drew this at 8.2px. 13px is
    // what .82rem resolved to on a default host.
    //
    // The two hardcoded accents here are the FALLBACK. They are keyed to
    // `prefers-color-scheme`, which is the operating system's setting and not
    // the colour of the page this is sitting on — see the derivation near the
    // end of this sheet, which replaces them wherever it can run.
    `${F} [${attr}-toast]{position:absolute;inset:0;display:flex;align-items:center;`+
    `font-size:13px;font-weight:500;color:#2E7D5B;pointer-events:none;`+
    `opacity:0;transform:translateY(6px);`+
    `transition:opacity .22s cubic-bezier(.2,.8,.2,1),transform .22s cubic-bezier(.2,.8,.2,1);}` +
    `${F} [${attr}-strip][${attr}-toasting] [${attr}-toast]{opacity:1;transform:none;}` +
    `${F} [${attr}-strip][${attr}-toasting="blocked"] [${attr}-toast]{color:#C0392B;}` +
    `@media (prefers-color-scheme:dark){${F} [${attr}-strip][${attr}-toasting="blocked"] [${attr}-toast]{color:#FF8A7A;}}` +
    `${F} [${attr}-prog]{position:absolute;inset:0;display:flex;flex-direction:column;`+
    `align-items:stretch;justify-content:center;gap:5px;pointer-events:none;}` +
    `${F} [${attr}-strip][${attr}-loading] [${attr}-say-full],`+
    `${F} [${attr}-strip][${attr}-loading] [${attr}-icon]{opacity:0;}` +
    `${F} [${attr}-strip][${attr}-toasting] [${attr}-say-full],` +
    `${F} [${attr}-strip][${attr}-toasting] [${attr}-icon]{opacity:0;transition:opacity .16s;}` +
    `@media (prefers-reduced-motion:reduce){${F} [${attr}-toast]{transition:opacity .01ms;transform:none;}}` +
    `${F} .${attr}-clipped{position:absolute;width:1px;height:1px;overflow:hidden;`+
    `clip-path:inset(50%);white-space:nowrap;}` +
    `${F} [${attr}-say-full]{margin:0;font-family:inherit;font-size:12px;`+
    `line-height:1.32;font-weight:400;text-transform:none;letter-spacing:normal;`+
    // NO text-wrap:balance. Balancing evens the line lengths, which on a
    // sentence sharing a row with two buttons means the whole block
    // reflows and narrows every time the sentence changes — locked to
    // broken to loading to open — and the strip visibly jumps under the
    // reader mid-solve. Ordinary wrapping fills each line and only the
    // last one moves.
    // .80, AND EVERY STEP OF THIS NUMBER'S HISTORY IS A WCAG 2.2 SC 1.4.3
    // FAILURE SOMEBODY MEASURED. It was .55, which failed on every host but
    // pure black; it went to .70; the style audit then found .70 failing on a
    // host nobody had thought to try. Measured on a white page, 12px — this
    // inherits `currentColor`, so the host picks the colour and we pick only
    // the fade:
    //
    //          host #000   #111   #222   #333   #444   #374151 (Tailwind gray-700)
    //   .55         4.76   4.17   3.67   3.24   2.88    3.19
    //   .70         8.52   7.07   5.89   4.94   4.17    4.14   ← fails
    //   .80        10.2    8.51   7.14   6.03   5.17    5.13
    //
    // gray-700 on white is Tailwind's default body colour and therefore one of
    // the most-deployed pairs of colours on the web. At .70 it came out at
    // 4.14:1. The whole point of the fade is that the sentence is furniture and
    // should not shout over the passage it introduces, and at .80 it still
    // reads as quieter than the body — this buys about a point of contrast for
    // a difference in weight that has to be looked for.
    //
    // An earlier axe run reported all of this clean, because opacity on an
    // ancestor does not appear in a child's computed style and the tool read 1.
    // scripts/style-audit.mjs walks the ancestor chain for exactly that reason.
    //
    // SAY THE TRUE THING: .80 does not GUARANTEE 4.5:1 and nothing here can. A
    // host whose own body text is #666 is at 4.44:1 before we touch it, and we
    // can only ever be worse than the page we are in. This fixes the part that
    // was ours.
    `color:currentColor;opacity:.8;}` +
    `${F} [${attr}-say-full]:focus-visible{outline:2px solid currentColor;`+
    `outline-offset:3px;border-radius:3px;opacity:.9;}` +
    `${F} [${attr}-acts]{display:flex;align-items:center;gap:7px;flex-shrink:0;flex-wrap:wrap;}` +
    // FOUR THINGS IN HERE ARE ABOUT SOMEBODY ELSE'S STYLESHEET, and each was
    // measured broken by scripts/style-audit.mjs before it was written.
    //
    // `font-size:11px`, NOT `.66rem`. A rem is the HOST's root font size, and a
    // host that sets `html{font-size:10px}` — the old "62.5% trick", still in
    // plenty of production CSS — drew these labels at 6.6px. Uppercase, 500
    // weight, .06em tracking, 6.6px: unreadable, and invisible to every
    // contrast checker because the colour was perfect. 11px is what .66rem
    // resolved to on a default host, so nothing moves on a normal page; it
    // simply stops being the host's decision. Measured: 6.6px → 11px on the
    // 10px-root host, 15.8px → 11px on the 24px-root host.
    //
    // `line-height:1.4` is declared for the same reason: without it the pill's
    // height is whatever the host's body line-height happens to be, and the
    // strip is laid out around a fixed row. 1.4 is within a pixel of what a
    // 1.5-line-height host was already producing, so this is a lock, not a
    // change. A host rule carrying `!important` still wins — measured, and
    // survivable: `* { line-height: 1 !important }` costs 3px of pill height
    // and fails nothing.
    //
    // `letter-spacing` and `text-transform` were already declared, and are the
    // reason a host `body{letter-spacing:2px}` cannot reach in here.
    //
    // The border is TWO declarations, and the second is the one that matters.
    // At `rgba(128,128,128,.34)` the pill's edge measured 1.45:1 against the
    // strip on every light host in the audit — an outline nobody can see, on
    // the only two controls in the component. Derived from `currentColor` at
    // 62% it tracks the host the way the rest of this sheet does and clears the
    // 3:1 SC 1.4.11 asks of a control boundary on every host measured: 3.27 on
    // white, 3.32 on Tailwind gray-700, 4.95 on a dark theme.
    //
    // 62% and not 52%, which was the first attempt: it cleared white at 3.27
    // and then failed at 2.69 on a gray-700 host, because the tint is mixed
    // toward the strip's own colour and a lighter host text has less room to
    // fall. The audit found that; arithmetic on one background would not have.
    //
    // `#808080` is the fallback for a browser without `color-mix`. A fixed grey
    // cannot follow a host, but mid-grey is the one value that clears 3:1
    // against both a near-white strip (3.59) and a near-black one (4.32), and
    // it is what the old rgba was already reaching for at a third of the alpha.
    `${F} button{display:inline-flex;align-items:center;gap:7px;cursor:pointer;` +
    `border:1px solid #808080;` +
    `border-color:color-mix(in srgb,currentColor 62%,transparent);` +
    `border-radius:999px;background:transparent;color:inherit;` +
    `font-family:inherit;font-size:11px;line-height:1.4;letter-spacing:.06em;` +
    `text-transform:uppercase;font-weight:500;padding:7px 13px;white-space:nowrap;}` +
    `${F} button:hover{background:rgba(128,128,128,.14);}` +
    // WCAG 2.2 SC 2.4.7. The UA ring was never removed, so this is not a fix
    // for a missing indicator — it is a fix for an ILLEGIBLE one: the primary
    // button paints `background:currentColor`, and a default ring drawn in the
    // text colour on a background of the text colour is invisible. The offset
    // moves it clear of the fill; the colour is the same expression the glyphs
    // on that fill use, and is derived below.
    `${F} button:focus-visible,${F} [${attr}-out]:focus-visible{` +
    `outline:2px solid currentColor;outline-offset:2px;}` +
    // The BUSY state, and the reason it is a dim rather than a `hidden`.
    //
    // While the block is working, every action button used to be `hidden`.
    // The button that had just been PRESSED was one of them, so the browser
    // moved focus to <body> the instant the reader activated it — for the
    // whole five to twenty seconds of the wait. A screen-reader user pressed
    // "Original text", lost their place, and got a polite announcement they
    // had no context left to attach it to. That is most of "I didn't really
    // know what was going on". A control that stays put, stays focused and
    // says it is busy costs one dimmed button and fixes it outright.
    `${F} button[${attr}-off]{opacity:.4;pointer-events:none;}` +

    // ── THE UNCOVER BUTTON, AND THE BUG THAT WAS REPORTED AS "IN DARK MODE IT
    //    GETS ALL FUCKED" ────────────────────────────────────────────────────
    //
    // It used to be four declarations:
    //
    //     button[-primary]      { background: currentColor }
    //     button[-primary] span { color: Canvas }
    //     button[-primary] svg  { color: Canvas }
    //     button[-primary]:focus-visible { outline-color: Canvas }
    //
    // The fill is the host's text colour — correct, and the whole point of this
    // component looking like part of the page it is in. The GLYPHS on that fill
    // were `Canvas`, on the reasoning that the UA canvas is the host's page
    // colour, so it must contrast with the host's text colour.
    //
    // `Canvas` is not the host's page colour. It is the colour the USER AGENT
    // would paint, and it only goes dark when the document opts in with
    // `color-scheme: dark`. A site that ships its own dark theme — `body {
    // background: #111; color: #eee }`, which is how the large majority of dark
    // themes on the web are actually built — leaves Canvas white. So the button
    // painted near-white glyphs on a near-white fill:
    //
    //     host                                      label      icon
    //     body{background:#111;color:#eee}          1.16:1     1.16:1
    //     body{background:#0b0b0b;color:#f5f5f5}    1.09:1     1.09:1
    //     Tailwind Preflight + slate-900 theme      1.23:1     1.23:1
    //     forced-colors: active                     1.00:1     1.00:1
    //
    // 1.09:1 is not "hard to read". It is a button with nothing drawn on it.
    // Every one of those numbers comes from scripts/style-audit.mjs, which
    // exists because nobody could say what "fucked" meant.
    //
    // THE FIX ASKS THE FILL, NOT THE USER AGENT. The one thing that is known
    // for certain about the glyphs' background is that it IS `currentColor`, so
    // the glyph colour is derived from `currentColor` instead of from a system
    // colour that only correlates with it. Relative colour syntax reads the
    // fill's OKLCH lightness and picks the pole it is furthest from:
    //
    //     clamp(0, (.62 - l) * infinity, 1)   →   0 (black) when l > .62
    //                                             1 (white) when l < .62
    //
    // `infinity` is a real <number> in calc(), so the multiplication saturates
    // and the clamp turns a continuous lightness into the binary choice this
    // needs. .62 is the standard OKLCH crossover for "black or white on this?";
    // the worst case near it is a host whose body text is #767676, which gets
    // white glyphs at 4.54:1 — and that host's own body text is 4.54:1 too, so
    // the button is exactly as legible as the page it sits in, which is the
    // most this component can honestly promise. Measured after: 15.2:1, 16.7:1
    // and 13.1:1 on the three dark hosts above.
    //
    // WHY THE FILL IS GATED BEHIND @supports RATHER THAN THE GLYPHS. Gating
    // only the glyph colour would leave a browser without relative colour with
    // the old, broken pair. Gating the FILL means such a browser never gets a
    // filled button at all: it falls through to the shared outline pill with a
    // heavier weight, which is plainer than intended and legible everywhere,
    // because its label is `currentColor` on the host's own background like
    // everything else in the strip. Baseline for relative colour is Chrome 119,
    // Safari 16.4 and Firefox 128 — this is the enhancement, not the floor.
    //
    // NO `!important` ANYWHERE IN HERE. Every one of these properties is
    // declared on a selector carrying two attribute selectors, which beats any
    // reset a host is realistically running, and the audit confirms Preflight,
    // `all:unset` and a `* {}` reset all lose to it on the merits.
    `${F} button[${attr}-primary]{font-weight:600;}` +
    `@supports (color:oklch(from red l c h)){` +
    `${F} button[${attr}-primary]{background:currentColor;border-color:transparent;}` +
    `${F} button[${attr}-primary] span,${F} button[${attr}-primary] svg{` +
    `color:oklch(from currentColor clamp(0,(.62 - l)*infinity,1) 0 0);}` +
    `${F} button[${attr}-primary]:focus-visible{outline-offset:-4px;` +
    `outline-color:oklch(from currentColor clamp(0,(.62 - l)*infinity,1) 0 0);}}` +
    `${F} button svg{width:13px;height:13px;flex:none;}` +
    // 24x24, not 20x20: WCAG 2.2 SC 2.5.8 (Target Size, Minimum) is AA and
    `${F} [${attr}-icon]{display:inline-flex;align-items:center;flex:none;opacity:.75;}` +
    `${F} [${attr}-icon="off"]{opacity:1;}` +
    `@media (prefers-color-scheme:dark){${F} [${attr}-toast]{color:#57E08C;}}` +
    `${F} [${attr}-icon] svg{width:14px;height:14px;}` +
    `${F} progress{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:100%;height:3px;border:0;` +
    `background:rgba(128,128,128,.22);border-radius:999px;overflow:hidden;vertical-align:middle;}` +
    `${F} progress::-webkit-progress-bar{background:rgba(128,128,128,.22);border-radius:999px;}` +
    `${F} progress::-webkit-progress-value{background:currentColor;border-radius:999px;}` +
    `${F} progress::-moz-progress-bar{background:currentColor;border-radius:999px;}` +
    // .80, matched to the sentence it covers. At .72 it measured 4.36:1 on a
    // Tailwind gray-700 host — the same failure, in the same place, for the
    // same reason, and it is live text a reader is meant to read while they
    // wait rather than decoration.
    `${F} [${attr}-est]{order:-1;font-size:12px;line-height:1.32;letter-spacing:normal;opacity:.8;`+
    `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}` +
    // The clipped copy of the full sentence. NEVER display:none. Its presence
    // in the tree is now controlled by `aria-hidden`, and a
    // display rule here would make that control a lie in one direction: an
    // element removed from the tree by CSS cannot be put back by an attribute.
    `@media (max-width:500px){`+
    `${F} [${attr}-strip]{flex-direction:column;align-items:stretch;gap:9px;padding:10px 12px;}`+
    `${F} [${attr}-say]{flex:1 1 100%;}`+
    `${F} [${attr}-acts]{flex:1 1 100%;}`+
    `${F} [${attr}-acts]{gap:6px;}`+
    `${F} [${attr}-acts] button[${attr}-act]{flex:1 1 0;justify-content:center;}`+
    
    `${F} progress{flex:1 1 auto;width:auto;max-width:none;}`+

    `${F} > [${attr}-block],${F} > [${attr}-out]{padding:18px 14px;}`+
    `}` +

    // ── THE TOAST'S ACCENT, KEYED TO THE PAGE RATHER THAN TO THE OPERATING
    //    SYSTEM ───────────────────────────────────────────────────────────
    //
    // The green and the red above are fixed colours with a
    // `prefers-color-scheme: dark` variant, and that variant asks the wrong
    // question. `prefers-color-scheme` is what the READER told their operating
    // system. It says nothing about what this page is painted, and the two
    // disagree constantly: a site with its own dark theme and no OS preference
    // set, a site that only ships light and a reader whose OS is dark. Measured
    // on those two hosts, the confirmation line came out at 3.68:1 and 1.55:1.
    //
    // No fixed colour can fix this. A green dark enough for 4.5:1 on white
    // needs luminance ≤ .183 and a green light enough for 4.5:1 on #111 needs
    // ≥ .223, so the two requirements have no overlap and the choice HAS to be
    // made per page. The signal available is the one the rest of this sheet
    // already runs on: `currentColor` is the host's text colour, so its
    // lightness says which way round the page is. Same saturating clamp the
    // primary button uses, into a fixed hue and chroma so a green stays green.
    //
    // The fallback is the pair above, unchanged. A browser without relative
    // colour gets exactly what it got before this block existed.
    //
    // WHERE THIS IS STILL A GUESS, said plainly. Reading the page's polarity off
    // the text colour is exact at both ends and undefined in the middle: a host
    // whose body text is around #8a8a8a lands on the wrong side of .62 and gets
    // a light green on a white page, 1.42:1. That host's own body text is 3.45:1
    // and fails SC 1.4.3 before this component draws anything, so the ambiguity
    // exists only where the page has already lost — but it is a real limit and
    // it is measured, as `host-below-the-line` in scripts/style-audit.mjs. The
    // Uncover button is not affected: its glyphs are derived against the FILL,
    // which is that same colour, so it stays legible on top of it either way.
    `@supports (color:oklch(from red l c h)){` +
    `${F} [${attr}-toast]{color:oklch(from currentColor clamp(.42,(l - .62)*infinity,.84) .14 152);}` +
    `${F} [${attr}-strip][${attr}-toasting="blocked"] [${attr}-toast]{` +
    `color:oklch(from currentColor clamp(.45,(l - .62)*infinity,.82) .17 27);}}` +

    // ── WINDOWS HIGH CONTRAST ─────────────────────────────────────────────
    //
    // Forced colors replaces every author colour with one of a handful the
    // reader chose, and it does it property by property — which is why the
    // primary button came out at exactly 1.00:1 in the audit. Its fill was
    // `currentColor` and its glyphs were `Canvas`; forced colors mapped both
    // ends of that onto the same system colour and the button went blank.
    //
    // The fix is to stop being clever in this mode and ask for the colours the
    // reader already picked for buttons. ButtonFace/ButtonText/ButtonBorder is
    // what a native <button> gets, so these end up looking like the rest of the
    // reader's system rather than like a component that has opinions.
    //
    // The selectors carry the `-primary` attribute even where the value is the
    // same for every button: the @supports block above is (0,2,1) and a plain
    // `button` rule here would be (0,1,1) and lose. This block is LAST in the
    // sheet so that, at equal specificity, it wins.
    //
    // Opacity is not a colour and forced colors does not touch it, so every
    // fade in this sheet survives into a mode whose entire purpose is removing
    // fades. They are reset here: the busy dim becomes GrayText, which is the
    // system's own way of saying the same thing, and the rest go to full.
    `@media (forced-colors:active){` +
    `${F} button,${F} button[${attr}-primary]{background:ButtonFace;border-color:ButtonBorder;}` +
    `${F} button span,${F} button svg,` +
    `${F} button[${attr}-primary] span,${F} button[${attr}-primary] svg{color:ButtonText;}` +
    `${F} button[${attr}-off]{opacity:1;border-color:GrayText;}` +
    `${F} button[${attr}-off] span,${F} button[${attr}-off] svg{color:GrayText;}` +
    `${F} button:focus-visible,${F} button[${attr}-primary]:focus-visible,` +
    `${F} [${attr}-out]:focus-visible{outline:2px solid CanvasText;outline-offset:2px;}` +
    `${F} [${attr}-say-full],${F} [${attr}-est],${F} [${attr}-status],` +
    `${F} [${attr}-icon]{opacity:1;}` +
    `${F} [${attr}-toast],${F} [${attr}-strip][${attr}-toasting="blocked"] [${attr}-toast]{` +
    `color:CanvasText;}` +
    `}`
  );
}

/**
 * The notice's browser half.
 *
 * Wires every frame on the page: the solve buttons (both strips drive the same
 * puzzle), the copy buttons, the info disclosures, and the font-health probe.
 *
 * The puzzle machinery is deliberately IDENTICAL to solver.ts — same warm-up,
 * same calibration window, same key derivation — because the two must agree
 * byte for byte with `sealText` or the AES-GCM tag rejects and the reader gets
 * an error where their words should be.
 *
 * Notes on the source, which carries no comments of its own:
 *
 * - A `-simulate-fail` attribute on <html> forces the probe to report failure.
 *   It exists because the failure state is the one an author is least likely to
 *   have seen and most likely to ship broken: it only appears when a font 404s
 *   in production, which is exactly when nobody is watching. Toggling an
 *   attribute is inert on a healthy page, costs nothing in bytes, and cannot be
 *   reached by a crawler in a way that reveals anything the markup does not
 *   already say.
 * - `all()` is the page-wide uncover. Pressing any block's control starts every
 *   other locked block too. The control used to be per block and its NAME said
 *   so ("for paragraph 2"), because a reader had to tell several identical
 *   buttons apart by ear — but that is the wrong shape for what it does. A
 *   reader who needs the plain text needs it for the article, not for one
 *   paragraph, and making them find and press a button per block, waiting each
 *   time, is an obstacle dressed as a feature. Every block still grinds its own
 *   puzzle — separate seals, separate moduli, no shortcut — but concurrently in
 *   their own workers, so the page costs the slowest block rather than the sum.
 *   Blocks already open, or restored from cache, are skipped.
 *
 *   It also drives the OTHER script's controls. A page can mix both tiers —
 *   one block drawing a wrapper, the rest using the clipped control — and they
 *   are wired by two separate scripts with separate state, so iterating this
 *   script's own frames uncovered exactly one block and left the rest sitting
 *   there. Synthesising a click on the clipped buttons is the honest way to
 *   reach them: it goes through their real handler, so their capability checks,
 *   their busy latch and their cache all behave exactly as if a reader had
 *   pressed them.
 * - `probe()` asks `document.fonts.load()` for the FACE rather than inferring
 *   health from whether anything on the page is currently using it. The
 *   inference is circular: the failure skin swaps the block off the shielded
 *   family, which would remove the only consumer of the font being measured and
 *   then report the absence it just caused.
 * - Both strips share one state. `paint()` re-renders every strip of a frame
 *   from that state, so pressing the bottom button updates the top one.
 * - The copy listener is on `document`, and returns immediately unless the
 *   selection intersects a still-protected block. Copying the notice itself,
 *   or any other text on the page, must behave exactly as it would anywhere.
 * - The tooltip is a real `<button>` with `aria-expanded`, openable by click and
 *   keyboard and closable with Escape. Hover-open is layered on in CSS behind
 *   `@media (hover:hover)` so a touch user is never left needing a pointer.
 *   This paragraph described code that did not exist until now: the button
 *   shipped a hard-coded `aria-expanded="false"` and nothing ever read or wrote
 *   it, so it announced "collapsed" forever and did nothing when pressed. The
 *   panel opened on `:focus-within` instead, which meant a keyboard reader saw
 *   it open on arrival and then pressed a button that visibly did nothing.
 * - The explanation is a plain visible text node in the lead strip, written by
 *   paintStrip from the `-locked-say` / `-open-say` attributes. It is in the
 *   accessibility tree exactly once, with no synchroniser needed — the earlier
 *   design had the same sentence in three places and a `syncFull()` to stop
 *   them being announced together, which is the kind of machinery that exists
 *   only to manage a problem the layout created.
 *   route through it. Its rule is "carry what the frame's NAME does not":
 *   exposed only while the block is OPEN and the tooltip is collapsed, because
 *   the open-state sentence ("you are reading the original… press Restore") is
 *   the one thing the static group name cannot say. While the block is locked
 *   the name already carries the explanation verbatim, so a second copy two
 *   nodes away is pure repetition; while the tooltip is expanded the panel
 *   carries it. Every state has exactly one bearer, which is what the previous
 *   panel/clipped swap bought and this keeps.
 * - `hold()` is the focus safety net. Every state change here hides some button,
 *   and hiding the button a reader just pressed hands focus to `<body>` — which
 *   on a virtual-buffer screen reader also drops them at the top of the
 *   document. `hold()` runs after every paint and puts focus on the control
 *   that replaced the one that vanished, but ONLY when focus actually went to
 *   nowhere, so a reader who moved on in the meantime is never yanked back.
 *   The click handler applies the other half of that guard: it passes a strip
 *   only when focus was already inside the frame when the press happened.
 *   Firefox and Safari do not focus a button on mouse-down, so without it a
 *   mouse user would be handed a focus ring they never asked for — the fix for
 *   losing focus must not become a way of imposing it.
 * - `paintStrip` TOGGLES, it never rebuilds. An earlier version replaced the
 *   action area's innerHTML with a progress bar while working, which destroyed
 *   the buttons — so once a block finished there was no Restore button left to
 *   un-hide, and the frame was stuck open for the rest of the session. The
 *   progress element ships in the markup alongside the buttons and they take
 *   turns. (This paragraph was a six-line comment INSIDE the emitted string
 *   until now — six lines of prose about progress bars and Restore buttons
 *   shipping on every page of every site using this mode, which is exactly the
 *   signature setCamouflage() exists to erase. It stops at the compiler now,
 *   like every other explanation in this file.)
 * - `land()` staggers the reveal: paint, then focus at +120 ms, then the status
 *   line at +420 ms. Both delays are for the same reason and neither is
 *   cosmetic. A screen reader rebuilding its virtual buffer after a DOM change
 *   the size of this one will announce stale content if focus arrives during
 *   the rebuild, and a focus move cancels whatever speech is in flight — so an
 *   announcement made before the move is an announcement nobody hears.
 */
/**
 * The clipped control's layout, for when an author draws it.
 *
 * The drawn wrapper has always had a row: sentence on the left, controls on the
 * right, one fixed height so nothing moves when the progress bar takes the
 * buttons' place. The clipped control had none — it was a note, a button, a
 * progress bar and an output element stacked in source order, so the bar
 * appeared in a different place on every block and jumped the text down when it
 * arrived.
 *
 * These rules give it the same row, so a page mixing both tiers looks like one
 * component rather than two. They are inert while the control is hidden: that
 * hiding is an INLINE style and no stylesheet beats it, which is exactly why
 * this can be emitted unconditionally.
 *
 * `min-height` on the row is the part that stops the jumping — the bar and the
 * button are different heights, and without it the paragraph below shifts every
 * time one replaces the other.
 */
/** Everything above, for the drawn wrapper, plus the box it sits in. */
export function noticeCss(attr: string): string {
  const F = `[${attr}-frame]`;
  return (
    innerCss(F, attr) +
    // The outline and its failed-state colour come from innerCss, which both
    // tiers share. NOTHING IS ADDED HERE ANY MORE.
    //
    // Four strip rules used to be re-emitted at this point — the fill, the two
    // border radii, the failed-state tint — with a comment claiming they were
    // "the frame's own". They are byte-identical to the ones innerCss already
    // wrote a hundred lines up, so every page using the wrapper shipped both
    // copies and the later one won by being later. A rule that only works
    // because it is duplicated is a rule nobody can safely edit.
    //
    // The strip selector genuinely does only match inside a frame — the clipped
    // tier renders no `-strip` element at all — so innerCss is the right home
    // for it and this function has nothing left to say.
    ""
  );
}

/** The same UI with no box around it, for the clipped control. */
export function altCss(attr: string): string {
  const G = `[${attr}-group]`;
  return (
    innerCss(G, attr) +
    // The control gets the strip's LAYOUT and the strip's INSET, but not its
    // fill — the box is the outline only, so the row reads as one thing with
    // the prose below it rather than as a band sitting on top of it. The
    // padding used to be `10px 0 0`, from back when there was no outline to be
    // inset from: the sentence and the button sat flush against the border on
    // both sides and along the bottom.
    `${G}{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;` +
    `width:100%;box-sizing:border-box;padding:10px 14px;}` +
    // The solver writes the revealed words here; it belongs under the row, not
    // in it.
    // A CLASS SELECTOR, because that is what the element carries. This was
    // written as `[${attr}-alt-out]` and matched nothing at all, so the revealed
    // words had no order and landed ABOVE the progress bar and the status line
    // instead of below them — visible on every un-clipped control, which now
    // includes the font-failure state.
    `${G} > .${attr}-alt-out{flex:1 1 100%;order:9;}`+
    // The bar and the live status are siblings of the row rather than
    // children of it on this tier, so they each take a full line under it.
    // Same widths, same order, same look as the drawn strip — the demo used
    // to restyle both of these itself and they came out a different product.
    `${G} > progress{flex:1 1 100%;order:7;margin:2px 0;}`+
    `${G} > [${attr}-status]{flex:1 1 100%;order:8;font-size:12px;line-height:1.32;opacity:.7;}`+
    // AN EMPTY LIVE REGION TAKES NO ROW. It is `flex:1 1 100%`, so even at
    // zero height it wrapped to a line of its own and collected the 10px
    // row-gap in front of it — which is why this tier's box had visibly more
    // space under the row than over it. Taken out of flex flow while empty,
    // and clipped rather than `display:none`d: a live region that is
    // display:none when its text arrives is unreliably announced, while the
    // clip technique is the one every screen reader handles. `:empty` stops
    // matching the moment the script writes a word, so it rejoins the flow
    // exactly when it has something to occupy a line with.
    `${G} > [${attr}-status]:empty{position:absolute;width:1px;height:1px;`+
    `margin:0;padding:0;overflow:hidden;clip-path:inset(50%);}`
  );
}

/*
 * NO say('working') BEFORE est(). est() overwrites the status ~80ms later with
 * the same lead plus a measured duration, and solver.ts's header records what
 * the pair costs: "VoiceOver read the pair as 'working this' before being cut
 * off. Two polite updates inside one breath is one update the reader never
 * hears." The clipped path had this deleted; this path was written afterwards
 * and reproduced it. The ~80ms of silence is covered for sighted readers by the
 * button dimming and the bar appearing.
 *
 * NO aria-busy anywhere. It was on the actions container during the grind, and
 * on the clipped tier it was on the wrapper that CONTAINS the live region —
 * where the ARIA spec's meaning ("you may ignore changes until this goes
 * false") is a request to suppress the exact announcements the feature depends
 * on. Inconsistent support is the only reason they were heard at all.
 */
/**
 * A string literal safe inside `<script>`. See the twin in solver.ts: an HTML
 * parser ends a script at the first literal `</`, whatever JavaScript quoting
 * says, so `JSON.stringify` alone is not enough for a value that lands there.
 * Duplicated rather than shared because Shield.tsx imports this module, and an
 * import back would be a cycle.
 */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function noticeScript(names: NoticeNames): string {
  const { attr, flag, logPrefix, storePrefix, family } = names;
  const WORKER_BODY =
    `var W=8000,C=25000;onmessage=function(e){` +
    `var n=BigInt(e.data.n),t=e.data.t,x=2n,i;` +
    `for(i=0;i<Math.min(W,t);i++)x=(x*x)%n;` +
    `if(t<=W+C){for(;i<t;i++)x=(x*x)%n;postMessage({done:x.toString(16)});return;}` +
    `var c0=Date.now();for(i=W;i<W+C;i++)x=(x*x)%n;` +
    `var el=Math.max(1,Date.now()-c0),rate=C/(el/1000);` +
    `postMessage({seconds:(t-W-C)/rate});` +
    `var step=Math.max(1,Math.floor(t/200));` +
    `for(i=W+C;i<t;i++){x=(x*x)%n;if(i%step===0)postMessage({p:i/t});}` +
    `postMessage({done:x.toString(16)});};`;

  return `(function(){
if (typeof window === 'undefined' || typeof document === 'undefined') return;
if (window[${js(flag)}]) return;
window[${js(flag)}] = 1;
var A = ${js(attr)};
var PFX = ${js(logPrefix)};
var STORE = ${js(storePrefix)};
var FAMILY = ${js(family)};
var BODY = ${js(WORKER_BODY)};
var CAPABLE = typeof BigInt === 'function' && window.crypto && window.crypto.subtle;
var FONTS = {};
var frames = [];
var wired = typeof WeakSet === 'function' ? new WeakSet() : null;
var wiredList = [];
function isWired(el){ return wired ? wired.has(el) : wiredList.indexOf(el) !== -1; }
function markWired(el){ if (wired) wired.add(el); else wiredList.push(el); }
function q(el, n){ return el.querySelectorAll('[' + A + '-' + n + ']'); }
function fromB64(s){ var b = atob(s), o = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
function plural(n, a, b){ return n + ' ' + (n === 1 ? a : b); }
function human(s){
  if (s < 45) return 'about ' + plural(Math.max(5, Math.round(s / 5) * 5), 'second', 'seconds');
  var m = s / 60;
  return m < 1.5 ? 'about a minute' : 'about ' + plural(Math.round(m), 'minute', 'minutes');
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function open(hex, d, len){
  var c = hex.length >= len ? hex : new Array(len - hex.length + 1).join('0') + hex;
  return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
    .then(function(k){ return window.crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['decrypt']); })
    .then(function(k){ return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(d.iv) }, k, fromB64(d.ct)); })
    .then(function(b){ return new TextDecoder().decode(b).replace(/\\u0000+$/, ''); });
}
function task(d, onEst, onProg){
  return new Promise(function(res, rej){
    var len = BigInt(d.n).toString(16).length;
    function fin(h){ open(h, d, len).then(function(t){ res({ hex: h, text: t }); }, rej); }
    var w = null;
    try { var u = URL.createObjectURL(new Blob([BODY], { type: 'text/javascript' }));
      w = new Worker(u); URL.revokeObjectURL(u); } catch (e) { w = null; }
    if (w){
      w.onmessage = function(ev){ var m = ev.data;
        if (m.seconds !== undefined) onEst(m.seconds);
        else if (m.p !== undefined) onProg(m.p);
        else if (m.done !== undefined){ w.terminate(); onProg(1); fin(m.done); } };
      w.onerror = function(){ w.terminate(); chunk(); };
      w.postMessage({ n: d.n, t: d.t });
      return;
    }
    chunk();
    function chunk(){
      var n = BigInt(d.n), t = d.t, S = 4000, x = 2n, i = 0, meas = false, t0 = Date.now();
      (function run(){
        var end = Math.min(t, i + S);
        for (; i < end; i++) x = (x * x) % n;
        if (!meas && i >= S){ meas = true; onEst(t / (i / Math.max(0.001, (Date.now() - t0) / 1000))); }
        onProg(i / t);
        if (i < t) setTimeout(run, 0); else fin(x.toString(16));
      })();
    }
  });
}
function pick(list, key){
  var h = 5381, i;
  for (i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}
function Frame(root){
  var self = this;
  this.root = root;
  this.state = 'locked';
  this.down = 0;
  this.ok = true;
  this.plain = null;
  this.block = root.querySelector('[' + A + '-block]');
  this.out = root.querySelector('[' + A + '-out]');
  this.status = root.querySelector('[' + A + '-status]');
  var holder = root.querySelector('[' + A + '-data]');
  this.data = null;
  try {
    var all = JSON.parse(holder.textContent);
    var d = all && all.length ? pick(all, root.getAttribute(A + '-for') || '') : all;
    if (d && typeof d.ct === 'string' && d.n && d.t) this.data = d;
    else console.error(PFX + ' sealed payload is missing required fields.');
  }
  catch (e) { console.error(PFX + ' sealed payload is not valid JSON.', e); }
  this.key = this.data ? STORE + this.data.ct.slice(0, 40) : null;
  try { this.says = JSON.parse(root.getAttribute(A + '-says') || '{}'); }
  catch (e) { this.says = {}; }
  this.cached = null;
  try { this.cached = this.key ? window.localStorage.getItem(this.key) : null; } catch (e) {}
  this.down = !CAPABLE && !this.cached ? 1 : 0;
  this.paint();
}
Frame.prototype.reopen = function(){
  var self = this;
  if (!this.cached || !this.data) return;
  var len = BigInt(this.data.n).toString(16).length;
  open(this.cached, this.data, len).then(function(t){
    self.plain = t;
    self.state = 'open';
    self.paint();
  }, function(e){
    console.warn(PFX + ' cached answer did not open; discarding it.', e);
    try { if (self.key) window.localStorage.removeItem(self.key); } catch (err) {}
  });
};
Frame.prototype.say = function(k){ if (this.status) this.status.textContent = this.says[k] || ''; };
Frame.prototype.standdown = function(){
  this.down = 1;
  this.paint();
};
Frame.prototype.paint = function(){
  var self = this, st = this.state, open = st === 'open';
  var gn = open ? this.says.groupOpen : this.says.group;
  if (gn) this.root.setAttribute('aria-label', gn);
  if (this.ok === false && !open) this.root.setAttribute(A + '-failed', '1');
  else this.root.removeAttribute(A + '-failed');
  var broken = this.ok === false && !open;
  if (this.block){
    this.block.hidden = open;
    if (broken) this.block.setAttribute(A + '-skeleton', '');
    else this.block.removeAttribute(A + '-skeleton');
  }
  if (this.out){
    this.out.hidden = !open;
    if (open){
      if (this.out.textContent !== this.plain) this.out.textContent = this.plain;
      this.out.setAttribute('tabindex', '0');
      this.out.removeAttribute('aria-hidden');
    }
    else { this.out.textContent = ''; this.out.setAttribute('tabindex', '-1'); }
  }
  var strips = q(this.root, 'strip');
  for (var i = 0; i < strips.length; i++) this.paintStrip(strips[i]);
};
Frame.prototype.paintStrip = function(strip){
  var self = this, st = this.state;
  var acts = strip.querySelector('[' + A + '-acts]');
  var shortEl = strip.querySelector('[' + A + '-say-full]');
  if (shortEl && st !== 'working') {
    var key = st === 'open' ? '-open-say' : (this.ok === false ? '-broken-say' : '-locked-say');
    var seen = strip.getAttribute(A + key) || '';
    var heard = st === 'open' || this.ok === false
      ? seen
      : (strip.getAttribute(A + '-locked-name') || seen);
    var eye = shortEl.querySelector('[' + A + '-seen]');
    var ear = shortEl.querySelector('[' + A + '-heard]');
    if (eye && ear){
      eye.textContent = seen;
      ear.textContent = heard;
    } else {
      shortEl.textContent = seen;
    }
  }
  if (st === 'working') strip.setAttribute(A + '-loading', '');
  else strip.removeAttribute(A + '-loading');
  var prog = strip.querySelector('[' + A + '-prog]');
  if (prog) prog.hidden = st !== 'working';
  var gOn = strip.querySelector('[' + A + '-icon="on"]');
  var gCheck = strip.querySelector('[' + A + '-icon="off"]');
  if (gOn) gOn.hidden = st === 'open';
  if (gCheck) gCheck.hidden = st !== 'open';
  var busy = st === 'working';
  if (acts){
  }
  var btns = strip.querySelectorAll('[' + A + '-act]');
  var anyBusy = busy;
  for (var i = 0; i < btns.length; i++){
    var b = btns[i], kind = b.getAttribute(A + '-act');
    if (kind === 'copy') b.hidden = false;
    else b.hidden = st === 'open' ? true : kind !== 'show';
    if (anyBusy) b.hidden = false;
    if (busy){ b.setAttribute('aria-disabled', 'true'); b.setAttribute(A + '-off', ''); }
    else { b.removeAttribute('aria-disabled'); b.removeAttribute(A + '-off'); }
    if (this.down){ b.hidden = true; b.style.display = 'none'; }
  }
  if (this.down && shortEl){
    var msg = this.says.incapable || '';
    var eye2 = shortEl.querySelector('[' + A + '-seen]');
    var ear2 = shortEl.querySelector('[' + A + '-heard]');
    if (eye2 && ear2){ eye2.textContent = msg; ear2.textContent = msg; }
    else shortEl.textContent = msg;
    shortEl.setAttribute('aria-label', msg);
  }
};
Frame.prototype.hold = function(strip, kind){
  var a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  var b = strip ? strip.querySelector('[' + A + '-act="' + kind + '"]') : null;
  if (b && !b.hidden){ try { b.focus(); } catch (e) {} }
};
Frame.prototype.run = function(intent, strip, own){
  var self = this;
  if (this.state !== 'locked' || !this.data) return;
  if (!CAPABLE){
    this.say(window.isSecureContext === false ? 'insecure' : 'incapable');
    this.standdown();
    return;
  }
  if (own){ if (this.out) this.out.setAttribute('aria-live', 'polite'); }
  else {
    if (this.out) this.out.removeAttribute('aria-live');
    if (this.status) this.status.setAttribute('aria-live', 'off');
  }
  this.state = 'working';
  this.paint();
  this.hold(strip, intent === 'copy' ? 'copy' : 'show');
  var marks = [], spoke = 0, once = false;
  function est(s){
    if (once) return; once = true;
    marks = s < 6 ? [] : s < 20 ? [0.5] : [0.25, 0.5, 0.75];
    if (self.status) self.status.textContent =
      (self.says.working || '') + ' ' + human(s) + (s < 20 ? '.' : '. ' + (self.says.keep || ''));
    var els = q(self.root, 'est');
    var lead = self.says.working || '';
    for (var i = 0; i < els.length; i++){
      els[i].textContent = lead ? lead + ' ' + human(s) : cap(human(s));
    }
  }
  function prog(p){
    var bars = self.root.getElementsByTagName('progress');
    for (var i = 0; i < bars.length; i++) bars[i].value = Math.round(p * 100);
    while (spoke < marks.length && p >= marks[spoke]){
      if (self.status) self.status.textContent =
        Math.round(marks[spoke] * 100) + ' ' + (self.says.pct || ''); spoke++;
    }
  }
  task(this.data, est, prog).then(function(r){
    try { if (self.key) window.localStorage.setItem(self.key, r.hex); } catch (e) {}
    self.plain = r.text;
    self.state = 'open';
    self.paint();
    if (intent === 'copy'){ self.copy(null); self.hold(strip, 'copy'); }
    else self.land(own);
  }, function(err){
    console.error(PFX + ' request failed.', err);
    self.state = 'locked';
    self.paint();
    self.hold(strip, intent === 'copy' ? 'copy' : 'show');
    self.say('err');
  });
};
Frame.prototype.land = function(own){
  var self = this;
  setTimeout(function(){
    if (own) { try { self.out.focus(); } catch (e) {} }
    setTimeout(function(){ self.say('done'); }, 300);
  }, 120);
};
Frame.prototype.toast = function(kind){
  var strips = q(this.root, 'strip'), i;
  var msg = this.says[kind === 'blocked' ? 'toastBlocked' : 'toastCopied'] || '';
  for (i = 0; i < strips.length; i++){
    var t = strips[i].querySelector('[' + A + '-toast]');
    if (t) t.textContent = msg;
    strips[i].setAttribute(A + '-toasting', kind === 'blocked' ? 'blocked' : 'ok');
  }
  if (this.toastT) clearTimeout(this.toastT);
  this.toastT = setTimeout(function(){
    for (var j = 0; j < strips.length; j++) strips[j].removeAttribute(A + '-toasting');
  }, 2100);
};
Frame.prototype.copy = function(btn){
  var self = this;
  if (!this.plain) return;
  try {
    navigator.clipboard.writeText(this.plain).then(function(){
      self.say('copied');
      self.toast('ok');
    }, function(e){
      self.say('copyFail');
      console.warn(PFX + ' clipboard write rejected.', e);
    });
  } catch (e) {
    self.say('copyFail');
  }
};
function all(except){
  var live = [];
  for (var p = 0; p < frames.length; p++){
    if (frames[p].root && frames[p].root.isConnected !== false) live.push(frames[p]);
  }
  frames = live;
  for (var i = 0; i < frames.length; i++){
    var f = frames[i];
    if (f === except || f.state !== 'locked' || !f.data) continue;
    f.run('show', null, false);
  }
  var others = document.querySelectorAll('[' + A + '-solve]');
  for (var j = 0; j < others.length; j++){
    var o = others[j];
    if (o.hidden || o.getAttribute('aria-disabled') === 'true') continue;
    try { var e4 = new MouseEvent('click', {bubbles: true}); e4.__all = 1; o.dispatchEvent(e4); }
    catch (e) { try { o.click(); } catch (e5) {} }
  }
}
document.addEventListener('click', function(ev){
  var t = ev.target;
  var btn = t && t.closest ? t.closest('[' + A + '-act]') : null;
  if (btn){
    if (btn.getAttribute('aria-disabled') === 'true') return;
    var root = btn.closest('[' + A + '-frame]');
    var here = root && root.contains(document.activeElement)
      ? btn.closest('[' + A + '-strip]') : null;
    for (var i = 0; i < frames.length; i++){
      if (frames[i].root === root){
        var k = btn.getAttribute(A + '-act');
        var own = !ev.__all;
        if (k === 'copy' && frames[i].state === 'open') frames[i].copy(btn);
        else if (k === 'copy') frames[i].run('copy', here, own);
        else {
          frames[i].run('show', here, own);
          all(frames[i]);
        }
        return;
      }
    }
    return;
  }
});
document.addEventListener('copy', function(ev){
  if (!CAPABLE) return;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  if (ev.defaultPrevented || !ev.clipboardData) return;
  var hits = [];
  for (var i = 0; i < frames.length; i++){
    var f = frames[i];
    if (f.state === 'open' || !f.block || !f.guard) continue;
    if (!f.block.textContent) continue;
    for (var r = 0; r < sel.rangeCount; r++){
      if (sel.getRangeAt(r).intersectsNode(f.block)){ hits.push(f); break; }
    }
  }
  if (!hits.length) return;
  var text = sel.toString();
  for (var h = 0; h < hits.length; h++){
    var src = hits[h].block.textContent;
    if (text.indexOf(src) !== -1) text = text.split(src).join(hits[h].notice);
    else if (hits.length === 1) text = hits[h].notice;
  }
  ev.clipboardData.setData('text/plain', text);
  ev.preventDefault();
  hits[0].say('clipped');
  hits[0].toast('blocked');
});
function faceOf(block){
  var fam = FAMILY, w = '400';
  if (block && window.getComputedStyle){
    var cs = window.getComputedStyle(block);
    var first = String(cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (first) fam = first;
    if (cs.fontWeight) w = String(cs.fontWeight);
  }
  return { fam: fam, w: w };
}
function faceOk(fam, w){
  var key = fam + '|' + w;
  if (FONTS[key]) return FONTS[key];
  var p;
  if (document.documentElement.hasAttribute(A + '-simulate-fail')) p = Promise.resolve(false);
  else if (!document.fonts || !document.fonts.load) p = Promise.resolve(false);
  else p = document.fonts.load(w + ' 1em "' + fam + '"').then(function(f){
    if (!f || f.length === 0) return false;
    for (var i = 0; i < f.length; i++) if (f[i].status === 'error') return false;
    return true;
  }, function(){ return false; });
  FONTS[key] = p;
  return p;
}
var told = {};
function probe(){
  FONTS = {};
  told = {};
  var live = [];
  for (var i = 0; i < frames.length; i++){
    if (frames[i].root && frames[i].root.isConnected !== false) live.push(frames[i]);
  }
  frames = live;
  for (var j = 0; j < frames.length; j++){
    (function(f){
      var face = faceOf(f.block);
      faceOk(face.fam, face.w).then(function(ok){
        f.ok = ok;
        if (!ok && !told[face.fam]){
          told[face.fam] = 1;
          console.error(PFX + ' font "' + face.fam + '" did not load at weight ' + face.w + '. Blocks using it are showing substituted text. Check that the face is reachable.');
        }
        f.paint();
      });
    })(frames[j]);
  }
}
var probed = false;
function sweep(){
  var roots = document.querySelectorAll('[' + A + '-frame]');
  var fresh = [];
  for (var i = 0; i < roots.length; i++){
    var r = roots[i];
    if (isWired(r)) continue;
    markWired(r);
    try {
      var f = new Frame(r);
      f.guard = r.getAttribute(A + '-guard') !== '0';
      f.notice = r.getAttribute(A + '-clip') || '';
      frames.push(f);
      fresh.push(f);
      f.reopen();
    }
    catch (e) { console.error(PFX + ' one block could not be prepared.', e); }
  }
  if (!fresh.length) return;
  if (!probed){ probed = true; probe(); }
  else for (var j = 0; j < fresh.length; j++) fresh[j].paint();
}
try {
  new MutationObserver(function(){ probe(); }).observe(document.documentElement, {
    attributes: true, attributeFilter: [A + '-simulate-fail'],
  });
} catch (e) {}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
else sweep();
try { new MutationObserver(function(){ if (document.readyState !== 'loading') sweep(); })
  .observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
})();`;
}

/**
 * `copyPaste` WITHOUT the wrapper — the whole of it.
 *
 * ## Why this is not the wrapper's handler
 *
 * The wrapper's copy interception lives inside {@link noticeScript}, reads its
 * configuration off a `-frame` element and asks a live `Frame` object whether a
 * block is still sealed. None of that exists on the `screenReader`-only tier,
 * which is exactly why `copyPaste` on its own used to be accepted and silently
 * do nothing.
 *
 * The fix could have been an invisible per-block host carrying the same
 * attributes the frame carries. It is not, because that would put new markup on
 * every protected block on the leanest tier that ships any markup at all. What
 * this does instead costs, per block, ONE attribute holding one sentence — and
 * per page, this listener.
 *
 * ## No state, no sweep, no observer
 *
 * There is nothing to wire. The handler queries the document at COPY time,
 * which is a few hundred microseconds once in a while and buys three things the
 * sweep-and-register shape does not: blocks that stream in later work with no
 * MutationObserver, a solved block is detected by looking at where its words
 * would be rather than by remembering that it was solved, and this file holds
 * no references that could keep a removed block alive.
 *
 * ## The four decisions in the handler, in order
 *
 * - It returns immediately unless a range actually intersects a marked block.
 *   Copying a heading, a caption, the notice itself or any other text on the
 *   page must behave exactly as it does on any other website, and the fast exit
 *   is what guarantees that rather than promises it. Selection is never
 *   disabled: `user-select:none` would break the reader this feature is for.
 * - It stays out of the way when there is NO PATH to the words. If the control
 *   is still hidden — the browser lacks BigInt or `crypto.subtle`, the page is
 *   on an insecure origin, or the page-level script has not run yet — a notice
 *   telling someone to press a button that will never appear is a dead end, and
 *   a dead end is worse than a wrong paste. The reader gets the substituted
 *   words and the page behaves like the plain tier it currently is.
 * - When the block is ALREADY SOLVED, including from the localStorage cache,
 *   the real words go to the clipboard with no wait and no notice. That is the
 *   whole point of having paid the puzzle once. The revealed element is clipped
 *   off-screen by default, so a plain drag-select over the visible block would
 *   otherwise still yield the substituted text from a block the reader has
 *   already opened.
 * - The substitution is a targeted splice, not a wholesale replacement,
 *   WHENEVER the block's text appears intact in the selection: select three
 *   paragraphs of which one is protected and the other two arrive untouched.
 *   Only a PARTIAL selection of a protected block falls back to replacing the
 *   whole clipboard, because half a substituted paragraph cannot be mapped onto
 *   half a real one. That is the same rule the wrapper's handler has always
 *   used, and it is stated here because it is the one case where a reader loses
 *   text they had also selected.
 *
 * ## It covers every selected block too, and yields to the wrapper
 *
 * Same two fixes as the wrapper's handler, for the same reasons: it stopped at
 * the first `-clip-say` element a selection touched, so selecting three clipped
 * blocks pasted one notice and two paragraphs of raw decoy words. And on a page
 * mixing tiers BOTH handlers are bound to `copy`, so whichever ran second used
 * to overwrite the other's `setData`. Each now checks `defaultPrevented` and the
 * first to act wins.
 *
 * The whole-selection fallback still applies only when exactly one block was
 * touched — with several, replacing everything would discard the substitutions
 * already made for the others.
 *
 * ## What the emitted source does NOT carry
 *
 * Same rule as every other emitted script in this package: no comments, and no
 * word that would identify the mechanism. The one sentence a reader is meant to
 * see travels as an attribute on the block, written by React and escaped by
 * React, so an author can translate it and the script stays byte-identical on
 * every page that uses it.
 */
export interface CopyGuardNames {
  /** The camouflage base attribute, e.g. `data-typeface`. */
  attr: string;
  /** Window-level idempotency flag, so N blocks emit one listener. */
  flag: string;
}

export function copyGuardScript(names: CopyGuardNames): string {
  const { attr, flag } = names;
  return `(function(){
if (typeof window === 'undefined' || typeof document === 'undefined') return;
if (window[${js(flag)}]) return;
window[${js(flag)}] = 1;
var A = ${js(attr)};
function parts(el){
  var id = el.id;
  var b = id ? document.querySelector('[' + A + '-solve-for="' + id + '"]') : null;
  var g = b && b.closest ? b.closest('[' + A + '-group]') : null;
  return { b: b, o: g ? g.querySelector('[' + A + '-out]') : null };
}
document.addEventListener('copy', function(ev){
  if (ev.defaultPrevented || !ev.clipboardData) return;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  var els = document.querySelectorAll('[' + A + '-clip-say]'), hits = [];
  for (var i = 0; i < els.length; i++){
    var el = els[i];
    if (!el.textContent || !el.getAttribute(A + '-clip-say')) continue;
    for (var r = 0; r < sel.rangeCount; r++){
      if (sel.getRangeAt(r).intersectsNode(el)){ hits.push(el); break; }
    }
  }
  if (!hits.length) return;
  var got = sel.toString(), put = got;
  for (var h = 0; h < hits.length; h++){
    var hitEl = hits[h], src = hitEl.textContent;
    var note = hitEl.getAttribute(A + '-clip-say'), p = parts(hitEl);
    var ready = p.o && p.o.textContent ? p.o.textContent : '';
    if (!ready && !(p.b && p.b.hidden === false)) return;
    var twice = ready !== '' && got.indexOf(ready) !== -1;
    if (put.indexOf(src) !== -1) put = put.split(src).join(twice ? '' : (ready || note));
    else if (twice) return;
    else if (hits.length === 1) put = ready || note;
  }
  ev.clipboardData.setData('text/plain', put);
  ev.preventDefault();
});
})();`;
}
