/**
 * The font-load guard, executed rather than merely inspected.
 *
 * The guard exists for one job: if the font does not load, the reader must NOT
 * be left looking at the raw decoy text in a fallback face. It used to do that
 * job for weight 400 only. `document.fonts.load('1em "Optik"')` is a CSS font
 * shorthand with no weight, so it defaults to 400 and probes the Regular face
 * and nothing else — a page whose only shielded block was bold passed the
 * guard while painting decoys, and pulled Regular down for nothing on top.
 *
 * These tests run the generated script against a fake window/document/
 * document.fonts so the fail path is observed, not assumed.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { Shield, setFontHost, setCamouflage } from "../src/Shield.js";
import { findAllTags, props } from "./helpers.js";

const BODY = "The future of writing belongs to those who write it.";
const OFF = { mode: "none" } as const;

// ---- fake DOM ---------------------------------------------------------------

interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  childNodes: unknown[];
  computed: { fontFamily: string; fontWeight: string };
  setAttribute(k: string, v: string): void;
  querySelectorAll(): FakeEl[];
}

function fakeEl(fontFamily: string, fontWeight: string): FakeEl {
  return {
    tagName: "DIV",
    attrs: {},
    style: {},
    textContent: "sfvw hjqrz",
    childNodes: [],
    computed: { fontFamily, fontWeight },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    querySelectorAll: () => [],
  };
}

interface FakeFace {
  family: string;
  status: string;
}

interface RunOptions {
  /** Protected elements the guard will sweep. */
  elements?: FakeEl[];
  /** What `document.fonts.load(shorthand)` does, per shorthand. */
  load?: (shorthand: string) => Promise<FakeFace[]>;
  /** The whole registered FontFaceSet, for the error-state sweep. */
  faces?: FakeFace[];
  /** Reuse a window across runs, to exercise the per-family registry. */
  win?: Record<string, unknown>;
}

/** Execute a guard script and return everything it did. */
async function runGuard(script: string, opts: RunOptions = {}) {
  const els = opts.elements ?? [fakeEl("Optik, system-ui, sans-serif", "400")];
  const loads: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];

  const sheets: string[] = [];
  const head = {
    appendChild(node: { text: string }) {
      sheets.push(node.text);
    },
  };
  const doc = {
    readyState: "complete",
    addEventListener: () => {},
    head,
    createElement: () => ({ text: "", setAttribute() {}, appendChild(n: { text: string }) { this.text = n.text; } }),
    createTextNode: (text: string) => ({ text }),
    // The guard scopes every lookup to its own variant, so the real selector is
    // `[data-typeface="alpha"]` (plus an optional `:not([…-failed])`), never the
    // bare attribute. Matching on the prefix keeps this stub honest to that.
    querySelectorAll: (sel: string) => (sel.startsWith("[data-typeface") ? els : []),
    fonts: {
      load: (shorthand: string) => {
        loads.push(shorthand);
        return (opts.load ?? (async () => [{ family: "Optik", status: "loaded" }]))(shorthand);
      },
      forEach: (cb: (f: FakeFace) => void) => (opts.faces ?? []).forEach(cb),
    },
  };
  const win = (opts.win ?? {}) as Record<string, unknown>;
  win.getComputedStyle = (el: FakeEl) => el.computed;

  const fn = new Function("window", "document", "console", "setTimeout", script);
  fn(
    win,
    doc,
    { error: (m: string) => errors.push(m), warn: (m: string) => warns.push(m) },
    (cb: () => void, ms: number) => timers.push({ fn: cb, ms }),
  );

  // Let the probe promises settle.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  return { loads, errors, warns, timers, els, win, sheets };
}

/** The guard bootstrap <script> a Shield emitted. */
function guardOf(tree: ReturnType<typeof Shield>): string {
  const scripts = findAllTags(tree, "script");
  return (props(scripts[0]!).dangerouslySetInnerHTML as { __html: string }).__html;
}

// ---- the regression itself --------------------------------------------------

describe("the guard probes the weights the page uses, not weight 400", () => {
  it("never emits the weightless `1em` shorthand that caused the bug", () => {
    for (const weight of [undefined, "regular", "bold", "black", 640] as const) {
      const src = guardOf(Shield({ children: BODY, variant: "alpha", weight, a11y: OFF }));
      // A shorthand whose size is not preceded by a weight resolves to 400.
      expect(src).not.toMatch(/load\(\s*'1em/);
      expect(src).toContain("w + ' 1em \"' + FAMILY + '\"'");
    }
  });

  it("probes only the bold face for a bold-only page", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { loads } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
    });
    expect(loads).toEqual(['700 1em "Optik"']);
    expect(loads.join()).not.toContain("400");
  });

  it("probes only the black face for a weight-900 page (no wasted Regular fetch)", async () => {
    const tree = Shield({ children: BODY, variant: "gamma", weight: "black", a11y: OFF });
    const { loads } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik Gamma, system-ui, sans-serif", "900")],
    });
    expect(loads).toEqual(['900 1em "Optik Gamma"']);
  });

  it("seeds the snapped cut, not the raw number an author typed", async () => {
    // weight={470} resolves to 500 before it reaches the style, so the guard
    // probes the cut by name. Probing 470 would have pulled the same file (the
    // 450-549 band covers it), so nothing about the download changes; what
    // changes is that the probe now says the weight it actually means.
    const tree = Shield({ children: BODY, variant: "alpha", weight: 470, a11y: OFF });
    expect(guardOf(tree)).toContain("var SEED   = 500;");
    const { loads } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "500")],
    });
    expect(loads).toEqual(['500 1em "Optik"']);
  });

  it("picks up a weight that came from inheritance rather than the prop", async () => {
    // No `weight` prop at all, so there is no SSR seed: the computed weight on
    // the element is the only place 800 can possibly come from.
    const tree = Shield({ children: BODY, variant: "alpha", a11y: OFF });
    const { loads } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "800")],
    });
    expect(loads).toEqual(['800 1em "Optik"']);
  });

  it("ignores elements belonging to another variant's family", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "regular", a11y: OFF });
    const { loads } = await runGuard(guardOf(tree), {
      elements: [
        fakeEl("Optik, system-ui, sans-serif", "400"),
        // "Optik Beta" starts with "Optik"; a substring match here would make
        // the alpha watcher download an alpha cut nobody asked for.
        fakeEl("Optik Beta, system-ui, sans-serif", "900"),
      ],
    });
    expect(loads).toEqual(['400 1em "Optik"']);
  });
});

describe("a failed non-400 face fails as loudly as a failed 400 face", () => {
  // The guard now shows the SAME sentence the notice does, rather than a
  // dead-end "Content unavailable". A reader who hits a bad deploy gets an
  // explanation and, on the tiers that draw one, a working control — not a
  // blanked paragraph with nowhere to go.
  // NOT DEFAULT_BROKEN. That is the sentence the STRIP shows, above the words,
  // where "the text below" points at them. This is the name put on the BLOCK
  // itself, which is the words — so it has to be self-referential, and it must
  // not name an Uncover button that the wrapperless tiers do not have.
  const blanked = "This text isn't showing correctly.";

  it("fails when the bold face rejects (404 on optik-a-700.woff2)", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { errors, els, sheets } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      load: async () => {
        throw new Error("A network error occurred.");
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Font "Optik" failed to load');
    expect(sheets).toHaveLength(1);
    expect(els[0]!.attrs['aria-label']).toBe(blanked);
    expect(sheets[0]).toContain('color:transparent!important');
    expect(els[0]!.attrs["data-typeface-failed"]).toBe("1");
    expect(els[0]!.attrs["aria-label"]).toBe(blanked);
  });

  it("masks with a stylesheet and leaves the decoy text node alone", async () => {
    // The DOM rewrite this replaced did not survive hydration: React found
    // text it had not rendered, threw hydration error #418, and restored the
    // decoy — a guard that logs a failure the reader never sees. Verified in
    // a real Next.js App Router page, not deduced.
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { els, sheets } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      load: async () => {
        throw new Error("A network error occurred.");
      },
    });
    expect(els[0]!.textContent).toBe("sfvw hjqrz");
    // Masked by CSS instead, which reconciliation has no opinion about. The
    // text node is deliberately untouched: rewriting it is what broke under
    // hydration, and it is also what makes the skeleton possible — the block
    // keeps the exact height its real lines occupied, because the real lines
    // are still there, just painted out.
    expect(sheets[0]).toContain("color:transparent!important");
    expect(sheets[0]).toContain("background-repeat:repeat-y");
  });

  it("fails when the bold face resolves but is parked in status 'error'", async () => {
    // Engines disagree about which of these two shapes a 404 produces, so the
    // guard has to catch both.
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { errors, els } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      load: async () => [{ family: "Optik", status: "error" }],
    });
    expect(errors[0]).toContain("the weight-700 face failed to load");
    expect(els[0]!.attrs["data-typeface-failed"]).toBe("1");
  });

  it("fails when no @font-face is declared for the weight in use", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { errors } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      load: async () => [],
    });
    expect(errors[0]).toContain("no @font-face declared for weight 700");
  });

  it("fails when a face errored outside every weight it probed", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { errors } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      faces: [{ family: '"Optik"', status: "error" }],
    });
    expect(errors[0]).toContain("in error state");
  });

  it("still catches the original missing-400 case", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "regular", a11y: OFF });
    const { errors, els } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "400")],
      load: async () => {
        throw new Error("A network error occurred.");
      },
    });
    expect(errors[0]).toContain('Font "Optik" failed to load');
    expect(els[0]!.attrs["data-typeface-failed"]).toBe("1");
  });

  it("names the configured fontHost so a bad host is diagnosable", async () => {
    setFontHost("/wrong-path");
    try {
      const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
      const { errors } = await runGuard(guardOf(tree), {
        elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
        load: async () => {
          throw new Error("A network error occurred.");
        },
      });
      expect(errors[0]).toContain("/wrong-path/");
    } finally {
      setFontHost("/fonts");
    }
  });
});

describe("the happy path stays happy", () => {
  it("does not touch the page when every probed weight loads", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { errors, els, sheets } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
    });
    expect(errors).toEqual([]);
    expect(sheets).toEqual([]);
    expect(els[0]!.textContent).toBe("sfvw hjqrz");
    expect(els[0]!.attrs["data-typeface-failed"]).toBeUndefined();
  });

  it("arms the 4s timeout only once the DOM has been swept", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { timers } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
    });
    expect(timers.some((t) => t.ms === 4000)).toBe(true);
  });

  it("blanks the page if nothing settles before the timeout", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const { timers, errors, els } = await runGuard(guardOf(tree), {
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
      load: () => new Promise(() => {}), // never settles
    });
    expect(errors).toEqual([]);
    timers.find((t) => t.ms === 4000)!.fn();
    expect(errors[0]).toContain("timeout after 4000ms");
    expect(els[0]!.attrs["data-typeface-failed"]).toBe("1");
  });

  it("waits for DOMContentLoaded before sweeping a still-parsing document", async () => {
    const tree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const listeners: Array<() => void> = [];
    const doc = {
      readyState: "loading",
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      querySelectorAll: () => [],
      fonts: { load: async () => [{ status: "loaded" }], forEach: () => {} },
    };
    const fn = new Function("window", "document", "console", "setTimeout", guardOf(tree));
    fn({ getComputedStyle: () => ({}) }, doc, { error: () => {}, warn: () => {} }, () => {});
    expect(listeners).toHaveLength(1);
  });
});

describe("one live watcher per family, not one per page", () => {
  it("lets a second family register its own watcher", async () => {
    const win: Record<string, unknown> = {};
    const alphaTree = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const betaTree = Shield({ children: BODY, variant: "beta", weight: "black", a11y: OFF });

    const a = await runGuard(guardOf(alphaTree), {
      win,
      elements: [fakeEl("Optik, system-ui, sans-serif", "700")],
    });
    const b = await runGuard(guardOf(betaTree), {
      win,
      elements: [fakeEl("Optik Beta, system-ui, sans-serif", "900")],
    });

    expect(a.loads).toEqual(['700 1em "Optik"']);
    // Before the fix a single window boolean made this second script a no-op,
    // so nothing ever checked the beta family at all.
    expect(b.loads).toEqual(['900 1em "Optik Beta"']);
    expect(Object.keys(win["__tf_guard__"] as object).sort()).toEqual(["Optik", "Optik Beta"]);
  });

  it("stands down and hands its weight over when the family is already watched", async () => {
    const win: Record<string, unknown> = {};
    const first = Shield({ children: BODY, variant: "alpha", weight: "bold", a11y: OFF });
    const second = Shield({ children: BODY, variant: "alpha", weight: "black", a11y: OFF });

    await runGuard(guardOf(first), { win, elements: [fakeEl("Optik, sans-serif", "700")] });
    const seedLoads: string[] = [];
    const registry = (win["__tf_guard__"] as Record<string, { seed(w: number): void }>)["Optik"]!;
    const spy = vi.spyOn(registry, "seed");
    await runGuard(guardOf(second), { win, elements: [fakeEl("Optik, sans-serif", "900")] });
    seedLoads.push(...spy.mock.calls.map((c) => String(c[0])));

    expect(seedLoads).toEqual(["900"]);
  });
});

describe("each variant's guard minds only its own blocks (regression)", () => {
  // Auto-rotation puts two or three variants on a normal page, and one guard is
  // emitted per variant. Selecting on the bare attribute made every guard
  // inspect every other variant's elements, which produced a stream of console
  // warnings claiming beta's blocks used "the wrong font" — and, far worse, let
  // one variant's 404 blank the blocks of variants that had loaded fine.
  it("scopes every DOM lookup to its own variant value", () => {
    const scripts: string[] = [];
    for (const v of ["alpha", "beta", "gamma", "maxhide"] as const) {
      const tree = Shield({ children: "The future of writing", variant: v, a11y: { mode: "none" } });
      const found = JSON.stringify(tree).match(/var SEL[^;]+;/g) ?? [];
      scripts.push(...found);
    }
    expect(scripts.length).toBeGreaterThan(0);
    for (const line of scripts) {
      // The selector must carry a variant value, never the bare attribute.
      expect(line).toMatch(/ATTR \+ '=' \+/);
    }
  });

  it("emits a different selector per variant", () => {
    const sel = (v: "alpha" | "beta") => {
      const tree = Shield({ children: "The future of writing", variant: v, a11y: { mode: "none" } });
      return (JSON.stringify(tree).match(/var SEL[^;]+;/) ?? [""])[0];
    };
    expect(sel("alpha")).not.toBe(sel("beta"));
    expect(sel("alpha")).toContain("alpha");
    expect(sel("beta")).toContain("beta");
  });
});

describe("unforwarded props are rejected, not dropped (regression)", () => {
  it("names the prop it would have discarded", () => {
    // `<Shield as={Link} href="/post">` used to lose `href` in silence: a dead
    // link, or an unrelated crash from inside the component, with nothing
    // naming the cause. That contradicted the package's fail-loud rule.
    expect(() => Shield({ children: "x", href: "/post", a11y: { mode: "none" } } as never))
      .toThrow(/received `href`, which it does not forward/);
    expect(() => Shield({ children: "x", id: "a", title: "b", a11y: { mode: "none" } } as never))
      .toThrow(/`id`, `title`/);
  });

  it("suggests the shape that actually works", () => {
    expect(() => Shield({ children: "x", href: "/p", a11y: { mode: "none" } } as never))
      .toThrow(/<Link href="\/post"><Shield as="span">/);
  });

  it("accepts every documented prop", () => {
    expect(() =>
      Shield({
        children: "x", as: "p", variant: "alpha", weight: 500, lineHeight: 1.6,
        size: "1rem", className: "c", style: { color: "red" }, rotate: false,
        a11y: { mode: "none" },
      }),
    ).not.toThrow();
  });
});

describe("setCamouflage({ attrName }) is validated", () => {
  // setCamouflage mutates module-level state, so this block puts the defaults
  // back. Leaving a renamed attribute behind would make whichever test ran next
  // fail for a reason with nothing to do with what it was testing.
  afterAll(() => {
    setCamouflage({
      attrName: "data-typeface",
      guardFlag: "__tf_guard__",
      logPrefix: "[typeface]",
      familyName: { alpha: "Optik", beta: "Optik Beta", gamma: "Optik Gamma", maxhide: "Optik Max" },
      filePrefix: { alpha: "optik-a", beta: "optik-b", gamma: "optik-c", maxhide: "optik-m" },
    });
  });

  // `attrName` is spliced VERBATIM into CSS selectors and querySelectorAll
  // strings in every emitted script. A bad value does not throw at runtime — it
  // produces a selector matching nothing, so the guard never fires and the
  // notice never wires, on a page that otherwise looks completely fine. Failing
  // at the call is the only place this is cheap to notice.
  it("accepts what the hash path itself generates", () => {
    // The guard would be worthless — worse, actively harmful — if it rejected
    // the library's own default naming.
    for (const hash of ["a8f3", "ada3", "1iuxvtu", "0000"]) {
      expect(() => setCamouflage({ hash })).not.toThrow();
      expect(() => setCamouflage({ attrName: `data-typeface-${hash}` })).not.toThrow();
    }
  });

  it("accepts ordinary hand-written names", () => {
    for (const name of ["data-body", "data-x", "data-Type-9"]) {
      expect(() => setCamouflage({ attrName: name })).not.toThrow();
    }
  });

  it("rejects anything that would break a selector", () => {
    for (const bad of ["data-a b", "data-a]", 'data-a"', "typeface", "data-a.b", "data-a[x]"]) {
      expect(() => setCamouflage({ attrName: bad }), bad).toThrow(/attrName/);
    }
  });
});
