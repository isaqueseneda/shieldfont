/**
 * The `a11y` prop.
 *
 * Two properties carry the whole feature and are asserted hardest:
 *   1. the alternative is OUTSIDE the aria-hidden subtree — otherwise assistive
 *      technology never reaches it and the prop is decoration;
 *   2. `visualHidden` clips rather than `display:none`-ing — the latter would
 *      remove the control from the accessibility tree, which is the exact bug
 *      the prop exists to fix.
 *
 * A third property is now asserted just as hard, in "renders no link, ever":
 * the alternative contains NO `<a>` at all. The 0.2.0 `{ mode: "text", href }`
 * put a URL to the original words in the HTML, which any scraper that follows
 * it reads for free. It is gone, and the test is the guard against it coming
 * back by accident.
 *
 * Every fixture below passes `wrapper: false` plus `{ mode: "text" }`, because
 * the clipped off-screen control is what `renderA11y` builds. The drawn wrapper
 * is the default and has its own suite further down.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Shield, withShieldRenderPass, type ShieldA11y } from "../src/Shield.js";
import { DEFAULT_TEXT, copyGuardScript, noticeScript } from "../src/notice.js";
import type { CSSProperties, ReactElement } from "react";
import {
  descendants,
  findAllTags,
  findTag,
  props,
  shieldedBlock,
  walkAll,
  visibleText,
  walkDeep,
} from "./helpers.js";

const BODY = "The future of writing belongs to those who write it.";

/** The camouflage base attribute the tests run against. */
const A = "data-typeface";

/** Every element carrying a given bare data attribute, in DOM order. */
function byAttrAll(tree: unknown, attr: string): ReactElement[] {
  return walkDeep(tree as never).filter((e) => attr in props(e));
}

/** The one element carrying a given bare data attribute. */
function byAttr(tree: unknown, attr: string): ReactElement {
  const hit = byAttrAll(tree, attr)[0];
  if (!hit) throw new Error(`no element with ${attr}`);
  return hit;
}

/**
 * What assistive technology would actually be handed: everything except the
 * subtrees cut off by `aria-hidden`.
 *
 * `walkAll` is the wrong tool for every assertion in the notice suite below,
 * because half of what this component renders is deliberately NOT in the
 * accessibility tree — icons, the visible tooltip, the toast, the whole second
 * strip's prose. Counting rendered elements would report a duplicate that no
 * listener hears, and would have gone on reporting a single copy of things
 * that were being read out twice.
 */
function exposed(node: unknown): ReactElement[] {
  return walkDeep(node as never, (el) => props(el)["aria-hidden"] === "true");
}

/** A block with the drawn notice, the configuration the demo ships. */
const noticed = (over: Record<string, unknown> = {}) =>
  Shield({ children: BODY, as: "p", wrapper: { position: "both" }, ...over } as never);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aria-hidden stays on the encoded block", () => {
  it("keeps aria-hidden=\"true\", with and without an alternative", () => {
    for (const a11y of [
      { mode: "none" } as const,
      { mode: "text" } as const,
      { mode: "text", note: "Uncover the words below." } as const,
    ]) {
      const block = shieldedBlock(Shield({ children: BODY, wrapper: false, a11y }));
      expect(props(block)["aria-hidden"]).toBe("true");
    }
  });

  it("never puts the alternative inside the hidden subtree", () => {
    const tree = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    const block = shieldedBlock(tree);
    const inside = descendants(block);
    expect(inside.some((el) => el.type === "button")).toBe(false);
    expect(inside.some((el) => el.type === "a")).toBe(false);
    // ...and it IS somewhere in the tree.
    expect(findTag(tree, "button")).toBeDefined();
  });

  it("puts the alternative BEFORE the hidden block in DOM order", () => {
    const tree = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    // walkDeep, not walkAll: the button lives inside a subcomponent, and
    // walkAll stops at function components and silently finds nothing.
    const order = walkDeep(tree);
    const controlAt = order.findIndex((el) => el.type === "button");
    const blockAt = order.indexOf(shieldedBlock(tree));
    expect(controlAt).toBeGreaterThanOrEqual(0);
    expect(blockAt).toBeGreaterThanOrEqual(0);
    expect(controlAt).toBeLessThan(blockAt);
  });
});

describe("renders no link, ever", () => {
  // The regression guard for the whole reason the 0.2.0 `{ mode: "text", href }`
  // was deleted: a URL to the original words sitting in the HTML is a one-line
  // bypass for any scraper that follows it, and it cannot be shown to a screen
  // reader without being shown to everyone else. If an <a> reappears in this
  // output, something has undone that.
  it("emits no <a> under any accepted configuration", () => {
    for (const a11y of [
      { mode: "none" } as const,
      { mode: "text" } as const,
      { mode: "text", note: "Uncover the words below." } as const,
      { mode: "text", visualHidden: true } as const,
      { mode: "text", reveal: "visible" } as const,
    ]) {
      const tree = Shield({ children: BODY, wrapper: false, a11y });
      expect(findAllTags(tree, "a")).toHaveLength(0);
    }
    // ...including with no `a11y` at all (which warns; silence it here).
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(findAllTags(Shield({ children: BODY }), "a")).toHaveLength(0);
  });

  it("ignores a leftover `href`/`transcript` instead of rendering it", () => {
    // TypeScript rejects both fields now, but a plain-JS caller and a project
    // mid-upgrade can still pass the 0.2.0 shape. The old URL must not reach
    // the DOM just because the object it arrived on still has the key — that
    // would make the removal cosmetic for exactly the installs that have not
    // migrated yet. (Typechecking does not run over this directory, so this is
    // asserted at runtime, where it is actually verified.)
    const stale = {
      mode: "text",
      href: "/plain/post-1.txt",
      transcript: "/t.txt",
    } as unknown as ShieldA11y;
    const tree = Shield({ children: BODY, wrapper: false, a11y: stale });
    expect(findAllTags(tree, "a")).toHaveLength(0);
    expect(JSON.stringify(tree)).not.toContain("/t.txt");
    expect(JSON.stringify(tree)).not.toContain("/plain/post-1.txt");
    // The control itself still renders — a stale field is ignored, not fatal.
    expect(findTag(tree, "button")).toBeDefined();
  });

  it("rejects the retired audio mode instead of quietly rendering a player", () => {
    // `{ mode: "audio", src }` was removed in 0.3.2 (GitHub issue #2): it asked
    // the author to synthesise and host a recording, which almost nobody did,
    // and audio with no text alternative fails WCAG 2.2 SC 1.2.1 even when they
    // did. TypeScript rejects the object now; this asserts the runtime does not
    // resurrect it for a plain-JS caller who has not upgraded — no <audio>
    // element, and the URL they passed never reaches the markup.
    const retired = { mode: "audio", src: "/audio/post-1.mp3" } as unknown as ShieldA11y;
    const tree = Shield({ children: BODY, wrapper: false, a11y: retired });
    expect(findTag(tree, "audio")).toBeUndefined();
    expect(JSON.stringify(tree)).not.toContain("/audio/post-1.mp3");
  });
});

describe('mode: "none"', () => {
  it("renders nothing extra and does not warn — an auditable opt-out", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = Shield({ children: BODY, a11y: { mode: "none" } });
    expect(warn).not.toHaveBeenCalled();
    expect(findTag(tree, "button")).toBeUndefined();
    expect(findTag(tree, "a")).toBeUndefined();
    expect(findTag(tree, "p")).toBeUndefined();
    // style + script + the encoded block, nothing else.
    expect(walkAll(tree).filter((el) => typeof el.type === "string")).toHaveLength(3);
  });
});

describe("visualHidden", () => {
  it("clips instead of using display:none or visibility:hidden", () => {
    for (const a11y of [
      { mode: "text", visualHidden: true } as const,
      { mode: "text", note: "Uncover the words below.", visualHidden: true } as const,
    ]) {
      const tree = Shield({ children: BODY, wrapper: false, a11y });
      const wrap = walkAll(tree).find((el) => String(props(el).className ?? "").endsWith("-alt"));
      expect(wrap).toBeDefined();
      const style = props(wrap!).style as CSSProperties;
      expect(style.clipPath).toBe("inset(50%)");
      expect(style.position).toBe("absolute");
      expect(style.overflow).toBe("hidden");
      // The two ways of getting this wrong.
      expect(style.display).toBeUndefined();
      expect(style.visibility).toBeUndefined();
      expect(JSON.stringify(style)).not.toContain("none");
    }
  });

  it("clips by default, and `false` puts the control back on screen", () => {
    // The default is the interesting half: a sighted reader can already read
    // the block through the font, so the control is screen-reader-only unless
    // asked for. `false` must leave NO style behind at all — an empty style
    // object here would be a clip that stopped clipping without anyone noticing.
    const hidden = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    const alt = (t: unknown) =>
      walkAll(t).find((el) => String(props(el).className ?? "").endsWith("-alt"));
    expect((props(alt(hidden)!).style as CSSProperties).clipPath).toBe("inset(50%)");

    const shown = Shield({
      children: BODY,
      wrapper: false,
      a11y: { mode: "text", visualHidden: false },
    });
    expect(props(alt(shown)!).style).toBeUndefined();
  });
});

describe("markup validity", () => {
  it("wraps in a div/p for block Shields", () => {
    const tree = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    const wrap = walkAll(tree).find((el) => String(props(el).className ?? "").endsWith("-alt"));
    expect(wrap!.type).toBe("div");
    expect(findTag(tree, "p")).toBeDefined();
  });

  it("uses phrasing content for an inline Shield, so it cannot split a <p>", () => {
    // A <div>/<p> sibling emitted next to an inline <Shield as="span"> inside a
    // paragraph makes the browser close the enclosing <p> early.
    const tree = Shield({ as: "span", children: BODY, wrapper: false, a11y: { mode: "text" } });
    const wrap = walkAll(tree).find((el) => String(props(el).className ?? "").endsWith("-alt"));
    expect(wrap!.type).toBe("span");
    expect(findTag(tree, "div")).toBeUndefined();
    expect(findTag(tree, "p")).toBeUndefined();
    expect(shieldedBlock(tree).type).toBe("span");
  });

  it("wraps the alternative without a group role", () => {
    // `role="group"` + `aria-label` used to be here. Removed after a real
    // VoiceOver session: it announced the group, then that you were "inside of
    // a group", then how to exit the group — before a control that already
    // named itself. A note and a button read fine as plain siblings.
    const tree = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    const wrap = walkAll(tree).find((el) => String(props(el).className ?? "").endsWith("-alt"));
    expect(wrap).toBeDefined();
    // `presentation` takes the wrapper itself out of the accessibility tree.
    // Without it VoiceOver announces the plain <div> as a group of its own.
    expect(props(wrap!).role).toBe("presentation");
    expect(props(wrap!)["aria-label"]).toBeUndefined();
  });
});

/**
 * The drawn notice (`wrapper`), from the ear outward.
 *
 * Everything below was written after walking one protected block the way a
 * screen-reader user does — linearly, then by form control — and then verified
 * in Chromium against the live demo. The pattern in every case is the same: the
 * markup was individually reasonable and the SEQUENCE was not.
 */
describe("settings the wrapper cannot honour fail loudly", () => {
  // These four configure the OFF-SCREEN control. The wrapper replaces that
  // control, so on the default tier they meant nothing — and until 0.3.2 they
  // meant nothing SILENTLY, which is the part that mattered: a page that set
  // them and changed nothing else got a different rendering on upgrade with no
  // error, no warning and no way to find out except by noticing.
  for (const key of ["reveal", "visualHidden", "label", "note"] as const) {
    it(`throws for a11y.${key} on the drawn tier`, () => {
      const value = key === "visualHidden" ? false : key === "reveal" ? "visible" : "x";
      expect(() =>
        Shield({ children: BODY, a11y: { mode: "text", [key]: value } } as never),
      ).toThrow(new RegExp(`a11y\\.${key}`));
    });

    it(`allows a11y.${key} when the wrapper is off`, () => {
      const value = key === "visualHidden" ? false : key === "reveal" ? "visible" : "x";
      expect(() =>
        Shield({ children: BODY, wrapper: false, a11y: { mode: "text", [key]: value } } as never),
      ).not.toThrow();
    });
  }

  it("names every offending key at once, not just the first", () => {
    expect(() =>
      Shield({
        children: BODY,
        a11y: { mode: "text", reveal: "visible", label: "L" },
      } as never),
    ).toThrow(/a11y\.reveal, a11y\.label/);
  });

  it("points at the replacement rather than only refusing", () => {
    expect(() =>
      Shield({ children: BODY, a11y: { mode: "text", note: "x" } } as never),
    ).toThrow(/wrapper=\{\{ text/);
  });

  it("leaves the fields the wrapper DOES honour alone", () => {
    // `seconds` is read on every tier; a blanket "any a11y field throws" would
    // have taken it with them.
    expect(() =>
      Shield({ children: BODY, a11y: { mode: "text", seconds: 9 } } as never),
    ).not.toThrow();
  });
});

describe("the three switches, and what a bare <Shield> does with them", () => {
  // These pin the DEFAULTS. Nothing else in the suite does: every other test
  // passes the switch it cares about, so the day the wrapper default moved from
  // off to on, 22 tests failed for the right reason and none of them was
  // actually asserting what a bare <Shield> renders. That is the assertion that
  // matters most, because it is the one every consumer gets without asking for
  // anything.
  //
  // There are no names here for combinations of the three. There used to be
  // four (FULL / INVISIBLE / MINIMAL / SEALED SHUT) and they were deleted: a
  // test titled with an invented name says less about what broke than one
  // titled with the props that were passed.
  const A = "data-typeface";
  const frames = (t: ReturnType<typeof Shield>) => byAttrAll(t, `${A}-frame`);
  const clipped = (t: ReturnType<typeof Shield>) => byAttrAll(t, `${A}-group`);

  it("a bare <Shield> draws the wrapper", () => {
    const t = Shield({ children: BODY });
    expect(frames(t)).toHaveLength(1);
    // And the sentence a reader can see is really in the markup, not just an
    // element that could have held one.
    const said = walkDeep(t).some((e) =>
      String(props(e).children ?? "").includes("please uncover the text"),
    );
    expect(said).toBe(true);
  });

  it("a bare <Shield> seals the words and mediates copy", () => {
    // The other two defaults, asserted beside the first, so all three "on by
    // default" claims in the prop docs have one test between them. Copy
    // mediation is read off the frame rather than off the block: with the
    // wrapper drawn the notice script owns the listener, and `-guard` is the
    // flag it reads.
    const t = Shield({ children: BODY });
    expect(byAttrAll(t, `${A}-data`).length).toBeGreaterThan(0);
    expect(props(frames(t)[0]!)[`${A}-guard`]).toBe("1");
  });

  it("wrapper={false} keeps the control and drops the box", () => {
    const t = Shield({ children: BODY, wrapper: false } as never);
    expect(frames(t)).toHaveLength(0);
    expect(clipped(t)).toHaveLength(1);
  });

  it("copyPaste={false} also drops the clipboard sentence", () => {
    const t = Shield({ children: BODY, wrapper: false, copyPaste: false } as never);
    expect(frames(t)).toHaveLength(0);
    expect(clipped(t)).toHaveLength(1);
    expect(props(shieldedBlock(t))[`${A}-clip-say`]).toBeUndefined();
  });

  it("screenReader={false} draws nothing and seals nothing", () => {
    const t = Shield({ children: BODY, screenReader: false } as never);
    expect(frames(t)).toHaveLength(0);
    expect(clipped(t)).toHaveLength(0);
    expect(byAttrAll(t, `${A}-data`)).toHaveLength(0);
  });

  it("screenReader={false} does not throw on the other two defaults", () => {
    // `wrapper` defaults to on, and the guard throws when a wrapper is asked
    // for with no seal behind it. Defaulting to `true` rather than to "on if
    // there is a seal" made the one configuration that turns the seal off throw
    // on the prop that defines it. Caught by a11y-warning.test.ts at the time;
    // pinned here because this is where the defaults are described.
    expect(() => Shield({ children: BODY, screenReader: false } as never)).not.toThrow();
  });

  it("wrapper={{ className }} styles the box and nothing else", () => {
    // TWO HOOKS, TWO ELEMENTS. The complaint that produced this was that the
    // Uncover button is unstyleable on a dark host page; the risk in fixing it
    // was widening `<Shield className>` to cover the wrapper, which would have
    // silently applied every existing text rule to the box on upgrade. So the
    // assertion is BOTH halves: the new hook reaches the frame, and the old one
    // still lands exactly where it always did.
    const t = Shield({
      children: BODY,
      className: "prose",
      wrapper: { className: "my-box" },
    } as never);
    expect(props(frames(t)[0]!).className).toBe("my-box");
    expect(props(shieldedBlock(t)).className).toBe("prose");
    const out = byAttrAll(t, `${A}-out`)[0]!;
    expect(props(out).className).toBe("prose");
  });

  it("emits no class attribute when nobody asked for one", () => {
    // `className=""` would be a byte of signature on every wrapper on the page
    // for a feature almost nobody uses. resolveNotice leaves it undefined.
    const t = Shield({ children: BODY });
    expect(props(frames(t)[0]!).className).toBeUndefined();
  });

  it("`explain` is dead, and says so by name", () => {
    // NOT A SILENT ALIAS. `explain` was the 0.3.2 name for `wrapper`, and a
    // component that quietly forwarded it would leave two spellings of one prop
    // alive in every codebase that used the old one. The generic unknown-prop
    // throw would fire on it anyway; what this pins is that the message names
    // the successor rather than reciting the whole accepted-props list.
    expect(() => Shield({ children: BODY, explain: false } as never)).toThrow(/wrapper/);
    expect(() => Shield({ children: BODY, explain: false } as never)).toThrow(/explain/);
    // Including when the value would have been the default anyway: a rename is
    // not conditional on the value being interesting.
    expect(() => Shield({ children: BODY, explain: true } as never)).toThrow(/renamed/);
  });
});

describe("the drawn notice — what a listener is handed", () => {


  it("lets the group name be renamed and translated", () => {
    // The old short shape is one prop away, and still the escape hatch for
    // anyone who finds the disclaimer too long to hear per block.
    const t = noticed({ wrapper: { labels: { group: "Texto protegido" } } });
    expect(props(byAttr(t, `${A}-frame`))["aria-label"]).toBe("Texto protegido, paragraph 1");
  });






  it("names every control for its action, and nothing else", () => {
    // Six paragraphs used to render twelve buttons named exactly "Original
    // text" — a control list (NVDA Insert+F7, VoiceOver rotor, JAWS Insert+F5)
    // showed a column of identical rows. The answer was a per-block ordinal.
    //
    // The ordinal is GONE now, and deliberately: one press uncovers every
    // protected block on the page, so a name saying "for paragraph 2" would
    // describe a scope the control does not have. Identical names are the
    // correct outcome for a control that does the identical thing.
    //
    // The FACT is gone from the name too — every button used to end "protected
    // from AI bots". By the time a listener reaches a button they have been
    // told: the sentence sits directly above it and says the text is scrambled
    // and what to do. The suffix was a third telling, landing on the words a
    // reader most needs to hear cleanly, and it made NVDA's Elements List
    // useless for these controls — every row ending in the same four words,
    // and the list filters from the start of the string.
    const trees = withShieldRenderPass(() => [
      Shield({ children: BODY, as: "h2", wrapper: true } as never),
      Shield({ children: `${BODY} 2`, as: "p", wrapper: true } as never),
    ]);
    expect(byAttrAll(trees[0], `${A}-act`)).toHaveLength(2);
    for (const t of trees) {
      for (const b of byAttrAll(t, `${A}-act`)) {
        const name = props(b)["aria-label"] as string;
        expect(name).not.toContain("protected from AI bots");
        expect(name).not.toMatch(/paragraph \d|heading \d/);
        // Still says what it does.
        expect(name).toMatch(/copy|uncover/i);
      }
    }
    const shows = trees.flatMap((t) =>
      byAttrAll(t, `${A}-act`)
        .filter((b) => props(b)[`${A}-act`] === "show")
        .map((b) => props(b)["aria-label"] as string),
    );
    for (const n of shows) expect(n).toContain("Uncover the original text");
  });

  it("keeps the visible label at the FRONT of the accessible name (SC 2.5.3)", () => {
    // Label in Name. A speech-input user says "click Original text"; if the
    // accessible name did not contain the visible words, nothing would happen.
    const t = noticed({ wrapper: { labels: { show: "Ver o texto" } } });
    for (const b of byAttrAll(t, `${A}-act`)) {
      const label = props(b)["aria-label"] as string;
      const span = descendants(b).find((e) => e.type === "span");
      // SC 2.5.3 governs controls that HAVE a visible label. Copy is icon-only
      // now — there is no visible text for a speech-input user to say, so the
      // rule has nothing to bite on. What it must still have is a name at all,
      // which is the icon-only failure mode worth guarding instead.
      if (!span) {
        expect(label.length).toBeGreaterThan(0);
        continue;
      }
      expect(label.startsWith(String(props(span).children))).toBe(true);
    }
  });

  it("hides the second strip's prose from the tree while keeping its buttons", () => {
    // A repeated toolbar is a normal, useful pattern and both sets drive the
    // same state, so the BUTTONS stay. It is the prose that could not be
    // skipped past without also skipping the controls.
    const bottom = byAttrAll(noticed(), `${A}-strip`)[1]!;
    const heard = exposed(bottom);
    expect(heard.filter((e) => `${A}-say-full` in props(e))).toHaveLength(0);
    expect(heard.filter((e) => `${A}-full` in props(e))).toHaveLength(0);
    expect(heard.filter((e) => `${A}-health` in props(e))).toHaveLength(0);
    // Two controls per strip now, not three — Restore was removed as redundant
    // once the words are on screen.
    expect(heard.filter((e) => `${A}-act` in props(e))).toHaveLength(2);
  });

  it("keeps <progress> out of the tree and the spoken estimate in it", () => {
    // Reverses a decision this package made on VoiceOver evidence. NVDA ships
    // "Progress bar output: Beep" ON, and this bar is driven ~200 times across
    // a wait that defaults to twenty seconds — twenty seconds of tones over the
    // top of the live region trying to say what is happening. What replaces
    // querying the bar is the estimate beside it, in words.
    const tree = noticed();
    const bars = walkDeep(tree).filter((e) => e.type === "progress");
    expect(bars).toHaveLength(2);
    for (const b of bars) expect(props(b)["aria-hidden"]).toBe("true");
    expect(exposed(tree).filter((e) => `${A}-est` in props(e))).toHaveLength(1);
  });

  it("ships no font-failure paragraph at all", () => {
    // It used to ship hidden and aria-hidden, holding a third copy of the
    // notice sentence for a swap the script had already stopped doing. The
    // skeleton does that job on the block itself. An element whose entire
    // lifecycle is "render it, hide it" is markup and one plain English
    // sentence handed to a scraper for nothing.
    expect(byAttrAll(noticed(), `${A}-fallback`)).toHaveLength(0);
  });

  it("keeps one polite live region per block, with no landmark role", () => {
    const status = byAttr(noticed(), `${A}-status`);
    expect(props(status)["aria-live"]).toBe("polite");
    expect(props(status)["aria-atomic"]).toBe("true");
    expect(props(status).role).toBeUndefined();
    expect(byAttrAll(noticed(), `${A}-status`)).toHaveLength(1);
  });

  it("builds none of the new names out of the words being protected", () => {
    // Each fix above put NEW strings in the HTML — a group name, six button
    // names, a progress label. Every one of them is an accessible name, which
    // means it ships in the markup in clear, which means a name assembled from
    // the text would be the same free bypass the removed href was. Asserted
    // against the names specifically, not the whole tree: the encoded block is
    // a separate mechanism with its own separate and openly documented
    // coverage property (see puzzle.test.ts, "is sealed independently of how
    // well the encoder covered the words").
    const secret = "Zarquon threadbare pomegranate ossuary.";
    const tree = noticed({ children: secret });
    const names = [
      // The frame is unnamed by default now, so this collects undefined for it.
      // An absent name cannot leak the protected words; filter rather than
      // assert one exists.
      props(byAttr(tree, `${A}-frame`))["aria-label"] as string | undefined,
      ...byAttrAll(tree, `${A}-act`).map((b) => props(b)["aria-label"] as string | undefined),
      ...byAttrAll(tree, `${A}-tip`).map((b) => props(b)["aria-label"] as string | undefined),
      // .filter(Boolean): the drawn tier's progress bar is aria-hidden and no
      // longer carries a name at all, so this now collects undefined for it —
      // which the toLowerCase() below then threw on. An absent name cannot leak
      // the protected words, so filtering is the correct reading of "every name
      // that exists".
      ...walkDeep(tree)
        .filter((e) => e.type === "progress")
        .map((b) => props(b)["aria-label"] as string | undefined)
        .filter((n): n is string => typeof n === "string"),
      // Every name that EXISTS, filtered once at the end: the frame and the
      // progress bars are unnamed now, and an absent name cannot leak anything.
    ].filter((n): n is string => typeof n === "string");
    // >3, and it has come down twice: once when the progress bars stopped
    // carrying a name they could never have spoken, once when the frame stopped
    // carrying one at all. This assertion exists to catch the list going
    // EMPTY and passing vacuously, not to pin an exact inventory — but keep it
    // just under the real number so a silent collapse still fails.
    expect(names.length).toBeGreaterThan(3);
    for (const w of ["Zarquon", "threadbare", "pomegranate", "ossuary"]) {
      for (const n of names) expect(n.toLowerCase()).not.toContain(w.toLowerCase());
    }
  });
});

describe("the drawn notice — the emitted script", () => {
  const js = () =>
    noticeScript({ attr: A, flag: "f", logPrefix: "[t]", storePrefix: "p-", family: "Optik" });

  it("never removes the control a reader just pressed", () => {
    // The single worst thing in the component, and it was invisible to every
    // markup assertion. While working, EVERY action button was set `hidden` —
    // including the one that had just been activated — so the browser moved
    // focus to <body> the instant a reader pressed it, and left it there for
    // the whole five-to-twenty-second wait. Verified in Chromium before and
    // after: activeElement went from BODY to the pressed button.
    //
    // The busy state is now a dim, not a removal: aria-disabled on the buttons,
    // NO aria-busy. It used to mark the actions container for the whole grind,
    // and on the clipped tier the wrapper that CONTAINS the live region. The
    // ARIA spec's meaning is "you may ignore changes here until this goes
    // false", which on the element holding a polite live region is a request to
    // suppress the announcements this feature exists to make. Inconsistent
    // support was the only reason the estimate was heard at all.
    const s = js();
    expect(s).not.toContain("aria-busy");
    // The old line, exactly as it read. Its return would restore the bug.
    expect(s).not.toContain("if (st === 'working'){ b.hidden = true; continue; }");
  });

  it("puts focus somewhere real when a state change hides the focused button", () => {
    // Pressing Restore hid the Restore button, which was focused, which dropped
    // the reader on <body> — at the top of the document on any screen reader
    // with a virtual buffer. Verified in Chromium: focus now lands on the Show
    // button of the SAME strip the reader pressed in.
    const s = js();
    expect(s).toContain("Frame.prototype.hold");
    expect(s).toContain("document.activeElement");
  });

  it("moves focus to the revealed words BEFORE announcing, not after", () => {
    // A focus move cancels speech in flight, so the old order — announce
    // "done", then focus — delivered the announcement to nobody on NVDA or
    // JAWS. The delays also give a virtual buffer time to rebuild after a DOM
    // change this size, which is the documented cause of a focus move landing
    // on stale content.
    expect(js()).toContain("Frame.prototype.land");
  });

  it("carries no comment and no word that names the mechanism", () => {
    // The rule the font guard and solver.ts already follow: a project that
    // called setCamouflage({ hash }) so its HTML shares no signature with any
    // other ShieldFont site must not have that undone by prose in the script.
    //
    // This is a REGRESSION TEST for something that was already shipping: a
    // six-line comment about progress bars and Restore buttons sat inside the
    // emitted string, and a `gShield` local plus an `-icon="shield"` attribute
    // value put the project's own name on every page using this mode.
    const s = js();
    expect(s).not.toContain("/*");
    expect(s).not.toContain("//");
    for (const word of [
      "shield", "puzzle", "decoy", "scramble", "protect", "original",
      "plaintext", "cipher", "unlock", "reveal",
    ]) {
      expect(s.toLowerCase()).not.toContain(word);
    }
  });
});

describe("still encodes", () => {
  it("leaves the shielded text encoded regardless of the a11y mode", () => {
    const tree = Shield({ children: BODY, wrapper: false, a11y: { mode: "text" } });
    const encoded = props(shieldedBlock(tree)).children as string;
    expect(typeof encoded).toBe("string");
    expect(encoded).not.toBe(BODY);
    // The alternative must never carry the plaintext into the HTML.
    expect(JSON.stringify(walkAll(tree))).not.toContain(BODY);
  });
  const drawn = (extra: Record<string, unknown> = {}) =>
    Shield({ children: BODY, wrapper: true, ...extra });
  const frame = (t: ReturnType<typeof Shield>) =>
    walkDeep(t).find((e) => Object.keys(props(e)).some((k) => k.endsWith("-frame")))!;

  // ---- THE SENTENCE LIVES IN EXACTLY ONE PLACE -------------------------
  //
  // The design changed on the maintainer's instruction: "put the whole
  // sentence in there, no abridged sentence hidden into an info icon
  // anymore", plus "let's not make reader read twice in a row". So the full
  // explanation is now VISIBLE in the lead strip, the info disclosure is
  // gone, and the frame's accessible name is a short identifier again.

  it("shows the explanation visibly, and announces it via the controls", () => {
    const t = drawn();
    const shown = walkDeep(t).filter((e) =>
      Object.keys(props(e)).some((k) => k.endsWith("-say-full")),
    );
    // Visible in the bar for sighted readers...
    expect(shown.length).toBeGreaterThan(0);
    // visibleText, not `children`: the sentence is two spans now — one for
    // eyes (aria-hidden) and one for ears (clipped) — because a label on the
    // note got BOTH announced, the short version then the long one. String()
    // over an array of elements yields "[object Object]", which is what this
    // asserted against until it was looked at.
    expect(visibleText(shown[0]!)).toContain("screen reader");
    // ...and it is a REAL TAB STOP on the lead strip. Three placements were
    // tried before this one: a plain text node (Tab cannot reach prose), and
    // aria-describedby (a description, which VoiceOver and NVDA both suppress
    // at default verbosity). Only a focusable node is reliably reached and
    // announced, so the sentence is its own stop and appears nowhere else.
    const lead = shown[0]!;
    expect(props(lead).tabIndex).toBe(0);
    expect(props(lead).role).toBe("note");
    expect(props(lead)["aria-hidden"]).toBeUndefined();
    // The trailing copy stays hidden and unfocusable, or the reader meets the
    // same sentence twice.
    for (const e of shown.slice(1)) expect(props(e)["aria-hidden"]).toBe("true");
    // And it is not ALSO carried by a control, which would announce it twice.
    const names = walkDeep(t).map((e) => String(props(e)["aria-label"] ?? ""));
    expect(names.some((n) => n.includes("scrambled to protect"))).toBe(false);
  });

  it("no longer renders an info disclosure at all", () => {
    const t = drawn();
    const tips = walkDeep(t).filter((e) =>
      Object.keys(props(e)).some((k) => /-tip(-wrap|-panel)?$/.test(k)),
    );
    expect(tips).toHaveLength(0);
  });

  it("leaves the frame unnamed, so the sentence is not pre-empted by a worse one", () => {
    // The default WAS "Protected text, paragraph 2". It was a worse version of
    // the sentence that follows it — a listener does not know what "protected
    // text" means until the next phrase explains it — and it cost twelve words
    // per block to say so. Measured over a real accessibility tree: 85 words to
    // reach the second block with it, 73 without.
    expect(props(frame(drawn()))["aria-label"]).toBeUndefined();
  });

  it("keeps the group ROLE, which is what separates one block from the next", () => {
    // The name went; the boundary did not. An unnamed role="group" is still
    // announced ("grouping" / "out of grouping" on NVDA), and that is the only
    // thing telling a listener where one block's furniture ends and the next
    // block's begins.
    expect(props(frame(drawn())).role).toBe("group");
  });

  it("names the frame when an author asks for one", () => {
    const t = Shield({ children: BODY, wrapper: { labels: { group: "Sealed" } } } as never);
    const name = String(props(frame(t))["aria-label"]);
    expect(name).toContain("Sealed");
    // Still carries the ordinal, so two named blocks do not sound alike.
    expect(name).toMatch(/\d/);
  });

  it("does not distinguish blocks by ordinal any more, and does not need to", () => {
    // This asserted two distinct names. There are no names now. While locked
    // every block is SILENT, so there is nothing to tell apart and nothing to
    // choose between: uncovering is page-wide, and nobody can want block 5
    // specifically when they cannot read any of them. Once open, the words
    // themselves distinguish them.
    const page = withShieldRenderPass(() => [
      Shield({ children: BODY + " one", wrapper: true }),
      Shield({ children: BODY + " two", wrapper: true }),
    ]);
    expect(page.map((t) => props(frame(t))["aria-label"])).toEqual([undefined, undefined]);
  });

  it("keeps the trailing strip's prose out of the tree, so nothing repeats", () => {
    const t = drawn({ wrapper: { position: "both" } });
    const said = walkDeep(t).filter((e) =>
      Object.keys(props(e)).some((k) => k.endsWith("-say-full")),
    );
    expect(said).toHaveLength(2);  // position:"both" explicitly, below
    // The lead copy is a focusable note; only the trailing one is hidden.
    expect(said.filter((e) => props(e)["aria-hidden"] === "true")).toHaveLength(1);
    expect(said.filter((e) => props(e).tabIndex === 0)).toHaveLength(1);
  });

});
