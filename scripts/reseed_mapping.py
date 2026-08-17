#!/usr/bin/env python3
"""Create a deterministic, optionally document-specific grouped mapping.

The default output records ordered alias candidates and safe nonce metadata;
--legacy-flat/--compatibility keeps the historical involution output.
"""
import argparse
import hashlib
import json
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from mapping_contract import (  # noqa: E402
    MappingContractError,
    flatten_contract,
    load_contract,
    nonce_info,
    validate_contract,
)

DEFAULT_PAIRS = ROOT / "benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json"


def _ordered(words, seed, nonce, group_id):
    def key(word):
        return hashlib.sha256(
            f"{seed}\0{nonce}\0{group_id}\0{word}".encode("utf-8")
        ).digest()
    return sorted(words, key=key)


def _legacy_groups(data):
    groups = OrderedDict()
    assigned = set()
    digit_sources = set(data.get("_digit_permutation", {}))
    for pair in data.get("all_pairs", []):
        source, target = pair.get("src"), pair.get("tgt")
        if source in digit_sources or target in digit_sources:
            continue
        bucket = pair.get("bucket", "legacy")
        group = groups.setdefault(bucket, [])
        for word in (source, target):
            if word not in assigned:
                group.append(word)
                assigned.add(word)
    return groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--pairs", default=str(DEFAULT_PAIRS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--legacy-flat", "--compatibility", action="store_true",
                    help="Emit the legacy flat involution")
    ap.add_argument("--case", default="preserve")
    ap.add_argument("--document-nonce", "--nonce", default=None)
    a = ap.parse_args()

    data = json.loads(Path(a.pairs).read_text(encoding="utf-8"))
    if "groups" in data:
        source_contract = load_contract(a.pairs, compatibility=False)
        groups = OrderedDict()
        for group in source_contract["groups"]:
            groups[group["id"]] = list(dict.fromkeys(
                [entry["source"] for entry in group["sources"]] +
                [alias for entry in group["sources"] for alias in entry["aliases"]]
            ))
    else:
        groups = _legacy_groups(data)
    digits = data.get("_digit_permutation", {})
    if not groups:
        raise SystemExit(f"no source groups in {a.pairs}")

    flat = {}
    output_groups = []
    unpaired = 0
    nonce = a.document_nonce or ""
    for group_id, words in groups.items():
        ordered = _ordered(sorted(words), a.seed, nonce, group_id)
        if len(ordered) % 2:
            unpaired += 1
            ordered = ordered[:-1]
        sources = []
        for index in range(0, len(ordered), 2):
            left, right = ordered[index:index + 2]
            flat[left] = right
            flat[right] = left
            sources.append({"source": left, "aliases": [right], "position": len(sources)})
            sources.append({"source": right, "aliases": [left], "position": len(sources)})
        if sources:
            grammar = group_id if "." in group_id else (
                "special.digits" if group_id == "special.digits" else group_id
            )
            output_groups.append({
                "id": group_id,
                "version": "1",
                "grammar": grammar,
                "sources": sources,
            })
    if digits:
        digit_sources = []
        for index, (source, target) in enumerate(digits.items()):
            flat[source] = target
            digit_sources.append({"source": source, "aliases": [target], "position": index})
        output_groups.append({
            "id": "special.digits", "version": "1", "grammar": "special.digits",
            "sources": digit_sources,
        })

    if a.legacy_flat:
        Path(a.out).write_text(json.dumps(flat, ensure_ascii=False, indent=0) + "\n",
                               encoding="utf-8")
    else:
        contract = {
            "schema": "shieldfont.mapping.v2",
            "profile": "versioned-groups",
            "case": a.case,
            "seed": {"id": f"reseed-{a.seed}", "value": a.seed},
            "groups": output_groups,
        }
        if a.document_nonce is not None:
            contract["nonce_meta"] = nonce_info(a.document_nonce)
        try:
            canonical = validate_contract(contract, compatibility=False)
            materialised, _ = flatten_contract(canonical)
        except MappingContractError as exc:
            print(f"[FAIL] mapping contract {exc.code}: {exc}")
            return 13
        if materialised != flat:
            raise SystemExit("mapping contract replay mismatch")
        Path(a.out).write_text(json.dumps(contract, ensure_ascii=False, indent=0) + "\n",
                               encoding="utf-8")

    words = sum(1 for key in flat if key.isalpha())
    involution = sum(1 for source, target in flat.items() if flat.get(target) == source)
    print(f"[reseed] schema={'compatibility' if a.legacy_flat else 'shieldfont.mapping.v2'} "
          f"profile={'compatibility' if a.legacy_flat else 'versioned-groups'} "
          f"groups={len(output_groups)} seed_id=reseed-{a.seed} "
          f"nonce_source={'provided' if a.document_nonce else 'none'} "
          f"nonce_digest_prefix={hashlib.sha256(a.document_nonce.encode()).hexdigest()[:12] if a.document_nonce else 'none'}")
    print(f"[reseed] words={words} digits={sum(1 for k in flat if k.isdigit())} "
          f"unpaired_groups={unpaired}")
    print(f"[reseed] involution={involution}/{len(flat)} ({100 * involution / len(flat):.1f}%)")
    print(f"[reseed] wrote {a.out} ({Path(a.out).stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
