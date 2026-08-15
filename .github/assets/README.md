# README Assets

Images used by the root `README.md`. Both are shipped, and both `<img>` tags in
the README point at them.

| File | Size | What it is | Source |
|------|------|------------|--------|
| `banner.png` | 1200×630, 202 KB | Hero banner at the top of the README. Also the site's OpenGraph card, so the two stay visually consistent. | `shieldfont-website/public/og.png` |
| `hero-before-after.png` | 1600×899, 102 KB | Side-by-side: what a human reads vs. what a machine reads. Sits under the opening pitch, just above the "What a human sees / What a mass scraper sees" table. | Press kit, `campaign-you-vs-ai.png`, resized and palette-optimised |

Keep assets under ~500 KB each: GitHub compresses, but a slow first load hurts
the first impression. `hero-before-after.png` was 3.1 MB at press-kit
resolution; `sips -Z 1600` plus a 256-colour adaptive palette brings it to
102 KB with no visible loss at README width.

The full press kit — press release, fact sheet, campaign renders — lives in the
website repo under `public/press-kit/` and `public/press-assets/`.
