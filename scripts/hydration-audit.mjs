/**
 * Hydration audit for `<Shield a11y={{ mode: "text" }}>`.
 *
 * Run with `npm run test:hydration`. Not part of `npm test`, for the same
 * reason as the screen-reader audit beside it: it drives a real browser, which
 * is too heavy for the unit-test loop.
 *
 * ## What it guards
 *
 * The solver script runs at parse time. It has to — it works without React,
 * without a bundler, and on a static export. That puts it in a race with
 * hydration on any page that hydrates, and the package loses that race by
 * design: the script mutates the DOM first and React arrives afterwards to
 * check the page against what it rendered.
 *
 * The expensive case is the RETURN VISIT. `wire()` looks in localStorage before
 * anything else, and a hit reveals immediately — which used to mean writing
 * text into two elements React had server-rendered EMPTY (the live-region
 * status line and the output element). React then found children it had not
 * rendered and threw: measured at four #418 recoverable errors plus one #423,
 * in a PRODUCTION build, in both reveal modes. It fired for every returning
 * reader of every shielded page, which is precisely the audience the cache
 * exists to serve.
 *
 * The fix is two props: both elements render with an empty
 * `dangerouslySetInnerHTML`, which gives them no child fibers, so React neither
 * hydrates nor reconciles inside them. Nothing in the unit suite can see that.
 * Every one of those tests passed identically before and after the fix, because
 * they assert on the React element tree and this is a property of what a
 * BROWSER does with that tree over time. Delete either prop and this script
 * fails; `npm test` stays green.
 *
 * ## Why it renders and hydrates in the same page
 *
 * One element object is server-rendered and then hydrated, so the sealed
 * payload is byte-identical on both sides and the only difference between the
 * two DOMs is whatever the solver did in between. That is the whole experiment,
 * and it is why `sealText` is stubbed in the browser bundle: the real one seals
 * with `node:crypto` and is RANDOM, so a second render would produce a second
 * payload and manufacture a mismatch that has nothing to do with what is being
 * tested. The seal is done once, here, with the real implementation.
 *
 * React is bundled in its PRODUCTION build on purpose. Development React is
 * louder about mismatches, and being louder is not the point: production is
 * what ships, and production is where this failure was silent enough to survive
 * a release.
 *
 * ## The self-check, which is not optional
 *
 * The first version of this probe reported a clean pass against a build that
 * still had the bug. The bundle was executing mid-parse, so the solver found
 * `readyState === 'loading'`, deferred itself to DOMContentLoaded, and ended up
 * sweeping AFTER hydration — the race resolving the harmless way, on a page
 * where nothing was being tested. A probe that cannot fail is worse than no
 * probe, so this one asserts that the text was already on the page BEFORE
 * hydration ran, and fails with a distinct message if it was not.
 */
import { createServer } from "node:http";
import { chromium } from "playwright";
import { build } from "esbuild";
import { sealText } from "../packages/core/dist/puzzle.js";

const SHIELD = new URL("../packages/react/dist/index.js", import.meta.url).pathname;
const TEXT = "The future of writing belongs to those who write it.";
const PLAIN = "the plain text this reader unlocked on an earlier visit";

/**
 * Stands in for `@shieldfont/core/puzzle` inside the browser bundle: hands back
 * the one payload sealed below, so both renders see the same bytes. See the
 * header for why this is load-bearing rather than a convenience.
 */
const stubPuzzle = {
  name: "stub-puzzle",
  setup(b) {
    b.onResolve({ filter: /^@shieldfont\/core\/puzzle$/ }, () => ({
      path: "stub-puzzle",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `export const DEFAULT_SECONDS = 20;
                 export function sealText() { return window.__SEALED__; }`,
      loader: "js",
    }));
  },
};

const ENTRY_TEMPLATE = `
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { hydrateRoot } from "react-dom/client";
import { Shield } from ${JSON.stringify(SHIELD)};

const probe = { recoverable: [] };
window.__probe = probe;

// Stage nothing until the document has finished loading. The solver only
// sweeps synchronously once readyState is past 'loading'; run this mid-parse
// and it defers itself to DOMContentLoaded, which lands after hydrateRoot and
// quietly turns the audit into a no-op that always passes.
if (document.readyState !== "complete") {
  await new Promise((r) => window.addEventListener("load", r, { once: true }));
}

const el = React.createElement(
  Shield,
  // wrapper:false — the clipped off-screen control, which is what this audit
  // is about. The race it exercises is the SOLVER's: cached text written into
  // the DOM before hydrateRoot runs. Since 0.3.2 a bare <Shield> draws the
  // wrapper, whose browser half is a different script with a different reveal
  // path, so the fixture quietly stopped rendering the thing under test.
  { as: "p", wrapper: false, a11y: { mode: "text", seconds: 5, reveal: window.__REVEAL__ } },
  ${JSON.stringify(TEXT)},
);

const root = document.getElementById("root");
root.innerHTML = renderToStaticMarkup(el);

// Arrive as a reader who unlocked this block on an earlier visit: the solver
// derives its key from the camouflage attribute plus the first 40 characters
// of the ciphertext.
// AN ARRAY SINCE 0.3.2 — the real payload rides among decoys. The cache key is
// derived from the block's OWN ciphertext, so this has to pick the same one the
// emitted solver will, by the same rule (djb2 over the block key, mod length).
// Taking [0] would pass here only because the stub below makes all four
// identical, and would then hide a real mismatch the day it stopped.
const payloads = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
const key = root.querySelector("[data-typeface-solve]").getAttribute("data-typeface-solve-for") || "";
let hh = 5381;
for (let i = 0; i < key.length; i++) hh = ((hh << 5) + hh + key.charCodeAt(i)) >>> 0;
const data = Array.isArray(payloads) ? payloads[hh % payloads.length] : payloads;
localStorage.setItem("data-typeface-" + data.ct.slice(0, 40), ${JSON.stringify("__ANSWER__")});

// The real emitted solver, run at the moment a parser would reach it.
const solver = [...root.querySelectorAll("script:not([type])")]
  .map((s) => s.textContent)
  .find((t) => t.includes("-solve"));
if (!solver) throw new Error("no solver script in the rendered markup");
(0, eval)(solver);

const read = () => ({
  out: root.querySelector("[data-typeface-out]")?.textContent ?? null,
  status: root.querySelector("[data-typeface-status]")?.textContent ?? null,
});
probe.before = read();

hydrateRoot(root, el, {
  onRecoverableError: (err) => probe.recoverable.push(String((err && err.message) || err)),
});

// Long enough for hydration, for any recovery re-render, and for the resweep
// the solver's MutationObserver would make in response to one, all to settle.
setTimeout(() => { probe.after = read(); probe.done = true; }, 500);
`;

const sealed = sealText(TEXT, { seconds: 5 });

/* THE CACHE HOLDS THE PUZZLE'S ANSWER, NOT THE TEXT.
   This audit used to seed localStorage with the plaintext, which is what the
   solver stored until 0.3.2 — it caches the answer hex now and decrypts on
   arrival, so that a browser that has "unlocked" a block is holding a number
   rather than somebody's article. A seeded plaintext no longer opens, the
   solver discards it as corrupt, and the audit reported "the race was not
   exercised" — correctly, and for a reason two layers away from what it prints.

   Computed here rather than by driving a real solve, so the audit stays a
   single page load: same sequential squaring the browser does, same canonical
   fixed-width hex the key derivation expects. ~1.25M squarings at seconds:5,
   which is a second or two in Node. */
const answerHex = (() => {
  const n = BigInt(sealed.n);
  let x = 2n;
  for (let i = 0; i < sealed.t; i++) x = (x * x) % n;
  return x.toString(16).padStart(n.toString(16).length, "0");
})();
const bundle = await build({
  stdin: { contents: ENTRY_TEMPLATE.replace("__ANSWER__", answerHex), resolveDir: process.cwd(), loader: "js" },
  bundle: true,
  format: "esm",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [stubPuzzle],
});
const js = bundle.outputFiles[0].text;

const server = createServer((req, res) => {
  const [path, query] = req.url.split("?");
  if (path === "/bundle.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(js);
    return;
  }
  const reveal = new URLSearchParams(query).get("reveal") ?? "hidden";
  res.writeHead(200, { "content-type": "text/html" }).end(
    `<!doctype html><meta charset="utf-8"><title>hydration audit</title><div id="root"></div>
     <script>window.__REVEAL__=${JSON.stringify(reveal)};` +
      `window.__SEALED__=${JSON.stringify(sealed)}</script>
     <script type="module" src="/bundle.js"></script>`,
  );
});
// localhost, not file:// or setContent: localStorage needs a real origin.
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const failures = [];

// Both reveal modes. The textContent write is NOT gated on the mode — only the
// hiding of the encoded block is — so "hidden", the default, is as exposed as
// "visible" and the original report of this bug missed that.
for (const reveal of ["hidden", "visible"]) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${origin}/?reveal=${reveal}`);
  await page.waitForFunction(() => window.__probe?.done, null, { timeout: 20000 });
  const p = await page.evaluate(() => window.__probe);
  await page.close();

  const label = `reveal="${reveal}"`;

  // THE SELF-CHECK, INVERTED IN 0.3.2 — and the inversion IS the new race.
  //
  // This used to require the cached text to be on the page BEFORE hydrateRoot.
  // That was right while localStorage held the plaintext: the solver read it
  // and wrote it straight in, synchronously, so React hydrated over content
  // that was already there. The cache now holds the puzzle's ANSWER — a number,
  // not somebody's article — so opening it goes through crypto.subtle and lands
  // a tick or two later, AFTER React has hydrated.
  //
  // So the danger moved rather than going away. React now hydrates an EMPTY
  // output node and the decrypt writes into it afterwards, which is the exact
  // thing renderPuzzle's empty dangerouslySetInnerHTML exists to survive: React
  // must not own that subtree, or the next render deletes the words a reader
  // waited for. That is what is asserted below.
  if (p.before.out !== "") {
    failures.push(
      `${label}: the audit did not exercise the race — the output already had ` +
        `content before hydration (saw ${JSON.stringify(p.before.out)}), so React ` +
        `never hydrated over an empty node and the assertions below prove nothing.`,
    );
    continue;
  }

  if (p.recoverable.length > 0) {
    failures.push(
      `${label}: React reported ${p.recoverable.length} hydration error(s) — the solver ` +
        `is writing into nodes React reconciles. Check that the status line and the ` +
        `output element still render with dangerouslySetInnerHTML in renderPuzzle().\n` +
        p.recoverable.map((e) => `    ${e}`).join("\n"),
    );
  }
  if (pageErrors.length > 0) failures.push(`${label}: page error(s): ${pageErrors.join("; ")}`);
  // TEXT, not PLAIN. The fixture seals TEXT and the answer decrypts to it; PLAIN
  // was the string this audit used to SEED the cache with back when the cache
  // held plaintext, and asserting on it survived the change to answer-caching as
  // a comparison that could never be true whatever the component did.
  if (p.after.out !== TEXT) {
    failures.push(
      `${label}: the unlocked text did not survive hydration ` +
        `(saw ${JSON.stringify(p.after.out)}, wanted ${JSON.stringify(TEXT)}).`,
    );
  }
  if (failures.length === 0 || !failures.some((f) => f.startsWith(label))) {
    console.log(`✓ ${label}: decrypt landed after hydration, survived, no React errors`);
  }
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n✗ hydration audit failed\n\n${failures.map((f) => `  ${f}`).join("\n\n")}\n`);
  process.exit(1);
}
console.log("\n✓ hydration audit passed");
