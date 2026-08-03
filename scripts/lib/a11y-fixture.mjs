/**
 * The page both screen-reader audits run against, and the server that hosts it.
 *
 * Extracted from a11y-audit.mjs when the NVDA audit arrived. There are now two
 * harnesses — one driving a simulated accessibility tree in-page, one driving
 * REAL NVDA from Node on a Windows runner — and they have to agree on the
 * fixture or their results cannot be compared. Two copies of these four blocks
 * would drift within a release, and the whole value of the NVDA run is that it
 * measures the same page the virtual reader already measured.
 *
 * WHY IT IS SERVED OVER http://localhost RATHER THAN file:// OR setContent.
 * Three reasons, each learned the hard way:
 *
 *   - `crypto.subtle` exists only in a secure context, and localhost is one.
 *     The whole mode depends on it.
 *   - Both fixtures draw themselves from an emitted <script> that wires at
 *     DOMContentLoaded. `page.setContent()` does not give it one, so an audit
 *     built that way walks the PREVIOUS page and reports missing buttons that
 *     were never rendered.
 *   - The bundled woff2s have to be reachable. Without them the font guard does
 *     exactly what it should — declares the page broken and skeletonises every
 *     block — which is correct behaviour that would nonetheless make the
 *     fixture unrepresentative of a real deployment.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Shield, withShieldRenderPass } from "../../packages/react/dist/Shield.js";

const require = createRequire(import.meta.url);

/** Short puzzles: these audit behaviour, not the difficulty calibration. */
export const A11Y = { mode: "text", seconds: 5 };

/**
 * The ordinal counts within its own noun, not across the page: a listener
 * hunting "the second heading" must hear a number that exists on the page. Two
 * paragraphs are included so per-noun counting is actually exercised — with one
 * of each tag, a page-wide counter would pass by accident.
 */
export const BLOCKS = [
  { as: "h2", text: "Manifesto for the open web", noun: "heading 1" },
  {
    as: "p",
    noun: "paragraph 1",
    text: "The future of writing belongs to those who write it, and the shapes that carry those words are not neutral.",
  },
  {
    as: "blockquote",
    noun: "quote 1",
    text: "A tax on attention is the only tax a crawler cannot refuse to pay.",
  },
  {
    as: "p",
    noun: "paragraph 2",
    text: "Every sentence you publish feeds a machine that never stopped to ask you first.",
  },
];

/**
 * Words the encoder actually swaps in this fixture — a screen reader must never
 * say any of them. Not "words from the source text": the mapping passes unknown
 * words through unchanged, so asserting on those would fail for a reason that
 * has nothing to do with what a reader hears.
 */
export const DECOY_MARKERS = ["derives", "primer", "keep it"];

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** All four blocks with `wrapper: false` — the clipped off-screen control. */
export const clippedHtml = page(
  "audit",
  withShieldRenderPass(() =>
    renderToStaticMarkup(
      h(
        "main",
        null,
        h("h1", null, "Audit page"),
        h("p", null, "Ordinary text, for contrast."),
        ...BLOCKS.map((b) =>
          h(Shield, { as: b.as, a11y: A11Y, wrapper: false, children: b.text }),
        ),
      ),
    ),
  ),
);

/** Two blocks with the wrapper drawn, which is what a bare <Shield> renders. */
export const drawnHtml = page(
  "audit full",
  withShieldRenderPass(() =>
    renderToStaticMarkup(
      h(
        "main",
        null,
        h("h1", null, "Audit page"),
        ...BLOCKS.slice(0, 2).map((b) => h(Shield, { as: b.as, a11y: A11Y, children: b.text })),
      ),
    ),
  ),
);

/**
 * Serve both pages, the fonts, and (optionally) the virtual screen reader.
 *
 * `withVsr` is false for the NVDA run: that harness drives a real reader from
 * Node and has no use for a module the page would import.
 *
 * Routes: `/` → clipped, `/full` → drawn, `/fonts/*` → the bundled woff2s.
 */
export async function serveFixture({ withVsr = false } = {}) {
  const fontDir = new URL("../../packages/react/fonts/", import.meta.url);
  // Resolved via the package's own package.json rather than a deep path: the
  // package's `exports` map does not expose lib/, and a hard-coded node_modules
  // path breaks under hoisting.
  const vsr = withVsr
    ? readFileSync(
        join(
          dirname(require.resolve("@guidepup/virtual-screen-reader/package.json")),
          "lib/esm/index.browser.js",
        ),
        "utf8",
      )
    : null;

  const server = createServer((req, res) => {
    if (vsr && req.url.startsWith("/vsr.js")) {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(vsr);
    }
    if (req.url.startsWith("/fonts/")) {
      try {
        const buf = readFileSync(new URL(req.url.slice("/fonts/".length), fontDir));
        res.writeHead(200, { "content-type": "font/woff2" });
        return res.end(buf);
      } catch {
        return res.writeHead(404).end();
      }
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url.startsWith("/full") ? drawnHtml : clippedHtml);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://localhost:${server.address().port}`,
    close: () => server.close(),
  };
}
