// On the wording of commit 50311c1, see the message of the commit that added this line.
/**
 * Time-lock puzzles — the build-time half of the accessible plain-text path.
 *
 * ## Why this exists
 *
 * `<Shield>` marks its encoded block `aria-hidden`, because voicing a decoy is
 * worse than voicing nothing. That leaves assistive technology with silence,
 * and silence on its own is not an alternative. The obvious fix — put the
 * original words at a URL and link to it — shipped in 0.2.0 as
 * `a11y={{ mode: "text", href }}` and was REMOVED in this release, because a URL
 * cannot be offered to a screen reader without being offered to everyone else.
 * The same crawl that reads the decoy reads the link beside it, for one more
 * line of code. The accessible path was the cheapest path into the plaintext,
 * which made it the weakest part of the package.
 *
 * This module is the replacement. The plain text still ships in the page, but
 * ENCRYPTED, and the key is not in the page either — it is a number the browser
 * has to *grind out*, and grinding costs a deliberate, tunable amount of CPU.
 *
 * ## The design goal, stated exactly
 *
 * The goal is NOT to make the plaintext expensive in absolute terms. It cannot
 * be: a crawler that wants the words can always render the page and OCR the
 * pixels, which costs ~5.0 CPU-seconds for a real article page and is
 * available whether or not this module exists. OCR is the floor on ShieldFont's
 * protection and no amount of cryptography raises it.
 *
 * The goal is that the accessible path is **never the cheapest path**. Set the
 * puzzle above the OCR cost and the plain-text mode stops being a shortcut: a
 * crawler gains nothing by using it, so it adds no attack surface, so it can
 * exist. That is the whole argument, and it also caps the difficulty — pushing
 * far past OCR buys no protection at all (they would just OCR instead) and only
 * makes disabled readers wait longer. See {@link DEFAULT_SECONDS}.
 *
 * ## The primitive
 *
 * A Rivest-Shamir-Wagner time-lock puzzle (1996). Pick primes p and q, let
 * n = p·q, and define the key as
 *
 *     K = 2^(2^T) mod n
 *
 * A solver who knows only n must square 2 sequentially, T times. There is no
 * known shortcut, and — the load-bearing property — **it cannot be
 * parallelised**: squaring number i+1 needs the result of squaring number i.
 * A crawler with a thousand GPUs still pays T sequential steps per page. Their
 * only lever is a faster single core, worth maybe 3-4x over a laptop, which is
 * exactly the narrow margin this design wants.
 *
 * Compare a hash chain (the obvious alternative): equally sequential, but the
 * BUILDER pays the same T as the solver, so a 200-page site costs an hour of
 * build time. Here the builder holds a trapdoor. Knowing p and q gives φ(n),
 * and Euler's theorem collapses the tower:
 *
 *     e = 2^T mod φ(n)      then      K = 2^e mod n
 *
 * Two modular exponentiations, about a millisecond. Measured on this repo's
 * reference machine: **62 ms to seal a block that costs the reader a 14-second
 * budget to open.**
 * p, q and φ(n) are discarded and never leave this function — with them the
 * puzzle would be trivially bypassable, so nothing may retain them.
 *
 * ## Freshness
 *
 * Every call generates its own primes. A modulus is never reused across blocks
 * or across builds, so solving one block teaches an attacker nothing about the
 * next one, and every redeploy invalidates every solution anyone has already
 * computed. A shared or persisted modulus would let one grind unlock a whole
 * site forever, which would defeat the entire mechanism — hence
 * {@link sealText} taking no seed parameter and offering no way to pin one.
 *
 * The same property costs legitimate readers their cached solutions on every
 * deploy. That is the intended trade, and it is symmetric: it is the very thing
 * that expires the crawler's cache.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generatePrimeSync,
  randomBytes,
} from "node:crypto";

/**
 * Squarings per second on the reference device — a mid-range phone, or Safari,
 * which is what `seconds` in {@link SealOptions} is denominated in. Deliberately
 * NOT a fast desktop: a progress bar that beats its promise is a good surprise,
 * one that overruns reads as broken.
 *
 * This constant only converts seconds to a step count at build time. It is not
 * a claim about the reader's device, which may be several times slower (Safari
 * and Firefox both trail V8 on BigInt, and a phone trails a laptop). The solver
 * does NOT trust this number — it benchmarks the actual device before it starts
 * and reports an estimate based on what it measured. See the solver script in
 * @shieldfont/react.
 *
 * IT WAS 250,000, AND THE ARGUMENT FOR MOVING IT WAS ITSELF WRONG.
 *
 * That argument said an M1 Max does 259,500 squarings/s, so 250,000 was 96% of
 * one of the fastest consumer cores in existence while being described as a slow
 * one. The 259,500 was a bad measurement — an unwarmed loop. Measured again in
 * the shape the solver actually runs, a warmed Worker in Chrome on the same M1
 * Max does about 667,000 squarings/s, median of eleven runs. So 250,000 was
 * around 37% of a fast core, which is a defensible slow-device figure, and the
 * stated reason for changing it does not hold.
 *
 * 120,000 STAYS ANYWAY, for a reason that survives the correction: it is about
 * 5.5x slower than that fast core, which is the right order for a mid-range
 * phone or for Safari, and it is the floor an author should reason from rather
 * than the ceiling. Nothing about the step count depends on this number being
 * exactly right — `t` is derived from the ATTACKER's rate (see DEFAULT_SECONDS),
 * and this one only decides how many steps a given `seconds` buys.
 *
 * Recorded rather than quietly fixed, because a wrong measurement used to
 * justify a change is worse than the change being wrong.
 */
export const REFERENCE_SQUARINGS_PER_SECOND = 120_000;

/**
 * Modulus size in bits. 2048 is the sweet spot and the choice is load-bearing
 * in both directions:
 *
 *   - Big enough that factoring n is infeasible, which is what stops an
 *     attacker recovering the trapdoor and skipping the work entirely.
 *   - Small enough that squaring stays fast, which matters because throughput
 *     sets how much *work* a second of a reader's patience buys. Measured:
 *     269k squarings/s at 2048 bits, 126k at 3072, 93k at 4096. A larger
 *     modulus is not "more secure" here — it just makes every step slower, so
 *     the same wall-clock wait buys FEWER sequential steps and the puzzle gets
 *     cheaper for the crawler, not dearer.
 */
const MODULUS_BITS = 2048;

/** Each prime is half the modulus. */
const PRIME_BITS = MODULUS_BITS / 2;

/**
 * Default target, in seconds on the reference device — 14 × 120,000 = 1,680,000
 * steps.
 *
 * THIS WAS 20 SECONDS AGAINST A REFERENCE OF 250,000, i.e. 5,000,000 steps, and
 * the reasoning above it was wrong in three places at once. It put OCR at ~3
 * CPU-seconds per page, assumed "server cores run 3-4x a laptop", and costed the
 * puzzle per PAGE while the component seals per BLOCK. Measured 2026-08:
 *
 *   - Render + OCR is ~5.0 CPU-seconds for a real article page — Tesseract costs
 *     ~2.7 ms per WORD (it tracks text volume, not pixels), a real page carries
 *     ~750 words once nav, sidebar, comments and footer are counted, and a
 *     measured 12% of pages need a retry.
 *   - Server cores are NOT faster than a laptop on bignum work; they are equal
 *     to slightly slower. The attacker's real advantage is software: OpenSSL's
 *     hand-written Montgomery assembly does 1,737,000 squarings/s where V8's
 *     BigInt in a warmed worker does about 667,000. That is a 2.6x gap, and it
 *     is not going away. It does not change `t`, which is derived from the
 *     attacker's rate alone.
 *   - Five blocks on a page meant five puzzles, so the old default billed a
 *     crawler ~14 CPU-seconds against an OCR floor of 5. Ten times over.
 *
 * The rule this number obeys: **a block's puzzle should cost a crawler slightly
 * LESS than its share of render+OCR.** OCR is always available, so anything
 * dearer is not protection — the crawler takes the cheaper door and the extra
 * seconds are paid entirely by disabled readers.
 *
 *   budget/block = 5.0 CPU-s ÷ 5 blocks           = 1.00 CPU-s
 *   t            = 0.97 × 1.00 × 1,737,000        ≈ 1,680,000
 *   crawler pays = 1,680,000 ÷ 1,737,000          = 0.97 CPU-s per block
 *                = 97% of the OCR floor ✓
 *
 * ## Why 97% and not the 81% this shipped with first
 *
 * 81% left a fifth of the available deterrence unclaimed for no reason. The
 * crawler picks the CHEAPER door, so the whole game is to sit as close under the
 * OCR floor as the measurement error allows:
 *
 *   - below the floor, the puzzle is the cheaper door, so they pay it;
 *   - above the floor, they OCR instead and every extra second is paid purely by
 *     disabled readers, buying nothing.
 *
 * So the target is "just under", not "comfortably under". 97% keeps the puzzle
 * the cheaper door while claiming essentially all of the budget. Deliberately
 * not 100%: the 5.0 CPU-s OCR figure is a measurement, not a constant, and
 * overshooting it is the one direction with no upside.
 *
 * Reader-side, that is ~6.5 s on V8 and ~14 s on the 120,000 reference. Both are
 * honest ranges: a real reader may be 2-4x either way, which is why the solver
 * measures the device rather than trusting this.
 *
 * NOTE THE DOLLARS CANCEL. A crawler OCRs and squares on the same rented CPU, so
 * $/vCPU-second appears on both sides of the comparison and drops out. The rule
 * is CPU-seconds against CPU-seconds — which also makes it robust to spot-price
 * swings and to hardware generations, since OCR and squaring speed up together.
 *
 * Going higher is still the tempting mistake, for the same reason as before.
 */
export const DEFAULT_SECONDS = 14;

/**
 * Floor. NOT "below this the puzzle is cheaper than OCR" — that was the old
 * comment and it is false: the OCR-matched point is ~14 reference-seconds, so a
 * floor of 5 forbade nothing useful and a floor above 14 would have forbidden
 * the correct value. This is now just a sanity bound against a typo.
 */
const MIN_SECONDS = 1;

/**
 * Hard ceiling. Not a security limit — a limit on how long it is defensible to
 * make somebody wait for words everyone else already has. Was 120, which is ten
 * times the OCR floor: two full minutes of a disabled reader's life buying
 * nothing a crawler would ever pay. 30 is already ~2x past the useful point.
 */
const MAX_SECONDS = 30;

/** Options for {@link sealText}. Pass at most one of `seconds` or `steps`. */
export interface SealOptions {
  /**
   * Target grind time in seconds on the reference device (see
   * {@link REFERENCE_SQUARINGS_PER_SECOND}). Default {@link DEFAULT_SECONDS}.
   *
   * Read {@link DEFAULT_SECONDS} before raising this. Higher is not safer.
   */
  seconds?: number;

  /**
   * The step count directly, bypassing the seconds range check.
   *
   * This is an ESCAPE HATCH, not the normal way in. It exists for two callers:
   * tests, which need the real code path at a step count that returns in
   * milliseconds rather than seconds; and tooling that has measured its own
   * audience and wants to calibrate against that instead of against this
   * file's reference laptop.
   *
   * It deliberately skips the 1..30 second guard, so it will happily build a
   * puzzle that a crawler solves instantly. If you are reaching for it to make
   * a page feel faster, use `seconds` and read {@link DEFAULT_SECONDS} first.
   */
  steps?: number;
}

/**
 * A sealed block: everything the browser needs to grind out the key and
 * decrypt, and nothing that would let it skip the grinding.
 *
 * Serialised into the page as JSON. Field names are short because this ships in
 * the HTML of every protected block.
 */
export interface SealedText {
  /** Modulus n, as a decimal string (`BigInt` does not survive JSON). */
  n: string;
  /** Sequential squarings required. */
  t: number;
  /** AES-GCM initialisation vector, base64. */
  iv: string;
  /** AES-256-GCM ciphertext with its 16-byte auth tag appended, base64. */
  ct: string;
}

/** `2^exp mod m`, square-and-multiply. ~log2(exp) steps, so ~21 for T = 1.68M. */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = base % m;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/**
 * The canonical bytes of a puzzle answer, as the key-derivation input.
 *
 * Fixed-width lowercase hex, zero-padded to the modulus width. Both halves of
 * this protocol — this file and the solver script in @shieldfont/react — must
 * agree on it EXACTLY or the auth tag fails and the reader gets an error
 * instead of their text. Hex rather than raw bytes specifically to remove
 * byte-order as a way for the two implementations to disagree silently: a
 * padded hex string is the same string in Node and in every browser.
 */
function canonical(x: bigint, modulusHexLength: number): string {
  return x.toString(16).padStart(modulusHexLength, "0");
}

/**
 * Encrypt `plaintext` behind a fresh time-lock puzzle.
 *
 * Fast — the trapdoor makes sealing independent of the target time, so a
 * 1-second puzzle and a 30-second puzzle both cost about 60 ms to build, and
 * essentially all of that is prime generation.
 *
 * Call this at BUILD TIME, in Node, where the plaintext already lives. It is
 * deliberately Node-only (it needs `node:crypto` for prime generation) and
 * deliberately not exported from the package index, so bundling
 * `@shieldfont/core` for a browser never pulls it in.
 *
 * @example
 *   import { sealText } from "@shieldfont/core/puzzle";
 *   const sealed = sealText("The words a screen reader needs.", { seconds: 14 });
 */
export function sealText(plaintext: string, opts: SealOptions = {}): SealedText {
  if (typeof plaintext !== "string") {
    throw new TypeError(`sealText: plaintext must be a string, got ${typeof plaintext}.`);
  }

  if (opts.seconds !== undefined && opts.steps !== undefined) {
    throw new TypeError(
      "sealText: pass `seconds` or `steps`, not both — they set the same number two different ways.",
    );
  }

  let t: number;
  if (opts.steps !== undefined) {
    if (!Number.isFinite(opts.steps) || opts.steps < 1) {
      throw new RangeError(`sealText: \`steps\` must be a positive number, got ${String(opts.steps)}.`);
    }
    t = Math.round(opts.steps);
  } else {
    const seconds = opts.seconds ?? DEFAULT_SECONDS;
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      throw new RangeError(
        `sealText: \`seconds\` must be between ${MIN_SECONDS} and ${MAX_SECONDS}, got ${String(seconds)}. ` +
          `The OCR-matched point is about ${DEFAULT_SECONDS}; past it a crawler simply takes the ` +
          `cheaper door and every extra second is paid by a disabled reader waiting longer for words ` +
          `every other reader already has (see DEFAULT_SECONDS for the measurements).`,
      );
    }
    t = Math.round(seconds * REFERENCE_SQUARINGS_PER_SECOND);
  }

  // Fresh primes per call. Never reused, never seeded, never returned — see the
  // freshness note in the module header.
  let p = generatePrimeSync(PRIME_BITS, { bigint: true });
  const q = generatePrimeSync(PRIME_BITS, { bigint: true });
  // Astronomically unlikely, but p === q would make phi wrong and the puzzle
  // unsolvable-by-design rather than expensive. Cheap to rule out.
  while (p === q) p = generatePrimeSync(PRIME_BITS, { bigint: true });

  const n = p * q;
  const phi = (p - 1n) * (q - 1n);

  // The trapdoor. 2^(2^t) mod n without doing 2^t squarings: reduce the
  // exponent mod phi(n) first (Euler), then one ordinary modular exponentiation.
  const e = modPow(2n, BigInt(t), phi);
  const key = modPow(2n, e, n);

  // Everything the solver must not have dies here. There is no code path that
  // returns, logs or persists p, q or phi.

  const hexLength = n.toString(16).length;
  const keyBytes = createHash("sha256").update(canonical(key, hexLength), "utf8").digest();

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // WebCrypto's AES-GCM expects the tag appended to the ciphertext; Node hands
  // it over separately. Concatenate so `crypto.subtle.decrypt` accepts it.
  const ct = Buffer.concat([body, cipher.getAuthTag()]);

  return {
    n: n.toString(10),
    t,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
  };
}

/**
 * Solve a sealed block the slow way and return the plaintext.
 *
 * This is the SOLVER, in Node, and it exists for tests and for anyone verifying
 * the claim rather than for production use — it really does perform `t`
 * sequential squarings, so calling it takes about as long as the puzzle
 * promises. Nothing in the shipping path calls it; the browser has its own
 * implementation in @shieldfont/react, and this function is what proves the two
 * agree.
 *
 * @param onProgress Called with a 0..1 fraction, at most once per 1% of work.
 */
export function solveText(
  sealed: SealedText,
  onProgress?: (fraction: number) => void,
): string {
  const n = BigInt(sealed.n);
  const hexLength = n.toString(16).length;
  const step = Math.max(1, Math.floor(sealed.t / 100));

  let x = 2n;
  for (let i = 0; i < sealed.t; i++) {
    x = (x * x) % n;
    if (onProgress && i % step === 0) onProgress(i / sealed.t);
  }
  onProgress?.(1);

  const keyBytes = createHash("sha256").update(canonical(x, hexLength), "utf8").digest();

  const raw = Buffer.from(sealed.ct, "base64");
  // Split the appended tag back off for Node's API.
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(tag);
  return decipher.update(body, undefined, "utf8") + decipher.final("utf8");
}
