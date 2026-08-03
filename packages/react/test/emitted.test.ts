/**
 * The emitted browser scripts are STRINGS, so TypeScript never checks them and
 * every other test in this suite inspects React trees rather than running them.
 * That gap is not theoretical: an over-broad edit removed the middle of a
 * function here, shipped a script with unbalanced braces, and all 188 tests
 * still passed. The page would have been dead on arrival.
 *
 * These tests parse what actually ships.
 */
import { describe, it, expect } from "vitest";
import { Script } from "node:vm";
import { noticeScript, copyGuardScript } from "../src/notice.js";
import { solverScript } from "../src/solver.js";
import { Shield, withShieldRenderPass } from "../src/Shield.js";
import { walkAll, props } from "./helpers.js";

const NAMES = {
  attr: "data-typeface-a8f3",
  flag: "__fg_a8f3__",
  logPrefix: "[typeface a8f3]",
  storePrefix: "data-typeface-a8f3-",
};
const emitted = () => [
  ["notice", noticeScript({ ...NAMES, family: "Optik a8f3" })],
  ["solver", solverScript(NAMES)],
  ["copyGuard", copyGuardScript({ attr: NAMES.attr, flag: NAMES.flag })],
  ...everyRenderedScript(),
] as const;

/**
 * Every `<script>` a real render actually puts in the page.
 *
 * The three above are exported and were the only ones these tests could see.
 * `fontGuardScript` is not exported — and it was the one shipping twenty-two
 * lines of comments and console strings naming the mechanism, undetected, in
 * the served HTML of every page. A test that can only inspect what a module
 * chose to export will keep missing exactly the script nobody is looking at, so
 * this reads them off a rendered tree instead.
 */
function everyRenderedScript(): [string, string][] {
  const out: [string, string][] = [];
  const tree = withShieldRenderPass(() =>
    walkAll(Shield({ children: "The future of writing belongs to those who write it." })),
  );
  let n = 0;
  for (const el of tree) {
    if (el.type !== "script") continue;
    const html = props(el).dangerouslySetInnerHTML as { __html?: string } | undefined;
    // The sealed payload rides in a script too, but it is JSON, not code.
    if (props(el).type === "application/json") continue;
    if (html?.__html) out.push([`rendered #${++n}`, html.__html]);
  }
  return out;
}

describe("the emitted browser scripts", () => {
  it("include the ones a real render emits, not just the exported ones", () => {
    // Guards the guard. If the render shape changes and everyRenderedScript()
    // finds nothing, every check below would pass by inspecting an empty list —
    // which is worse than no test, because it reads as coverage.
    const found = emitted().map(([n]) => n);
    expect(found.filter((n) => n.startsWith("rendered")).length).toBeGreaterThan(0);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it("are syntactically valid JavaScript", () => {
    for (const [name, src] of emitted()) {
      expect(() => new Script(src), `${name} does not parse`).not.toThrow();
    }
  });

  it("carry no comments — every byte ships on every page", () => {
    for (const [name, src] of emitted()) {
      expect(src, `${name} carries a block comment`).not.toMatch(/\/\*/);
      expect(src.split("\n").filter((l) => l.trim().startsWith("//")), name).toHaveLength(0);
    }
  });

  it("name nothing that identifies the mechanism", () => {
    // setCamouflage() renames attributes and font families. It cannot rename a
    // word sitting inside the script, so one careless string here undoes a
    // project's whole per-site signature.
    const banned = [
      "shield", "Shield", "puzzle", "decoy", "scramble", "protect",
      "original", "plain text", "AI bot", "progress bar",
    ];
    for (const [name, src] of emitted()) {
      // TextEncoder/TextDecoder legitimately contain "encod"; nothing else may.
      const stripped = src.replace(/Text(Encoder|Decoder)/g, "");
      for (const word of banned) {
        expect(stripped.includes(word), `${name} leaks "${word}"`).toBe(false);
      }
    }
  });

  it("cannot be cut in half by a camouflage value", () => {
    // An HTML parser closes a <script> at the first literal "</", whatever the
    // JavaScript quoting says — so a camouflage value carrying one used to end
    // the script early and spill the remainder into the page as visible text.
    // JSON.stringify does not escape it; the js() helper does.
    const hostile = "</script><b>x";
    const srcs = [
      noticeScript({ attr: "data-x", flag: hostile, logPrefix: hostile, storePrefix: hostile, family: hostile }),
      solverScript({ attr: "data-x", flag: hostile, logPrefix: hostile, storePrefix: hostile }),
      copyGuardScript({ attr: "data-x", flag: hostile }),
    ];
    for (const src of srcs) {
      expect(src).not.toContain("</script");
      expect(src).toContain("\\u003c/script");
      // Still valid JavaScript afterwards — an escape that broke the parse
      // would be a worse bug than the one it fixed.
      expect(() => new Script(src)).not.toThrow();
    }
  });

  it("reference only elements the server actually renders", () => {
    // The break that motivated this file: the script wrote into `-short` after
    // the markup had been renamed to `-say-full`, so the sentence was never
    // filled and a screen reader had nothing to read. Nothing type-checks the
    // join between these two halves, so assert it.
    const notice = noticeScript({ ...NAMES, family: "Optik a8f3" });
    // `-full]` alone would match `-say-full]`, which is the element we WANT.
    for (const dead of ["-short]", "-tip]", "-tip-panel]", "[' + A + '-full]"]) {
      expect(notice.includes(dead), `writes into removed ${dead}`).toBe(false);
    }
    expect(notice).toContain("-say-full]");
  });
});
