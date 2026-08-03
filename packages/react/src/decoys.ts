/**
 * Sealing a block among decoys.
 *
 * ## The attack this exists for
 *
 * The cheapest way at the accessible text is not to visit the page. It is to
 * fetch the HTML, regex out every `{n, t, iv, ct}` blob, and grind them
 * natively — no browser, no button, no waiting for anything to render. One
 * script does that to every site using this library, forever, because the
 * sealed payload is a recognisable shape sitting in plain markup.
 *
 * Shipping several indistinguishable payloads per block makes that several
 * times the work, with nothing in a blob to say which one matters.
 *
 * ## What it costs the reader: nothing
 *
 * The browser is TOLD which payload is the block's own, so it solves exactly
 * one and waits exactly as long as it did before. The asymmetry is not
 * cryptographic and this file will not pretend otherwise: an attacker who reads
 * the emitted script can see the same thing the browser sees. With no server
 * there is no fact we hold that they cannot. What this buys is that a BULK
 * attacker pattern-matching for sealed blobs has to stop pattern-matching and
 * start reading — and pays 4x until they do.
 *
 * ## Why the decoys must be DIFFERENT TEXTS
 *
 * The tempting version is to seal the same paragraph under alpha, beta and
 * gamma. It is broken, and interestingly so. Line the four plaintexts up word
 * by word: roughly three quarters of the words are identical across all of
 * them, because the mappings only substitute about a quarter. At the positions
 * that DO differ, any two mappings agree with each other about half the time —
 * so at many positions two of the three decoys land on the same word and the
 * odd one out is the original. A majority vote over the four recovers the
 * plaintext with no mapping, no font and no cleverness.
 *
 * Worse, it hands over something the visible decoy never did: a map of exactly
 * which words were substituted. Wherever the versions differ, that word is
 * fake; wherever they agree, it is genuine. Right now an attacker cannot tell
 * which of the visible words to trust. That version would tell them.
 *
 * So the decoys are unrelated prose. Nothing to align, nothing to vote on.
 *
 * ## Why the decoys are ENCODED before they are sealed
 *
 * A decoy holding recognisable Austen or Melville can be matched against Gutenberg in one
 * query and thrown away, which costs an attacker nothing. Encoded, it matches
 * nothing anywhere, and carries the same word-frequency fingerprint as the
 * visible block — because it was made the same way.
 */
import { decoyParagraphs, encode } from "@shieldfont/core";
import { sealText, type SealedText } from "@shieldfont/core/puzzle";
import type { Mapping } from "@shieldfont/core";

/**
 * How many decoys ride along with the real payload.
 *
 * Three, so four blobs total. The attacker's cost rises linearly with this and
 * so does the page weight — about 2 kB of ciphertext each — so there is no
 * cliff to reach for and no reason to go higher. Three is where the bytes stop
 * being free and the protection stops being interesting at the same time.
 */
export const DECOY_COUNT = 3;

/**
 * Plaintexts are padded to a multiple of this before sealing.
 *
 * WITHOUT IT THE WHOLE MECHANISM IS DECORATION, and the first version shipped
 * without it. AES-GCM ciphertext is plaintext length plus a 16-byte tag, so an
 * unpadded set of four leaks its own answer: the decoys come from a corpus
 * clamped to 220-900 characters, and anything outside that band — a heading, a
 * pull quote — is the odd one out on sight. Worse, the decoys used to be seeded
 * per SITE, so the same three paragraphs rode along on every block and their
 * three lengths were a site-wide constant. Learn the triple from any few
 * blocks; the length that does not recur is the reader's words. Zero CPU, HTML
 * only, no browser. Measured: 8 blocks out of 8.
 *
 * Padding to a shared bucket makes every payload in a set the same size. The
 * bucket still discloses roughly how long the block is, which is not a secret —
 * the decoy text is sitting right there in the markup — but it discloses it
 * about all four equally, which is the only property that matters here.
 */
const PAD_BUCKET = 256;

/**
 * BYTES, not characters — and the difference is the whole point.
 *
 * AES-GCM encrypts the UTF-8 encoding, so what leaks through ciphertext length
 * is the byte count. Padding to a common CHARACTER count leaves two payloads
 * different sizes the moment one of them contains a curly quote or an em-dash,
 * which the corpus is full of. The first version of this did exactly that and the
 * set still gave itself away; a test caught it.
 */
function byteLen(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Padded with NULs, which cannot occur in the source text: `<Shield>` rejects
 * non-string children and the encoder emits words and punctuation. NUL is one
 * byte in UTF-8, so character count and byte count move together here even
 * though they do not in the text being padded. Both emitted scripts strip a NUL
 * run from the end after decrypting.
 */
function pad(text: string, toBytes: number): string {
  return text + "\u0000".repeat(Math.max(0, toBytes - byteLen(text)));
}

export interface SealedSet {
  /** Every payload, shuffled. The real one is at {@link index}. */
  payloads: SealedText[];
  /** Which element of {@link payloads} holds the reader's words. */
  index: number;
}

/**
 * Seal `plain` among {@link DECOY_COUNT} decoys and say where it landed.
 *
 * `blockKey` places the real payload within the set. It has to be stable across
 * server and client — the emitted script derives the same index from the same
 * input, so anything that changes between renders would leave the browser
 * grinding a decoy and reporting a failure it cannot explain.
 *
 * ## Which paragraphs get used is RANDOM, and that was the bug
 *
 * There used to be a `seed` parameter here, carrying the project's camouflage
 * hash, and the corpus draw was derived from it plus the block key. Both values
 * are printed in the page. `decoyParagraphs` and the corpus are both public
 * exports. So the decoys could be recomputed straight from the markup by anyone
 * who installed the package — no CPU, no browser, nothing solved — and the real
 * payload identified by elimination. A reviewer did it on eight blocks of eight.
 *
 * Nothing needed that derivation. The browser is told which payload is its own
 * by `indexFor(blockKey)`; it never needs to know what the others hold. So the
 * draw is now `crypto.randomInt` and there is nothing left to recompute.
 *
 * The parameter is removed rather than ignored, so no caller can believe it
 * still does something.
 */
export function sealWithDecoys(
  plain: string,
  mapping: Mapping,
  seconds: number,
  blockKey: string,
): SealedSet {
  const filler = decoyParagraphs(DECOY_COUNT);
  const encoded = filler.map((text) => encode(text, mapping));

  // One length for the whole set, so ciphertext size discloses nothing about
  // which payload is which.
  const longest = Math.max(byteLen(plain), ...encoded.map(byteLen));
  const width = Math.ceil((longest + 1) / PAD_BUCKET) * PAD_BUCKET;
  const payloads: SealedText[] = [];

  // The real one first, then the decoys, then rotate. Rotating rather than
  // shuffling keeps the arrangement recoverable from one number, which is what
  // the browser is given — a shuffle would need a permutation table in the
  // markup, which is both bigger and a louder signal that something is being
  // hidden.
  payloads.push(sealText(pad(plain, width), { seconds }));
  for (const text of encoded) {
    // Already encode()d above. Raw corpus prose is one search away from being
    // identified as filler; encoded, it is indistinguishable from the block
    // beside it. If the corpus runs dry the block simply gets fewer decoys —
    // never a plaintext one.
    payloads.push(sealText(pad(text, width), { seconds }));
  }

  const index = indexFor(blockKey, payloads.length);
  return { payloads: rotate(payloads, index), index };
}

/** Move element 0 to position `by`, keeping the rest in order. */
function rotate<T>(items: T[], by: number): T[] {
  const n = items.length;
  const out = new Array<T>(n);
  for (let i = 0; i < n; i++) out[(i + by) % n] = items[i]!;
  return out;
}

/**
 * Where the real payload sits, derived from the block's key.
 *
 * Derived rather than written into an attribute, and the difference is smaller
 * than it looks: an attacker who reads the emitted script learns the rule and
 * can apply it. What it stops is the attacker who never opens the script —
 * which, given the whole premise here is scrapers that do not run JavaScript,
 * is the one worth stopping.
 *
 * Kept trivially cheap and duplicated verbatim in the emitted script. If the
 * two ever disagree the browser grinds a decoy, fails to decrypt, and reports
 * an error nobody can diagnose — so this function and its copy in notice.ts are
 * pinned together by a test.
 */
export function indexFor(key: string, count: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h % count;
}
