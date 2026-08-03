/**
 * The wrapper, measured inside host pages that are actively trying to break it.
 *
 * ## Why this exists
 *
 * The drawn wrapper is injected into somebody else's document and inherits
 * somebody else's CSS. Everything we know about how it survives that came from
 * looking at it on pages we wrote ourselves, which is the one population where
 * it cannot fail. The bug report that started this file was one sentence long —
 * "in dark mode the Uncover button gets all fucked" — and nobody could say what
 * "fucked" meant, because there was no way to ask the question in numbers.
 *
 * So this renders the wrapper inside seventeen hostile hosts and MEASURES.
 * Every cell in the table it prints is a number or a boolean read out of a live
 * Chromium, not a screenshot somebody squinted at.
 *
 * ## The measurement that had already been got wrong once
 *
 * `getComputedStyle(el).opacity` reports the ELEMENT'S OWN opacity and nothing
 * else. An ancestor painting the whole subtree at 0.7 does not appear anywhere
 * in a descendant's computed style, so a naive contrast check reads the child's
 * `color` at face value and reports a pass. That is exactly how an axe run once
 * declared the strip's sentence clean while it sat at 3.24:1 (see the table in
 * notice.ts above `opacity:.7`).
 *
 * `paintedBg()` and `paintedInk()` below therefore walk the whole ancestor
 * chain from the root down, multiply opacity as they go, and alpha-composite
 * each ancestor's background in paint order over the UA canvas colour — which
 * is itself read from the page with a `background: Canvas` probe, so it tracks
 * `color-scheme` and forced-colors instead of being assumed white.
 *
 * ## What a green run here does and does not prove
 *
 * Same disclaimer the axe scan carries. This settles seventeen hosts. It says
 * nothing about the eighteenth, and one of the seventeen is here to show that
 * the limit is real: the wrapper inherits the host's text colour on purpose, so
 * a host whose own body text already fails contrast hands us a failure we can
 * measure and cannot fix. Such hosts are listed in KNOWN below with the reason
 * naming what would have to be abandoned, and they are reported, not hidden.
 *
 * ## Why it does not use serveFixture()
 *
 * `scripts/lib/a11y-fixture.mjs` serves two fixed pages, which is the right
 * shape for the screen-reader audits: they need one page both harnesses agree
 * on. This needs seventeen pages that differ only in the host's stylesheet. The
 * BLOCKS and A11Y it renders are imported from there, so the content under test
 * is the same content the other audits use.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Shield, withShieldRenderPass } from "../packages/react/dist/Shield.js";
import { BLOCKS, A11Y } from "./lib/a11y-fixture.mjs";

const ATTR = "data-typeface";

/* ---------------------------------------------------------------- the hosts */

/**
 * Tailwind's Preflight, the three rules of it that touch this component. Copied
 * from tailwindcss/src/css/preflight.css rather than paraphrased, because the
 * point of the test is that it is the real thing: `border: 0 solid` and
 * `background-color: transparent` are what actually strip a button on the most
 * widely deployed reset in the world.
 */
const PREFLIGHT = `
*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:currentColor}
html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:ui-sans-serif,system-ui,sans-serif}
body{margin:0;line-height:inherit}
button,[type='button']{font-family:inherit;font-feature-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}
button{background-color:transparent;background-image:none;text-transform:none;-webkit-appearance:button}
svg{display:block;vertical-align:middle}
progress{vertical-align:baseline}
`;

/**
 * A 1990s-vintage reset plus the parts of normalize.css that reach a button.
 * The `* { margin:0; padding:0 }` half is what makes it interesting: it is one
 * of the few rules that can subtract the strip's inset without naming it.
 */
const HARD_RESET = `
*{margin:0;padding:0;box-sizing:border-box}
button,input,select,textarea{font:inherit;color:inherit;background:none;border:none}
svg{display:block}
progress{display:block}
`;

const HOSTS = [
  {
    id: "baseline",
    label: "baseline (white host, no CSS)",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "dark-scheme",
    label: "dark, host declares color-scheme",
    scheme: "dark",
    css: ":root{color-scheme:dark}body{font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "dark-bg-only",
    label: "dark, host paints its own theme only",
    scheme: "dark",
    // No `color-scheme`. This is the overwhelmingly common shape of a
    // hand-rolled dark theme, and it is the host the bug report came from.
    css: "body{background:#111;color:#eee;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "dark-host-light-os",
    label: "dark host, OS says light",
    scheme: "light",
    css: "body{background:#0b0b0b;color:#f5f5f5;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "light-host-dark-os",
    label: "light host, OS says dark",
    scheme: "dark",
    css: ":root{color-scheme:light}body{background:#fff;color:#1a1a1a;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "tailwind-preflight",
    label: "Tailwind Preflight",
    css: PREFLIGHT + "body{background:#fff;color:#374151;padding:24px}",
  },
  {
    id: "tailwind-dark",
    label: "Tailwind Preflight, dark theme",
    scheme: "dark",
    css: PREFLIGHT + "body{background:#0f172a;color:#e2e8f0;padding:24px}",
  },
  {
    id: "hard-reset",
    label: "classic reset (* margin/padding 0)",
    css: HARD_RESET + "body{background:#fff;color:#333;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "button-all-unset",
    label: "button { all: unset }",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}button{all:unset}",
  },
  {
    id: "font-size-inherit",
    label: "button font-size:inherit !important, 22px body",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;font-size:22px;padding:24px}button{font-size:inherit !important}",
  },
  {
    id: "line-height-1",
    label: "* { line-height: 1 !important }",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}*{line-height:1 !important}",
  },
  {
    id: "svg-full-width",
    label: "global svg { width: 100% }",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}svg{width:100%;height:auto}",
  },
  {
    id: "forced-colors",
    label: "forced-colors: active (Windows HCM)",
    forcedColors: "active",
    scheme: "dark",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "root-24px",
    label: "root font-size 24px",
    css: "html{font-size:24px}body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "root-10px",
    label: "root font-size 10px",
    css: "html{font-size:10px}body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}",
  },
  {
    id: "rtl",
    label: 'dir="rtl"',
    dir: "rtl",
    css: "body{background:#fff;color:#222;font-family:system-ui,sans-serif;padding:24px}",
  },
  // THE HOST WE CANNOT FIX, kept in the run so the claim is a measurement
  // rather than a caveat in a comment. `#8a8a8a` on white measures 3.45:1 — the
  // host's own body text fails SC 1.4.3 before this component renders a single
  // pixel. The wrapper inherits that colour on purpose, so everything in the
  // strip inherits the failure, and the only way out would be to stop
  // inheriting and impose a palette, which would make the wrapper a foreign
  // object on every well-built page in order to rescue a badly built one.
  //
  // It is also the one host where the light/dark derivations in notice.ts are
  // guessing. They read the page's polarity off `currentColor`'s lightness,
  // which is exact at both ends and undefined in the middle: at #8a8a8a the
  // crossover lands on "the page is dark" and the toast comes out light green
  // on white at 1.42:1. That ambiguity only exists for a text colour that is
  // already failing, which is the same sentence as everything above. The
  // Uncover button survives it — its glyphs are derived against the FILL, which
  // is that same mid-grey, so it reads 6.08:1 here. See KNOWN.
  {
    id: "host-below-the-line",
    label: "host body text already fails (#8a8a8a)",
    css: "body{background:#fff;color:#8a8a8a;font-family:system-ui,sans-serif;padding:24px}",
  },
];

/* ------------------------------------------------------------ the fixture */

const body = withShieldRenderPass(() =>
  renderToStaticMarkup(
    h(
      "main",
      null,
      h("h1", null, "Host page"),
      h("p", null, "Ordinary host text, for comparison."),
      ...BLOCKS.slice(0, 2).map((b) => h(Shield, { as: b.as, a11y: A11Y, children: b.text })),
    ),
  ),
);

const pageFor = (host) =>
  `<!doctype html><html lang="en"${host.dir ? ` dir="${host.dir}"` : ""}>` +
  `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${host.label}</title><style>${host.css}</style></head>` +
  `<body>${body}</body></html>`;

async function serve() {
  const fontDir = new URL("../packages/react/fonts/", import.meta.url);
  const server = createServer((req, res) => {
    if (req.url.startsWith("/fonts/")) {
      try {
        const buf = readFileSync(new URL(req.url.slice("/fonts/".length), fontDir));
        res.writeHead(200, { "content-type": "font/woff2" });
        return res.end(buf);
      } catch {
        return res.writeHead(404).end();
      }
    }
    const host = HOSTS.find((x) => req.url === "/h/" + x.id);
    if (!host) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageFor(host));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://localhost:${server.address().port}`, close: () => server.close() };
}

/* ------------------------------------------------- the in-page measurement */

/**
 * Runs inside the page, once per STATE. Everything it returns is read off live
 * layout and computed style; nothing is inferred from the stylesheet we shipped.
 *
 * The three states are the three the emitted script actually produces:
 *
 *   idle    what a reader sees on arrival
 *   toast   the copy confirmation, laid over the sentence
 *   busy    the grind: buttons dimmed by `-off`, the progress row over the row
 *
 * `busy` and `toast` are reached by setting the same attributes `paintStrip`
 * sets, with transitions killed first — the toast fades in over 220 ms and a
 * measurement taken mid-transition is a measurement of nothing.
 */
function measure([A, state]) {
  /* ---- colour arithmetic -------------------------------------------- */

  // Colours are resolved by PAINTING them, not by parsing the string. A
  // computed value in this component can come back as `rgb()`, `rgba()`,
  // `color(srgb …)` or `oklch(…)` depending on which syntax produced it, and a
  // regex that knows only the first two silently returns null for the exact
  // declarations this audit was written to check.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (s) => {
    const v = String(s || "").trim();
    if (!v || v === "transparent" || v === "none") return [0, 0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    // A rejected value leaves fillStyle untouched, so seed it with something
    // no stylesheet here uses and treat "unchanged" as "did not parse".
    ctx.fillStyle = "#010203";
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    if (d[0] === 1 && d[1] === 2 && d[2] === 3 && d[3] === 255) return null;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  // Source-over compositing. `dst` is always opaque by construction.
  const over = (src, dst) => {
    const a = src[3];
    return [0, 1, 2].map((i) => src[i] * a + dst[i] * (1 - a));
  };
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return r2((x + 0.05) / (y + 0.05));
  };

  /* ---- the UA canvas, as THIS page resolves it ----------------------- */
  // Not assumed white. `Canvas` follows `color-scheme` and forced-colors, and
  // the difference between what it resolves to and what the host actually
  // paints is the entire bug this audit was written for.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:0;background-color:Canvas";
  document.documentElement.appendChild(probe);
  const CANVAS = parse(getComputedStyle(probe).backgroundColor) || [255, 255, 255, 1];
  probe.remove();
  const BASE = CANVAS[3] > 0 ? over(CANVAS, [255, 255, 255]) : [255, 255, 255];

  /* ---- the chain walk, which is the whole point of this file ---------- */
  const chainOf = (el) => {
    const out = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) out.push(n);
    return out.reverse();
  };
  /**
   * Cumulative opacity applied to `el` by itself AND every ancestor.
   *
   * This is the number `getComputedStyle` will not give you. A child of an
   * element at `opacity:.7` reports its own opacity as 1, and a contrast check
   * that believes it reads a colour that is never painted. It has produced one
   * false all-clear in this repository already.
   */
  const cumOpacity = (el) =>
    chainOf(el).reduce((acc, n) => {
      const o = parseFloat(getComputedStyle(n).opacity);
      return acc * (Number.isNaN(o) ? 1 : o);
    }, 1);
  /** What is actually painted behind `el`'s own text, `el`'s background included. */
  const paintedBg = (el) => {
    if (!el) return BASE.slice();
    let out = BASE.slice();
    let cum = 1;
    for (const n of chainOf(el)) {
      const cs = getComputedStyle(n);
      const o = parseFloat(cs.opacity);
      cum *= Number.isNaN(o) ? 1 : o;
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) out = over([bg[0], bg[1], bg[2], bg[3] * cum], out);
    }
    return out;
  };
  /** The colour a run of text in `el` is actually painted, after everything. */
  const paintedInk = (el, prop) => {
    if (!el) return null;
    const c = parse(getComputedStyle(el)[prop || "color"]);
    if (!c) return null;
    const cum = cumOpacity(el);
    return over([c[0], c[1], c[2], c[3] * cum], paintedBg(el));
  };
  const ratioAt = (el, prop) => {
    const ink = paintedInk(el, prop);
    return ink ? contrast(ink, paintedBg(el)) : null;
  };

  /* ---- put the frame into the requested state ------------------------ */
  const frame = document.querySelector("[" + A + "-frame]");
  if (!frame) return { error: "no frame rendered" };
  const strip = frame.querySelector("[" + A + "-strip]");
  const kill = (el) => el && (el.style.transition = "none");
  const acts = [...frame.querySelectorAll("[" + A + "-act]")];
  if (state === "toast") {
    kill(strip.querySelector("[" + A + "-toast]"));
    strip.setAttribute(A + "-toasting", "ok");
  }
  if (state === "busy") {
    strip.setAttribute(A + "-loading", "");
    const prog = strip.querySelector("[" + A + "-prog]");
    if (prog) prog.hidden = false;
    for (const b of acts) {
      b.hidden = false;
      b.setAttribute(A + "-off", "");
      kill(b);
    }
  }
  // Force layout so everything above is reflected before anything is read.
  void frame.getBoundingClientRect();

  const vis = (el) => el && !el.hidden && getComputedStyle(el).display !== "none";
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r2(r.width), h: r2(r.height) };
  };

  /* ---- the controls -------------------------------------------------- */
  const buttons = acts.filter(vis).map((b) => {
    const cs = getComputedStyle(b);
    const r = rect(b);
    const outside = paintedBg(b.parentElement);
    const cum = cumOpacity(b);
    const own = parse(cs.backgroundColor) || [0, 0, 0, 0];
    const fill = over([own[0], own[1], own[2], own[3] * cum], outside);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = parse(cs.borderTopColor) || [0, 0, 0, 0];
    const borderInk =
      bw > 0 && cs.borderTopStyle !== "none" && bc[3] > 0
        ? over([bc[0], bc[1], bc[2], bc[3] * cum], outside)
        : null;

    const label = b.querySelector("span");
    const svg = b.querySelector("svg");
    const svgR = svg ? rect(svg) : null;
    // The centre point, and who owns it. A control nothing can be aimed at is
    // the top-priority failure in this file, above any contrast number.
    const hit = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);

    return {
      act: b.getAttribute(A + "-act"),
      primary: b.hasAttribute(A + "-primary"),
      w: r.w,
      h: r.h,
      fontSize: r2(parseFloat(cs.fontSize)),
      lineHeight: cs.lineHeight,
      label: label ? label.textContent : null,
      labelRatio: label ? ratioAt(label) : null,
      // The icon is the whole of the copy control's meaning, so it is measured
      // as a graphic in its own right (SC 1.4.11, 3:1), not as decoration.
      iconRatio: svg ? contrast(paintedInk(svg, "stroke") || paintedInk(svg) || fill, fill) : null,
      iconW: svgR ? svgR.w : null,
      iconH: svgR ? svgR.h : null,
      // Fill OR border may carry the edge; a reader sees the better of the two.
      boundary: Math.max(contrast(fill, outside), borderInk ? contrast(borderInk, outside) : 0),
      // A host `line-height` or `font-size` big enough to push the label out of
      // the pill shows up here and nowhere else.
      clipped: b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1,
      hittable: !!hit && (hit === b || b.contains(hit)),
      hitOwner: hit ? hit.tagName.toLowerCase() : null,
    };
  });

  /* ---- overflow ------------------------------------------------------ */
  const fr = frame.getBoundingClientRect();
  let bleed = 0;
  let bleeder = null;
  for (const n of frame.querySelectorAll("*")) {
    if (!vis(n)) continue;
    const cs = getComputedStyle(n);
    if (cs.position === "absolute" || cs.position === "fixed") continue;
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const d = Math.max(fr.left - r.left, r.right - fr.right);
    if (d > bleed) {
      bleed = d;
      bleeder = n.tagName.toLowerCase() + (n.getAttribute(A + "-act") || "");
    }
  }

  const icons = [...frame.querySelectorAll("svg")]
    .filter((s) => vis(s) && vis(s.parentElement))
    .map((s) => rect(s));

  const seen = frame.querySelector("[" + A + "-seen]");
  const toast = strip.querySelector("[" + A + "-toast]");
  const est = frame.querySelector("[" + A + "-est]");

  return {
    state,
    canvas: `rgb(${CANVAS.slice(0, 3).map(Math.round).join(",")})`,
    sentence: {
      ratio: vis(seen) && cumOpacity(seen) > 0.01 ? ratioAt(seen) : null,
      fontSize: seen ? r2(parseFloat(getComputedStyle(seen).fontSize)) : null,
    },
    // The host's own body text, measured the same way. It is the CEILING: the
    // wrapper inherits this colour on purpose, so nothing inside it can beat
    // this number, and a host below 4.5 hands us a failure we cannot fix.
    hostBody: ratioAt(document.querySelector("main > p")),
    toast: state === "toast" && vis(toast) ? ratioAt(toast) : null,
    est: state === "busy" && vis(est) ? ratioAt(est) : null,
    buttons,
    overflowStrip: strip ? r2(Math.max(0, strip.scrollWidth - strip.clientWidth)) : 0,
    overflowPage: r2(Math.max(0, document.documentElement.scrollWidth - window.innerWidth)),
    bleed: r2(bleed),
    bleeder,
    iconMin: icons.length ? Math.min(...icons.map((i) => Math.min(i.w, i.h))) : null,
    iconMax: icons.length ? Math.max(...icons.map((i) => Math.max(i.w, i.h))) : null,
    stripH: strip ? r2(strip.getBoundingClientRect().height) : null,
  };
}

/* ------------------------------------------------------------- thresholds */

/**
 * What counts as broken, in the priority order the fix work took.
 *
 * TEXT is 4.5:1 (SC 1.4.3). Nothing in this component is large text — the
 * sentence is 12px and the labels are smaller — so 3:1 never applies.
 *
 * GRAPHICS are 3:1 (SC 1.4.11). The copy control is icon-only, so its icon is
 * the whole of its meaning and is held to the graphics threshold.
 *
 * BOUNDARIES are 3:1 as well. It is arguable that SC 1.4.11 does not require it
 * here — both controls carry something else that identifies them, a text label
 * on one and a 14:1 icon on the other — but a pill whose edge measured 1.45:1
 * against the strip on every light host is an edge nobody can see, and the
 * argument for leaving it there was only ever that nobody had measured it. The
 * number does a second job: a host reset that DELETES the border (Tailwind
 * Preflight's `border-width:0`, `button{all:unset}`) takes it to exactly
 * 1.00:1, and no threshold above 1 can miss that.
 *
 * TARGET is 24px (SC 2.5.8, AA). LABEL_PX is not a WCAG number: it is the point
 * below which a 500-weight uppercase label with .06em tracking stops being
 * readable, and it exists because `font-size:.66rem` on a 10px-root host drew
 * the buttons at 6.6px.
 */
const MIN_TEXT = 4.5;
const MIN_GRAPHIC = 3;
const MIN_BOUNDARY = 3;
const MIN_TARGET = 24;
const MIN_LABEL_PX = 9;

/**
 * Hosts whose failures are NOT ours to fix, with the reason. A host in here
 * still prints its numbers — it is exempted from the exit code, never from the
 * table — and the reason has to name what would have to be abandoned.
 */
const KNOWN = {
  "host-below-the-line":
    "the host's own body text is 3.45:1. The wrapper inherits the host's text " +
    "colour by design, so it cannot be more legible than the page it is in. " +
    "Fixing this means hardcoding a palette, which would make the wrapper a " +
    "foreign object on every correctly built page to rescue one that is not.",
};

function judge(host, states) {
  const bad = [];
  const idle = states.idle;
  if (idle.error) return [idle.error];

  if (idle.sentence.ratio !== null && idle.sentence.ratio < MIN_TEXT) {
    // The one failure mode that may not be ours: we fade the host's own colour,
    // so a host already near the line goes under it. The host's own number is
    // printed beside ours so the two can be told apart.
    const ceiling = idle.hostBody === null ? "?" : `${idle.hostBody}:1`;
    bad.push(`sentence ${idle.sentence.ratio}:1 (host body ${ceiling})`);
  }
  for (const b of idle.buttons) {
    const who = `${b.act}${b.primary ? "*" : ""}`;
    if (!b.hittable) bad.push(`${who} not hittable (${b.hitOwner} owns its centre)`);
    if (b.w < MIN_TARGET || b.h < MIN_TARGET) bad.push(`${who} target ${b.w}x${b.h}px`);
    if (b.labelRatio !== null && b.labelRatio < MIN_TEXT) bad.push(`${who} label ${b.labelRatio}:1`);
    if (b.iconRatio !== null && b.iconRatio < MIN_GRAPHIC) bad.push(`${who} icon ${b.iconRatio}:1`);
    if (b.boundary < MIN_BOUNDARY) bad.push(`${who} boundary ${b.boundary}:1`);
    if (b.fontSize < MIN_LABEL_PX) bad.push(`${who} label ${b.fontSize}px`);
    if (b.clipped) bad.push(`${who} label clipped by its own pill`);
    if (b.iconW !== null && (b.iconW < 8 || b.iconW > 32)) bad.push(`${who} icon ${b.iconW}px wide`);
  }
  if (idle.bleed > 1) bad.push(`overflows frame by ${idle.bleed}px (${idle.bleeder})`);
  if (idle.overflowStrip > 1) bad.push(`strip scrolls ${idle.overflowStrip}px`);
  if (idle.overflowPage > 1) bad.push(`page scrolls ${idle.overflowPage}px`);

  // The toast is live text a reader is meant to read, so it is held to 1.4.3.
  const t = states.toast.toast;
  if (t !== null && t < MIN_TEXT) bad.push(`toast ${t}:1`);
  // The loading line is live text too.
  const e = states.busy.est;
  if (e !== null && e < MIN_TEXT) bad.push(`loading line ${e}:1`);
  // The dimmed buttons during the grind are NOT judged. SC 1.4.3 exempts text
  // that is part of an inactive component, and `-off` sets aria-disabled and
  // pointer-events:none. Their numbers are printed under --verbose.
  return bad;
}

/* ------------------------------------------------------------------- run */

const { origin, close } = await serve();
const browser = await chromium.launch();
const rows = [];

try {
  for (const host of HOSTS) {
    const ctx = await browser.newContext({
      colorScheme: host.scheme ?? "light",
      forcedColors: host.forcedColors ?? "none",
      viewport: { width: 1024, height: 800 },
    });
    const page = await ctx.newPage();
    await page.goto(origin + "/h/" + host.id, { waitUntil: "networkidle" });
    // Wait for the wrapper's own script to have painted a state, not for a
    // timer: the strip's buttons are toggled by paintStrip(), and measuring
    // before it runs measures markup no reader ever sees.
    await page
      .waitForFunction(
        (A) => {
          const b = document.querySelector("[" + A + '-act="show"]');
          return b && !b.hidden && b.getBoundingClientRect().width > 0;
        },
        ATTR,
        { timeout: 15_000 },
      )
      .catch(() => {});

    const states = {};
    for (const state of ["idle", "toast", "busy"]) {
      states[state] = await page.evaluate(measure, [ATTR, state]);
      // Each state mutates the DOM, so the next one starts from a clean page.
      if (state !== "busy") await page.reload({ waitUntil: "networkidle" });
    }
    rows.push({ host, states, bad: judge(host, states) });
    await ctx.close();
  }
} finally {
  await browser.close();
  close();
}

/* ---------------------------------------------------------------- report */

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n) => String(v === null || v === undefined ? "—" : v).padStart(n);

const COLS = [
  ["sentence", 9],
  ["copy·icon", 10],
  ["show·lbl", 9],
  ["show·bnd", 9],
  ["copy·bnd", 9],
  ["toast", 7],
  ["icon px", 9],
  ["bleed", 7],
];
console.log("\n" + pad("host", 40) + COLS.map(([t, w]) => num(t, w)).join(""));
console.log("-".repeat(40 + COLS.reduce((a, [, w]) => a + w, 0) + 3));

for (const { host, states, bad } of rows) {
  const m = states.idle;
  const copy = m.buttons?.find((b) => b.act === "copy");
  const show = m.buttons?.find((b) => b.act === "show");
  console.log(
    pad(host.label, 40) +
      num(m.sentence?.ratio, 9) +
      num(copy?.iconRatio, 10) +
      num(show?.labelRatio, 9) +
      num(show?.boundary, 9) +
      num(copy?.boundary, 9) +
      num(states.toast.toast, 7) +
      num(m.iconMin === null ? "—" : `${m.iconMin}-${m.iconMax}`, 9) +
      num(m.bleed, 7) +
      (bad.length ? "  ✗" : "  ✓"),
  );
}

console.log("");
let failed = 0;
for (const { host, bad } of rows) {
  if (!bad.length) continue;
  const excused = KNOWN[host.id];
  if (!excused) failed++;
  console.log(`${excused ? "KNOWN" : "FAIL "} ${host.label}`);
  for (const b of bad) console.log(`        · ${b}`);
  if (excused) console.log(`        → ${excused}`);
}

if (process.argv.includes("--verbose")) {
  console.log("\n--- full readings ---");
  for (const { host, states } of rows) console.log(host.id, JSON.stringify(states, null, 1));
}

console.log(
  `\n${rows.length} hosts · ${rows.filter((r) => !r.bad.length).length} clean · ${failed} failing`,
);
process.exit(failed ? 1 : 0);
