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
 * Jane Austen, *Pride and Prejudice*, 1813. Public domain worldwide — it
 * predates every copyright term in force anywhere. Sourced from Project
 * Gutenberg with their header and footer stripped, which is the part carrying
 * their own terms; the 1813 text underneath carries none. Paragraphs were
 * filtered to body prose between 220 and 900 characters: no chapter headings,
 * no illustration markers, no front matter.
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
 * It is a fixed, public corpus. Somebody who works out which book it is could,
 * in principle, encode it under each published mapping and build a table of
 * known decoys. That defeats the mechanism for a targeted attacker — which it
 * was never meant to stop — and the slice offset is seeded per site so at least
 * no two sites ship the same ones. See ROADMAP.md.
 */
import corpus from "./decoy-corpus.json" with { type: "json" };

/** Body paragraphs, 220–900 characters each. */
export const DECOY_CORPUS: readonly string[] = corpus as string[];

/**
 * Pick `count` paragraphs, deterministically, from a seed.
 *
 * Deterministic, so a given seed always selects the same paragraphs.
 *
 * That is NOT the same as a reproducible build, and an earlier version of this
 * comment claimed it was — while decoys.ts, in the same commit, correctly said
 * the opposite. `sealText` mints fresh primes and a fresh IV on every call, so
 * two builds of one commit never produce identical bytes and never could. What
 * is stable here is the SELECTION: the same seed draws the same paragraphs, so
 * a block's decoys do not churn between renders.
 *
 * Seeded from the SITE rather than fixed, so two projects using this library
 * never ship identical decoys — otherwise one afternoon's work would produce a
 * list of known decoy ciphertexts good against everybody.
 *
 * The mixing is a plain 32-bit xorshift. It is not cryptographic and does not
 * need to be: an attacker who predicts which paragraphs were chosen has learnt
 * which decoys are decoys, and the corpus is public anyway, so the secret was
 * never here. It exists to spread the choices out, nothing more.
 */
export function decoyParagraphs(seed: string, count: number): string[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // ZERO IS A FIXED POINT of the xorshift below — 0 ^ (0<<13) ^ (0>>>17) ^
  // (0<<5) is 0 — so a seed hashing to it makes the loop pick index 0 forever
  // and never terminate. Synchronous, so nothing can interrupt it: the author's
  // build hangs with no error and no way to guess why.
  //
  // One project in 2^32, and reachable through the documented API:
  // setCamouflage({ hash: "8pu9abvy" }) is one such seed. sealText already rules
  // out its own astronomically-unlikely degenerate case (p === q) on exactly
  // this reasoning; this is the same class and deserves the same line.
  if (h === 0) h = 1;
  const out: string[] = [];
  const used = new Set<number>();
  // Distinct paragraphs: two identical decoys on one block would tell an
  // attacker that at least those two are not the real text.
  while (out.length < count && used.size < DECOY_CORPUS.length) {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    const i = h % DECOY_CORPUS.length;
    if (used.has(i)) continue;
    used.add(i);
    out.push(DECOY_CORPUS[i]!);
  }
  return out;
}
