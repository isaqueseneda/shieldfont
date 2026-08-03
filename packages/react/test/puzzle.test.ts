/**
 * `a11y={{ mode: "text" }}` — the time-lock plain-text control.
 *
 * Two things are being defended here and they pull in opposite directions:
 *
 *   1. A screen-reader user must reach a working, comprehensible control and,
 *      after it runs, the real words — announced, focusable, in reading order.
 *   2. The rendered HTML must not contain those words. Not in an attribute, not
 *      in a comment, not in the sealed payload. The whole point of the mode is
 *      that the plaintext is present but *closed*, and a leak here would be a
 *      silent, total defeat of the package.
 *
 * The suite asserts both on the same tree, because a change that satisfies one
 * by breaking the other is the failure mode worth catching.
 */
import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { Shield, setCamouflage, withShieldRenderPass } from "../src/Shield.js";
import { solveText, type SealedText } from "@shieldfont/core/puzzle";
import {
  props,
  walkAll,
  findAllTags,
  shieldedBlock,
  descendants,
  visibleText,
  walkDeep,
} from "./helpers.js";

const BODY = "The future of writing belongs to those who write it.";
/** Milliseconds rather than seconds; the mode's own default is 20s. */
const FAST = { mode: "text", seconds: 5 } as const;

/**
 * No wrapper, spelled once. Every test in this file is about the CLIPPED
 * control — the one that is real and focusable and nowhere on screen — and a
 * bare <Shield> no longer renders it: since the wrapper became the default,
 * `wrapper: false` is what it takes to get the clipped control at all. Spelled
 * here rather than at twenty-two call sites, and spelled explicitly: a test
 * that names the switch it depends on is a test that will still be right the
 * next time a default moves.
 */
const CLIPPED = { a11y: FAST, wrapper: false } as const;

/** The one element carrying a given bare data attribute. */
function byAttr(tree: unknown, attr: string) {
  return walkAll(tree as never).find((e) => attr in props(e));
}

/** Everything the browser would see, near enough for leak assertions. */
function markup(tree: unknown): string {
  return JSON.stringify(tree);
}

/**
 * The note's sentence.
 *
 * It moved from a string child to `dangerouslySetInnerHTML` so the emitted
 * solver can swap it for the open-state sentence without React reconciling it
 * back. Read it the way it now ships, not the way it used to.
 */
function noteText(el: ReactElement): string {
  const html = props(el).dangerouslySetInnerHTML as { __html?: string } | undefined;
  return html?.__html ?? String(props(el).children ?? "");
}

describe("the encoded block stays hidden", () => {
  it("is aria-hidden even when the puzzle control is present", () => {
    const tree = Shield({ children: BODY, ...CLIPPED });
    expect(props(shieldedBlock(tree))["aria-hidden"]).toBe("true");
  });

  it("puts the control OUTSIDE the hidden block and BEFORE it in DOM order", () => {
    const tree = Shield({ children: BODY, ...CLIPPED });
    const all = walkAll(tree);
    const block = shieldedBlock(tree);
    const button = findAllTags(tree, "button")[0];
    expect(button).toBeDefined();

    // Outside: nothing inside the aria-hidden subtree is the control.
    expect(descendants(block)).not.toContain(button);
    // Before: linear navigation reaches the control ahead of the silence.
    expect(all.indexOf(button!)).toBeLessThan(all.indexOf(block));
  });

  it("never renders a link, in any configuration", () => {
    // The removed 0.2.0 text mode was an <a href> to the original words. The
    // replacement must not quietly reintroduce one.
    for (const a11y of [FAST, { mode: "text" } as const, { mode: "text", seconds: 28 } as const]) {
      expect(findAllTags(Shield({ children: BODY, wrapper: false, a11y }), "a")).toHaveLength(0);
    }
  });
});

describe("the plaintext does not ship", () => {
  /** The sealed JSON as it would reach the browser. */
  function payload(children: string): string {
    const holder = byAttr(Shield({ children, ...CLIPPED }), "data-typeface-data");
    return (props(holder!).dangerouslySetInnerHTML as { __html: string }).__html;
  }

  it("never appears in the sealed payload", () => {
    // This is the guarantee the mode rests on: the words are present in the
    // page but CLOSED. Assert it against the payload specifically rather than
    // the whole tree — the encoded block is a separate mechanism with its own
    // separate (and openly documented) property, exercised just below.
    const secret = "Zarquon threadbare pomegranate ossuary.";
    const json = payload(secret);

    expect(json).not.toContain(secret);
    for (const word of ["Zarquon", "threadbare", "pomegranate", "ossuary"]) {
      expect(json.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("is sealed independently of how well the encoder covered the words", () => {
    // Words outside the ~12k mapping pass through `encode()` unchanged, so a
    // block of rare vocabulary renders much of itself in clear in the encoded
    // element. That is a property of dictionary coverage, not of this mode, and
    // `variant="maxhide"` is the lever for it — but it means the puzzle must
    // not inherit the weakness. Whatever the encoder did, the payload is sealed.
    const rare = "Zarquon threadbare pomegranate ossuary.";
    const common = "The future of writing belongs to those who write it.";
    for (const source of [rare, common]) {
      expect(payload(source)).not.toContain(source);
    }
  });

  it("ships an ARRAY of payloads, each with only n, t, iv and ct", () => {
    // An array since 0.3.2: the real payload rides among decoys, so that
    // pulling every sealed blob out of the HTML and grinding them natively —
    // the cheapest attack on this path, and one script does it to every site
    // using the library — costs four times as much with nothing to say which
    // one matters. See src/decoys.ts.
    const holder = byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-data");
    expect(holder).toBeDefined();
    const json = (props(holder!).dangerouslySetInnerHTML as { __html: string }).__html;
    const payloads = JSON.parse(json);
    expect(Array.isArray(payloads)).toBe(true);
    expect(payloads).toHaveLength(4);
    for (const p of payloads) {
      expect(Object.keys(p).sort()).toEqual(["ct", "iv", "n", "t"]);
    }
    // Every payload is a DIFFERENT seal — a repeated modulus would mark the
    // duplicates as filler at a glance.
    expect(new Set(payloads.map((p: { n: string }) => p.n)).size).toBe(4);
  });

  it("puts the real text among decoys, and the decoys leak nothing", () => {
    // The property that matters, asserted by actually SOLVING every payload the
    // way a bulk attacker would: pull the sealed blobs out of the HTML and
    // grind them natively, no browser, no button.
    const holder = byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-data");
    const json = (props(holder!).dangerouslySetInnerHTML as { __html: string }).__html;
    const payloads = JSON.parse(json) as SealedText[];

    // EVERY CIPHERTEXT IS THE SAME LENGTH. Without this the set gives itself
    // away for free: AES-GCM ciphertext is plaintext length plus a tag, the
    // decoy corpus is clamped to 220-900 characters, and anything outside that
    // band is the odd one out on sight — no CPU, no browser, HTML alone.
    //
    // Asserted on the CIPHERTEXT, not on the decrypted string. The padding
    // equalises BYTES, because that is what AES encrypts and therefore what
    // leaks; the decrypted character counts still differ by a few, since Austen
    // is full of curly quotes and em-dashes that cost more than one byte each.
    // An earlier version of this checked characters, passed, and left the real
    // leak in place.
    expect(new Set(payloads.map((p) => p.ct.length)).size).toBe(1);

    const texts = payloads.map((p) => solveText(p).replace(/\u0000+$/, ""));

    // Exactly one is the reader's words. Zero would mean the block is broken;
    // more than one would mean a decoy is carrying real text.
    expect(texts.filter((t) => t === BODY)).toHaveLength(1);

    // AND THE DECOYS ARE UNRELATED PROSE. This is the assertion that guards
    // against the broken design: sealing the SAME paragraph under alpha, beta
    // and gamma looks equivalent and is not, because three quarters of the words
    // are identical across mappings and any two mappings agree with each other
    // about half the time — so lining the four up and taking the most common
    // word at each position recovers the plaintext, with no mapping and no font.
    // Unrelated texts have nothing to align.
    const realWords = new Set(BODY.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
    for (const t of texts.filter((x) => x !== BODY)) {
      const shared = t
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4 && realWords.has(w));
      expect(shared.length).toBeLessThan(3);
    }
  });

  it("escapes < in the payload so a future field cannot inject markup", () => {
    const holder = byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-data");
    const json = (props(holder!).dangerouslySetInnerHTML as { __html: string }).__html;
    expect(json).not.toContain("<");
  });

  it("seals fresh every render, so identical text is not a shared puzzle", () => {
    const read = () => {
      const holder = byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-data");
      return (props(holder!).dangerouslySetInnerHTML as { __html: string }).__html;
    };
    expect(read()).not.toBe(read());
  });
});

describe("the control is usable by a screen reader", () => {
  const tree = () => Shield({ children: BODY, ...CLIPPED });

  it("wraps the alternative WITHOUT a group role or label", () => {
    // Measured against real VoiceOver, `role="group"` + `aria-label` produced
    // about twenty words of scaffolding per block — "Accessible alternative,
    // group… you are currently on a button inside of a group… to exit this
    // group press Control-Option-Shift-Up-Arrow" — in front of a button whose
    // own name already says what it does.
    const wrap = byAttr(tree(), "data-typeface-group");
    expect(wrap).toBeDefined();
    // `presentation` takes the wrapper itself out of the accessibility tree.
    // Without it VoiceOver announces the plain <div> as a group of its own.
    expect(props(wrap!).role).toBe("presentation");
    expect(props(wrap!)["aria-label"]).toBeUndefined();
  });

  it("explains WHY the section is silent, in a sentence", () => {
    const note = noteText(findAllTags(tree(), "p")[0]!);
    // Long enough to explain, short enough not to be an obstacle. The upper
    // bound moved from 120 to 200 when the note stopped saying "is not read
    // aloud" — that phrasing assumed everyone using assistive technology is
    // listening, which leaves out braille, and it named a symptom rather than
    // telling the reader what to do about it. The note is now the same
    // sentence the drawn wrapper shows, so there is one explanation to
    // translate and maintain instead of two that can drift apart.
    expect(note.length).toBeGreaterThan(40);
    expect(note.length).toBeLessThan(200);
    // It must name the ACTION, not the widget. The sentence used to end "…by
    // pushing the button", which is an instruction the button already gives,
    // and which is wrong on any surface where the control is not a button.
    // What a reader needs from this sentence is what uncovering is FOR.
    expect(note).toMatch(/uncover/i);
    expect(note).toMatch(/screen reader/i);
  });

  it("labels the button with the cost, not just the action", () => {
    const button = findAllTags(tree(), "button")[0]!;
    const label = String(props(button)["aria-label"]);
    // The COST lives in the spoken name now; the visible word is just the verb,
    // so the control matches the drawn wrapper's button rather than shouting a
    // sentence at a sighted reader.
    // The visible word, read out of the label span the shared <ActionButton>
    // renders beside the icon — not off `children`, which is now icon + span.
    expect(visibleText(button)).toBe("Uncover");
    expect(label).toMatch(/original text/i);
    // Someone deciding whether to press it needs to know it is not instant.
    expect(label).toMatch(/\b5 seconds\b/);
    expect(props(button).type).toBe("button");
  });

  it("ships the button hidden, for the script to reveal once it knows it works", () => {
    // Progressive enhancement: a control that cannot function is worse than no
    // control, and worst of all for a reader who cannot see that it did nothing.
    expect(props(findAllTags(tree(), "button")[0]!).hidden).toBe(true);
  });

  it("has a polite live region, and no landmark role on it", () => {
    const status = byAttr(tree(), "data-typeface-status");
    expect(status).toBeDefined();
    // assertive would interrupt whatever the reader is listening to, four times
    // over, for a background task they were told to keep reading through.
    expect(props(status!)["aria-live"]).toBe("polite");
    expect(props(status!)["aria-atomic"]).toBe("true");
    // NOT role="status". Both announce updates, but the role also puts a named
    // landmark in the tree, so a screen reader passing an as-yet-empty one says
    // the bare word "status" for nothing — once per block. Caught by running a
    // real screen reader over a two-block page.
    expect(props(status!).role).toBeUndefined();
  });

  it("names the control for what it does, not for one block", () => {
    // NO ORDINAL. This used to assert a distinct name per block, which was
    // right when each block had its own control. One press now uncovers every
    // protected block on the page, so "for paragraph 2" would describe a scope
    // the button does not have — and the ordinal was only ever there to tell
    // several identical buttons apart.
    const page = withShieldRenderPass(() => [
      Shield({ children: BODY + " one", wrapper: false, a11y: { mode: "text" }, as: "h2" }),
      Shield({ children: BODY + " two", wrapper: false, a11y: { mode: "text" }, as: "p" }),
    ]);
    const names = page.map((t) =>
      String(props(findAllTags(t, "button")[0]!)["aria-label"]),
    );
    for (const n of names) {
      expect(n).toContain("Uncover the original text");
      expect(n).not.toMatch(/paragraph \d|heading \d/);
    }
    // Same action, same words, wherever a reader meets it.
    expect(new Set(names).size).toBe(1);
  });

  it("uses one vocabulary across both control styles", () => {
    // The clipped control and the drawn wrapper are the same action. They used
    // to say "Unlock the plain text for paragraph 2" and "Get text" — a reader
    // who learned one met the other on the next block.
    const clipped = String(
      props(findAllTags(Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } }), "button")[0]!)["aria-label"],
    );
    expect(clipped).toContain("Uncover the original text");
  });

  it("refuses table-context tags rather than breaking the table", () => {
    // The browser foster-parents our wrapper out of the table, drops the cell
    // from the accessibility tree, and leaves a stray one behind.
    expect(() => Shield({ children: BODY, as: "td" })).toThrow(/not supported/);
    expect(() => Shield({ children: BODY, as: "tr" })).toThrow(/not supported/);
    expect(() => Shield({ children: BODY, as: "span" })).not.toThrow();
  });

  it("never puts the protected words in the button name", () => {
    // The label ships in the HTML. A label quoting the text it unlocks would be
    // the same free bypass the removed href was.
    const secret = "Zarquon threadbare pomegranate ossuary.";
    const label = String(
      props(findAllTags(Shield({ children: secret, ...CLIPPED }), "button")[0]!).children,
    );
    for (const w of ["Zarquon", "threadbare", "pomegranate", "ossuary"]) {
      expect(label.toLowerCase()).not.toContain(w.toLowerCase());
    }
  });

  it("honours an explicit label override", () => {
    const t = Shield({ children: BODY, wrapper: false, a11y: { ...FAST, label: "Read this bit plainly" } });
    expect(visibleText(findAllTags(t, "button")[0]!)).toBe("Read this bit plainly");
  });

  it("shortens the note after the first block on a page", () => {
    // The full explanation is worth hearing once. Six times, before reaching any
    // content, it is an obstacle.
    const trees = withShieldRenderPass(() =>
      [1, 2, 3].map((i) => Shield({ children: `${BODY} ${i}`, ...CLIPPED })),
    );
    // Found by ROLE, not by a word in the sentence. This used to grep for
    // "crambled", which broke the day the default wording changed and did not
    // contain it any more — the test was pinned to the copy rather than to the
    // structure it exists to check.
    const notes = trees.map((t) =>
      noteText(walkDeep(t).find((e) => props(e).role === "note")!),
    );
    expect(notes[0].length).toBeGreaterThan(notes[1].length);
    expect(notes[1]).toBe(notes[2]);
    // Even the short one has to say what the button is for.
    expect(notes[1]).toMatch(/uncover/i);
  });

  it("clips the revealed text off-screen by default, never removing it", () => {
    const out = byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-out");
    const style = props(out!).style as Record<string, unknown>;
    // display:none and visibility:hidden would both drop the words out of the
    // accessibility tree, which is the entire thing being delivered. The
    // display:none present here is the pre-reveal state; the solver clears only
    // that property, leaving the clip in place.
    expect(style.clipPath).toBe("inset(50%)");
    expect(style.position).toBe("absolute");
    expect(style.visibility).toBeUndefined();
    expect(props(out!)["data-typeface-out"]).toBe("hidden");
  });

  it("can be told to reveal visibly instead", () => {
    const out = byAttr(
      Shield({ children: BODY, wrapper: false, a11y: { ...FAST, reveal: "visible" } }),
      "data-typeface-out",
    );
    const style = props(out!).style as Record<string, unknown>;
    expect(style.clipPath).toBeUndefined();
    expect(props(out!)["data-typeface-out"]).toBe("visible");
  });

  it("keeps the progress bar OUT of the accessibility tree, and labelled", () => {
    const bar = findAllTags(tree(), "progress")[0];
    expect(bar).toBeDefined();
    // CONTRACT CHANGED, deliberately. This used to assert the opposite, on the
    // reasoning that "<progress> does not announce on its own, so leaving it
    // exposed costs nothing and lets a reader query exact progress on demand".
    // That is true of VoiceOver — the only screen reader this path had ever
    // been tested against — and false of NVDA, which ships "Progress bar
    // output: Beep" enabled by default and plays a rising tone on every value
    // change. The solver drives ~200 of them across a few-second wait, so the
    // old contract bought one reader an on-demand query and charged another
    // twenty seconds of beeping over the live region explaining the wait.
    //
    // AND NO LABEL. "It costs nothing" was wrong twice over. It was a hard-coded
    // English string rather than `labels.progress`, so it was untranslatable as
    // well as unreadable — an aria-label on an aria-hidden element names nothing
    // for anyone — and a stray English sentence in the markup is the one kind of
    // dead code setCamouflage() can never rename. If someone with NVDA reports
    // no beeping, un-hide the bar and give it the label from `labels.progress`.
    expect(props(bar!)["aria-hidden"]).toBe("true");
    expect(props(bar!)["aria-label"]).toBeUndefined();
  });

  it("gives the output element a focus target and starts it hidden", () => {
    const out = byAttr(tree(), "data-typeface-out");
    expect(out).toBeDefined();
    // tabIndex -1 so the script can move focus to the words once they exist,
    // rather than announcing "done" and leaving someone to hunt for the change.
    expect(props(out!).tabIndex).toBe(-1);
    expect(props(out!).hidden).toBe(true);
  });

  it("points the button at the block it will hide", () => {
    const t = tree();
    const button = findAllTags(t, "button")[0]!;
    const target = props(button)["data-typeface-solve-for"];
    expect(target).toBeTruthy();
    expect(props(shieldedBlock(t)).id).toBe(target);
  });

  it("hides the whole control from sighted readers by default", () => {
    // A sighted reader can already read the block — the font does that — so an
    // unexplained widget attached to text that looks fine is noise to them.
    const style = props(byAttr(Shield({ children: BODY, ...CLIPPED }), "data-typeface-group")!)
      .style as Record<string, unknown>;
    expect(style.clipPath).toBe("inset(50%)");
    // ...and `visualHidden: false` is the way back on screen, for anyone who
    // needs the focus indicator a clipped control takes away.
    const shown = props(
      byAttr(
        Shield({ children: BODY, wrapper: false, a11y: { ...FAST, visualHidden: false } }),
        "data-typeface-group",
      )!,
    ).style;
    expect(shown).toBeUndefined();
  });

  it("honours visualHidden by clipping, never by display:none", () => {
    const t = Shield({ children: BODY, wrapper: false, a11y: { ...FAST, visualHidden: true } });
    const group = byAttr(t, "data-typeface-group")!;
    const style = props(group).style as Record<string, unknown>;
    // display:none would remove the control from the accessibility tree, which
    // is the precise bug this whole prop exists to fix.
    expect(style.display).toBeUndefined();
    expect(style.clipPath).toBe("inset(50%)");
  });

  it("uses phrasing-content wrappers for an inline shield", () => {
    // A <p> or <div> sibling next to an inline <Shield as="span"> would close
    // the enclosing paragraph early and reflow the document.
    const t = Shield({ children: BODY, as: "span", ...CLIPPED });
    for (const el of walkAll(t)) {
      expect(el.type).not.toBe("p");
      expect(el.type).not.toBe("div");
    }
  });
});

describe("page-level wiring", () => {
  it("emits the solver once per render pass, however many blocks there are", () => {
    const trees = withShieldRenderPass(() =>
      [1, 2, 3, 4].map((i) => Shield({ children: `${BODY} ${i}`, a11y: FAST })),
    );
    const solvers = findAllTags(trees, "script").filter((s) =>
      String((props(s).dangerouslySetInnerHTML as { __html: string })?.__html).includes("-solve"),
    );
    expect(solvers).toHaveLength(1);
  });

  it("gives blocks distinct ids even when their text is identical", () => {
    // Same string hashes the same, so without the pass counter both buttons
    // would address one block and the other would never be hidden.
    const trees = withShieldRenderPass(() => [
      Shield({ children: BODY, ...CLIPPED }),
      Shield({ children: BODY, ...CLIPPED }),
    ]);
    const ids = trees.map((t) => props(shieldedBlock(t)).id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("stamps no id and no solver when there is no seal to open", () => {
    // Both spellings of "off". `{ mode: "none" }` is the explicit opt-out;
    // `screenReader: false` is the switch. Neither seals anything, so neither
    // may leave a block id or a solver script behind for a control that is not
    // there — the id in particular is a signature bought for nothing.
    for (const off of [{ a11y: { mode: "none" } as const }, { screenReader: false }]) {
      const t = Shield({ children: BODY, wrapper: false, ...off });
      expect(props(shieldedBlock(t)).id).toBeUndefined();
      const scripts = findAllTags(t, "script").filter((s) =>
        String((props(s).dangerouslySetInnerHTML as { __html: string })?.__html).includes("-solve"),
      );
      expect(scripts).toHaveLength(0);
    }
  });

  it("routes every emitted name through camouflage", () => {
    setCamouflage({ hash: "b7c1" });
    try {
      const t = Shield({ children: BODY, ...CLIPPED });
      const html = markup(t);
      expect(html).toContain("data-typeface-b7c1-solve");
      // Nothing in the SSR-visible output may say what this is.
      expect(html.toLowerCase()).not.toContain("shield");
      expect(html.toLowerCase()).not.toContain("puzzle");
    } finally {
      setCamouflage({ hash: "" });
      setCamouflage({
        familyName: { alpha: "Optik", beta: "Optik Beta", gamma: "Optik Gamma", maxhide: "Optik Max" },
        filePrefix: { alpha: "optik-a", beta: "optik-b", gamma: "optik-c", maxhide: "optik-m" },
        attrName: "data-typeface",
        guardFlag: "__tf_guard__",
        logPrefix: "[typeface]",
      });
    }
  });
});
