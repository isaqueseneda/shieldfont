/**
 * Filler prose, for the decoy payloads that sit beside a sealed block.
 *
 * ## What this is for
 *
 * Every shielded block ships several sealed payloads: one holding the real
 * words, the rest holding text that is not the reader's and never was. The
 * cheapest attack on the accessibility path is not visiting the page at all —
 * it is pulling the sealed JSON straight out of the HTML and grinding it
 * natively, with one script that works on every site using this library.
 * Several indistinguishable payloads make that several times the work, with no
 * way to tell which one matters without reading the wiring.
 *
 * The reader's browser is TOLD which payload is theirs, so it solves exactly
 * one. The asymmetry is not cryptographic: it is that a bulk attacker
 * pattern-matching for sealed blobs has no idea, and a targeted one who reads
 * the script does. That is the honest size of it.
 *
 * ## Where these sentences come from, and why it is safe
 *
 * Six public domain works, chosen to spread the filler across genre, era and
 * voice so it does not all read as one writer:
 *
 *   Austen, Pride and Prejudice (1813)        social fiction
 *   Shelley, Frankenstein (1818)              gothic
 *   Melville, Moby Dick (1851)                adventure and essay
 *   Doyle, The Adventures of Sherlock Holmes  detective
 *   Wells, The Time Machine (1895)            science fiction
 *   Kafka, Metamorphosis (1915)               modernist
 *
 * All predate every copyright term in force anywhere. Gutenberg's header and
 * footer are stripped, which is the only part carrying their terms; the works
 * underneath carry none.
 *
 * REDDIT AND WIKIPEDIA WERE CONSIDERED AND REJECTED, since a wider register
 * would genuinely help. Reddit posts are copyrighted by whoever wrote them.
 * Wikipedia is CC BY-SA, which drags attribution and share-alike obligations
 * into every page that ships a decoy — an unreasonable thing to hand a user who
 * only wanted to protect a paragraph. Modern-register public domain text is
 * scarce; US federal government works are the obvious untapped source if this
 * ever needs widening again.
 *
 * ## Why it is ENCODED before it is sealed
 *
 * Never seal these sentences as they stand. A decoy holding recognisable Austen
 * can be matched against Gutenberg in one query and discarded, which costs an
 * attacker nothing and hands them the answer. Run each slice through the same
 * word substitution the visible block uses, and it matches nothing, anywhere —
 * while carrying the same statistical fingerprint as every other decoy on the
 * page. The scrambler is the thing that makes this corpus usable, not the
 * corpus itself.
 *
 * ## Why not generate the sentences instead
 *
 * A Markov chain over a corpus this size is a bigger artifact than the corpus
 * and writes worse English. A grammar-based generator is small but obviously
 * repetitive across a few hundred samples. A language model is hundreds of
 * megabytes, slow, and non-deterministic, which would make builds
 * irreproducible. Real sentences by a real writer beat all three, need no
 * inference step, and cost 300 KB in a package that already ships a megabyte of
 * mapping dictionaries.
 *
 * ## It never reaches a reader
 *
 * This is a build-time asset. What ships to a browser is the sealed ciphertext,
 * which is the same size whatever text went into it.
 *
 * ## Known weakness
 *
 * It is a fixed, public corpus. Somebody who solves a payload can run the
 * public `decode()` over the result and match it against these six books, which
 * identifies it as filler immediately. Randomising WHICH paragraphs get used
 * stops the choice being predicted from the markup; it cannot stop a solved
 * decoy being recognised afterwards. So the payloads raise a bulk attacker's
 * cost and do not create ambiguity, and the docs should not claim they do.
 * See ROADMAP.md.
 */
import corpus from "./decoy-corpus.json" with { type: "json" };

/** Body paragraphs, 220–900 characters each. */
export const DECOY_CORPUS: readonly string[] = corpus as string[];

/**
 * Pick `count` paragraphs at random.
 *
 * ## Why this is random rather than derived, which it used to be
 *
 * The first version seeded the draw from the camouflage attribute and the block
 * key. Both of those are PRINTED IN THE PAGE, and this function and the corpus
 * are both public exports — so anyone could install the package, read two
 * attributes off the HTML, and compute exactly which three payloads were filler
 * and which one held the reader's words. No CPU, no browser. A reviewer
 * demonstrated it on eight blocks out of eight.
 *
 * That defeated the entire point. Several sealed payloads are only worth
 * shipping if a bulk attacker has to grind all of them; if the arrangement can
 * be derived from the markup, they grind one.
 *
 * Randomness fixes it because nothing about the choice is recoverable. The
 * browser never needs to know WHICH corpus paragraphs were used — only which
 * payload is the block's own, and that comes from the block key by a separate
 * rule. So the selection can be as unpredictable as we like at no cost.
 *
 * ## Why losing determinism costs nothing
 *
 * Builds were never byte-reproducible and never could be: `sealText` mints
 * fresh primes and a fresh IV on every call. Two builds of one commit already
 * differed in every ciphertext. This only adds variation to which plaintext
 * sits underneath them.
 *
 * Uses Web Crypto, not `Math.random`, because a predictable PRNG here would
 * reintroduce exactly the weakness this replaced — a seed an attacker can guess
 * is a seed an attacker can derive.
 *
 * `globalThis.crypto` rather than `node:crypto`, and that is not a style
 * preference: a static `node:crypto` import makes this module unbundleable for
 * the browser, and `@shieldfont/core` is imported by code that gets bundled.
 * It broke the hydration audit immediately. Web Crypto is a global in Node 19+
 * and in every browser, so nothing is imported and nothing breaks.
 */
function randomIndex(bound: number): number {
  const buf = new Uint32Array(1);
  // Rejection sampling. A bare `% bound` is biased toward low indices whenever
  // bound does not divide 2^32 — small here, but this is the one function whose
  // entire job is being unpredictable, so it should not have a known skew.
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0]!;
  } while (v >= limit);
  return v % bound;
}

export function decoyParagraphs(count: number): string[] {
  const out: string[] = [];
  const used = new Set<number>();
  // Distinct paragraphs: two identical decoys on one block would tell an
  // attacker that at least those two are not the real text.
  while (out.length < count && used.size < DECOY_CORPUS.length) {
    const i = randomIndex(DECOY_CORPUS.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(DECOY_CORPUS[i]!);
  }
  return out;
}
