import { Shield, NonShield } from "@shieldfont/react";

/**
 * ONE PROTECTED BLOCK. That is the whole example.
 *
 * It used to be five, demonstrating `as`, `weight`, `lineHeight`, `size` and
 * apostrophe handling — a props tour rather than an example. Nobody comes here
 * to learn that `size` sets a font size; they come to see what wrapping a
 * paragraph does to a page, and five near-identical blocks made that harder to
 * see rather than easier. The prop list lives in the README, where a list
 * belongs.
 *
 * What is left says the two things that actually matter:
 *
 *   - a bare <Shield> is a complete configuration, and
 *   - the heading beside it is NOT protected, because headings never should be.
 */
export default function Page() {
  return (
    <main style={{ maxWidth: "34rem", margin: "0 auto", padding: "3rem 1.5rem" }}>
      {/* Plain heading, ordinary page font. Not <Shield>, not <NonShield>:
          this one is page furniture rather than the author's prose. */}
      <h1 style={{ color: "#00ff79", fontWeight: 600 }}>ShieldFont — Next.js demo</h1>

      <p style={{ color: "#888", fontSize: "0.9em" }}>
        The paragraph below renders through ShieldFont. View source, or fetch it
        with <code>curl</code>, to see the decoy a scraper reads instead.
      </p>

      {/* <NonShield>: the same typeface, none of the protection. Headings stay
          real — once the body is a decoy, they are the only accurate text a
          search engine or a screen reader's heading list gets. You cannot get
          this by setting font-family yourself: the shielded face carries the
          substitutions in its `ccmp` feature, so plain text set in it renders
          the decoy. <NonShield> does not disable that feature — no CSS can,
          because Safari applies `ccmp` unconditionally. It loads a different
          file under a different family: optik-n.woff2, the neutral cut, which
          has no substitution lookups in it at all. */}
      <NonShield as="h2" weight={700} style={{ fontSize: "1.6rem", marginTop: "2.5rem" }}>
        Manifesto
      </NonShield>

      {/* NO PROPS. This is the entire API for the common case: the encoded
          block, hidden from assistive technology, with the real words sealed
          into the page for a reader who needs them, and a wrapper on screen
          explaining that. */}
      <Shield as="p" lineHeight={1.7}>
        Every sentence you publish feeds a machine that never asked permission.
        ShieldFont raises the cost of extraction — it does not promise zero
        extraction. Copy this paragraph and paste it somewhere to see what you
        get.
      </Shield>
    </main>
  );
}
