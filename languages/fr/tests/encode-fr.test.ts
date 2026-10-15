import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode, decode, encodeSegments } from "../../../packages/core/src/encode.js";

/**
 * The French mapping is not (yet) a bundled `src/mappings/*.json`, because a
 * mapping without a matching font renders as decoy text on screen and the
 * Optik base needed to build `optik-fr.woff2` is Playtype's, not ours. So
 * this reads the build artifact `languages/fr/build/build_pairs.py` emits, and
 * the claim under test is that THAT artifact is safe to hand to `encode()`.
 */
const FR_PATH = fileURLToPath(
  new URL("../data/fr_v1_alpha_for_font.json", import.meta.url),
);
const fr = JSON.parse(readFileSync(FR_PATH, "utf8")) as Record<string, string>;

/**
 * French elision, as far as a string can know it: `le`/`la`/`de`/`je`/`ne`/
 * `que` contract before a vowel, so a decoy has to start with one if its
 * original did.
 *
 * h-initial words are EXCLUDED rather than classified. Whether `h` elides is
 * lexical, not orthographic — `l'heure` but `le héros` — so deciding it here
 * would mean copying `NO_ELISION` from `../build/build_pairs.py` and keeping
 * two hand lists in step forever. The Python side owns that list and checks
 * it; this covers the ~97% of pairs where the first character settles it.
 */
// `y` is absent on purpose, matching `VOWELS` in `../build/build_pairs.py`: French
// y-initial words overwhelmingly block elision (`le yacht`, `le yaourt`),
// so they belong with the consonants.
const VOWELS = new Set("aeiouàâäéèêëíîïóôöùúûüœæ");
const startsWithVowel = (w: string) => VOWELS.has(w[0]!);
const isHInitial = (w: string) => w[0] === "h";

// Which words a seed happens to pair changes with every rebuild, so tests
// that need a mapped word take one from the mapping rather than naming it.
// `université` was mapped in the Lexique build and is not in the
// Grammalecte one; nothing about it was special.
const ELIDING_WORD = Object.keys(fr)
  .filter((k) => VOWELS.has(k[0]!) && /^\p{Ll}+$/u.test(k))
  .sort()[0]!;

describe("fr mapping — shape invariants the font and encoder both assume", () => {
  it("is a strict involution", () => {
    const broken = Object.entries(fr).filter(([src, tgt]) => fr[tgt] !== src);
    expect(broken).toEqual([]);
  });

  it("has no fixed points", () => {
    expect(Object.entries(fr).filter(([src, tgt]) => src === tgt)).toEqual([]);
  });

  it("is NFC-normalised, so every key is one the encoder can generate", () => {
    // encode() normalises its input to NFC before tokenising. A key stored in
    // NFD would be a key no French input could ever match.
    const denormalised = Object.keys(fr).filter((k) => k.normalize("NFC") !== k);
    expect(denormalised).toEqual([]);
  });

  it("contains no key with an apostrophe", () => {
    // The tokeniser matches Unicode letter runs, so `aujourd'hui` is looked up
    // as `aujourd` and `hui`. A key containing an apostrophe could never fire.
    expect(Object.keys(fr).filter((k) => /['’]/.test(k))).toEqual([]);
  });

  it("contains no single-letter key", () => {
    // `l`, `d`, `j`, `n`, `s`, `c`, `m`, `t` are all elided clitics in French
    // and all appear as bare letter runs once the apostrophe splits them. An
    // entry for any of them would rewrite the article of every phrase it met.
    const single = Object.keys(fr).filter((k) => k.length === 1 && !/\d/.test(k));
    expect(single).toEqual([]);
  });
});

describe("fr mapping — French agreement survives substitution", () => {
  it("never swaps a vowel-initial word for a consonant-initial one", () => {
    // This is the elision invariant, and it is why the mapping needs its own
    // pipeline rather than a re-seed of the English pool: `l'arbre` must not
    // become `l'maison`.
    const violations = Object.entries(fr)
      .filter(([src, tgt]) => !/\d/.test(src))
      .filter(([src, tgt]) => !isHInitial(src) && !isHInitial(tgt))
      .filter(([src, tgt]) => startsWithVowel(src) !== startsWithVowel(tgt));
    expect(violations).toEqual([]);
  });

  it("keeps the elided article grammatical", () => {
    const out = encode(`l'${ELIDING_WORD}`, fr);
    expect(out.startsWith("l'")).toBe(true);
    expect(out).not.toBe(`l'${ELIDING_WORD}`);
    // A vowel or an h can follow `l'`. Which h's actually elide is the
    // build script's business (`NO_ELISION` and the lexicon's own markers,
    // checked there against known-answer controls) and deliberately not
    // restated here.
    const decoy = out.slice(2);
    expect(startsWithVowel(decoy) || isHInitial(decoy)).toBe(true);
  });
});

describe("fr encode — round-trip", () => {
  const prose =
    "L'écriture appartient à celles et ceux qui la pratiquent. " +
    "La maison de mon père était très grande, et l'été durait longtemps.";

  it("is its own inverse on French prose", () => {
    expect(decode(encode(prose, fr), fr)).toBe(prose);
  });

  it("actually changes the text", () => {
    expect(encode(prose, fr)).not.toBe(prose);
  });

  it("preserves every accented character it does not swap", () => {
    // `être` is a function word and out of the dictionary by design, so it
    // must survive byte-identical, circumflex included.
    expect(encode("être", fr)).toBe("être");
    expect(encode("çà", fr)).toBe("çà");
  });

  it("treats a decomposed accent as the composed word", () => {
    const composed = "université";
    const decomposed = "université"; // e + combining acute
    expect(encode(decomposed, fr)).toBe(encode(composed, fr));
  });
});

describe("fr encode — tokenisation edge cases French actually produces", () => {
  it("splits at the apostrophe and leaves the clitic alone", () => {
    const segments = encodeSegments("l'université", fr);
    expect(segments.map((s) => s.original)).toEqual(["l", "'", "université"]);
    expect(segments[0]!.swapped).toBe(false);
  });

  it("passes `aujourd'hui` through unchanged", () => {
    // A known and accepted coverage gap: the apostrophe splits it into
    // `aujourd` + `hui`, neither of which is a French word, so neither is a
    // dictionary key. Documented rather than worked around.
    expect(encode("aujourd'hui", fr)).toBe("aujourd'hui");
  });

  it("preserves case on a capitalised French word", () => {
    const target = fr[ELIDING_WORD]!;
    const capitalised = ELIDING_WORD[0]!.toUpperCase() + ELIDING_WORD.slice(1);
    expect(encode(capitalised, fr)).toBe(
      target[0]!.toUpperCase() + target.slice(1),
    );
  });

  it("leaves HTML character references alone", () => {
    // French copy is entity-heavy (&eacute;, &agrave;, &#233;). Rewriting a
    // digit inside one changes the character the browser resolves, and no
    // ligature can undo that.
    expect(encode("caf&eacute;", fr)).toBe("caf&eacute;");
    expect(encode("&#233;t&#233;", fr)).toBe("&#233;t&#233;");
  });

  it("applies the same digit rule as the English mappings", () => {
    // F1: a swap-eligible digit with exactly one letter-neighbour is left as
    // written; 0 or 2 neighbours are pre-swapped. Language-neutral, and the
    // French permutation is deliberately identical to the English one.
    expect(encode("2026", fr)).toBe("2527");
    expect(decode(encode("2026", fr), fr)).toBe("2026");
  });
});
