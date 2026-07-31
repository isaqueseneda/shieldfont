#!/usr/bin/env python3
"""reseed_mapping.py — generate YOUR OWN private ShieldFont mapping from your own
seed, by re-pairing the shipped v18 word pool WITHIN its grammatical buckets.

This is the same in-bucket re-pairing method used to derive the shipped β/γ
variants from α (same pool, same buckets, seeds 1 and 2), but it is NOT a
byte-reproduction of them: running this script at --seed 1 reproduces only 194
of β's 12,034 entries, because the shipped variants also went through the full
build pipeline (semantic veto, collision drops) that this script skips. What you
get is an equivalent-quality mapping of your own, not a copy of a shipped one.

A re-seeded mapping is unique to you, so a scraper holding the PUBLIC alpha
dictionary cannot batch-decode your pages with it. That is dictionary reuse, and
it is the only attack a seed defeats: the font you serve still encodes your
pairs, so anyone who downloads it can invert THAT font and recover your
originals, seed or no seed. See docs/custom-mappings.md.

  in  : a v18 pairs file whose entries carry a `bucket` (default: shipped alpha)
  out : a flat {src: tgt} mapping JSON — the exact form the encoder consumes,
        so you can `encode(text, yourMapping)` immediately.

IMPORTANT — a custom mapping needs a MATCHING font. The shipped alpha/beta/gamma/
max fonts render ONLY their own pairs; render a custom mapping with a shipped
font and readers see gibberish. Build a matching font after generating — see
docs/custom-mappings.md / benchmark/README.md §3.

CAVEAT — this re-pairs within grammatical buckets (decoys stay POS/inflection-
matched and read naturally) but does NOT re-run the semantic veto the from-
scratch pipeline applies, so a small fraction of pairs may be closer in meaning
than ideal. For a fully veto-clean build from a seed, use the v7 pipeline in
benchmark/README.md §3A.

Usage:
  python3 scripts/reseed_mapping.py --seed 12345 --out scripts/myseed_for_font.json
"""
import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PAIRS = ROOT / "benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--pairs", default=str(DEFAULT_PAIRS))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    data = json.loads(Path(a.pairs).read_text())
    all_pairs = data.get("all_pairs", [])
    if not all_pairs:
        raise SystemExit(f"no `all_pairs` in {a.pairs}")

    # each word assigned to exactly ONE bucket (first seen) so re-pairing yields
    # a clean involution — a word in two buckets would break m[m[x]] == x.
    by_bucket: dict[str, list[str]] = defaultdict(list)
    seen: set[str] = set()
    for p in all_pairs:
        for w in (p["src"], p["tgt"]):
            if w not in seen:
                seen.add(w)
                by_bucket[p["bucket"]].append(w)

    rng = random.Random(a.seed)
    flat: dict[str, str] = {}
    unpaired = 0
    for bucket, words in sorted(by_bucket.items()):
        ws = sorted(words)
        rng.shuffle(ws)
        i = 0
        while i + 1 < len(ws):
            x, y = ws[i], ws[i + 1]
            if x != y:
                flat[x] = y
                flat[y] = x
            i += 2
        if len(ws) % 2 == 1:
            unpaired += 1  # odd word out passes through unencoded

    # keep the curated digit permutation as-is
    for s, t in data.get("_digit_permutation", {}).items():
        flat[s] = t

    Path(a.out).write_text(json.dumps(flat, ensure_ascii=False, indent=0))
    words = sum(1 for k in flat if k.isalpha())
    involution = sum(1 for s, t in flat.items() if flat.get(t) == s)
    print(f"[reseed] seed={a.seed} buckets={len(by_bucket)} words={words} "
          f"digits={sum(1 for k in flat if k.isdigit())} unpaired_buckets={unpaired}")
    print(f"[reseed] involution={involution}/{len(flat)} ({100 * involution / len(flat):.1f}%)")
    print(f"[reseed] wrote {a.out} ({Path(a.out).stat().st_size:,} bytes)")
    print("[reseed] NEXT: build a matching font — see docs/custom-mappings.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
