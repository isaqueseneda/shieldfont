/**
 * The `locale` prop: every string a block shows or speaks comes from one
 * table, and an English block is unchanged by the table existing.
 *
 * The render tests collect every string the tree carries (text nodes and
 * attribute values both, since half of what a reader hears is attributes) and
 * leave out the three things that are not reader-facing text: the emitted
 * scripts, whose English is the fallback for blocks without a `-says`; the
 * stylesheets; and the encoded block, whose decoy words are English whatever
 * the locale.
 */
import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { Shield, withShieldRenderPass } from "../src/Shield.js";
import { SHIELD_LOCALES, type ShieldStrings } from "../src/locales.js";
import { noticeScript } from "../src/notice.js";
import { solverScript } from "../src/solver.js";
import { props, shieldedBlock, walkDeep } from "./helpers.js";

const A = "data-typeface";
const FAST = { mode: "text", seconds: 5 } as const;
const BODY = "The future of writing belongs to those who write it.";
const EN = SHIELD_LOCALES.en;

/** Every leaf string in a table, by dotted key. */
function flat(s: ShieldStrings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === "string") out[k] = v;
    else for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = v2 as string;
  }
  return out;
}

const placeholders = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Every string a reader could meet in this tree. See the file comment. */
function readerStrings(tree: ReactNode): string[] {
  const block = shieldedBlock(tree);
  const out: string[] = [];
  const skip = (e: ReactElement) => e === block || e.type === "script" || e.type === "style";
  for (const el of walkDeep(tree, skip)) {
    for (const [k, v] of Object.entries(props(el))) {
      if (typeof v === "string" && k !== "className" && k !== "id") out.push(v);
      if (k === "dangerouslySetInnerHTML") out.push((v as { __html: string }).__html);
      if (k === "children") {
        for (const c of [v].flat()) if (typeof c === "string") out.push(c);
      }
    }
  }
  return out;
}

/** English sentences that must not survive into a page in `s`'s language. */
function englishLeaks(found: string[], s: ShieldStrings): string[] {
  const other = flat(s);
  const text = found.join("\n");
  return Object.entries(flat(EN))
    .filter(([k, v]) => !v.includes("{") && v.length > 6 && v !== other[k])
    .filter(([, v]) => text.includes(v))
    .map(([k]) => k);
}

describe("the shipped tables", () => {
  it("all have every key English has, and nothing empty", () => {
    const keys = Object.keys(flat(EN)).sort();
    for (const [name, s] of Object.entries(SHIELD_LOCALES)) {
      const f = flat(s);
      expect(Object.keys(f).sort(), name).toEqual(keys);
      for (const [k, v] of Object.entries(f)) expect(v.trim(), `${name}.${k}`).not.toBe("");
    }
  });

  it("keep English's placeholders in every string", () => {
    const en = flat(EN);
    for (const [name, s] of Object.entries(SHIELD_LOCALES)) {
      for (const [k, v] of Object.entries(flat(s))) {
        expect(placeholders(v), `${name}.${k}`).toEqual(placeholders(en[k]!));
      }
    }
  });

  // The spoken name has to begin with the visible label, or "click Uncover"
  // in voice control matches nothing. resolveNotice falls back safely; this
  // makes sure no shipped table needs the fallback.
  it("start every long Uncover name with the visible label", () => {
    for (const [name, s] of Object.entries(SHIELD_LOCALES)) {
      expect(s.showLong.startsWith(s.show), name).toBe(true);
    }
  });
});

describe("a block with a locale", () => {
  for (const [name, s] of Object.entries(SHIELD_LOCALES)) {
    if (name === "en") continue;

    it(`${name}: the drawn wrapper says nothing in English`, () => {
      const tree = withShieldRenderPass(() => [
        Shield({ children: BODY, as: "p", a11y: FAST, locale: name as never }),
        Shield({ children: `${BODY} Again.`, as: "p", a11y: FAST, locale: name as never }),
      ]);
      const found = readerStrings(tree);
      expect(englishLeaks(found, s)).toEqual([]);
      expect(found).toContain(s.text);
      expect(found).toContain(s.repeat);
    });

    it(`${name}: the clipped tier says nothing in English`, () => {
      const tree = withShieldRenderPass(() => [
        Shield({ children: BODY, as: "p", wrapper: false, a11y: FAST, locale: name as never }),
        Shield({ children: `${BODY} Again.`, as: "p", wrapper: false, a11y: FAST, locale: name as never }),
      ]);
      const found = readerStrings(tree);
      expect(englishLeaks(found, s)).toEqual([]);
      expect(found).toContain(s.puzzle.replace("{n}", "5"));
    });
  }

  it("still lets the author's own wording win", () => {
    const tree = Shield({
      children: BODY,
      a11y: FAST,
      locale: "fr",
      wrapper: { text: "Texte de l’auteur.", labels: { show: "Ouvrir" } },
    });
    const found = readerStrings(tree);
    expect(found).toContain("Texte de l’auteur.");
    expect(found).toContain("Ouvrir");
    expect(found).not.toContain(SHIELD_LOCALES.fr.text);
    // Everything the author did not set is still French.
    expect(found).toContain(SHIELD_LOCALES.fr.copy);
  });

  it("names a group with the translated element noun", () => {
    const tree = Shield({
      children: BODY,
      as: "li",
      a11y: FAST,
      locale: "de",
      wrapper: { labels: { group: "Geschützter Text." } },
    });
    const frame = walkDeep(tree).find((e) => props(e)["role"] === "group");
    expect(props(frame!)["aria-label"]).toBe("Geschützter Text, Listeneintrag 1");
  });

  it("takes a whole table for a language that does not ship", () => {
    const italian: ShieldStrings = { ...EN, nouns: { ...EN.nouns }, text: "Se usi uno screen reader, scopri il testo." };
    const found = readerStrings(Shield({ children: BODY, a11y: FAST, locale: italian }));
    expect(found).toContain("Se usi uno screen reader, scopri il testo.");
  });

  it("throws on a locale that does not ship, naming the ones that do", () => {
    expect(() => Shield({ children: BODY, locale: "xx" as never })).toThrow(/en, fr, es, pt, de/);
  });
});

describe("an English block", () => {
  // The scripts already speak English, so an English block sends them nothing
  // extra: no `-says` on the clipped group, no duration templates in the
  // drawn one. That is what keeps existing pages' markup byte for byte.
  it("carries no clipped-tier -says and no duration templates", () => {
    const clipped = walkDeep(Shield({ children: BODY, wrapper: false, a11y: FAST }));
    expect(clipped.some((e) => `${A}-says` in props(e))).toBe(false);

    const drawn = walkDeep(Shield({ children: BODY, a11y: FAST }));
    const says = drawn.map((e) => props(e)[`${A}-says`]).find((v) => typeof v === "string");
    expect(JSON.parse(says as string)).not.toHaveProperty("sec");
  });

  it("is the same with locale=\"en\" as with no locale", () => {
    const strip = (t: ReactNode) => readerStrings(t).sort();
    expect(strip(Shield({ children: BODY, a11y: FAST, locale: "en" }))).toEqual(
      strip(Shield({ children: BODY, a11y: FAST })),
    );
  });
});

describe("the wait estimate in both scripts", () => {
  const NAMES = { attr: A, flag: "__tf__", logPrefix: "[typeface]", storePrefix: `${A}-` };

  /** The script's own `plural` + `human`, lifted out and run as written. */
  function humanFrom(src: string): (s: number, t?: object) => string {
    const plural = src.match(/function plural\([\s\S]*?\n?}\n?/)![0];
    const human = src.match(/function human\([\s\S]*?\n}\n/)![0];
    return new Function(`${plural}\n${human}\nreturn human;`)() as never;
  }

  const scripts: [string, string][] = [
    ["notice", noticeScript({ ...NAMES, family: "Optik" })],
    ["solver", solverScript(NAMES)],
  ];

  for (const [name, src] of scripts) {
    it(`${name}: words it from the templates, and in English without them`, () => {
      const human = humanFrom(src);
      const fr = { sec: SHIELD_LOCALES.fr.seconds, min1: SHIELD_LOCALES.fr.minute, min: SHIELD_LOCALES.fr.minutes };
      expect(human(12, fr)).toBe("environ 10 secondes");
      expect(human(70, fr)).toBe("environ une minute");
      expect(human(200, fr)).toBe("environ 3 minutes");
      expect(human(12)).toBe("about 10 seconds");
      expect(human(70, {})).toBe("about a minute");
      expect(human(200)).toBe("about 3 minutes");
    });
  }
});
