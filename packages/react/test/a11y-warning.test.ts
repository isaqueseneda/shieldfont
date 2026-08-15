/**
 * The dev-time warning for turning the accessible alternative OFF.
 *
 * It used to fire for an OMITTED `a11y` prop, because the alternative was
 * opt-in and silence was the default. `screenReader` now defaults to true, so
 * omitting everything ships the alternative and there is nothing to
 * warn about — the warning moved to the one remaining way to end up with an
 * aria-hidden block and no alternative, which is asking for it.
 *
 * Lives in its own file, and re-imports the module per test, because the
 * "once per process" latch is module-scoped: any other test that renders a
 * <Shield> without `a11y` would consume it first and make these assertions
 * meaningless.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const BODY = "The future of writing belongs to those who write it.";

/** A fresh module instance, so the warn-once latch is unset. */
async function freshShield() {
  vi.resetModules();
  return (await import("../src/Shield.js")).Shield;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("opting out of the accessible alternative", () => {
  it("warns once per process, not once per block", async () => {
    const Shield = await freshShield();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 25; i++)
      Shield({ children: `${BODY} ${i}`, screenReader: false });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("screenReader");
    expect(message).toMatch(/aria-hidden/);
    // It has to say what the off-state actually costs a reader, in plain words.
    // No criterion numbers: the message is read by a developer at a console,
    // and a citation there teaches the wrong vocabulary back into the docs.
    expect(message).toMatch(/assistive technology/i);
    expect(message).toMatch(/NOTHING/);
    expect(message).not.toMatch(/WCAG/);
    // It must point at the fix, including the explicit opt-out...
    expect(message).toMatch(/mode: "none"/);
    // ...and must not re-suggest the thing this release deleted.
    expect(message).toMatch(/speechSynthesis/);
    expect(message).toMatch(/build time/i);

    // The text mode is suggested again, and that is correct — but ONLY in its
    // time-lock shape. This assertion used to forbid the string `mode: "text"`
    // outright, which was right while the mode did not exist and is wrong now.
    // What must never come back is the 0.2.0 shape: a URL to the original words
    // sitting in the HTML. So the name is allowed and `href` is not.
    expect(message).toMatch(/mode: "text"/);
    expect(message).not.toMatch(/href/i);
    expect(message).not.toMatch(/plain-text (copy|version|URL)/i);
    // Nor the audio mode, retired in 0.3.2. A message that still enumerates it
    // sends an author to configure a mode that no longer type-checks.
    expect(message).not.toMatch(/mode: "audio"/);
  });

  it("does not warn on the DEFAULT — the alternative ships without asking", async () => {
    const Shield = await freshShield();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Shield({ children: BODY });
    expect(warn).not.toHaveBeenCalled();
  });

  it("seals the original by default, with no a11y prop at all", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Shield = await freshShield();
    const html = renderToStaticMarkup(Shield({ children: BODY }) as never);
    // A sealed payload is present, and the plaintext is not.
    expect(html).toMatch(/type="application\/json"/);
    expect(html).not.toContain("belongs");
  });

  it("warns for a11y={{ mode: \"none\" }} too — it is the other way to opt out", async () => {
    const Shield = await freshShield();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Shield({ children: BODY, a11y: { mode: "none" } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the alternative is present, in any configuration", async () => {
    const Shield = await freshShield();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // `mode: "none"` is deliberately NOT in this list any more — it is an
    // opt-out, and the test above asserts it warns.
    Shield({ children: BODY, a11y: { mode: "text" } });
    Shield({ children: BODY, a11y: { mode: "text", seconds: 5 } });
    Shield({ children: BODY, wrapper: false, a11y: { mode: "text", note: "Uncover it below." } });
    Shield({ children: BODY, wrapper: false, a11y: { mode: "text", visualHidden: false } });

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet in production — it is a development-time warning", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const Shield = await freshShield();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    Shield({ children: BODY });

    expect(warn).not.toHaveBeenCalled();
  });

  it("still renders normally when it warns", async () => {
    const Shield = await freshShield();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = Shield({ children: BODY });
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain("aria-hidden");
  });
});
