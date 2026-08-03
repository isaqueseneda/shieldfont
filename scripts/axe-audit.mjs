/**
 * An axe scan of both rendered shapes — wrapper drawn and control clipped —
 * before and after the unlock.
 *
 * ## Why this exists
 *
 * `docs/plain-text-mode.md` carried a table saying most switch combinations
 * "Pass" WCAG 2.2, while ROADMAP.md said in the same repository
 * that **no axe scan has ever been run**. One of those was a claim and the other
 * was the truth, and a reviewer noticed. This is the scan.
 *
 * ## What a green run here does and does not prove
 *
 * axe-core checks roughly a third of WCAG, and only the machine-checkable third:
 * contrast ratios, accessible names, ARIA validity, landmark and heading
 * structure. It cannot judge whether the words a screen reader is given are the
 * words on the screen, which is the entire question this library raises. So:
 *
 *   - a FAILURE here is proof of a defect;
 *   - a PASS here is not proof of conformance, and no document in this repo may
 *     use this run to claim one.
 *
 * The two things axe genuinely settles for us are contrast (SC 1.4.3) and
 * accessible names on the controls (SC 4.1.2), both of which were guesses.
 *
 * ## The two states
 *
 * The interesting state is not the loaded page — it is the page AFTER Uncover,
 * where a live region appears, buttons change name, and the revealed text
 * becomes a Tab stop. Nothing had ever scanned that, so it is scanned here with
 * a deliberately short puzzle.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { serveFixture, BLOCKS } from "./lib/a11y-fixture.mjs";

const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

/** WCAG 2.0/2.1/2.2 A and AA. Best-practice rules are excluded deliberately:
 *  they are opinions, not criteria, and this run is about a conformance claim. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page, label, out) {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
    TAGS,
  );
  // INCOMPLETE IS NOT A PASS. axe returns three buckets and the third is the
  // one that matters here: checks it could not decide. Contrast lands there
  // whenever a colour is inherited or composited — which is this component's
  // normal case, since the strip inherits `currentColor` from the host page.
  // Reporting only `violations` would let a wall of undecided contrast checks
  // read as a clean bill of health, which is the precise mistake this scan was
  // added to stop being made.
  out.push({
    label,
    violations: res.violations,
    incomplete: res.incomplete,
    passes: res.passes.length,
    ran: res.passes.concat(res.violations, res.incomplete).map((r) => r.id),
  });
  return res;
}

const { origin, close } = await serveFixture();
const browser = await chromium.launch();
const results = [];

try {
  for (const [path, label] of [
    ["/", "control clipped, loaded"],
    ["/full", "wrapper drawn, loaded"],
  ]) {
    const page = await browser.newPage();
    await page.goto(origin + path, { waitUntil: "networkidle" });
    await scan(page, label, results);

    // Then the state nothing had ever looked at.
    //
    // Dispatched rather than clicked. Without the wrapper the control is
    // deliberately clipped to a 1px box off-screen, so a real pointer click
    // lands on whatever is painted over it and Playwright retries until it
    // times out — which is the harness failing, not the page.
    const pressed = await page
      .locator("button")
      .filter({ hasText: /uncover|show/i })
      .first()
      .evaluate((el) => (el.click(), true))
      .catch(() => false);

    if (pressed) {
      // Wait for the WORDS, not for a timer. A sleep long enough to be safe on
      // CI is wasted locally and a sleep tuned locally makes CI flake; this repo
      // has lost three runs to exactly that. The plain text appearing anywhere
      // in the accessibility tree is the thing being waited for, so wait for it.
      await page
        .waitForFunction((want) => document.body.innerText.includes(want), BLOCKS[1].text, {
          timeout: 120_000,
        })
        .catch(() => console.log(`  (${label}: unlock never completed — scanning anyway)`));
      await scan(page, label.replace("loaded", "after Uncover"), results);
    }
    await page.close();
  }
} finally {
  await browser.close();
  close();
}

let failed = 0;
for (const r of results) {
  const n = r.violations.length;
  failed += n;
  console.log(
    `\n${r.label} — ${r.passes} passed, ${n} violation(s), ${r.incomplete.length} undecided`,
  );
  // Named explicitly, because "0 violations" is meaningless if the rule that
  // would have caught the defect never executed on this page.
  console.log(`  contrast rule ran: ${r.ran.includes("color-contrast") ? "yes" : "NO"}`);
  for (const v of r.incomplete) {
    console.log(`  [undecided] ${v.id}: ${v.nodes.length} node(s)`);
    for (const node of v.nodes.slice(0, 2)) {
      for (const c of [...node.any, ...node.all]) console.log(`      ${c.message}`);
    }
  }
  for (const v of r.violations) {
    console.log(`  [${v.impact}] ${v.id}: ${v.help}`);
    console.log(`    ${v.tags.filter((t) => t.startsWith("wcag")).join(" ")}`);
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`    → ${node.html.slice(0, 140)}`);
      for (const c of [...node.any, ...node.all]) console.log(`      ${c.message}`);
    }
    if (v.nodes.length > 3) console.log(`    …and ${v.nodes.length - 3} more`);
  }
}

console.log(
  `\naxe-core ${JSON.parse(readFileSync("node_modules/axe-core/package.json", "utf8")).version}` +
    ` · ${TAGS.join(", ")} · ${failed} violation(s) total`,
);
process.exit(failed ? 1 : 0);
