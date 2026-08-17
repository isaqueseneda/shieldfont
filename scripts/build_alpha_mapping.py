#!/usr/bin/env python3
"""build_alpha_mapping.py — build a v2 grouped mapping from the v18 benchmark.

The default output is the versioned source-group contract consumed by
generate_font.py.  Pass --legacy-flat/--compatibility for the historical flat
involution consumed by older encoders.

α (alpha) = v15_0_1_0_0_0_0, seed 42, verbatim. Words come from `all_pairs`; the
digit permutation is added as single-char entries so the font/encoder handle digits
the same way the deployed M15-EN build does.

Usage:
  python3 scripts/build_alpha_mapping.py \
    benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json \
    scripts/v18alpha_for_font.json
"""
import json
import argparse
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from mapping_contract import (MappingContractError, nonce_info, validate_contract,
                              flatten_contract)  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--legacy-flat", "--compatibility", action="store_true",
                    help="Emit the legacy flat involution instead of the v2 contract")
    ap.add_argument("--case", default="preserve")
    ap.add_argument("--document-nonce", "--nonce", default=None)
    a = ap.parse_args()
    src = Path(a.src)
    out = Path(a.out)
    d = json.loads(src.read_text())

    flat: dict[str, str] = {}
    collisions = 0
    for p in d["all_pairs"]:
        s, t = p["src"], p["tgt"]
        if s in flat and flat[s] != t:
            collisions += 1
        flat[s] = t

    digits = d.get("_digit_permutation", {})
    for s, t in digits.items():
        flat[s] = t

    if a.legacy_flat:
        out.write_text(json.dumps(flat, ensure_ascii=False, indent=0))
    else:
        groups = OrderedDict()
        word_group = {}
        for p in d["all_pairs"]:
            if digits and p.get("src") in digits:
                continue
            bucket = p.get("bucket", "legacy")
            for word in (p["src"], p["tgt"]):
                word_group.setdefault(word, bucket)
            if word_group[p["src"]] != bucket or word_group[p["tgt"]] != bucket:
                continue
            group = groups.setdefault(bucket, {"id": bucket, "version": "1",
                                               "grammar": bucket, "sources": []})
            existing = next((item for item in group["sources"]
                             if item["source"] == p["src"]), None)
            if existing is None:
                group["sources"].append({
                    "source": p["src"], "aliases": [p["tgt"]],
                    "position": len(group["sources"]),
                })
        digits_group = None
        if digits:
            digits_group = {
                "id": "special.digits", "version": "1",
                "grammar": "special.digits", "sources": [
                    {"source": s, "aliases": [t], "position": i}
                    for i, (s, t) in enumerate(digits.items())
                ],
            }
        contract = {
            "schema": "shieldfont.mapping.v2",
            "profile": "versioned-groups",
            "case": a.case,
            "seed": {"id": f"alpha-{d.get('_seed', 42)}", "value": d.get("_seed", 42)},
            "groups": list(groups.values()) + ([digits_group] if digits_group else []),
        }
        if a.document_nonce is not None:
            contract["nonce_meta"] = nonce_info(a.document_nonce)
        try:
            canonical = validate_contract(contract, compatibility=False)
            # Validate and materialise once so collisions are reported before write.
            flatten_contract(canonical)
        except MappingContractError as exc:
            print(f"[FAIL] mapping contract {exc.code}: {exc}")
            return 13
        out.write_text(json.dumps(contract, ensure_ascii=False, indent=0) + "\n")

    # sanity report
    n_words = sum(1 for k in flat if k.isalpha())
    n_digits = sum(1 for k in flat if k.isdigit())
    involution = sum(1 for s, t in flat.items() if flat.get(t) == s)
    print(f"[alpha] source pairs      : {len(d['all_pairs'])}")
    print(f"[alpha] src collisions    : {collisions} (last-write-wins)")
    print(f"[alpha] flat entries      : {len(flat)}  (words={n_words}, digits={n_digits})")
    print(f"[alpha] involution        : {involution}/{len(flat)} "
          f"({100*involution/len(flat):.1f}%)")
    print(f"[alpha] digit permutation : {digits}")
    print(f"[alpha] profile            : {'compatibility' if a.legacy_flat else 'versioned-groups'}")
    print(f"[alpha] wrote             : {out}  ({out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
