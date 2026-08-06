#!/usr/bin/env python3
#
# ShieldFont — a web font that protects written content from AI scraping.
# Copyright (c) 2026 Isaque Seneda and Gabriel Abrucio.
#
# This file is part of ShieldFont.
#
# ShieldFont is free software: you can redistribute it and/or modify it
# under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# ShieldFont is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public
# License along with this program. If not, see
# <https://www.gnu.org/licenses/>.
"""
ShieldFont Generator

Generates a ShieldFont build from any base font. Downloads the base font
(direct TTF or Google Fonts zip), instantiates variable fonts, injects
GSUB ligature rules for lowercase / Capitalized / ALL CAPS variants of
every word in word_mapping.json, and exports .ttf + .woff2 + .css.

Preserves existing GSUB features on the base font (important when the
base has its own ligatures, e.g. Datatype's data-viz glyphs).

Usage:
  python3 scripts/generate_font.py \\
    --base-url URL --cache-name Base-Regular.ttf \\
    --name "ShieldFont Name" --prefix shieldfont-name
"""

import json
import os
import re
import sys
import argparse
import zipfile
import io
import hashlib
import requests
import unicodedata
from pathlib import Path
from io import BytesIO

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
from fontTools.ttLib.tables import otTables

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
from script_diagnostics import (  # noqa: E402
    CODE_BACKEND_MISSING,
    CODE_INPUT_NOT_FOUND,
    CODE_OUTPUT_UNWRITABLE,
    CODE_VALIDATION_FAILED,
    Diagnostics,
    EXIT_INPUT,
    EXIT_BACKEND,
    EXIT_OUTPUT,
    EXIT_VALIDATION,
    add_json_result_argument,
)
from shape_run import (  # noqa: E402
    PositionedGlyph,
    ShapeBackendError,
    ShapeParityError,
    ShapeRunner,
    font_bytes,
)
from mapping_contract import (  # noqa: E402
    MappingContractError,
    derive_bundle_id,
    flatten_contract,
    load_contract,
)
from artifact_contract import (  # noqa: E402
    deterministic_font_metadata,
    emit_canonical_artifacts,
    scan_public_artifacts,
    source_date_epoch,
)
DEFAULT_MAPPING_PATH = SCRIPT_DIR / "word_mapping.json"
MAPPING_PATH = DEFAULT_MAPPING_PATH  # may be overridden in main()
MAPPING_CONTRACT = None
MAPPING_CASE_FORM = "preserve"
MAPPING_NONCE_OVERRIDE = None
MAPPING_BUNDLE_ID = None
FONT_CACHE_DIR = SCRIPT_DIR / "fonts"
OUTPUT_DIR = PROJECT_DIR / "public" / "fonts"


def build_bundle_identity(mapping, font_bytes_or_digest, *, nonce=None,
                          tenant=None, compatibility=None):
    """Return an opaque identity for a complete, compatibility-bound build."""
    return derive_bundle_id(
        mapping=mapping,
        font=font_bytes_or_digest,
        nonce=nonce,
        tenant=tenant,
        compatibility=compatibility or {},
    )


def derive_cache_key(url, cache_name, *, compatibility=None):
    """Return a collision-resistant, opaque base-font cache identity."""
    return derive_bundle_id(
        font={"url_digest": _safe_text_id(url), "cache_name_digest": _safe_text_id(cache_name)},
        compatibility=compatibility or {},
    )


def download_font(url, cache_name):
    """Download a font from Google Fonts zip or direct URL."""
    cache_key = derive_cache_key(url, cache_name)
    cache_path = FONT_CACHE_DIR / f"{cache_key}-{Path(cache_name).name}"
    legacy_cache_path = FONT_CACHE_DIR / cache_name
    if cache_path.exists():
        print(f"[OK] Font cache: cache_status=hit key={cache_key}")
        return cache_path
    if legacy_cache_path.exists():
        print(f"[OK] Font cache: cache_status=hit key={cache_key} legacy=1")
        return legacy_cache_path

    FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[..] Font cache: cache_status=miss key={cache_key}")

    resp = requests.get(url, timeout=60, allow_redirects=True)
    if resp.status_code != 200:
        print(f"[FAIL] HTTP {resp.status_code}")
        sys.exit(1)

    # Check if it's a zip
    if resp.content[:2] == b'PK':
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        ttf_files = [n for n in zf.namelist() if n.endswith('.ttf')]
        if not ttf_files:
            print(f"[FAIL] No .ttf files found in zip. Contents: {zf.namelist()}")
            sys.exit(1)
        # Prefer static regular or just the first TTF
        chosen = None
        for f in ttf_files:
            fl = f.lower()
            if 'regular' in fl and 'static' in fl:
                chosen = f
                break
        if not chosen:
            for f in ttf_files:
                if 'regular' in f.lower():
                    chosen = f
                    break
        if not chosen:
            # For single-weight fonts (like Syne Mono), just pick any
            chosen = ttf_files[0]
        data = zf.read(chosen)
        cache_path.write_bytes(data)
        print(f"[OK] Extracted {chosen} ({len(data):,} bytes)")
    else:
        cache_path.write_bytes(resp.content)
        print(f"[OK] Downloaded ({len(resp.content):,} bytes)")

    return cache_path


def load_mapping():
    global MAPPING_CONTRACT, MAPPING_CASE_FORM
    contract = load_contract(MAPPING_PATH, nonce_override=MAPPING_NONCE_OVERRIDE)
    mapping, contract = flatten_contract(contract)
    MAPPING_CONTRACT = contract
    MAPPING_CASE_FORM = contract.get("case", "preserve")
    details = contract.get("diagnostics", {})
    if details:
        print(
            f"[OK] Mapping contract: schema={details.get('schema')} "
            f"profile={details.get('profile')} groups={details.get('group_count')} "
            f"seed_id_digest={_safe_text_id(details.get('seed_id', ''))} "
            f"nonce_source={details.get('nonce_source')} "
            f"nonce_digest_prefix={details.get('nonce_digest_prefix') or 'none'} "
            f"case={MAPPING_CASE_FORM} "
            f"alias_cardinality_histogram={details.get('alias_cardinality_histogram', {})} "
            f"case_counts={details.get('case_counts', {})} "
            f"fallback_decisions={details.get('fallback_decisions', {})}"
        )
    print(f"[OK] Loaded {len(mapping)} word mappings")
    return mapping


def mapping_output_payload(mapping):
    """Return the flat encoder mapping with safe v2 provenance when applicable."""
    if not isinstance(MAPPING_CONTRACT, dict) or MAPPING_CONTRACT.get("legacy"):
        return mapping
    details = MAPPING_CONTRACT.get("diagnostics", {})
    meta = {
        "schema": details.get("schema"),
        "profile": details.get("profile"),
        "groups": details.get("group_count"),
        "seedId": details.get("seed_id"),
        "nonceSource": details.get("nonce_source"),
        "nonceDigestPrefix": details.get("nonce_digest_prefix"),
        "case": MAPPING_CONTRACT.get("case", "preserve"),
        "aliasCardinalityHistogram": details.get("alias_cardinality_histogram", {}),
    }
    if MAPPING_BUNDLE_ID:
        meta["bundleId"] = MAPPING_BUNDLE_ID
    return {"_meta": meta, **mapping}


def _safe_text_id(value):
    """Return a stable identifier without putting corpus text in diagnostics."""
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def normalization_case_id(value):
    """Classify normalization without exposing the input text."""
    text = str(value)
    normalized = unicodedata.normalize("NFC", text)
    if normalized == text:
        return "nfc"
    if unicodedata.normalize("NFD", text) == unicodedata.normalize("NFD", normalized):
        return "nfd-equivalent"
    return "nfc-repaired"


def normalize_mapping(mapping):
    """Normalize mapping pairs to NFC and reject ambiguous normalized sources."""
    normalized = {}
    ambiguous_sources = set()
    rejected = 0
    for source, target in mapping.items():
        if not isinstance(source, str) or not isinstance(target, str):
            rejected += 1
            continue
        source_nfc = unicodedata.normalize("NFC", source)
        target_nfc = unicodedata.normalize("NFC", target)
        if source_nfc in ambiguous_sources:
            rejected += 1
            continue
        previous = normalized.get(source_nfc)
        if previous is not None and previous != target_nfc:
            rejected += 1
            print(
                "[WARN] rejected ambiguous normalized mapping "
                f"source_id={_safe_text_id(source_nfc)} "
                f"target_ids={_safe_text_id(previous)},{_safe_text_id(target_nfc)}"
            )
            normalized.pop(source_nfc, None)
            ambiguous_sources.add(source_nfc)
            continue
        normalized[source_nfc] = target_nfc
    print(
        f"[OK] Mapping normalization: form=NFC case_id={normalization_case_id('NFC')} "
        f"pairs={len(normalized)} rejected_ambiguity={rejected}"
    )
    return normalized


def normalize_ot_tag(tag, *, kind="tag"):
    """Validate an OpenType tag while keeping diagnostics bounded."""
    value = str(tag).strip()
    allowed_lengths = (3, 4) if kind == "language" else (4,)
    if len(value) not in allowed_lengths or not value.isascii() or not value.isalnum():
        expected = "three or four" if kind == "language" else "four"
        raise ValueError(f"invalid {kind} tag {value!r}; expected {expected} ASCII letters")
    return value


def parse_script_langsys_specs(specs):
    """Parse SCRIPT[:LANG] selectors; ``default`` selects DefaultLangSys."""
    result = {}
    for raw in specs or []:
        value = str(raw).strip()
        if not value:
            continue
        parts = re.split(r"[:/]", value, maxsplit=1)
        script = normalize_ot_tag(parts[0], kind="script")
        language = None
        if len(parts) == 2 and parts[1].strip().lower() not in {"", "default", "dflt"}:
            language = normalize_ot_tag(parts[1].strip(), kind="language")
        result.setdefault(script, [])
        if language not in result[script]:
            result[script].append(language)
    return result


def load_script_langsys_map(path):
    """Load a small JSON scope map without requiring a new config format."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    specs = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                specs.append(item)
            elif isinstance(item, dict):
                specs.append(f"{item['script']}:{item.get('language', 'default')}")
    elif isinstance(raw, dict):
        for script, languages in raw.items():
            if isinstance(languages, dict):
                if languages.get("default", False):
                    specs.append(f"{script}:default")
                languages = languages.get("languages", [])
            if languages is True or languages is None:
                specs.append(f"{script}:default")
            elif isinstance(languages, str):
                specs.append(f"{script}:{languages}")
            else:
                for language in languages:
                    specs.append(f"{script}:{language}")
    else:
        raise ValueError("script/langsys map must be an object or list")
    return parse_script_langsys_specs(specs)


MARK_SET_LIMIT = 256
MARK_SET_RANGES = {
    "basic-mn-v1": ((0x0300, 0x036F),),
    "basic": ((0x0300, 0x036F),),
    "none": (),
}

# Keep the feature contract explicit.  The generated word rules are a
# compatibility feature, not ordinary discretionary ligatures:
#
#   1. fire in the required ccmp stage (locl is the narrow fallback);
#   2. restore in the required rlig stage;
#   3. never depend on optional calt/dlig/liga being enabled.
#
# The tags are deliberately kept in one place so the generator, audit, and
# diagnostics cannot silently drift.
SOURCE_FEATURE_TAGS = ("ccmp", "locl")
RESTORATION_FEATURE_TAG = "rlig"
OPTIONAL_FEATURE_TAG = "calt"
FEATURE_STAGE_ORDER = (
    ("required-source", SOURCE_FEATURE_TAGS),
    ("required-restoration", (RESTORATION_FEATURE_TAG,)),
    ("optional-compatibility", (OPTIONAL_FEATURE_TAG,)),
)


def _has_font_table(font, tag):
    try:
        return tag in font
    except (KeyError, TypeError, IndexError):
        return tag in getattr(font, "tables", {})


def parse_supported_mark_set(value=None, explicit_marks=None):
    """Return a bounded set of combining-mark code points and its safe ID."""
    if value is None:
        value = "basic-mn-v1"
    key = str(value).strip().lower()
    if key in MARK_SET_RANGES:
        codepoints = {
            cp for start, end in MARK_SET_RANGES[key] for cp in range(start, end + 1)
        }
    else:
        codepoints = set()
        for item in key.split(","):
            item = item.strip()
            if not item:
                continue
            if "-" in item:
                start, end = item.split("-", 1)
                codepoints.update(range(int(start, 0), int(end, 0) + 1))
            else:
                codepoints.add(int(item, 0))
    if explicit_marks:
        codepoints = set()
        for item in str(explicit_marks).split(","):
            item = item.strip()
            if not item:
                continue
            if "-" in item:
                start, end = item.split("-", 1)
                codepoints.update(range(int(start, 0), int(end, 0) + 1))
            else:
                codepoints.add(int(item, 0))
    if len(codepoints) > MARK_SET_LIMIT:
        raise ValueError(f"supported mark set exceeds {MARK_SET_LIMIT} code points")
    if any(cp < 0 or cp > 0x10FFFF for cp in codepoints):
        raise ValueError("supported mark set contains an invalid Unicode code point")
    mark_set_id = (
        "none" if not codepoints else
        "basic-mn-v1" if codepoints == set(range(0x0300, 0x0370)) else
        "custom-" + hashlib.sha256(
            ",".join(f"{cp:X}" for cp in sorted(codepoints)).encode("ascii")
        ).hexdigest()[:12]
    )
    return codepoints, mark_set_id


def ensure_gdef_mark_data(font, supported_marks, generated_glyphs=()):
    """Preserve GDEF and add bounded mark/ligature classification."""
    from fontTools.ttLib.tables import G_D_E_F_

    supported_marks = set(supported_marks or ())
    cmap = font.getBestCmap()
    mark_glyphs = {
        glyph_name
        for cp, glyph_name in cmap.items()
        if cp in supported_marks and unicodedata.category(chr(cp)).startswith("M")
    }
    class_defs = {}
    if _has_font_table(font, "GDEF") and getattr(font["GDEF"], "table", None) is not None:
        gdef = font["GDEF"].table
        existing = getattr(getattr(gdef, "GlyphClassDef", None), "classDefs", None)
        if existing:
            class_defs.update(existing)
    for glyph_name in mark_glyphs:
        class_defs.setdefault(glyph_name, 3)
    glyph_set = set(font.getGlyphOrder())
    for glyph_name in generated_glyphs:
        if glyph_name in glyph_set:
            class_defs.setdefault(glyph_name, 2)

    if not _has_font_table(font, "GDEF"):
        table = G_D_E_F_.table_G_D_E_F_()
        table.table = otTables.GDEF()
        table.table.Version = 0x00010002
        font["GDEF"] = table
    gdef = font["GDEF"].table
    if getattr(gdef, "GlyphClassDef", None) is None:
        gdef.GlyphClassDef = otTables.ClassDef()
    gdef.GlyphClassDef.classDefs = class_defs

    mark_set_index = None
    if supported_marks:
        coverage = otTables.Coverage()
        coverage.glyphs = sorted(mark_glyphs, key=font.getGlyphID)
        if getattr(gdef, "MarkGlyphSetsDef", None) is None:
            gdef.MarkGlyphSetsDef = otTables.MarkGlyphSetsDef()
        tables = list(getattr(gdef.MarkGlyphSetsDef, "MarkSetTable", []) or [])
        gdef.MarkGlyphSetsDef.MarkSetTable = tables
        existing = [
            set(getattr(item, "glyphs", [])) for item in tables
        ]
        wanted = set(coverage.glyphs)
        if wanted in existing:
            mark_set_index = existing.index(wanted)
        else:
            tables.append(coverage)
            mark_set_index = len(tables) - 1
        gdef.MarkGlyphSetsDef.MarkSetCount = len(tables)
        if getattr(gdef, "Version", 0) < 0x00010002:
            gdef.Version = 0x00010002
    pending_carets = getattr(font, "_shieldfont_pending_carets", {})
    if pending_carets:
        caret_glyphs = len(pending_carets)
        caret_total = 0
        caret_rejected = 0
        caret_values = []
        for glyph_name, (coordinates, total_advance) in pending_carets.items():
            report = register_ligature_carets(
                font, glyph_name, coordinates, total_advance
            )
            caret_total += report["count"]
            caret_rejected += report["rejected"]
            if report["range"] is not None:
                caret_values.extend(report["range"])
        pending_carets.clear()
        print(
            f"[OK] GDEF LigatureCaretList: glyphs={caret_glyphs} "
            f"carets={caret_total} "
            f"range={min(caret_values) if caret_values else 'none'}.."
            f"{max(caret_values) if caret_values else 'none'} "
            f"rejected={caret_rejected}"
        )
    return mark_glyphs, mark_set_index


def _validated_caret_coordinates(coordinates, total_advance):
    """Return unique, signed coordinates safely derived from source advances."""
    lower = min(0, int(total_advance))
    upper = max(0, int(total_advance))
    result = []
    rejected = 0
    for raw in coordinates or ():
        try:
            coordinate = int(raw)
        except (TypeError, ValueError):
            rejected += 1
            continue
        if coordinate < -32768 or coordinate > 32767:
            rejected += 1
            continue
        # A caret outside the shaped run is not useful to a client and can
        # make the ligature appear to have a phantom component.
        if coordinate < lower or coordinate > upper:
            rejected += 1
            continue
        if coordinate in result:
            continue
        result.append(coordinate)
    return result, rejected


def register_ligature_carets(font, glyph_name, coordinates, total_advance):
    """Add a validated GDEF LigatureCaretList entry for one generated glyph.

    Caret positions are measured from the shaped source advances, rather than
    from nominal hmtx widths.  Existing GDEF data is preserved and generated
    entries are kept in glyph-ID order for deterministic serialization.
    """
    validated, rejected = _validated_caret_coordinates(coordinates, total_advance)
    if not validated:
        if rejected and os.environ.get("LOG_LEVEL", "").upper() == "DEBUG":
            print(f"[..] GDEF carets rejected={rejected} count=0")
        return {"count": 0, "rejected": rejected, "range": None}
    try:
        gdef_table = font["GDEF"]
    except (KeyError, TypeError, IndexError):
        return {"count": len(validated), "rejected": rejected, "range": (
            min(validated), max(validated)
        )}
    gdef = getattr(gdef_table, "table", None)
    if gdef is None:
        return {"count": len(validated), "rejected": rejected, "range": (
            min(validated), max(validated)
        )}
    lig_caret_list = getattr(gdef, "LigCaretList", None)
    if lig_caret_list is None:
        lig_caret_list = otTables.LigCaretList()
        gdef.LigCaretList = lig_caret_list
    coverage = getattr(lig_caret_list, "Coverage", None)
    if coverage is None:
        coverage = otTables.Coverage()
        lig_caret_list.Coverage = coverage
    entries = {
        name: lig
        for name, lig in zip(
            list(getattr(coverage, "glyphs", []) or []),
            list(getattr(lig_caret_list, "LigGlyph", []) or []),
        )
    }
    lig_glyph = otTables.LigGlyph()
    lig_glyph.CaretValue = []
    for coordinate in validated:
        caret = otTables.CaretValue()
        caret.Format = 1
        caret.Coordinate = coordinate
        lig_glyph.CaretValue.append(caret)
    lig_glyph.CaretCount = len(lig_glyph.CaretValue)
    entries[glyph_name] = lig_glyph
    try:
        glyph_ids = font.getReverseGlyphMap(rebuild=True)
    except AttributeError:
        glyph_ids = {name: index for index, name in enumerate(font.getGlyphOrder())}
    ordered_names = sorted(entries, key=lambda name: glyph_ids.get(name, 0x7FFFFFFF))
    coverage.glyphs = ordered_names
    lig_caret_list.LigGlyph = [entries[name] for name in ordered_names]
    lig_caret_list.LigGlyphCount = len(ordered_names)
    if os.environ.get("LOG_LEVEL", "").upper() == "DEBUG":
        print(
            f"[..] GDEF carets glyphs={len(ordered_names)} "
            f"count={len(validated)} range={min(validated)}..{max(validated)} "
            f"rejected={rejected}"
        )
    return {
        "count": len(validated),
        "rejected": rejected,
        "range": (min(validated), max(validated)),
    }


def _set_lookup_mark_filter(lookup, mark_set_index):
    if mark_set_index is None:
        return
    # Use only the bounded mark-filtering bit.  Combining it with IgnoreMarks
    # would skip every mark, including unsupported marks that must remain a
    # shaping boundary.
    lookup.LookupFlag = int(getattr(lookup, "LookupFlag", 0)) | 0x0010
    lookup.MarkFilteringSet = mark_set_index


def read_mapping_id():
    """Return the input mapping's own `_meta.mappingId`, or None.

    Used only to seed the glyph-name salt (see derive_glyph_name_salt); the word
    pairs themselves are read by load_mapping().
    """
    try:
        with open(MAPPING_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return None
    meta = raw.get("_meta")
    if isinstance(meta, dict):
        mid = meta.get("mappingId") or meta.get("id")
        if isinstance(mid, str) and mid:
            return mid
    return None


# ---------------------------------------------------------------------------
# Glyph names: opaque, salted, and dropped entirely from every web tier
# ---------------------------------------------------------------------------
# Composite word glyphs are named `word.<hash>` rather than `word.<plaintext>`,
# because the `post` table ships inside the font and a readable name hands over
# the whole codebook with zero GSUB parsing (RED-TEAM-FINDINGS.md §2).
#
# The hash is SALTED. Unsalted, `sha1(word)[:16]` is a pure function of the
# word, so an attacker hashes a stock English wordlist ONCE and recovers ~93% of
# the names in about a second — and that one table works against every
# ShieldFont ever built, forever. A per-mapping salt forces the precompute to be
# redone per dictionary.
#
# The salt is DERIVED, NEVER RANDOM. Reproducibility is a shipped property: two
# builds of the same commit against the same mapping must produce the same font,
# so an author can rebuild an archive years later. A per-build random salt would
# destroy that. The default is:
#
#     GLYPH_NAME_SALT + "|" + <mapping id>
#
# where <mapping id> is the input mapping's own `_meta.mappingId` when it has
# one, else the emitted variant name (`--mapping-out`, else the prefix minus
# "shieldfont-"). Both are deterministic properties of the build inputs.
#
# Be honest about what this buys. For the four PUBLISHED mappings the dictionary
# ships in @shieldfont/core, so anyone can derive the salt; all it removes is the
# *cross-mapping* rainbow table. It has real value only for a private
# bring-your-own mapping, where computing the salt requires the very dictionary
# the attacker is trying to recover. `--glyph-name-salt` takes an arbitrary
# string if you want a genuinely private one — write it down, you need the same
# value to reproduce the build.
#
# NOTE (scope): since --post-format-3 defaults to dropping the `post` table to
# format 3.0 on every woff2 we emit, the shipped web/CDN/React fonts carry NO
# glyph names at all and the salt is moot for them. It applies to the
# DOWNLOAD-TIER .ttf only — the one that must keep names so it is selectable in
# Word's font menu and so scripts/audit_font.py can name what it shaped. Not
# worth engineering further than this.
GLYPH_NAME_SALT = "shieldfont/glyph-names/v1"

# Playtype's own upright cut names, keyed by their OS/2 usWeightClass. Used to
# derive the default --subfamily from --weight, and to sanity-check that the
# base master really is the cut the caller says it is. The pipeline NEVER
# interpolates or synthesises a weight: each build reads one real static cut
# and the only outline work is the same word-ligature composite construction
# every face gets.
WEIGHT_SUBFAMILY = {
    400: "Regular",
    500: "Medium",
    600: "DemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
}


def derive_glyph_name_salt(mapping_id):
    """Deterministic default salt for the glyph-name hash. See GLYPH_NAME_SALT."""
    return f"{GLYPH_NAME_SALT}|{mapping_id}"


def safe_glyph_name(word, salt):
    """Opaque, deterministic, salted glyph name for a source word.

    scripts/audit_font.py:expected_glyph() mirrors this formula exactly — change
    one and you must change the other, or the audit reports false failures.

    sha1 is used as a namespacing hash, not as a security primitive: the name is
    truncated to 64 bits and the real protection is that web tiers ship no names
    at all. It stays sha1 so the formula is a one-line mirror in the audit.
    """
    digest = hashlib.sha1(f"{salt}\x00{word}".encode("utf-8")).hexdigest()[:16]
    return "word." + digest


def drop_glyph_names(font):
    """Set `post` to format 3.0: keep every outline and every GSUB rule, ship no
    glyph-name strings at all.

    Glyph names have NO rendering function in a web font — shaping, cmap lookup
    and GSUB all address glyphs by ID. On the shipped alpha build the `post`
    table is 984,521 bytes (18.9% of the TTF, ~17% of the woff2) of pure
    glyph-name payload, so this is a straight −18% on the byte the browser
    downloads, and it deletes the glyph-name attack surface as a side effect.

    MUST run as the LAST step, after any name-table camouflage/stamping, so the
    dev-side .ttf keeps its names for audit_font.py and for Word's font menu.
    Returns the number of names dropped (0 if the table was already format 3.0).
    """
    if "post" not in font:
        return 0
    post = font["post"]
    if float(post.formatType) == 3.0:
        return 0
    n = len(getattr(post, "glyphOrder", None) or font.getGlyphOrder())
    post.formatType = 3.0
    # format 3.0 compiles the 32-byte header only; clear the name payload so a
    # stale list can never be re-serialised by a later save.
    post.glyphOrder = []
    post.extraNames = []
    post.mapping = {}
    return n


def make_injective(mapping):
    """Guarantee each encoded (target) word maps back to exactly ONE source.

    A many-to-one target means two source words encode to the same string, so the
    font ends up with two composite glyphs competing for one ligature input — one
    of them silently renders as the WRONG real word (e.g. 'racial' and 'first'
    both encode to 'seventh', so 'racial' comes out looking like 'first').

    For each collision, keep the clean involution partner (the source S where
    mapping[target] == S, i.e. target<->S is a real two-way pair) and drop the
    orphan source(s); if there is no partner, keep the first alphabetically.
    Dropped source words simply go unencoded (rendered as plaintext) — a tiny
    coverage cost that removes the corruption entirely. Warns loudly so the drop
    is never silent (protects re-seeds and future dictionaries too).
    """
    reverse = {}
    for src, tgt in mapping.items():
        reverse.setdefault(tgt, []).append(src)

    dropped = []  # (orphan_src, tgt, kept_src)
    for tgt, srcs in reverse.items():
        if len(srcs) < 2:
            continue
        partner = mapping.get(tgt)
        keep = partner if partner in srcs else sorted(srcs)[0]
        for s in srcs:
            if s != keep:
                dropped.append((s, tgt, keep))

    if not dropped:
        print(f"[OK] Mapping is injective: {len(mapping)} entries, no target collisions")
        return mapping

    print(f"[WARN] {len(dropped)} many-to-one target collision(s) found — dropping "
          "ambiguous orphan(s) so no encoded word renders as the wrong word:")
    for s, tgt, keep in sorted(dropped):
        print(
            "       DROP  "
            f"source_id={_safe_text_id(s)} target_id={_safe_text_id(tgt)} "
            f"kept_id={_safe_text_id(keep)}"
        )
    for s, tgt, keep in dropped:
        mapping.pop(s, None)
    print(f"[OK] Mapping now injective: {len(mapping)} entries ({len(dropped)} orphan(s) dropped)")
    return mapping


def get_glyph_name_for_char(font, ch):
    # Cache the cmap on the font: getBestCmap() rebuilds the whole dict on every
    # call, which is O(n·k) death for large mappings (~12k words × chars × case
    # variants = hundreds of thousands of rebuilds). Build it once.
    cmap = getattr(font, "_shieldfont_cmap_cache", None)
    if cmap is None:
        cmap = font.getBestCmap()
        font._shieldfont_cmap_cache = cmap
    cp = ord(ch)
    return cmap.get(cp)


def _shape_source(font):
    """Keep shaping on the pre-generated font snapshot."""
    source = getattr(font, "_shieldfont_shape_source", None)
    if source is None:
        try:
            source = font_bytes(font)
            font._shieldfont_shape_source = source
        except Exception:
            source = None
    return source


def _legacy_positioned_run(font, word):
    """Compatibility path for the text-only metric fakes in upstream tests."""
    result = []
    for ch in word:
        gname = get_glyph_name_for_char(font, ch)
        if gname is None or gname not in font["glyf"]:
            return None
        advance, _lsb = font["hmtx"][gname]
        gid = font.getGlyphOrder().index(gname)
        result.append(PositionedGlyph(gid, 0, int(advance), 0, 0, 0))
    return tuple(result)


def _checked_int16(value, label):
    value = int(value)
    if value < -32768 or value > 32767:
        raise ValueError(f"{label} outside signed int16 range")
    return value


def _checked_uint16(value, label):
    value = int(value)
    if value < 0 or value > 65535:
        raise ValueError(f"{label} outside unsigned uint16 range")
    return value


def _component_bounds(glyph, x, y):
    if not hasattr(glyph, "xMin") or getattr(glyph, "numberOfContours", 0) == 0:
        return None
    return (
        int(glyph.xMin) + x,
        int(glyph.yMin) + y,
        int(glyph.xMax) + x,
        int(glyph.yMax) + y,
    )


def create_composite_glyph(
    font,
    word,
    new_glyph_name,
    *,
    shaper=None,
    script="latn",
    language="dflt",
    features=None,
    axes=None,
    strict=False,
):
    glyf_table = font["glyf"]
    hmtx_table = font["hmtx"]

    if shaper is None:
        source = _shape_source(font)
        if source is not None:
            try:
                shaper = ShapeRunner(
                    source,
                    script=script,
                    language=language,
                    features=features,
                    axes=axes,
                    strict=strict,
                )
            except ShapeBackendError:
                if strict:
                    raise
                shaper = None

    positioned = None
    if shaper is not None:
        try:
            positioned = shaper.shape(word).glyphs
        except (ShapeBackendError, ShapeParityError):
            if strict:
                raise
    if positioned is None:
        positioned = _legacy_positioned_run(font, word)
    if not positioned:
        return False

    glyph_order = font.getGlyphOrder()
    components = []
    bounds = []
    pen_x = pen_y = 0
    total_advance = 0
    caret_coordinates = []
    for item in positioned:
        if item.glyph_id < 0 or item.glyph_id >= len(glyph_order):
            return False
        comp_name = glyph_order[item.glyph_id]
        if comp_name not in glyf_table or comp_name == ".notdef":
            return False
        x = _checked_int16(pen_x + item.x_offset, "component x")
        y = _checked_int16(pen_y + item.y_offset, "component y")
        components.append((comp_name, x, y))
        bound = _component_bounds(glyf_table[comp_name], x, y)
        if bound is not None:
            bounds.append(bound)
        pen_x += int(item.x_advance)
        pen_y += int(item.y_advance)
        total_advance += int(item.x_advance)
        if item is not positioned[-1]:
            caret_coordinates.append(total_advance)

    new_glyph = Glyph()
    new_glyph.numberOfContours = -1

    glyph_components = []
    for i, (comp_name, x_off, y_off) in enumerate(components):
        comp = GlyphComponent()
        comp.glyphName = comp_name
        comp.flags = 0x0004 | 0x0002
        if i < len(components) - 1:
            comp.flags |= 0x0020
        comp.x = x_off
        comp.y = y_off
        glyph_components.append(comp)
    new_glyph.components = glyph_components

    if bounds:
        x_min = min(item[0] for item in bounds)
        y_min = min(item[1] for item in bounds)
        x_max = max(item[2] for item in bounds)
        y_max = max(item[3] for item in bounds)
    else:
        x_min = y_min = x_max = y_max = 0

    new_glyph.xMin = _checked_int16(x_min, "xMin")
    new_glyph.yMin = _checked_int16(y_min, "yMin")
    new_glyph.xMax = _checked_int16(x_max, "xMax")
    new_glyph.yMax = _checked_int16(y_max, "yMax")

    glyf_table[new_glyph_name] = new_glyph
    # The left side bearing MUST equal xMin. Rasterizers use it to size the
    # glyph mask, so a stale zero bearing can shave the final component.
    hmtx_table[new_glyph_name] = (
        _checked_uint16(total_advance, "advance"),
        new_glyph.xMin,
    )
    if os.environ.get("LOG_LEVEL", "").upper() == "DEBUG":
        digest = hashlib.sha256(word.encode("utf-8")).hexdigest()[:16]
        print(
            f"[..] composite text={digest} components={len(components)} "
            f"bounds=({new_glyph.xMin},{new_glyph.yMin},"
            f"{new_glyph.xMax},{new_glyph.yMax}) advance={total_advance} "
            f"lsb={new_glyph.xMin}"
        )

    if new_glyph_name not in glyph_order:
        glyph_order.append(new_glyph_name)
        font.setGlyphOrder(glyph_order)

    # GDEF is assembled after all composites exist so its class and coverage
    # data can be kept in glyph-ID order.  Retain the shaped caret inputs until
    # that pass, including zero/negative offsets on the source glyphs.
    pending = getattr(font, "_shieldfont_pending_carets", None)
    if pending is None:
        pending = {}
        font._shieldfont_pending_carets = pending
    pending[new_glyph_name] = (caret_coordinates, total_advance)

    return True

def _wrap_ext(otTables, base_lookup_type, subtable):
    """Wrap a GSUB subtable in an Extension (LookupType 7) so its parent
    Lookup uses 32-bit offsets — avoids 16-bit overflow on large tables."""
    ext = otTables.ExtensionSubst()
    ext.Format = 1
    ext.ExtensionLookupType = base_lookup_type
    ext.ExtSubTable = subtable
    return ext


def _append_unique_feature_index(lang_sys, feature_index):
    indices = list(getattr(lang_sys, "FeatureIndex", []) or [])
    if feature_index not in indices:
        indices.append(feature_index)
    lang_sys.FeatureIndex = indices
    lang_sys.FeatureCount = len(indices)


def _insert_feature_index(lang_sys, feature_index, *, after=None):
    indices = list(getattr(lang_sys, "FeatureIndex", []) or [])
    if feature_index in indices:
        return
    if after is None:
        indices.insert(0, feature_index)
    elif after in indices:
        indices.insert(indices.index(after) + 1, feature_index)
    else:
        indices.append(feature_index)
    lang_sys.FeatureIndex = indices
    lang_sys.FeatureCount = len(indices)


def _new_langsys_from_default(default_lang_sys):
    lang_sys = otTables.LangSys()
    lang_sys.LookupOrder = None
    lang_sys.ReqFeatureIndex = getattr(default_lang_sys, "ReqFeatureIndex", 0xFFFF)
    lang_sys.FeatureIndex = list(getattr(default_lang_sys, "FeatureIndex", []) or [])
    lang_sys.FeatureCount = len(lang_sys.FeatureIndex)
    return lang_sys


def _serialized_langsys_tag(language):
    """OpenType stores registered three-letter language tags in four bytes."""
    return language if len(language) == 4 else language.ljust(4)


def choose_source_feature_tag(font):
    """Prefer ccmp, then locl, retaining the legacy client placement."""
    if not _has_font_table(font, "GSUB") or not hasattr(font["GSUB"], "table"):
        return "ccmp", "no-gsub"
    records = getattr(
        getattr(font["GSUB"].table, "FeatureList", None),
        "FeatureRecord",
        [],
    ) or []
    tags = {record.FeatureTag for record in records}
    if "ccmp" in tags:
        return "ccmp", "existing-ccmp"
    if "locl" in tags:
        return "locl", "compatibility-locl-fallback"
    return "ccmp", "dedicated-ccmp"


def activate_feature_for_script_langsys(
    font,
    feature_tag,
    lookup_indices,
    *,
    script_langsys=None,
    placement="append",
    after_feature_index=None,
    stage="required",
):
    """Attach generated lookups to explicit OpenType Script/LangSys records.

    With no selector this retains activation for every existing Script/LangSys
    while using a dedicated feature record.  The dedicated record is important
    for NFD input: base ``ccmp`` composition must run before generated
    ligatures.  A selector attaches that record only to the requested systems,
    leaving base ``ccmp``/``locl`` feature records and lookup ordering intact.
    """
    if not _has_font_table(font, "GSUB") or not hasattr(font["GSUB"], "table"):
        return {"decision": "no-gsub", "activated": 0, "feature_index": None}
    gsub = font["GSUB"].table
    script_list = getattr(gsub, "ScriptList", None)
    feature_list = getattr(gsub, "FeatureList", None)
    if script_list is None or feature_list is None:
        return {
            "decision": "missing-layout-lists",
            "activated": 0,
            "feature_index": None,
        }
    lookup_indices = list(dict.fromkeys(int(i) for i in lookup_indices))

    feature = otTables.Feature()
    feature.FeatureParams = None
    feature.LookupListIndex = lookup_indices
    feature.LookupCount = len(lookup_indices)
    record = otTables.FeatureRecord()
    record.FeatureTag = feature_tag
    record.Feature = feature
    feature_list.FeatureRecord.append(record)
    feature_list.FeatureCount = len(feature_list.FeatureRecord)
    feature_index = len(feature_list.FeatureRecord) - 1
    activated = 0
    records_by_tag = {item.ScriptTag: item for item in script_list.ScriptRecord}
    selected_scopes = script_langsys or {
        record.ScriptTag: [None]
        for record in script_list.ScriptRecord
    }
    for script_tag, languages in selected_scopes.items():
        script_record = records_by_tag.get(script_tag)
        if script_record is None:
            script_record = otTables.ScriptRecord()
            script_record.ScriptTag = script_tag
            script_record.Script = otTables.Script()
            script_record.Script.DefaultLangSys = otTables.DefaultLangSys()
            script_record.Script.DefaultLangSys.LookupOrder = None
            script_record.Script.DefaultLangSys.ReqFeatureIndex = 0xFFFF
            script_record.Script.DefaultLangSys.FeatureIndex = []
            script_record.Script.DefaultLangSys.FeatureCount = 0
            script_record.Script.LangSysRecord = []
            script_record.Script.LangSysCount = 0
            script_list.ScriptRecord.append(script_record)
            script_list.ScriptCount = len(script_list.ScriptRecord)
            records_by_tag[script_tag] = script_record
        selected = languages or [None]
        for language in selected:
            if language is None:
                if placement == "after":
                    _insert_feature_index(
                        script_record.Script.DefaultLangSys,
                        feature_index,
                        after=after_feature_index,
                    )
                elif placement == "front":
                    _insert_feature_index(
                        script_record.Script.DefaultLangSys, feature_index
                    )
                else:
                    _append_unique_feature_index(
                        script_record.Script.DefaultLangSys, feature_index
                    )
                activated += 1
                continue
            lang_record = next(
                (
                    item for item in script_record.Script.LangSysRecord or []
                    if str(item.LangSysTag).strip() == language
                ),
                None,
            )
            if lang_record is None:
                lang_record = otTables.LangSysRecord()
                lang_record.LangSysTag = _serialized_langsys_tag(language)
                default_lang_sys = script_record.Script.DefaultLangSys
                if default_lang_sys is None:
                    default_lang_sys = otTables.DefaultLangSys()
                    default_lang_sys.LookupOrder = None
                    default_lang_sys.ReqFeatureIndex = 0xFFFF
                    default_lang_sys.FeatureIndex = []
                    default_lang_sys.FeatureCount = 0
                    script_record.Script.DefaultLangSys = default_lang_sys
                lang_record.LangSys = _new_langsys_from_default(
                    default_lang_sys
                )
                script_record.Script.LangSysRecord.append(lang_record)
                script_record.Script.LangSysCount = len(script_record.Script.LangSysRecord)
            if placement == "after":
                _insert_feature_index(
                    lang_record.LangSys,
                    feature_index,
                    after=after_feature_index,
                )
            elif placement == "front":
                _insert_feature_index(lang_record.LangSys, feature_index)
            else:
                _append_unique_feature_index(lang_record.LangSys, feature_index)
            activated += 1
    print(
        f"[OK] Script/LangSys activation: feature={feature_tag} "
        f"scripts={len(selected_scopes)} activated={activated} "
        f"stage={stage} placement={placement} "
        f"merge_decision={'dedicated-feature' if script_langsys else 'dedicated-feature-all-scopes'}"
    )
    return {
        "decision": "dedicated-feature" if script_langsys else "dedicated-feature-all-scopes",
        "activated": activated,
        "feature_index": feature_index,
    }


def estimate_chain_context_size(
    backtrack_glyphs: int,
    input_glyphs: int,
    lookahead_glyphs: int,
    *,
    format: int = 3,
) -> int:
    """Estimate a single boundary rule without serializing private mapping data."""
    if format == 2:
        # Header/class definitions plus one class rule. Class 0 is implicit.
        return 24 + 6 * 3 + 2 * 3
    if format != 3:
        raise ValueError("ChainContext format must be 2 or 3")
    return 24 + 2 * (backtrack_glyphs + input_glyphs + lookahead_glyphs)


def _class_def(glyphs, glyph_ids, class_id=1):
    """Build a deterministic non-overlapping OpenType class definition."""
    values = {}
    for glyph in sorted(set(glyphs), key=glyph_ids.__getitem__):
        if glyph in values:
            raise ValueError("class coverage overlap")
        values[glyph] = class_id
    return values


def validate_class_partition(class_groups, glyph_ids):
    """Validate disjoint, GID-ordered classes for GSUB Format 2."""
    seen = set()
    for class_id, glyphs in sorted(class_groups.items()):
        ordered = sorted(glyphs, key=glyph_ids.__getitem__)
        if list(glyphs) != ordered:
            raise ValueError(f"class {class_id} coverage is not glyph-ID ordered")
        overlap = seen.intersection(glyphs)
        if overlap:
            raise ValueError(f"class coverage overlap in class {class_id}")
        seen.update(glyphs)
    return True


def _build_chain_context_class_rule(
    *,
    backtrack_glyphs,
    input_glyphs,
    lookahead_glyphs,
    glyph_ids,
    restore_lookup_index,
    direction,
):
    """Build one class-oriented ChainContext rule.

    The first input class is represented by ChainSubClassSet index 1; all
    remaining sequences are empty because boundary checks are one glyph wide.
    """
    table = otTables.ChainContextSubst()
    table.Format = 2
    table.BacktrackClassDef = otTables.ClassDef()
    table.InputClassDef = otTables.ClassDef()
    table.LookAheadClassDef = otTables.ClassDef()
    table.BacktrackClassDef.classDefs = _class_def(
        backtrack_glyphs, glyph_ids
    ) if backtrack_glyphs else {}
    table.InputClassDef.classDefs = _class_def(input_glyphs, glyph_ids)
    table.LookAheadClassDef.classDefs = _class_def(
        lookahead_glyphs, glyph_ids
    ) if lookahead_glyphs else {}
    table.ChainSubClassSet = [None, otTables.ChainSubClassSet()]
    rule = otTables.ChainSubClassRule()
    rule.Backtrack = [1] if backtrack_glyphs and direction == "before" else []
    rule.Input = []
    rule.LookAhead = [1] if lookahead_glyphs and direction == "after" else []
    record = otTables.SubstLookupRecord()
    record.SequenceIndex = 0
    record.LookupListIndex = restore_lookup_index
    rule.SubstLookupRecord = [record]
    rule.SubstCount = 1
    table.ChainSubClassSet[1].ChainSubClassRule = [rule]
    table.ChainSubClassSet[1].ChainSubClassRuleCount = 1
    table.ChainSubClassSetCount = 2
    return table


def build_gsub_word_boundary_ligatures(
    font,
    ligature_map,
    single_subst_map=None,
    *,
    script_langsys=None,
    supported_marks=None,
    feature_tag="ccmp",
    restoration_feature_tag=RESTORATION_FEATURE_TAG,
    optional_feature_tag=OPTIONAL_FEATURE_TAG,
    optimization="auto",
):
    """Word-boundary ligatures via explicit feature-stage FIRE-THEN-REVERT.

    OpenType GSUB has no way to express "edge of run" — a chain rule that
    requires a non-letter backtrack glyph fails when the input is at run
    start (no glyph available). That broke the per-length chained-context
    design at line wraps and at the start/end of every text node.

    The trick: don't gate substitution at all. Fire EVERY ligature
    unconditionally, then add a chain rule that REVERTS the substitution
    when the substituted glyph has a letter neighbor (which means it
    fired inside a larger word, not on a standalone word). The reverter
    only fires when a letter is adjacent — and that check naturally fails
    at run edges (no glyph available) AND at natural word boundaries
    (space/punct on each side, neither is a letter).

    Lookups:
      A. LigatureSubst (Type 4)         all multi-char ligatures, fires anywhere
      B. SingleSubst (Type 1)           digit forward swaps (1->6, 3->8, 4->9)
      C. MultipleSubst (Type 2)         REVERSAL: word.X -> input chars,
                                        substituted-digit -> original digit
      D. ChainContext (Type 6 Fmt 3)    backtrack=letter, input=substituted-glyph
                                          -> invoke C (letter-before reverter)
      E. ChainContext (Type 6 Fmt 3)    input=substituted-glyph, lookahead=letter
                                          -> invoke C (letter-after reverter)

    Required-source (ccmp, or locl as a compatibility fallback) contains
    A/B. Required-restoration (rlig) contains D/E and invokes C. Optional
    calt/dlig/liga settings never gate this pipeline. Lookup IDs are ordered
    fire A/B, class-boundary D/E, internal restore C.
    """
    if not ligature_map and not single_subst_map:
        print("[WARN] No ligatures or singles to add")
        return
    if not (_has_font_table(font, "GSUB") and hasattr(font["GSUB"], "table")):
        print("[FAIL] GSUB missing")
        return

    gsub = font["GSUB"].table
    mark_set_index = None
    if supported_marks is not None:
        _mark_glyphs, mark_set_index = ensure_gdef_mark_data(
            font, supported_marks, ligature_map.keys()
        )
    cmap = font.getBestCmap()
    glyph_set = set(font.getGlyphOrder())

    # LETTER = alphabetic only (no apostrophe; quoted shorts like 'on' need it
    # to be non-letter so chain backtrack/lookahead matches it as a boundary).
    letter_glyphs = set()
    for cp, gname in cmap.items():
        if chr(cp).isalpha():
            letter_glyphs.add(gname)
    letter_glyphs &= glyph_set
    letter_list = sorted(letter_glyphs)
    if not letter_list:
        print("[FAIL] No letter glyphs in font")
        return

    # Validate ligature entries
    valid_ligs = {}
    skipped = 0
    for output_glyph, input_glyphs in ligature_map.items():
        if (
            output_glyph in glyph_set
            and input_glyphs
            and all(g in glyph_set for g in input_glyphs)
        ):
            valid_ligs[output_glyph] = list(input_glyphs)
        else:
            skipped += 1
    valid_singles = {}
    if single_subst_map:
        for src, tgt in single_subst_map.items():
            if src in glyph_set and tgt in glyph_set:
                valid_singles[src] = tgt
    if skipped:
        print(f"[..] Skipped {skipped} ligature entries (missing glyphs)")
    print(f"[..] LETTER coverage: {len(letter_list)} glyphs")
    print(f"[..] Building ligature_lookup ({len(valid_ligs)} entries) + "
          f"digit_lookup ({len(valid_singles)} entries)")

    # ---- Lookup A: LigatureSubst (Type 4) ----
    first_glyph_map = {}
    for output_glyph, input_glyphs in valid_ligs.items():
        first = input_glyphs[0]
        rest = list(input_glyphs[1:])
        first_glyph_map.setdefault(first, []).append((rest, output_glyph))
    for first in first_glyph_map:
        first_glyph_map[first].sort(key=lambda x: -len(x[0]))  # longest first

    # Split into multiple LigatureSubst subtables bounded by estimated compiled
    # BYTE size. In a LigatureSubst the Coverage table is emitted after all the
    # LigatureSets, so its 16-bit offset (from the subtable start) overflows
    # once the ligature data passes ~64KB. Bounding each subtable well under
    # that lets the whole table serialize in a single pass instead of sending
    # fontTools into a slow, per-overflow recompile loop.
    #
    # A large first-glyph group may span consecutive subtables. Its ligatures
    # stay in longest-first order (sorted above); a LigatureLookup tries its
    # subtables in order, so for any prefix pair the longer ligature — which
    # sorts first and thus lands in an earlier-or-equal subtable — is reached
    # first. Matching stays correct.
    LIG_SUBTABLE_BUDGET = 40 * 1024  # conservative margin under the 64KB limit
    lig_subtables = []
    lig_subtable_sizes = []

    def _new_lig_subtable():
        st = otTables.LigatureSubst()
        st.Format = 1
        st.ligatures = {}
        return st

    _cur = _new_lig_subtable()
    _cur_bytes = 6  # SubstFormat + Coverage offset + LigSetCount
    for first, lst in first_glyph_map.items():  # lst sorted longest-first
        for rest, out_glyph in lst:
            lig = otTables.Ligature()
            lig.LigGlyph = out_glyph
            lig.Component = rest
            lig.CompCount = len(rest) + 1
            # Ligature record + its offset within the LigatureSet; a first
            # occurrence of this first-glyph also adds a LigSet offset + count.
            rec_bytes = 2 + (2 + 2 + len(rest) * 2)
            if first not in _cur.ligatures:
                rec_bytes += 4
            if _cur_bytes + rec_bytes > LIG_SUBTABLE_BUDGET and _cur.ligatures:
                lig_subtables.append(_cur)
                lig_subtable_sizes.append(_cur_bytes)
                _cur = _new_lig_subtable()
                _cur_bytes = 6
                rec_bytes = 2 + (2 + 2 + len(rest) * 2) + 4
            _cur.ligatures.setdefault(first, []).append(lig)
            _cur_bytes += rec_bytes
    if _cur.ligatures:
        lig_subtables.append(_cur)
        lig_subtable_sizes.append(_cur_bytes)

    # Wrap in an Extension lookup (Type 7). This moves the bulky ligature data
    # behind 32-bit offsets and to the end of the table, so the small
    # word-boundary ChainContext lookups (and their coverages) stay clustered
    # at the front within 16-bit reach — otherwise the chains' coverage offsets
    # overflow across all this data and the pure-python serializer can't fix it.
    lig_lookup = otTables.Lookup()
    lig_lookup.LookupType = 4
    lig_lookup.LookupFlag = 0
    lig_lookup.SubTable = lig_subtables
    lig_lookup.SubTableCount = len(lig_subtables)
    _set_lookup_mark_filter(lig_lookup, mark_set_index)
    print(
        f"[..] LigatureSubst split into {len(lig_subtables)} byte-bounded "
        f"subtables bytes={','.join(map(str, lig_subtable_sizes[:8]))}"
        f"{',...' if len(lig_subtable_sizes) > 8 else ''}"
    )

    # ---- Lookup B: SingleSubst (Type 1) for digits ----
    digit_lookup = None
    if valid_singles:
        single_subst = otTables.SingleSubst()
        single_subst.mapping = dict(valid_singles)
        digit_lookup = otTables.Lookup()
        digit_lookup.LookupType = 1
        digit_lookup.LookupFlag = 0
        digit_lookup.SubTableCount = 1
        digit_lookup.SubTable = [single_subst]
        _set_lookup_mark_filter(digit_lookup, mark_set_index)

    # ---- Lookup C: MultipleSubst (Type 2) for reversal ----
    # word.X -> [input chars from ligature_map]
    # substituted-digit -> [original digit]
    revert_map = {}
    for output_glyph, input_glyphs in valid_ligs.items():
        revert_map[output_glyph] = list(input_glyphs)
    for src, tgt in valid_singles.items():
        # We substituted src -> tgt. To revert tgt back to src.
        revert_map[tgt] = [src]

    # Split the reversal MultipleSubst into bounded subtables too (same reason
    # as the ligature split — one 36k-entry subtable overflows 16-bit offsets).
    # Coverage is disjoint by key, so the split is semantically identical.
    MAX_REVERT_PER_SUBTABLE = 1500
    multi_subtables = []
    multi_subtable_sizes = []
    _revert_items = list(revert_map.items())
    for i in range(0, len(_revert_items), MAX_REVERT_PER_SUBTABLE):
        ms = otTables.MultipleSubst()
        items = _revert_items[i:i + MAX_REVERT_PER_SUBTABLE]
        ms.mapping = dict(items)
        multi_subtables.append(ms)
        multi_subtable_sizes.append(
            6 + sum(6 + (len(value) * 2) for _key, value in items)
        )
    # Extension-wrap the reversal lookup too (same reason as the ligature one:
    # keep its bulk behind 32-bit offsets so the ChainContext coverages stay
    # within 16-bit reach at the front of the table).
    multi_lookup = otTables.Lookup()
    multi_lookup.LookupType = 2
    multi_lookup.LookupFlag = 0
    multi_lookup.SubTable = multi_subtables
    multi_lookup.SubTableCount = len(multi_subtables)
    print(
        f"[..] MultipleSubst split into {len(multi_subtables)} subtables "
        f"bytes={','.join(map(str, multi_subtable_sizes[:8]))}"
        f"{',...' if len(multi_subtable_sizes) > 8 else ''}"
    )

    # Coverage glyph lists MUST be sorted by glyph ID, not name. fontTools builds
    # Format-2 coverage ranges by walking this list and coalescing CONSECUTIVE
    # GIDs; name order scrambles the GIDs, so a set that is really a few
    # ID-contiguous runs (~70 bytes) fragments into ~12k singleton ranges (~72KB)
    # and overflows the chain subtable's internal 16-bit InputCoverage offset.
    # GID order keeps every chain coverage tiny and the whole GSUB serializes in
    # one pass. (This is the actual fix for the large-mapping build failure.)
    glyph_ids = font.getReverseGlyphMap(rebuild=True)
    substituted_glyphs = sorted(revert_map.keys(), key=glyph_ids.__getitem__)
    # The "word substituted" set = word.X glyphs only (NOT digit-target glyphs).
    # When checking if a substituted-glyph's neighbor is "letter-like", we
    # include adjacent word.X glyphs as letter-equivalent (so 'inwards' →
    # [word.on, word.peace, d, s] reverts both — word.on's lookahead is
    # word.peace, treated as letter-equivalent).
    #
    # CRUCIAL: digit-target glyphs (one/six/three/eight/four/nine after a
    # forward 1↔6/3↔8/4↔9 swap) MUST be excluded — otherwise '1568' →
    # [six, five, one, three] would revert because 'one' has 'three' (a
    # substituted digit) as lookahead. We want adjacent digits to STAY
    # substituted; only revert digits when bounded by actual letters.
    word_substituted = set(g for g in substituted_glyphs if g.startswith("word."))
    boundary_coverage = sorted(
        letter_glyphs | word_substituted, key=glyph_ids.__getitem__
    )  # GID order — see above

    format3_estimate = (
        estimate_chain_context_size(
            len(boundary_coverage), len(substituted_glyphs), 0, format=3
        )
        + estimate_chain_context_size(
            0, len(substituted_glyphs), len(boundary_coverage), format=3
        )
    )
    format2_estimate = (
        estimate_chain_context_size(
            len(boundary_coverage), len(substituted_glyphs), 0, format=2
        )
        + estimate_chain_context_size(
            0, len(substituted_glyphs), len(boundary_coverage), format=2
        )
    )
    class_candidate = optimization in {"auto", "format2"} and (
        optimization == "format2" or format2_estimate < format3_estimate
    )
    # A class rule is only safe after a real shaping/collision oracle has
    # accepted the serialized font. This low-level builder has no text oracle,
    # so it deliberately keeps the proven Format 3 path until an orchestrator
    # supplies one. The candidate and estimate remain visible for benchmarking.
    use_class_rules = False
    if class_candidate:
        try:
            _class_def(boundary_coverage, glyph_ids)
            _class_def(substituted_glyphs, glyph_ids)
        except (KeyError, ValueError):
            class_candidate = False
        if class_candidate:
            print("[WARN] GSUB class optimization requires shaping validation; "
                  "using deterministic Format 3 fallback")
    print(
        f"[OK] GSUB boundary optimization: format2_estimate={format2_estimate} "
        f"format3_estimate={format3_estimate} "
        f"selected={'class-Format2' if use_class_rules else 'Format3'}"
    )

    # ---- Lookup D: ChainContext letter-BEFORE reverter ----
    if use_class_rules:
        chain_d = _build_chain_context_class_rule(
            backtrack_glyphs=boundary_coverage,
            input_glyphs=substituted_glyphs,
            lookahead_glyphs=[],
            glyph_ids=glyph_ids,
            restore_lookup_index=-1,
            direction="before",
        )
        rec_d = chain_d.ChainSubClassSet[1].ChainSubClassRule[0].SubstLookupRecord[0]
    else:
        chain_d = otTables.ChainContextSubst()
        chain_d.Format = 3
        bt_cov = otTables.Coverage(); bt_cov.glyphs = boundary_coverage
        chain_d.BacktrackCoverage = [bt_cov]
        chain_d.BacktrackGlyphCount = 1
        in_cov_d = otTables.Coverage(); in_cov_d.glyphs = substituted_glyphs
        chain_d.InputCoverage = [in_cov_d]
        chain_d.InputGlyphCount = 1
        chain_d.LookAheadCoverage = []
        chain_d.LookAheadGlyphCount = 0
        rec_d = otTables.SubstLookupRecord()
        rec_d.SequenceIndex = 0
        rec_d.LookupListIndex = -1  # placeholder, set after appending
        chain_d.SubstLookupRecord = [rec_d]
        chain_d.SubstCount = 1
    chain_d_lookup = otTables.Lookup()
    chain_d_lookup.LookupType = 6
    chain_d_lookup.LookupFlag = 0
    chain_d_lookup.SubTableCount = 1
    chain_d_lookup.SubTable = [chain_d]
    _set_lookup_mark_filter(chain_d_lookup, mark_set_index)

    # ---- Lookup E: ChainContext letter-AFTER reverter ----
    if use_class_rules:
        chain_e = _build_chain_context_class_rule(
            backtrack_glyphs=[],
            input_glyphs=substituted_glyphs,
            lookahead_glyphs=boundary_coverage,
            glyph_ids=glyph_ids,
            restore_lookup_index=-1,
            direction="after",
        )
        rec_e = chain_e.ChainSubClassSet[1].ChainSubClassRule[0].SubstLookupRecord[0]
    else:
        chain_e = otTables.ChainContextSubst()
        chain_e.Format = 3
        chain_e.BacktrackCoverage = []
        chain_e.BacktrackGlyphCount = 0
        in_cov_e = otTables.Coverage(); in_cov_e.glyphs = substituted_glyphs
        chain_e.InputCoverage = [in_cov_e]
        chain_e.InputGlyphCount = 1
        la_cov = otTables.Coverage(); la_cov.glyphs = boundary_coverage
        chain_e.LookAheadCoverage = [la_cov]
        chain_e.LookAheadGlyphCount = 1
        rec_e = otTables.SubstLookupRecord()
        rec_e.SequenceIndex = 0
        rec_e.LookupListIndex = -1  # placeholder
        chain_e.SubstLookupRecord = [rec_e]
        chain_e.SubstCount = 1
    chain_e_lookup = otTables.Lookup()
    chain_e_lookup.LookupType = 6
    chain_e_lookup.LookupFlag = 0
    chain_e_lookup.SubTableCount = 1
    chain_e_lookup.SubTable = [chain_e]
    _set_lookup_mark_filter(chain_e_lookup, mark_set_index)

    # Append lookups (their final indices will be re-mapped after the
    # front-shift below).  The order is intentional: fire, class/boundary,
    # then the internally-invoked restoration lookup.
    base = len(gsub.LookupList.Lookup)
    new_lookups = [lig_lookup]
    if digit_lookup:
        new_lookups.append(digit_lookup)
    new_lookups.extend([chain_d_lookup, chain_e_lookup, multi_lookup])
    for lk in new_lookups:
        gsub.LookupList.Lookup.append(lk)

    lig_idx_init = base
    digit_idx_init = base + 1 if digit_lookup else None
    chain_d_idx_init = base + (2 if digit_lookup else 1)
    chain_e_idx_init = chain_d_idx_init + 1
    multi_idx_init = chain_e_idx_init + 1

    # Wire chain SubstLookupRecord to point at multi_lookup
    rec_d.LookupListIndex = multi_idx_init
    rec_e.LookupListIndex = multi_idx_init

    print(f"  [..] Lookups appended: lig={lig_idx_init} digit={digit_idx_init} "
          f"multi={multi_idx_init} chain_d={chain_d_idx_init} chain_e={chain_e_idx_init}")

    # ----- Move all new lookups to LookupList front -----
    # OpenType applies lookups in LookupList order. Optik's built-in fi/fl
    # ligature is at a low index; moving ours to indices 0..4 ensures
    # they fire FIRST. Then renumber all references throughout.
    new_indices = [lig_idx_init]
    if digit_idx_init is not None:
        new_indices.append(digit_idx_init)
    new_indices.extend([chain_d_idx_init, chain_e_idx_init, multi_idx_init])
    new_set = set(new_indices)

    rebuilt = [gsub.LookupList.Lookup[i] for i in new_indices]
    rebuilt.extend(
        gsub.LookupList.Lookup[i] for i in range(len(gsub.LookupList.Lookup))
        if i not in new_set
    )
    n_new = len(new_indices)
    remap = {old_i: new_i for new_i, old_i in enumerate(new_indices)}
    next_slot = n_new
    for old_i in range(len(gsub.LookupList.Lookup)):
        if old_i not in new_set:
            remap[old_i] = next_slot
            next_slot += 1
    gsub.LookupList.Lookup = rebuilt
    gsub.LookupList.LookupCount = len(rebuilt)

    # New indices for our public-facing lookups (post-shift):
    lig_idx = remap[lig_idx_init]
    digit_idx = remap[digit_idx_init] if digit_idx_init is not None else None
    multi_idx = remap[multi_idx_init]
    chain_d_idx = remap[chain_d_idx_init]
    chain_e_idx = remap[chain_e_idx_init]

    # Patch SubstLookupRecord refs INSIDE all chain/context lookups (Optik's too)
    for fr in gsub.FeatureList.FeatureRecord:
        fr.Feature.LookupListIndex = [remap[i] for i in fr.Feature.LookupListIndex]
        fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)

    def _patch_refs(st):
        for rec in getattr(st, "SubstLookupRecord", []) or []:
            rec.LookupListIndex = remap[rec.LookupListIndex]
        for attr in ("SubRuleSet", "ChainSubRuleSet"):
            sets = getattr(st, attr, None)
            if not sets: continue
            for rs in sets:
                if rs is None: continue
                rules = getattr(rs, "SubRule", None) or getattr(rs, "ChainSubRule", None)
                for rule in (rules or []):
                    for rec in getattr(rule, "SubstLookupRecord", []) or []:
                        rec.LookupListIndex = remap[rec.LookupListIndex]
        for attr in ("SubClassSet", "ChainSubClassSet"):
            sets = getattr(st, attr, None)
            if not sets: continue
            for cs in sets:
                if cs is None: continue
                rules = getattr(cs, "SubClassRule", None) or getattr(cs, "ChainSubClassRule", None)
                for rule in (rules or []):
                    for rec in getattr(rule, "SubstLookupRecord", []) or []:
                        rec.LookupListIndex = remap[rec.LookupListIndex]

    for lk in gsub.LookupList.Lookup:
        for st in lk.SubTable:
            _patch_refs(st.ExtSubTable if lk.LookupType == 7 else st)

    print(f"  [..] Moved {n_new} lookups to LookupList front; patched all references")

    # ----- Wire the explicit feature stages -----
    # IMPORTANT: skip multi_idx (C) — it is invoked only via SubstLookupRecord.
    public_indices = [lig_idx]
    if digit_idx is not None:
        public_indices.append(digit_idx)
    source_activation = activate_feature_for_script_langsys(
        font,
        feature_tag,
        public_indices,
        script_langsys=script_langsys,
        placement="front",
        stage="required-source",
    )
    restoration_activation = activate_feature_for_script_langsys(
        font,
        restoration_feature_tag,
        [chain_d_idx, chain_e_idx],
        script_langsys=script_langsys,
        placement="after",
        after_feature_index=source_activation.get("feature_index"),
        stage="required-restoration",
    )
    print(
        f"[OK] Feature stages: required-source={feature_tag}["
        f"{','.join(map(str, public_indices))}] "
        f"required-restoration={restoration_feature_tag}["
        f"{chain_d_idx},{chain_e_idx}] "
        f"optional={optional_feature_tag}(not-required)"
    )
    print(
        f"[OK] Fire-then-revert GSUB built: lig={lig_idx} digit={digit_idx} "
        f"multi={multi_idx} chain_d={chain_d_idx} chain_e={chain_e_idx}; "
        f"feature={feature_tag}; restoration_feature={restoration_feature_tag}"
    )
    print(
        f"[OK] Fire-then-revert GSUB built: fire={public_indices} "
        f"boundary=[{chain_d_idx},{chain_e_idx}] restore={multi_idx} "
        f"source_feature_id={source_activation.get('feature_index')} "
        f"restoration_feature_id={restoration_activation.get('feature_index')} "
        f"order=fire>class-boundary>restore"
    )



def build_gsub_single_substitutions(font, single_subst_map):
    """Add a GSUB Type 1 (single substitution) lookup for 1-char swaps like digit rotation.

    Wires into liga + calt features so it fires alongside the ligature lookups.
    """
    if not single_subst_map:
        return

    sub_st = otTables.SingleSubst()
    sub_st.mapping = dict(single_subst_map)

    lookup = otTables.Lookup()
    lookup.LookupType = 1
    lookup.LookupFlag = 0
    lookup.SubTableCount = 1
    lookup.SubTable = [sub_st]

    if not ("GSUB" in font and hasattr(font["GSUB"], "table")):
        print("[WARN] GSUB missing — single-substs cannot attach")
        return

    gsub = font["GSUB"].table
    our_index = len(gsub.LookupList.Lookup)
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)

    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag in ("liga", "calt"):
            fr.Feature.LookupListIndex.insert(0, our_index)
            fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)

    print(f"[OK] Added GSUB single-subst lookup: {len(single_subst_map)} entries (digits etc.)")


def build_gsub_ligatures_merged(font, ligature_map):
    """
    Build ligature lookup and MERGE with any existing GSUB table.
    This preserves Datatype's data-viz features, Syne's kerning, etc.
    """
    if not ligature_map:
        print("[WARN] No ligatures to add")
        return

    # Group by first glyph
    first_glyph_map = {}
    for lig_glyph, component_glyphs in ligature_map.items():
        if len(component_glyphs) < 1:
            continue
        first = component_glyphs[0]
        rest = component_glyphs[1:] if len(component_glyphs) > 1 else []
        if first not in first_glyph_map:
            first_glyph_map[first] = []
        first_glyph_map[first].append((rest, lig_glyph))

    for first in first_glyph_map:
        first_glyph_map[first].sort(key=lambda x: -len(x[0]))

    # Build LigatureSubst subtable
    lig_subst = otTables.LigatureSubst()
    lig_subst.Format = 1
    lig_subst.ligatures = {}

    for first_glyph, entries in sorted(first_glyph_map.items()):
        ligs = []
        for remaining, lig_glyph_name in entries:
            lig = otTables.Ligature()
            lig.LigGlyph = lig_glyph_name
            lig.Component = remaining
            lig.CompCount = len(remaining) + 1
            ligs.append(lig)
        lig_subst.ligatures[first_glyph] = ligs

    # Build our Lookup
    lookup = otTables.Lookup()
    lookup.LookupType = 4
    lookup.LookupFlag = 0
    lookup.SubTableCount = 1
    lookup.SubTable = [lig_subst]

    has_existing_gsub = "GSUB" in font and hasattr(font["GSUB"], "table")

    if has_existing_gsub:
        print("[..] Merging with existing GSUB table")
        gsub = font["GSUB"].table

        # Append our lookup
        our_lookup_index = len(gsub.LookupList.Lookup)
        gsub.LookupList.Lookup.append(lookup)
        gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)

        # Find or create 'liga' and 'calt' features pointing to our lookup.
        # CRITICAL: insert our lookup at the FRONT of each feature's LookupListIndex
        # so it fires BEFORE the base font's built-in ligatures (e.g., Optik's f+i,
        # f+f, f+l ligatures would otherwise eat letter pairs that are part of our
        # encoded substitute words like "office" → eats "ffi" before our word match).
        liga_found = False
        calt_found = False
        for feat_rec in gsub.FeatureList.FeatureRecord:
            if feat_rec.FeatureTag == "liga":
                feat_rec.Feature.LookupListIndex.insert(0, our_lookup_index)
                feat_rec.Feature.LookupCount = len(feat_rec.Feature.LookupListIndex)
                liga_found = True
            elif feat_rec.FeatureTag == "calt":
                feat_rec.Feature.LookupListIndex.insert(0, our_lookup_index)
                feat_rec.Feature.LookupCount = len(feat_rec.Feature.LookupListIndex)
                calt_found = True

        feat_indices_to_add = []

        if not liga_found:
            feat = otTables.Feature()
            feat.FeatureParams = None
            feat.LookupListIndex = [our_lookup_index]
            feat.LookupCount = 1
            fr = otTables.FeatureRecord()
            fr.FeatureTag = "liga"
            fr.Feature = feat
            gsub.FeatureList.FeatureRecord.append(fr)
            gsub.FeatureList.FeatureCount = len(gsub.FeatureList.FeatureRecord)
            feat_indices_to_add.append(len(gsub.FeatureList.FeatureRecord) - 1)

        if not calt_found:
            feat = otTables.Feature()
            feat.FeatureParams = None
            feat.LookupListIndex = [our_lookup_index]
            feat.LookupCount = 1
            fr = otTables.FeatureRecord()
            fr.FeatureTag = "calt"
            fr.Feature = feat
            gsub.FeatureList.FeatureRecord.append(fr)
            gsub.FeatureList.FeatureCount = len(gsub.FeatureList.FeatureRecord)
            feat_indices_to_add.append(len(gsub.FeatureList.FeatureRecord) - 1)

        # Add new feature indices to script records
        if feat_indices_to_add:
            for sr in gsub.ScriptList.ScriptRecord:
                if sr.Script.DefaultLangSys:
                    sr.Script.DefaultLangSys.FeatureIndex.extend(feat_indices_to_add)
                    sr.Script.DefaultLangSys.FeatureCount = len(sr.Script.DefaultLangSys.FeatureIndex)
                for ls in sr.Script.LangSysRecord:
                    if ls.LangSys:
                        ls.LangSys.FeatureIndex.extend(feat_indices_to_add)
                        ls.LangSys.FeatureCount = len(ls.LangSys.FeatureIndex)

        print(f"[OK] Merged {len(ligature_map)} ligature rules into existing GSUB")
    else:
        # No existing GSUB — build from scratch (same as original script)
        print("[..] Building new GSUB table")
        feature_liga = otTables.Feature()
        feature_liga.FeatureParams = None
        feature_liga.LookupListIndex = [0]
        feature_liga.LookupCount = 1
        fr_liga = otTables.FeatureRecord()
        fr_liga.FeatureTag = "liga"
        fr_liga.Feature = feature_liga

        feature_calt = otTables.Feature()
        feature_calt.FeatureParams = None
        feature_calt.LookupListIndex = [0]
        feature_calt.LookupCount = 1
        fr_calt = otTables.FeatureRecord()
        fr_calt.FeatureTag = "calt"
        fr_calt.Feature = feature_calt

        feature_list = otTables.FeatureList()
        feature_list.FeatureCount = 2
        feature_list.FeatureRecord = [fr_liga, fr_calt]

        default_lang_sys = otTables.DefaultLangSys()
        default_lang_sys.ReqFeatureIndex = 0xFFFF
        default_lang_sys.FeatureIndex = [0, 1]
        default_lang_sys.FeatureCount = 2
        default_lang_sys.LookupOrder = None

        dflt_script = otTables.ScriptRecord()
        dflt_script.ScriptTag = "DFLT"
        dflt_script.Script = otTables.Script()
        dflt_script.Script.DefaultLangSys = default_lang_sys
        dflt_script.Script.LangSysRecord = []
        dflt_script.Script.LangSysCount = 0

        latn_lang_sys = otTables.DefaultLangSys()
        latn_lang_sys.ReqFeatureIndex = 0xFFFF
        latn_lang_sys.FeatureIndex = [0, 1]
        latn_lang_sys.FeatureCount = 2
        latn_lang_sys.LookupOrder = None

        latn_script = otTables.ScriptRecord()
        latn_script.ScriptTag = "latn"
        latn_script.Script = otTables.Script()
        latn_script.Script.DefaultLangSys = latn_lang_sys
        latn_script.Script.LangSysRecord = []
        latn_script.Script.LangSysCount = 0

        script_list = otTables.ScriptList()
        script_list.ScriptCount = 2
        script_list.ScriptRecord = [dflt_script, latn_script]

        lookup_list = otTables.LookupList()
        lookup_list.LookupCount = 1
        lookup_list.Lookup = [lookup]

        gsub = otTables.GSUB()
        gsub.Version = 0x00010000
        gsub.ScriptList = script_list
        gsub.FeatureList = feature_list
        gsub.LookupList = lookup_list

        from fontTools.ttLib.tables import G_S_U_B_
        gsub_table = G_S_U_B_.table_G_S_U_B_()
        gsub_table.table = gsub
        gsub_table.table.Version = 0x00010000
        font["GSUB"] = gsub_table

        print(f"[OK] Built new GSUB with {len(ligature_map)} ligature rules")


def derive_family(font):
    """Read the BASE font's own family name from its name table.

    Tries the typographic family (nameID 16) first, then the legacy family
    (nameID 1); prefers the Windows/Unicode record, falls back to the Mac
    record. Returns the trimmed name, or None if the name table has neither.

    This is what makes "turn any font into a shieldfont" literal: with no
    --name, the OUTPUT family carries the INPUT font's own name (that's why the
    flagship reads 'Optik' — it's the base's name, not a hardcoded string).
    MUST be read BEFORE the rename block overwrites these records.
    """
    if "name" not in font:
        return None
    name = font["name"]
    for nid in (16, 1):  # typographic family, then legacy family
        rec = name.getName(nid, 3, 1, 0x409) or name.getName(nid, 1, 0, 0)
        if rec is None:
            continue
        try:
            text = rec.toUnicode()
        except Exception:
            text = str(rec)
        text = (text or "").strip()
        if text:
            return text
    return None


def slugify(name):
    """Turn a family name into a filesystem/URL-safe output prefix.

    'Optik' -> 'optik', 'Young Serif' -> 'young-serif'. Falls back to
    'shieldfont' if the name has no alphanumerics.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug or "shieldfont"


def warn_if_ofl_rfn(font, family_name):
    """Warn (do NOT block) when building on an OFL base under its own name.

    Many OFL fonts (Inter included) declare a Reserved Font Name; shipping a
    modified font under the base's exact family name violates OFL §1. Detection
    is cheap and imperfect — we scan the license description / URL nameIDs.
    Only called when --name was auto-derived (an explicit --name is the user's
    deliberate choice and needs no warning).
    """
    if "name" not in font:
        return
    name = font["name"]
    license_text = ""
    for nid in (13, 14):  # License Description, License URL
        rec = name.getName(nid, 3, 1, 0x409) or name.getName(nid, 1, 0, 0)
        if rec is None:
            continue
        try:
            license_text += " " + rec.toUnicode()
        except Exception:
            license_text += " " + str(rec)
    lt = license_text.lower()
    if "open font license" in lt or "scripts.sil.org/ofl" in lt or "openfontlicense" in lt:
        print(
            f"[WARN] Base font looks OFL-licensed and you did not pass --name: its family "
            f"name '{family_name}' may be a Reserved Font Name. Shipping a modified font "
            f"under it can violate OFL §1 — rerun with --name \"{family_name} Shielded\" "
            f"(or another distinct name) to be safe."
        )


def main():
    parser = argparse.ArgumentParser(description="Generate ShieldFont variant")
    base_source = parser.add_mutually_exclusive_group(required=True)
    base_source.add_argument("--base-url", help="Google Fonts download URL")
    base_source.add_argument("--base-path", help="Path to a local TTF/OTF file")
    parser.add_argument("--cache-name", help="Filename for cached base font (required with --base-url)")
    parser.add_argument("--name", help="Font family name written into the output "
                        "(e.g. 'ShieldFont Datatype'). OPTIONAL — when omitted, the "
                        "family name is derived from the BASE font's own name table "
                        "(nameID 16, then 1), so the input font's name carries through.")
    parser.add_argument("--prefix", help="Output file prefix → public/fonts/<prefix>.{ttf,woff2,css}. "
                        "OPTIONAL — when omitted, it is a slug of the (derived or given) family name.")
    parser.add_argument("--copyright", default="Modified as ShieldFont.", help="Copyright notice")
    parser.add_argument("--weight", type=int, choices=sorted(WEIGHT_SUBFAMILY),
                        help="Numeric weight of the SOURCE cut (400..900). VERIFIED against the "
                             "base font's OS/2 usWeightClass — the build fails on a mismatch so a "
                             "Bold build can never silently read the Medium master. The outlines "
                             "are never touched: no interpolation, no synthetic bolding; pass the "
                             "real static cut via --base-path. Also derives the default "
                             "--subfamily and the numeric font-weight in the emitted CSS. "
                             "OPTIONAL — omitted keeps the pre-multi-weight behaviour (subfamily "
                             "'Regular', CSS font-weight normal).")
    parser.add_argument("--subfamily",
                        help="Subfamily / style name for nameIDs 2 and 17 (and the PostScript "
                             "name suffix). Default: derived from --weight via Playtype's own "
                             "cut names (Regular/Medium/DemiBold/Bold/ExtraBold/Black), else "
                             "'Regular'.")
    parser.add_argument("--no-mapping-emit", action="store_true",
                        help="Skip BOTH mapping emissions (public/fonts/<prefix>.map.json and the "
                             "packages/core/src/mappings refresh). REQUIRED for secondary-weight "
                             "builds of an already-shipped mapping: the 400 build already emitted "
                             "the canonical mapping, and re-emitting from a weight build would "
                             "either clobber it (dropping its _meta block) or litter bogus "
                             "<variant>-<weight>.json files. Text mappings are weight-agnostic.")
    parser.add_argument("--mapping-path", help="Path to a custom word mapping JSON (default: scripts/word_mapping.json)")
    parser.add_argument("--document-nonce", "--nonce",
                        help="Private document nonce used for keyed alias selection; "
                             "never written to diagnostics or mapping output")
    parser.add_argument("--tenant-id",
                        help="Opaque tenant input for bundle identity; never logged or used raw")
    parser.add_argument("--cache-key",
                        help="Optional opaque cache identity override; raw values are never logged")
    parser.add_argument("--mapping-out", help="Stem for the emitted encoder mapping JSON under "
                        "packages/core/src/mappings/ (default: prefix minus 'shieldfont-'). Use to "
                        "decouple the encoder mapping filename from the font basename, e.g. build "
                        "shieldfont-maxhide.* while emitting the mapping to m15en.json.")
    parser.add_argument("--post-format-3", choices=("auto", "both", "none"), default="auto",
                        help="Drop the `post` table to format 3.0 (no glyph names — see "
                             "drop_glyph_names). 'auto' (DEFAULT): ON for the .woff2, OFF for "
                             "the .ttf, so the browser payload loses ~18%% of its bytes while "
                             "the download-tier .ttf keeps names for Word and for "
                             "scripts/audit_font.py. 'both': drop on the .ttf too. 'none': keep "
                             "names everywhere (pre-0.2 behaviour).")
    parser.add_argument("--glyph-name-salt",
                        help="Salt for the opaque composite glyph-name hash. DEFAULT is derived "
                             "deterministically from the mapping id, so builds stay reproducible "
                             "(see GLYPH_NAME_SALT). Pass your own for a private mapping — you "
                             "need the SAME value to reproduce the build, and audit_font.py needs "
                             "it via --glyph-name-salt too.")
    parser.add_argument("--script", "--shape-script", dest="shape_script", default="latn",
                        help="Explicit HarfBuzz script tag for source shaping (default: latn)")
    parser.add_argument("--language", "--shape-language", dest="shape_language", default="dflt",
                        help="Explicit HarfBuzz language tag for source shaping (default: dflt)")
    parser.add_argument("--script-langsys", action="append", default=[],
                        metavar="SCRIPT[:LANG]",
                        help="Activate generated lookups only for this Script and "
                             "DefaultLangSys or LangSys tag; may be repeated")
    parser.add_argument("--script-langsys-map", "--script-map",
                        help="JSON object/list describing explicit Script/LangSys activation")
    parser.add_argument("--supported-mark-set", default="basic-mn-v1",
                        help="Supported combining-mark set ID or comma-separated code points "
                             "(default: basic-mn-v1)")
    parser.add_argument("--supported-marks", metavar="CODEPOINT[,CODEPOINT...]",
                        help="Override the supported mark set with bounded code points/ranges")
    parser.add_argument("--normalization", choices=("NFC",), default="NFC",
                        help="Mapping and shaping normalization form (default: NFC)")
    parser.add_argument("--features", "--shape-features", dest="shape_features",
                        default="ccmp,clig,calt,liga,kern,locl",
                        help="Comma-separated required shaping features")
    parser.add_argument("--axis", "--shape-axis", dest="shape_axes", action="append",
                        default=[], metavar="TAG=VALUE",
                        help="Variation coordinate; may be repeated")
    parser.add_argument("--parity-oracle", action="store_true",
                        help="Compare shaped runs with hb-shape when it is available")
    parser.add_argument("--release", action="store_true",
                        help="Fail closed when the pinned shaping backend is unavailable")
    parser.add_argument("--deterministic", action="store_true",
                        help="Require the pinned shaping backend for reproducible output")
    parser.add_argument("--gsub-optimization", choices=("auto", "format2", "format3"),
                        default="auto",
                        help="Evaluate class-oriented ChainContext Format 2; "
                             "fall back deterministically to Format 3")
    parser.add_argument("--artifact-dir",
                        help="Emit canonical artifacts here (default: public/fonts)")
    parser.add_argument("--source-date-epoch", type=int,
                        help="Controlled timestamp for reproducible font metadata")
    add_json_result_argument(parser)
    args = parser.parse_args()
    diag = Diagnostics(__file__, args.json_out)
    try:
        shape_script_tag = normalize_ot_tag(args.shape_script, kind="script")
        shape_language_tag = normalize_ot_tag(args.shape_language, kind="language")
        script_langsys = parse_script_langsys_specs(args.script_langsys)
        if args.script_langsys_map:
            loaded_scopes = load_script_langsys_map(args.script_langsys_map)
            for script_tag, languages in loaded_scopes.items():
                script_langsys.setdefault(script_tag, [])
                for language in languages:
                    if language not in script_langsys[script_tag]:
                        script_langsys[script_tag].append(language)
        supported_marks, supported_mark_set_id = parse_supported_mark_set(
            args.supported_mark_set, args.supported_marks
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        parser.error(f"invalid script/mark configuration: {exc}")
    print(
        f"[OK] Shaping tags: script_tag={shape_script_tag} "
        f"language_tag={shape_language_tag}"
    )
    if script_langsys:
        print(
            "[OK] Script/LangSys mapping: "
            + ",".join(
                f"{script}:{'default' if not langs else '|'.join(lang or 'default' for lang in langs)}"
                for script, langs in sorted(script_langsys.items())
            )
        )
    print(
        f"[OK] Supported mark set: id={supported_mark_set_id} "
        f"count={len(supported_marks)}"
    )
    strict_shape = args.release or args.deterministic or os.environ.get(
        "SHIELDFONT_RELEASE", ""
    ).lower() in {"1", "true", "yes"}
    shape_axes = {}
    for raw_axis in args.shape_axes:
        try:
            tag, value = raw_axis.split("=", 1)
            shape_axes[tag.strip()] = float(value)
        except ValueError:
            parser.error(f"invalid axis coordinate: {raw_axis!r}; expected TAG=VALUE")
    if args.mapping_path:
        global MAPPING_PATH
        MAPPING_PATH = Path(args.mapping_path)
    global MAPPING_NONCE_OVERRIDE
    MAPPING_NONCE_OVERRIDE = args.document_nonce

    print("=" * 60)
    print(f"ShieldFont Variant Generator: {args.name or '(name auto-derived from base font)'}")
    print("=" * 60)

    # Download base font (or use local path)
    if args.base_path:
        font_path = Path(args.base_path)
        if not font_path.exists():
            if diag.json_out is not None:
                diag.fail("local font not found", stage="input",
                          code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
                return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
            print(f"[FAIL] Local font not found: {font_path}")
            return 1
        print(f"[OK] Using local font {font_path}")
    else:
        font_path = download_font(args.base_url, args.cache_name)

    # Load the base font first — we read its own name table to derive the output
    # family name (and prefix) when the user didn't pass --name/--prefix.
    print(f"[..] Loading font from {font_path}")
    font = TTFont(str(font_path))
    try:
        controlled_epoch = source_date_epoch(args.source_date_epoch)
    except ValueError as exc:
        parser.error(str(exc))

    # Multi-weight support: verify the base master IS the cut the caller named,
    # then derive the subfamily. The check is read-only — usWeightClass,
    # fsSelection and macStyle all pass through from the master untouched.
    if args.weight is not None:
        actual_wc = font["OS/2"].usWeightClass if "OS/2" in font else None
        if actual_wc != args.weight:
            print(f"[FAIL] --weight {args.weight} but the base font's OS/2 usWeightClass "
                  f"is {actual_wc}. Wrong master? Pass the real static cut for this "
                  f"weight via --base-path; this pipeline never interpolates or "
                  f"synthesises weights.")
            if diag.json_out is not None:
                diag.fail("base font weight mismatch", stage="validation",
                          code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
                return diag.finish(EXIT_VALIDATION, stage="validation",
                                   code=CODE_VALIDATION_FAILED)
            return 1
        print(f"[OK] Base cut verified: usWeightClass {actual_wc} matches --weight")
    subfamily = args.subfamily or (
        WEIGHT_SUBFAMILY.get(args.weight, "Regular") if args.weight is not None else "Regular"
    )

    # Derive --name / --prefix from the base font when not given explicitly.
    # Read the base name table NOW, before the rename block far below overwrites
    # those records. An explicit --name / --prefix always wins.
    name_was_explicit = args.name is not None
    if not args.name:
        args.name = derive_family(font) or font_path.stem
        print(f"[OK] Derived family name from base font: '{args.name}'")
    if not args.prefix:
        args.prefix = slugify(args.name)
        print(f"[OK] Derived output prefix from family name: '{args.prefix}'")
    if not name_was_explicit:
        # OFL Reserved-Font-Name landmine: warn (never block) before shipping a
        # modified font under an OFL base's own name.
        warn_if_ofl_rfn(font, args.name)

    # Load mapping
    try:
        mapping = normalize_mapping(load_mapping())
    except MappingContractError as exc:
        print(f"[FAIL] mapping contract {exc.code}: {exc}")
        if diag.json_out is not None:
            diag.fail("mapping contract rejected", stage="validation",
                      code=CODE_VALIDATION_FAILED,
                      details={"contract_code": exc.code},
                      exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        return 1

    # Drop many-to-one target collisions so no encoded word can render as a
    # different real word (see make_injective). Keeps the font unambiguous.
    mapping = make_injective(mapping)

    compatibility_inputs = {
        "script": shape_script_tag,
        "language": shape_language_tag,
        "script_langsys": script_langsys,
        "supported_mark_set": supported_mark_set_id,
        "supported_marks": sorted(supported_marks),
        "normalization": args.normalization,
        "features": args.shape_features,
        "axes": shape_axes,
        "weight": args.weight,
        "post_format_3": args.post_format_3,
        "mapping_out": args.mapping_out or "",
        "gsub_optimization": args.gsub_optimization,
        "source_date_epoch": args.source_date_epoch,
    }
    global MAPPING_BUNDLE_ID
    MAPPING_BUNDLE_ID = build_bundle_identity(
        mapping,
        hashlib.sha256(font_path.read_bytes()).hexdigest(),
        nonce=args.document_nonce,
        tenant=args.tenant_id,
        compatibility=compatibility_inputs,
    )
    if args.cache_key:
        MAPPING_BUNDLE_ID = build_bundle_identity(
            mapping,
            MAPPING_BUNDLE_ID,
            nonce=args.document_nonce,
            tenant=args.tenant_id,
            compatibility={**compatibility_inputs, "cache_key": args.cache_key},
        )
    print(f"[OK] Bundle identity: bundle_id={MAPPING_BUNDLE_ID} cache_status=miss")

    # Emit the injective mapping for the encoder — SINGLE SOURCE OF TRUTH.
    # make_injective may have DROPPED colliding pairs, so the encoder MUST use
    # EXACTLY what the font was built from; encoding with the original input JSON
    # would render every dropped word as the WRONG real word. ALWAYS write
    # <prefix>.map.json next to the font output — this is the file a
    # Bring-Your-Own-Font user (outside this monorepo) must encode with,
    # independent of the packages/core path below.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    map_out_path = OUTPUT_DIR / f"{args.prefix}.map.json"
    if args.no_mapping_emit:
        print("[OK] Skipping mapping emissions (--no-mapping-emit): this build reuses "
              "a mapping whose canonical emission already exists")
    else:
        try:
            map_out_path.write_text(json.dumps(
                mapping_output_payload(mapping), ensure_ascii=False, indent=0
            ))
            print(f"[OK] Emitted encoder mapping (SINGLE SOURCE OF TRUTH — encode ONLY "
                  f"with this file): {map_out_path} ({len(mapping)} entries)")
        except Exception as e:
            print(f"[WARN] Could not emit encoder mapping to {map_out_path}: {e}")

    # The mapping id identifies WHICH dictionary this build encodes. It seeds the
    # glyph-name salt (see GLYPH_NAME_SALT) and names the emitted encoder mapping.
    variant = (args.mapping_out or args.prefix.replace("shieldfont-", "")) or args.prefix
    mapping_id = read_mapping_id() or variant
    glyph_salt = args.glyph_name_salt or derive_glyph_name_salt(MAPPING_BUNDLE_ID)
    print(f"[OK] Glyph-name salt: derived from opaque bundle identity "
          f"bundle_id={MAPPING_BUNDLE_ID}"
          if not args.glyph_name_salt else
          "[OK] Glyph-name salt: supplied via --glyph-name-salt (record it — the "
          "same value is required to reproduce this build)")

    # In the monorepo, ALSO refresh the bundled encoder mapping so
    # @shieldfont/core stays in sync with the font we just built.
    # (Skipped under --no-mapping-emit together with the map.json above:
    # a secondary-weight build must never rewrite the canonical mapping.)
    if not args.no_mapping_emit:
        try:
            enc_dir = PROJECT_DIR / "packages" / "core" / "src" / "mappings"
            if enc_dir.exists():
                enc_path = enc_dir / f"{variant}.json"
                had_meta = enc_path.exists() and '"_meta"' in enc_path.read_text()[:200]
                enc_path.write_text(json.dumps(
                    mapping_output_payload(mapping), ensure_ascii=False, indent=0
                ))
                print(f"[OK] Emitted encoder mapping (monorepo bundled encoder): "
                      f"{enc_path} ({len(mapping)} entries)")
                if had_meta:
                    # This write is pairs-only, so it DROPS the `_meta` provenance
                    # block that mappingMeta() in @shieldfont/core reads. Restore it
                    # or the package ships a mapping that can't say which generation
                    # it is.
                    print(f"[WARN] {enc_path.name} previously carried a `_meta` block and this "
                          f"write dropped it. Run `python3 scripts/stamp_mapping_meta.py` "
                          f"before building/publishing @shieldfont/core.")
        except Exception as e:
            print(f"[WARN] Could not emit monorepo encoder mapping: {e}")

    # Handle variable fonts
    if "fvar" in font:
        print("[..] Variable font detected, stripping variable tables...")
        try:
            from fontTools.varLib.instancer import instantiateVariableFont
            axes = dict(shape_axes)
            for axis in font["fvar"].axes:
                axes.setdefault(axis.axisTag, axis.defaultValue)
                print(f"     Axis {axis.axisTag}: value={axes[axis.axisTag]}")
            instantiateVariableFont(font, axes, inplace=True, overlap=True)
            static_data = BytesIO()
            font.save(static_data)
            font = TTFont(BytesIO(static_data.getvalue()))
            print("[OK] Instanced as static font")
        except Exception as e:
            print(f"[WARN] Could not instance: {e}")
            var_tables = ["fvar", "gvar", "HVAR", "MVAR", "avar", "STAT", "cvar"]
            for tbl in var_tables:
                if tbl in font:
                    del font[tbl]

    if "glyf" not in font:
        # Check for CFF, try converting
        if "CFF " in font or "CFF2" in font:
            print("[WARN] CFF font detected. Attempting conversion to TrueType...")
            try:
                from fontTools.pens.t2Pen import T2Pen
                from fontTools.pens.cu2quPen import Cu2QuPen
                from cu2qu.ufo import font_to_quadratic
            except ImportError:
                pass
            # Try using fonttools otf2ttf
            try:
                import subprocess
                import tempfile
                tmp_otf = os.path.join(tempfile.gettempdir(), f"{args.prefix}_temp.otf")
                tmp_ttf = os.path.join(tempfile.gettempdir(), f"{args.prefix}_temp.ttf")
                font.save(tmp_otf)
                # Use fonttools command line tool
                result = subprocess.run(
                    [sys.executable, "-c",
                     f"from fontTools.ttLib import TTFont; from fontTools.pens.qu2cuPen import *; "
                     f"import fontTools.cu2qu.ufo; print('ok')"],
                    capture_output=True, text=True
                )
                print(f"[FAIL] CFF to TrueType conversion not available.")
                print("       Please find a TTF version of this font.")
                sys.exit(1)
            except Exception as e2:
                print(f"[FAIL] {e2}")
                sys.exit(1)
        else:
            print("[FAIL] Font does not have TrueType outlines (glyf table).")
            sys.exit(1)

    glyph_count_before = len(font.getGlyphOrder())
    print(f"[OK] Loaded font: {glyph_count_before} glyphs")

    # Snapshot before adding any ShieldFont GSUB/lookup entries.  Every source
    # run in this build uses this immutable view, preventing recursive lookup
    # application when a caller reuses an already-shaped TTFont object.
    shape_source = font_bytes(font)
    try:
        shape_runner = ShapeRunner(
            shape_source,
            script=shape_script_tag,
            language=shape_language_tag,
            features=args.shape_features,
            axes=shape_axes,
            parity_oracle=args.parity_oracle,
            strict=strict_shape,
            oracle_font=font_path,
        )
    except ShapeBackendError as exc:
        if strict_shape:
            if diag.json_out is not None:
                diag.fail("required shaping backend unavailable", stage="backend",
                          code=CODE_BACKEND_MISSING, exit_code=EXIT_BACKEND)
                return diag.finish(EXIT_BACKEND, stage="backend",
                                   code=CODE_BACKEND_MISSING)
            print(f"[FAIL] required shaping backend unavailable: {exc}")
            return EXIT_BACKEND
        shape_runner = None
        print(
            f"[WARN] primary shaping backend unavailable; "
            f"compatibility_fallback=legacy-metrics: {exc}"
        )

    # Strip stale tables that become invalid after we add glyphs:
    #   vmtx/vhea/VORG: vertical metrics — sized to the original glyph count, won't
    #     auto-extend. Stripping is safe for horizontal Latin scripts.
    #   DSIG: digital signature — invalidated by any modification to the font.
    for stale in ("vmtx", "vhea", "VORG", "DSIG"):
        if stale in font:
            del font[stale]
            print(f"[OK] Stripped stale '{stale}' table (would not extend with new glyphs)")

    # Create composite glyphs and ligature rules
    print("[..] Creating composite glyphs and ligature rules...")
    ligature_map = {}
    single_subst_map = {}  # for 1-char keys (e.g., digit rotation 1↔6)
    success_count = 0
    skip_count = 0

    # First pass: pull out single-char entries (they get GSUB Type 1, not Type 4)
    multichar_mapping = {}
    for original_word, encoded_word in mapping.items():
        if len(original_word) == 1 and len(encoded_word) == 1:
            src_g = get_glyph_name_for_char(font, original_word)
            tgt_g = get_glyph_name_for_char(font, encoded_word)
            if src_g and tgt_g:
                single_subst_map[src_g] = tgt_g
                success_count += 1
            else:
                skip_count += 1
        else:
            multichar_mapping[original_word] = encoded_word
    if single_subst_map:
        print(f"[OK] Single-char substitutions ready: {len(single_subst_map)} pairs (e.g., digits)")

    for original_word, encoded_word in multichar_mapping.items():
        # SECURITY: never put the plaintext original word in the glyph name. The
        # glyph-name table ships inside the font, so a readable name hands over the
        # whole codebook with zero GSUB parsing (RED-TEAM-FINDINGS.md §2 — full
        # dictionary recovered in <1 min). Use an opaque, SALTED, deterministic
        # hash; audit_font.py.expected_glyph() mirrors this exact formula. NOTE:
        # this only raises the bar — the composite outlines still equal the
        # original word and remain OCR/GSUB-recoverable. It is not "protection,"
        # just friction, and on every woff2 tier the names are dropped outright
        # (--post-format-3). See GLYPH_NAME_SALT for why the salt is derived.
        safe_name = safe_glyph_name(original_word, glyph_salt)
        if safe_name in font.getGlyphOrder():
            safe_name = safe_name + ".lig"

        forms = [("lower", original_word, encoded_word, "")]
        if MAPPING_CASE_FORM in {"preserve", "title"}:
            forms.append((
                "title",
                original_word[0].upper() + original_word[1:],
                encoded_word[0].upper() + encoded_word[1:],
                ".cap",
            ))
        if MAPPING_CASE_FORM in {"preserve", "upper"}:
            forms.append(("upper", original_word.upper(), encoded_word.upper(), ".upper"))
        for _form, form_original, form_encoded, suffix in forms:
            form_glyph_names = []
            form_ok = True
            for ch in form_encoded:
                gname = get_glyph_name_for_char(font, ch)
                if gname is None:
                    form_ok = False
                    break
                form_glyph_names.append(gname)
            if not form_ok:
                if _form == "lower":
                    skip_count += 1
                continue
            form_name = safe_name + suffix
            if create_composite_glyph(
                font, form_original, form_name, shaper=shape_runner,
                script=shape_script_tag, language=shape_language_tag,
                features=args.shape_features, axes=shape_axes, strict=strict_shape,
            ):
                ligature_map[form_name] = form_glyph_names
                success_count += 1

    print(f"[OK] Created {success_count} composite glyphs, skipped {skip_count}")

    # Rename font. The subfamily carries the real cut name (Bold, Black, ...);
    # for the Regular cut every value below is byte-identical to the
    # pre-multi-weight behaviour. The full name (nameID 4) follows the same
    # convention as stamp_font_version.py: bare family for Regular,
    # "Family Subfamily" for any other cut.
    psname = args.name.replace(" ", "-")
    full_name = args.name if subfamily == "Regular" else f"{args.name} {subfamily}"
    name_table = font["name"]
    name_replacements = {
        0: f"{args.copyright}",
        1: args.name,
        2: subfamily,
        3: f"{psname}-{subfamily}",
        4: full_name,
        5: "Version 1.0",
        6: f"{psname}-{subfamily}",
        16: args.name,
        17: subfamily,
    }
    for name_record in name_table.names:
        if name_record.nameID in name_replacements:
            name_record.string = name_replacements[name_record.nameID]
    print(f"[OK] Renamed font to '{full_name}'")

    # Build/merge GSUB with word-boundary chained context. Each ligature only
    # fires when bounded by non-letter glyphs (space, punctuation, digits,
    # start/end of text), so short pairs like 'on↔in' or '1↔6' don't substitute
    # inside larger words ('font' stays 'font'; 'iPhone15' stays 'iPhone15').
    ensure_gdef_mark_data(font, supported_marks, ligature_map.keys())
    source_feature_tag, source_feature_decision = choose_source_feature_tag(font)
    print(
        f"[OK] Compatibility feature placement: source={source_feature_tag} "
        f"decision={source_feature_decision} "
        f"restoration={RESTORATION_FEATURE_TAG} optional={OPTIONAL_FEATURE_TAG}"
    )
    build_gsub_word_boundary_ligatures(
        font,
        ligature_map,
        single_subst_map,
        script_langsys=script_langsys or None,
        supported_marks=supported_marks,
        feature_tag=source_feature_tag,
        optimization=args.gsub_optimization,
    )

    # NOTE: do not pre-promote lookups to Extension here. HarfBuzz's repacker
    # (hb.serialize_with_tag, used by font.save for GSUB/GPOS) does its own
    # extension promotion and offset packing; feeding it pre-built
    # ExtensionSubst subtables makes it raise an opaque RepackerError and fall
    # back to the slow pure-Python resolver. With the ligature/reversal
    # subtables byte-bounded above, the repacker packs the table in one pass.

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ttf_path = OUTPUT_DIR / f"{args.prefix}.ttf"
    font.flavor = None
    deterministic_font_metadata(font, controlled_epoch)
    # The TTF is the DOWNLOAD tier: it has to be selectable by a human in Word's
    # font menu, and audit_font.py names the glyphs it shaped. So it keeps its
    # glyph names unless the caller explicitly asks otherwise.
    if args.post_format_3 == "both":
        n = drop_glyph_names(font)
        print(f"[OK] post -> format 3.0 on the TTF ({n:,} glyph names dropped) "
              f"[--post-format-3 both]")
    font.save(str(ttf_path))
    print(f"[OK] Saved TTF: {ttf_path} ({ttf_path.stat().st_size:,} bytes)")

    font2 = TTFont(str(ttf_path))
    woff2_path = OUTPUT_DIR / f"{args.prefix}.woff2"
    # LAST STEP before the browser payload is written: glyph names have no
    # rendering function on the web, and they are ~17% of the woff2.
    if args.post_format_3 in ("auto", "both"):
        n = drop_glyph_names(font2)
        if n:
            print(f"[OK] post -> format 3.0 on the WOFF2 ({n:,} glyph names dropped)")
    deterministic_font_metadata(font2, controlled_epoch)
    font2.flavor = "woff2"
    font2.save(str(woff2_path))
    print(f"[OK] Saved WOFF2: {woff2_path} ({woff2_path.stat().st_size:,} bytes)")

    artifact_dir = args.artifact_dir or str(OUTPUT_DIR)
    if artifact_dir:
        try:
            artifact_manifest = emit_canonical_artifacts(
                artifact_dir,
                mapping=mapping,
                audit_font=ttf_path,
                web_font=woff2_path,
                mapping_id=mapping_id,
                bundle_id=MAPPING_BUNDLE_ID,
                profile=(MAPPING_CONTRACT or {}).get("profile", "compatibility"),
                shaping={
                    "status": "not-run",
                    "font_glyphs": glyph_count_before + success_count,
                    "lookup_count": len(font2["GSUB"].table.LookupList.Lookup)
                    if "GSUB" in font2 else 0,
                },
                performance={
                    "mapping_pairs": len(mapping),
                    "font_glyphs": glyph_count_before + success_count,
                    "gsub_optimization": args.gsub_optimization,
                },
                security_report=(
                    "# ShieldFont security report\n\n"
                    "The public font omits glyph names (`post` format 3). "
                    "Mapping audit files and the audit TTF are private.\n\n"
                    "This raises the cost of casual scraping and records provenance; "
                    "it is not cryptography, confidentiality, authorization, or DRM.\n"
                ),
                source_date_epoch=controlled_epoch,
            )
            manifest_digest = hashlib.sha256(
                json.dumps(artifact_manifest, sort_keys=True).encode("utf-8")
            ).hexdigest()[:16]
            scan = scan_public_artifacts(artifact_dir, forbidden_words=mapping)
            if scan["status"] != "pass":
                raise ValueError(
                    f"public artifact scanner found {scan['finding_count']} findings"
                )
            print(
                f"[OK] Canonical artifacts: role=public/private/verification "
                f"count={len(artifact_manifest.get('artifacts', []))} "
                f"manifest_hash={manifest_digest}"
            )
        except (OSError, ValueError) as exc:
            print(f"[FAIL] canonical artifact emission failed: {type(exc).__name__}: {exc}")
            if diag.json_out is not None:
                diag.fail("canonical artifact emission failed", stage="output",
                          code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
                return diag.finish(EXIT_OUTPUT, stage="output",
                                   code=CODE_OUTPUT_UNWRITABLE)
            return 1

    # Write CSS. A weight build declares its real numeric weight so the face
    # only claims the cut it actually is; the default (no --weight) keeps the
    # historical `font-weight: normal`.
    css_weight = "normal" if args.weight is None else str(args.weight)
    css_path = OUTPUT_DIR / f"{args.prefix}.css"
    css_path.write_text(f"""@font-face {{
  font-family: '{args.name}';
  src: url('{args.prefix}.woff2') format('woff2'),
       url('{args.prefix}.ttf') format('truetype');
  font-weight: {css_weight};
  font-style: normal;
  font-display: block;
}}
""")
    print(f"[OK] Saved CSS: {css_path}")

    print()
    print("=" * 60)
    print(f"DONE! {args.name}")
    print(f"  Files: {ttf_path.name}, {woff2_path.name}, {css_path.name}, {map_out_path.name}")
    print(f"  Ligatures: {success_count}")
    print(f"  Encode ONLY with: {map_out_path}")
    print("=" * 60)
    if diag.json_out is not None:
        result_details = {"status": "written"}
        if isinstance(MAPPING_CONTRACT, dict):
            result_details.update(MAPPING_CONTRACT.get("diagnostics", {}))
        return diag.finish(0, stage="complete", details=result_details)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
