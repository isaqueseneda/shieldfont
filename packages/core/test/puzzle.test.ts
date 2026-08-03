/**
 * The time-lock puzzle: does it round-trip, does it leak, and does the browser
 * agree with the builder?
 *
 * The third question is the one that would otherwise ship broken. `sealText`
 * runs in Node on `node:crypto`; the solver runs in a browser on WebCrypto and
 * `BigInt`. They must derive byte-identical keys from the same puzzle answer or
 * the AES-GCM auth tag rejects and a reader gets an error where their words
 * should be — and testing `sealText` against `solveText` alone would never
 * catch that, because both live on the same side of the protocol. So
 * `browserSolve` below re-implements the browser half longhand, using only
 * primitives a browser has, and every round-trip assertion runs through it.
 *
 * Nearly everything here uses `{ steps }` rather than `{ seconds }`, which is
 * the same code path at a step count that returns in milliseconds. One test
 * (`the real thing`) runs an actual 5-second puzzle, because a suite that only
 * ever exercises toy difficulties would not notice the day the real one broke.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SECONDS,
  REFERENCE_SQUARINGS_PER_SECOND,
  sealText,
  solveText,
} from "../src/puzzle.js";

const SECRET = "The future of writing belongs to those who write it.";

/** Milliseconds, not seconds — see the file header. */
const FAST = { steps: 20_000 } as const;

/**
 * The browser half, rebuilt from WebCrypto + BigInt only.
 *
 * Deliberately imports nothing from puzzle.ts but the sealed payload. If the
 * two implementations ever drift, the auth tag fails and this goes red — which
 * is the entire reason it is written out by hand instead of calling solveText.
 */
async function browserSolve(sealed: ReturnType<typeof sealText>): Promise<string> {
  const n = BigInt(sealed.n);
  const hexLength = n.toString(16).length;

  let x = 2n;
  for (let i = 0; i < sealed.t; i++) x = (x * x) % n;

  const canonical = x.toString(16).padStart(hexLength, "0");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);

  const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(sealed.iv) },
    key,
    bytes(sealed.ct),
  );
  return new TextDecoder().decode(plain);
}

describe("sealText", () => {
  it("never emits the plaintext, in any field", () => {
    const serialised = JSON.stringify(sealText(SECRET, FAST));

    expect(serialised).not.toContain(SECRET);
    // Not even a distinctive fragment. Short base64 runs can coincide with
    // letters by chance, so this checks words long enough to be meaningful.
    for (const word of ["future", "writing", "belongs"]) {
      expect(serialised.toLowerCase()).not.toContain(word);
    }
  });

  it("never emits the trapdoor — only n, t, iv and ct", () => {
    // p, q and phi(n) would each collapse a twenty-second puzzle to a
    // millisecond. Asserting the exact shape means an added field cannot slip
    // through unnoticed, whatever it gets called.
    expect(Object.keys(sealText(SECRET, FAST)).sort()).toEqual(["ct", "iv", "n", "t"]);
  });

  it("is fast to build regardless of how slow it is to open", () => {
    // The whole reason for a trapdoor puzzle over a hash chain: a 200-block
    // site must not cost an hour of build time. Generous bound — this guards
    // against an accidental O(t) build, it does not benchmark the machine.
    const started = performance.now();
    sealText(SECRET, { seconds: DEFAULT_SECONDS });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("scales the step count with the requested seconds", () => {
    expect(sealText(SECRET, { seconds: 5 }).t).toBe(5 * REFERENCE_SQUARINGS_PER_SECOND);
    expect(sealText(SECRET, { seconds: 20 }).t).toBe(20 * REFERENCE_SQUARINGS_PER_SECOND);
    expect(sealText(SECRET).t).toBe(DEFAULT_SECONDS * REFERENCE_SQUARINGS_PER_SECOND);
  });

  it("gives every block a fresh modulus", () => {
    // A reused modulus would let one grind unlock a whole site, and would
    // survive redeploys. Same text, twice, must not produce the same puzzle.
    const a = sealText(SECRET, FAST);
    const b = sealText(SECRET, FAST);
    expect(a.n).not.toBe(b.n);
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects a difficulty outside the sane band", () => {
    // The band moved in 0.3.2 when the default was recalibrated against a
    // MEASURED OCR cost rather than an estimated one: 1..30 rather than 5..120.
    // The old floor of 5 came with a comment claiming anything lower was
    // "cheaper than OCR" — false, and it would now forbid values close to the
    // correct one. The old ceiling of 120 was two minutes of a disabled
    // reader's life buying nothing a crawler would ever pay for.
    expect(() => sealText(SECRET, { seconds: 0 })).toThrow(RangeError);
    expect(() => sealText(SECRET, { seconds: 31 })).toThrow(RangeError);
    expect(() => sealText(SECRET, { seconds: NaN })).toThrow(RangeError);
    // The message has to explain the ceiling, or someone will "harden" a page
    // by raising it and buy nothing for the wait they inflicted.
    expect(() => sealText(SECRET, { seconds: 600 })).toThrow(/no protection|OCR/i);
  });

  it("rejects non-string content rather than sealing a coerced value", () => {
    expect(() => sealText(undefined as unknown as string)).toThrow(TypeError);
    expect(() => sealText(42 as unknown as string)).toThrow(TypeError);
  });

  it("rejects seconds and steps together instead of silently picking one", () => {
    expect(() => sealText(SECRET, { seconds: 20, steps: 100 })).toThrow(TypeError);
    expect(() => sealText(SECRET, { steps: 0 })).toThrow(RangeError);
  });
});

describe("round trip", () => {
  it("solves back to the original text", async () => {
    await expect(browserSolve(sealText(SECRET, FAST))).resolves.toBe(SECRET);
  });

  it("survives the characters the encoder specifically handles", async () => {
    // P1 (accents) and F1 (letter-flanked digits) from encode.ts, plus the
    // scripts and punctuation a real page carries.
    const awkward = "Café — résumé, H3O and C4H10. Ünicode: 日本語 · emoji 🎧 · quote \"x\" 'y'.";
    await expect(browserSolve(sealText(awkward, FAST))).resolves.toBe(awkward);
  });

  it("handles an empty string and a very long one", async () => {
    await expect(browserSolve(sealText("", FAST))).resolves.toBe("");
    const long = SECRET.repeat(400);
    await expect(browserSolve(sealText(long, FAST))).resolves.toBe(long);
  });

  it("agrees with the Node solver as well as the browser one", () => {
    const sealed = sealText(SECRET, FAST);
    expect(solveText(sealed)).toBe(SECRET);
  });

  it("reports progress monotonically from 0 to 1", () => {
    const seen: number[] = [];
    solveText(sealText(SECRET, FAST), (f) => seen.push(f));

    expect(seen.length).toBeGreaterThan(50);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] as number);
    }
  });

  it("rejects a tampered payload instead of returning garbage", async () => {
    const sealed = sealText(SECRET, FAST);
    // Nudging n changes the puzzle answer, so the derived key is wrong. AES-GCM
    // must fail its auth tag rather than hand back plausible nonsense: a screen
    // reader voicing silent corruption is the exact failure this package exists
    // to avoid, and it would be indistinguishable from working.
    await expect(browserSolve({ ...sealed, n: (BigInt(sealed.n) + 2n).toString() })).rejects.toThrow();
    // Tamper the BYTES, not the encoding. `ct` is base64, so overwriting its
    // first character with a literal "A" was a 1-in-64 flake: a ciphertext that
    // already began with "A" came back byte-identical, decrypted correctly, and
    // the assertion failed for the one reason it was not testing. Decoding and
    // inverting a byte is unconditional.
    const raw = Buffer.from(sealed.ct, "base64");
    raw[0] = (raw[0] as number) ^ 0xff;
    const tampered = raw.toString("base64");
    expect(tampered).not.toBe(sealed.ct);
    expect(Buffer.from(tampered, "base64").equals(Buffer.from(sealed.ct, "base64"))).toBe(false);
    expect(() => solveText({ ...sealed, ct: tampered })).toThrow();
  });

  it("agrees on an answer that needs zero-padding", async () => {
    // canonical() left-pads the answer to the modulus width. A short answer
    // turns up roughly one block in sixteen, so a padding disagreement between
    // the two implementations would fail for a *minority* of blocks — the worst
    // kind to find in production. Search for one rather than hope.
    let sealed = sealText(SECRET, FAST);
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      const n = BigInt(sealed.n);
      let x = 2n;
      for (let k = 0; k < sealed.t; k++) x = (x * x) % n;
      if (x.toString(16).length < n.toString(16).length) found = true;
      else sealed = sealText(SECRET, FAST);
    }
    expect(found).toBe(true);
    await expect(browserSolve(sealed)).resolves.toBe(SECRET);
  }, 60_000);
});

describe("the real thing", () => {
  it("round-trips a genuine 5-second puzzle", async () => {
    // Everything above runs at a toy step count. This one pays the real cost,
    // so the shipping path is covered rather than merely the arithmetic.
    const sealed = sealText(SECRET, { seconds: 5 });
    expect(sealed.t).toBe(5 * REFERENCE_SQUARINGS_PER_SECOND);
    await expect(browserSolve(sealed)).resolves.toBe(SECRET);
  }, 120_000);
});
