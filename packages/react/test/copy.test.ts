/**
 * `copyPaste` — copy mediation, with and without the drawn wrapper.
 *
 * The prop shipped accepted-and-inert without the wrapper, which its own doc
 * comment admitted. Two things are being defended now:
 *
 *   1. It is REAL on its own, and cheap: one attribute per block, one shared
 *      page-level listener, and no new elements anywhere.
 *   2. It does NOTHING it was not asked to do. A selection that does not touch
 *      a still-protected block, a browser with no way to open the seal, a page
 *      that never named the prop — every one of those must behave exactly as it
 *      would if this package were not installed.
 *
 * The second is the one that needs the script EXECUTED rather than inspected,
 * so most of this file runs the emitted source against a hand-built DOM, the
 * same way guard.test.ts runs the font guard.
 */
import { describe, it, expect } from "vitest";
import { Shield, setCamouflage, withShieldRenderPass } from "../src/Shield.js";
import { copyGuardScript, standaloneClipboardNotice } from "../src/notice.js";
import { props, walkDeep, shieldedBlock, findAllTags } from "./helpers.js";

const BODY = "The future of writing belongs to those who write it.";
const A = "data-typeface";

/** Every script tag's source, in DOM order. */
function scripts(tree: unknown): string[] {
  return findAllTags(tree as never, "script").map((s) =>
    String((props(s).dangerouslySetInnerHTML as { __html: string } | undefined)?.__html ?? ""),
  );
}

/** The page-level copy listener a Shield emitted, if any. */
function copyJs(tree: unknown): string | undefined {
  return scripts(tree).find((s) => s.includes("-clip-say]"));
}

// ---------------------------------------------------------------------------
// A DOM small enough to reason about, big enough to run the listener against.
//
// The script uses four selector shapes and nothing else: `[attr]`,
// `[attr="value"]`, `closest()` and `querySelector()`. Modelling exactly those
// keeps the harness honest — anything the script starts relying on that is not
// here fails loudly instead of silently passing.
// ---------------------------------------------------------------------------

interface Node {
  attrs: Record<string, string>;
  id: string;
  hidden: boolean;
  textContent: string;
  children: Node[];
  parent: Node | null;
  getAttribute(name: string): string | null;
  closest(sel: string): Node | null;
  querySelector(sel: string): Node | null;
}

function node(
  attrs: Record<string, string>,
  opts: { id?: string; text?: string; hidden?: boolean; children?: Node[] } = {},
): Node {
  const n: Node = {
    attrs,
    id: opts.id ?? "",
    hidden: opts.hidden ?? false,
    textContent: opts.text ?? "",
    children: opts.children ?? [],
    parent: null,
    getAttribute: (name) => (name in attrs ? attrs[name]! : null),
    closest: (sel) => {
      let at: Node | null = n;
      while (at) {
        if (matches(at, sel)) return at;
        at = at.parent;
      }
      return null;
    },
    querySelector: (sel) => all(n).find((e) => matches(e, sel)) ?? null,
  };
  for (const c of n.children) c.parent = n;
  return n;
}

/** `[name]` or `[name="value"]`. */
function matches(n: Node, sel: string): boolean {
  const m = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (!m) throw new Error(`the harness does not model the selector ${sel}`);
  const [, name, value] = m;
  if (!(name! in n.attrs)) return false;
  return value === undefined || n.attrs[name!] === value;
}

function all(n: Node, out: Node[] = []): Node[] {
  for (const c of n.children) {
    out.push(c);
    all(c, out);
  }
  return out;
}

interface Sel {
  ranges: Node[][];
  text: string;
  collapsed?: boolean;
}

/** Run the emitted listener over one page and one selection. */
function runCopy(js: string, root: Node, sel: Sel) {
  const pool = [root, ...all(root)];
  const doc: Record<string, unknown> = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      (doc.handlers as Record<string, unknown>)[type] = fn;
    },
    handlers: {} as Record<string, unknown>,
    querySelector: (s: string) => pool.find((e) => matches(e, s)) ?? null,
    querySelectorAll: (s: string) => pool.filter((e) => matches(e, s)),
  };
  const selection = {
    isCollapsed: sel.collapsed ?? false,
    rangeCount: sel.ranges.length,
    getRangeAt: (i: number) => ({
      intersectsNode: (n: Node) => sel.ranges[i]!.includes(n),
    }),
    toString: () => sel.text,
  };
  const win: Record<string, unknown> = { getSelection: () => selection };
  new Function("window", "document", js)(win, doc);
  const wrote: Record<string, string> = {};
  let prevented = false;
  const ev = {
    clipboardData: { setData: (t: string, v: string) => { wrote[t] = v; } },
    preventDefault: () => { prevented = true; },
  };
  const handler = (doc.handlers as Record<string, (e: unknown) => void>).copy;
  expect(handler, "the script registered no copy listener").toBeTypeOf("function");
  handler(ev);
  return { wrote, prevented, clipboard: wrote["text/plain"] };
}

/** A page: one protected block, its clipped control, and a normal paragraph. */
function page(over: { hidden?: boolean; ready?: string; clip?: string } = {}) {
  const out = node({ [`${A}-out`]: "hidden" }, { text: over.ready ?? "" });
  const btn = node({ [`${A}-solve`]: "", [`${A}-solve-for`]: "blk" }, {
    hidden: over.hidden ?? false,
  });
  const group = node({ [`${A}-group`]: "" }, { children: [btn, out] });
  const block = node(
    { [A]: "alpha", [`${A}-clip-say`]: over.clip ?? standaloneClipboardNotice() },
    { id: "blk", text: "Fluent wrong words." },
  );
  const other = node({}, { text: "An ordinary paragraph." });
  const root = node({}, { children: [group, block, other] });
  return { root, block, other, out, btn };
}

const JS = () => copyGuardScript({ attr: A, flag: "__f__" });

describe("copyPaste requires a seal, and says so", () => {
  it("throws when the accessible path is off, in every spelling of off", () => {
    const offs = [{ screenReader: false }, { a11y: { mode: "none" } }];
    for (const off of offs) {
      expect(() => Shield({ children: BODY, copyPaste: true, ...off } as never)).toThrow(
        /copyPaste with the accessible path turned off/,
      );
    }
  });

  it("names both ways out, the way the wrapper throw does", () => {
    let msg = "";
    try {
      Shield({ children: BODY, copyPaste: true, screenReader: false } as never);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("screenReader={false}");
    expect(msg).toContain("remove copyPaste");
    // The reason, not just the rule: a notice pointing at nothing is worse than
    // the wrong paste it replaces.
    expect(msg).toMatch(/nothing for that sentence to point at/);
  });

  it("does not throw for copyPaste={false} with the path off", () => {
    // Turning a feature OFF is never a contradiction, whatever else is off.
    expect(() =>
      Shield({ children: BODY, copyPaste: false, screenReader: false } as never),
    ).not.toThrow();
  });
});

describe("what standalone copyPaste costs the markup", () => {
  it("marks the block and emits one page-level listener", () => {
    const tree = Shield({ children: BODY, wrapper: false, copyPaste: true } as never);
    const block = shieldedBlock(tree);
    expect(props(block)[`${A}-clip-say`]).toBe(standaloneClipboardNotice());
    expect(copyJs(tree)).toBeDefined();
  });

  it("adds NO elements — the whole per-block cost is one attribute", () => {
    const withOut = Shield({ children: BODY, wrapper: false } as never);
    const withOn = Shield({ children: BODY, wrapper: false, copyPaste: true } as never);
    const count = (t: unknown) => walkDeep(t as never).filter((e) => e.type !== "script").length;
    expect(count(withOn)).toBe(count(withOut));
  });

  it("leaves a block with no seal alone", () => {
    // 199 bytes, one element, no matchable strings. Nothing in this feature may
    // reach it — and it cannot, because asking for both throws.
    const tree = Shield({ children: BODY, screenReader: false } as never);
    expect(JSON.stringify(tree)).not.toContain("-clip-say");
    expect(copyJs(tree)).toBeUndefined();
  });

  it("survives the wrapper being turned off", () => {
    // It used to default to whatever `wrapper` was, so `wrapper={false}` took
    // the clipboard notice down with it and there was no way to ask for copy
    // mediation on an undrawn block: you got the wrapper and the notice, or
    // neither. They are independent now.
    const tree = Shield({ children: BODY, wrapper: false } as never);
    expect(props(shieldedBlock(tree))[`${A}-clip-say`]).toBeTruthy();
    expect(copyJs(tree)).toBeDefined();
  });

  it("goes off when it is turned off", () => {
    const tree = Shield({ children: BODY, wrapper: false, copyPaste: false } as never);
    expect(props(shieldedBlock(tree))[`${A}-clip-say`]).toBeUndefined();
    expect(copyJs(tree)).toBeUndefined();
  });

  it("emits the listener once per render pass, not once per block", () => {
    const trees = withShieldRenderPass(() =>
      [1, 2, 3].map((i) => Shield({ children: `${BODY} ${i}`, wrapper: false, copyPaste: true } as never)),
    );
    expect(scripts(trees).filter((s) => s.includes("-clip-say]"))).toHaveLength(1);
    for (const t of trees) expect(props(shieldedBlock(t))[`${A}-clip-say`]).toBeTruthy();
  });

  it("does not double up with the wrapper's own handler", () => {
    // Inside a frame the notice script owns the copy event. Two listeners on
    // one selection would fight over the same clipboard.
    const tree = Shield({ children: BODY, wrapper: true, copyPaste: true } as never);
    expect(copyJs(tree)).toBeUndefined();
    expect(props(shieldedBlock(tree))[`${A}-clip-say`]).toBeUndefined();
  });

  it("marks the BLOCK, never anything the wrapper also marks", () => {
    // A page may legitimately mix the two tiers. The wrapper parks its own
    // clipboard sentence on the frame, and both listeners are live on such a
    // page — so if the standalone one queried an attribute name the frame also
    // carries, it would claim the wrapper's blocks out from under the handler
    // that knows their state. The names must not collide, and this is the test
    // that says so.
    const [framed, bare] = withShieldRenderPass(() => [
      Shield({ children: BODY, wrapper: true } as never),
      Shield({ children: `${BODY} 2`, wrapper: false, copyPaste: true } as never),
    ]);
    const marked = (t: unknown) =>
      walkDeep(t as never).filter((e) => `${A}-clip-say` in props(e));
    expect(marked(framed)).toHaveLength(0);
    expect(marked(bare)).toHaveLength(1);
    const query = copyJs(bare)!.match(/querySelectorAll\('\[' \+ A \+ '([^']+)'\]?/)![1];
    expect(query).toBe("-clip-say]");
  });

  it("lets the sentence be replaced and translated", () => {
    const tree = Shield({
      children: BODY,
      wrapper: false,
      copyPaste: { notice: "[Texto protegido.]" },
    } as never);
    expect(props(shieldedBlock(tree))[`${A}-clip-say`]).toBe("[Texto protegido.]");
  });

  it("routes the attribute and the flag through camouflage", () => {
    setCamouflage({ hash: "b7c1" });
    try {
      const tree = Shield({ children: BODY, wrapper: false, copyPaste: true } as never);
      expect(JSON.stringify(tree)).toContain("data-typeface-b7c1-clip");
      expect(copyJs(tree)).toContain("data-typeface-b7c1");
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

describe("the standalone sentence is self-sufficient", () => {
  const s = standaloneClipboardNotice();

  it("does not point at a control nobody drew", () => {
    // "Use the button next to it" is a self-contradiction with no wrapper on
    // screen: there is no button next to it, and telling a sighted reader to
    // look for one sends them hunting for something that is deliberately
    // invisible.
    expect(s).not.toMatch(/button/i);
    expect(s).not.toMatch(/next to it/i);
    expect(s).not.toMatch(/beside/i);
  });

  it("says what happened and what to do", () => {
    expect(s).toMatch(/not what you\s+read/i);
    expect(s).toMatch(/Tab key/);
    expect(s).toMatch(/screen reader/i);
    expect(s).toMatch(/copy again/i);
  });

  it("never quotes the words it is protecting", () => {
    // The sentence ships in the HTML, in clear, on every marked block. One
    // built from the text would be the same free bypass a plain-text URL was.
    //
    // Asserted against the ATTRIBUTE, not against the whole tree: the encoded
    // block legitimately ships the substituted text, and the encoder covers
    // roughly one word in five, so a run of uncommon words can come out of
    // encode() byte-identical to what went in. A tree-wide search for the
    // input would fail on that and mean nothing. The seal itself has its own
    // coverage-independent assertions in puzzle.test.ts.
    const secret = "Zarquon threadbare pomegranate ossuary.";
    const tree = Shield({ children: secret, wrapper: false, copyPaste: true } as never);
    const clip = props(shieldedBlock(tree))[`${A}-clip-say`] as string;
    for (const w of ["Zarquon", "threadbare", "pomegranate", "ossuary"]) {
      expect(clip.toLowerCase()).not.toContain(w.toLowerCase());
    }
    // The listener reads the words off the DOM at copy time and holds none of
    // them: nothing about the block is baked into the emitted source.
    expect(copyJs(tree)).not.toContain("Zarquon");
  });
});

describe("the listener, executed", () => {
  it("does nothing to a selection that misses every protected block", () => {
    const p = page();
    const r = runCopy(JS(), p.root, { ranges: [[p.other]], text: "An ordinary paragraph." });
    expect(r.prevented).toBe(false);
    expect(r.clipboard).toBeUndefined();
  });

  it("does nothing to a collapsed selection", () => {
    const p = page();
    const r = runCopy(JS(), p.root, { ranges: [], text: "", collapsed: true });
    expect(r.prevented).toBe(false);
  });

  it("swaps the substituted run for the notice, and leaves the rest alone", () => {
    const p = page();
    const r = runCopy(JS(), p.root, {
      ranges: [[p.block, p.other]],
      text: "Before. Fluent wrong words. After.",
    });
    expect(r.prevented).toBe(true);
    expect(r.clipboard).toBe(`Before. ${standaloneClipboardNotice()} After.`);
    // The surrounding text a reader also selected survives intact.
    expect(r.clipboard).toContain("Before.");
    expect(r.clipboard).toContain("After.");
  });

  it("stands down when there is no path to the words at all", () => {
    // No BigInt, no crypto.subtle, or an insecure origin: the control never
    // un-hides, so a notice telling someone to press it is a dead end. The page
    // behaves like the plain tier it currently is.
    const p = page({ hidden: true });
    const r = runCopy(JS(), p.root, { ranges: [[p.block]], text: "Fluent wrong words." });
    expect(r.prevented).toBe(false);
    expect(r.clipboard).toBeUndefined();
  });

  it("gives the real words with no wait once the block is already open", () => {
    // Including the localStorage cache path, which is the same state: that
    // reader already paid for this text.
    const p = page({ hidden: true, ready: BODY });
    const r = runCopy(JS(), p.root, {
      ranges: [[p.block]],
      text: "Fluent wrong words.",
    });
    expect(r.prevented).toBe(true);
    expect(r.clipboard).toBe(BODY);
    expect(r.clipboard).not.toContain("protected from AI bots");
  });

  it("does not put the open block's words on the clipboard twice", () => {
    // The revealed element is clipped, not removed, so a select-all sweeps up
    // both it and the substituted block.
    const p = page({ hidden: true, ready: BODY });
    const r = runCopy(JS(), p.root, {
      ranges: [[p.block, p.out]],
      text: `Fluent wrong words. ${BODY}`,
    });
    expect(r.clipboard!.split(BODY)).toHaveLength(2);
    expect(r.clipboard).not.toContain("Fluent wrong words.");
  });

  it("replaces the whole clipboard only when the block was partly selected", () => {
    // Half a substituted paragraph cannot be mapped onto half a real one, so
    // this is the one case where other selected text is lost. Stated, not hidden.
    const p = page();
    const r = runCopy(JS(), p.root, { ranges: [[p.block]], text: "Fluent wrong" });
    expect(r.prevented).toBe(true);
    expect(r.clipboard).toBe(standaloneClipboardNotice());
  });

  it("honours a replaced sentence at run time, not just in the markup", () => {
    const p = page({ clip: "[Texto protegido.]" });
    const r = runCopy(JS(), p.root, { ranges: [[p.block]], text: "Fluent wrong words." });
    expect(r.clipboard).toBe("[Texto protegido.]");
  });

  it("carries no comment and no word that names the mechanism", () => {
    // The rule the font guard, the solver and the notice script already follow.
    // The one sentence a reader sees travels as an attribute React wrote, so
    // the script itself is byte-identical on every page that ships it.
    const s = JS();
    expect(s).not.toContain("/*");
    expect(s).not.toContain("//");
    for (const word of [
      "shield", "puzzle", "decoy", "scramble", "protect", "original",
      "plaintext", "plain text", "cipher", "unlock", "reveal", "ai bot",
      "encoded", "progress bar",
    ]) {
      expect(s.toLowerCase()).not.toContain(word);
    }
  });

  it("is small enough to be worth shipping per page", () => {
    // ~1.7 kB, once, for every block on the page — against the alternative
    // design, which was an invisible per-block host repeating the frame's
    // attributes on every protected paragraph. The bound is here to make a
    // future "just add a sweep and a MutationObserver" argue for itself.
    //
    // Raised from 1600 when the handler learned to splice EVERY selected block
    // rather than the first. Before that, selecting three clipped paragraphs
    // pasted one notice and two paragraphs of raw decoy words — so the 25 bytes
    // bought the handler's entire reason for existing on a multi-block page.
    // Raise this again only for a defect, never for a feature.
    expect(JS().length).toBeLessThan(1750);
  });
});
