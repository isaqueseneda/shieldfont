#!/usr/bin/env python3
"""stamp_mapping_meta.py — inject/refresh the `_meta` provenance block in each
shipped encoder mapping (packages/core/src/mappings/<variant>.json) from
MANIFEST.json.

Run AFTER generate_font.py emits a mapping. Idempotent: re-stamping overwrites
`_meta` and leaves the word pairs untouched. `_meta` is written as the first
key and is ignored by encode() (word/char lookups never hit it);
loadMappingFromString and generate_font.make_injective skip `_`-prefixed keys.

This is what makes "which font + dictionary version am I on?" answerable:
the same mappingId + version lands in the mapping JSON, the font name table
(nameID 26 / 5), and MANIFEST.json.

Usage: python3 scripts/stamp_mapping_meta.py [--version 0.1.0]
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapping_contract import validate_contract  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "packages" / "core"
MAPDIR = CORE / "src" / "mappings"
MANIFEST = json.loads((CORE / "MANIFEST.json").read_text())

VERSION = "0.1.0"
if "--version" in sys.argv:
    VERSION = sys.argv[sys.argv.index("--version") + 1]

# lineage family + user-facing variant name per mapping
FAMILY = {"alpha": "v18", "beta": "v18", "gamma": "v18", "m15en": "m15"}
USER_VARIANT = {"alpha": "alpha", "beta": "beta", "gamma": "gamma", "m15en": "max"}
FAMILY_LABEL = {
    "alpha": "ShieldFont Optik",
    "beta": "ShieldFont Optik Beta",
    "gamma": "ShieldFont Optik Gamma",
    "m15en": "ShieldFont Optik Max",
}
# Neutral cdn/react-tier woff2 basenames — what @shieldfont/react + @shieldfont/font
# actually ship, so the deployed @font-face src URL carries no "shieldfont" tell.
# (The download tier keeps branded shieldfont-*.woff2/.ttf names, separately.)
FONT_BASENAME = {
    "alpha": "optik-a",
    "beta": "optik-b",
    "gamma": "optik-c",
    "m15en": "optik-m",
}


def main() -> int:
    for variant, info in MANIFEST["variants"].items():
        path = MAPDIR / f"{variant}.json"
        if not path.exists():
            print(f"[skip] {variant}: {path} missing")
            continue
        raw = json.loads(path.read_text())
        contract = validate_contract(raw)
        pairs = {k: v for k, v in raw.items()
                 if not k.startswith("_") and k not in {"schema", "profile", "case",
                                                        "case_behavior", "seed",
                                                        "mapping_seed", "groups",
                                                        "document_nonce", "nonce"}}
        uvar = USER_VARIANT.get(variant, variant)
        fam = FAMILY.get(variant, variant)
        if contract.get("legacy"):
            pair_count = sum(1 for k in pairs if isinstance(k, str) and k.isalpha())
            profile = "compatibility"
            group_count = 0
            seed_value = info.get("seed")
            nonce_meta = {"source": "none", "digest_prefix": ""}
        else:
            pair_count = sum(len(entry["sources"]) for entry in contract["groups"])
            profile = contract["profile"]
            group_count = len(contract["groups"])
            seed_value = contract.get("seed")
            nonce_meta = contract["nonce"]
        meta = {
            "name": "shieldfont",
            "lang": "en",
            "mapping": fam,
            "variant": uvar,
            "version": VERSION,
            "mappingId": f"shieldfont-en-{fam}-{uvar}@{VERSION}",
            # mirror MANIFEST's declared pair count (single provenance source);
            # fall back to a live count of word entries in the shipped file.
            "pairs": info.get("pairs", pair_count),
            "seed": seed_value if seed_value is not None else info.get("seed"),
            "profile": profile,
            "groups": group_count,
            "nonceSource": nonce_meta["source"],
            "nonceDigestPrefix": nonce_meta["digest_prefix"],
            "font": f"{FONT_BASENAME.get(variant, 'optik-' + variant)}.woff2",
            "family": FAMILY_LABEL.get(variant, "ShieldFont"),
        }
        if "groups" in raw:
            out = dict(raw)
            out.pop("document_nonce", None)
            out.pop("nonce", None)
            out["nonce_meta"] = nonce_meta
            out["_meta"] = meta
        else:
            out = {"_meta": meta, **pairs}
        path.write_text(json.dumps(out, ensure_ascii=False, indent=0))
        print(f"[ok] {variant}: {meta['mappingId']} (pairs={meta['pairs']}, seed={meta['seed']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
