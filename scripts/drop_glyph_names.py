#!/usr/bin/env python3
#
# ShieldFont — a web font that protects written content from AI scraping.
# Copyright (c) 2026 Isaque Seneda and Gabriel Abrucio.
#
# This file is part of ShieldFont and is licensed under the GNU AGPL v3+.
# See scripts/generate_font.py for the full notice.
"""drop_glyph_names.py — set `post` to format 3.0 on a BUILT font, and prove
nothing else moved.

Glyph names have no rendering function in a web font: shaping, cmap lookup and
GSUB all address glyphs by ID. On the shipped alpha build the `post` table is
984,521 bytes — 18.9% of the TTF and ~17% of the woff2 — of pure glyph-name
strings. Dropping it is a straight ~18% cut to the bytes every visitor
downloads, and it deletes the glyph-name attack surface as a side effect.

WHY THIS IS A SEPARATE STEP. generate_font.py already does this for the woff2 it
writes (`--post-format-3`), but the *shipped* package fonts are produced from
the download-tier .ttf by a later name-table camouflage/stamping pass, and the
drop has to be the LAST thing that happens — otherwise the .ttf loses the names
that Word's font menu and scripts/audit_font.py both need. So the pipeline is:

    generate_font.py            -> public/fonts/<prefix>.ttf   (names KEPT)
    camouflage / stamping       -> packages/**/optik-*.woff2   (names still kept)
    drop_glyph_names.py         -> packages/**/optik-*.woff2   (names GONE)

Validation runs on every invocation and the destination is NOT written unless it
passes:
  - glyph count and glyph-order length unchanged
  - cmap entry count unchanged
  - GSUB lookup count, lookup types, and every feature's lookup-index list
    unchanged (this is what keeps `ccmp` wired to the same lookups, which is
    what makes Word and non-liga renderers work)
  - name table unchanged
  - `post` really is format 3.0 on the way out
  - (best effort, needs uharfbuzz) HarfBuzz shapes a set of encoded words to an
    identical GLYPH-ID sequence before and after

Usage:
  python3 scripts/drop_glyph_names.py in.woff2 --out out.woff2
  python3 scripts/drop_glyph_names.py packages/font/optik-a.woff2 --inplace
"""
import argparse
import os
import sys
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from generate_font import drop_glyph_names  # noqa: E402  (shared single source)
from artifact_contract import deterministic_font_metadata, source_date_epoch  # noqa: E402
from script_diagnostics import (  # noqa: E402
    CODE_INPUT_NOT_FOUND,
    CODE_OUTPUT_UNWRITABLE,
    CODE_VALIDATION_FAILED,
    Diagnostics,
    EXIT_INPUT,
    EXIT_OUTPUT,
    EXIT_VALIDATION,
    add_json_result_argument,
)

# Encoded (decoy) words that must fire a ligature, plus plain words that must
# not. Shaping these to the same glyph IDs before and after is the real proof
# that only the name payload moved.
PROBE_WORDS = [
    "analyze", "office", "determines", "publish", "the", "shield", "january",
    "x", "font", "winter", "iPhone", "1568", "Publish", "PUBLISH",
]


def _snapshot(font):
    """Everything that must be identical before and after the drop."""
    gsub = font["GSUB"].table if "GSUB" in font else None
    feats = {}
    if gsub:
        for i, fr in enumerate(gsub.FeatureList.FeatureRecord):
            feats[f"{i}:{fr.FeatureTag}"] = list(fr.Feature.LookupListIndex)
    nt = font["name"]
    return {
        "numGlyphs": font["maxp"].numGlyphs,
        "glyphOrderLen": len(font.getGlyphOrder()),
        "cmapEntries": len(font["cmap"].getBestCmap()),
        "gsubLookupCount": len(gsub.LookupList.Lookup) if gsub else 0,
        "gsubLookupTypes": [lk.LookupType for lk in gsub.LookupList.Lookup] if gsub else [],
        "features": feats,
        "names": sorted(
            (r.nameID, r.platformID, r.platEncID, r.langID, r.toUnicode())
            for r in nt.names
        ),
    }


def _to_ttf(src):
    """uharfbuzz can't decode woff2 in the shipped wheel — hand it a TTF."""
    f = TTFont(str(src))
    f.flavor = None
    fd, p = tempfile.mkstemp(suffix=".ttf")
    os.close(fd)
    f.save(p)
    return p


def shape_equiv(before_path, after_path, words):
    """'equal' | 'DIFFER' | 'skip' — identical glyph-ID runs for every word."""
    try:
        import uharfbuzz as hb
    except Exception:
        return "skip", None

    def gids(ttf, word):
        blob = hb.Blob.from_file_path(ttf)
        face = hb.Face(blob)
        fnt = hb.Font(face)
        buf = hb.Buffer()
        buf.add_str(f" {word} ")
        buf.guess_segment_properties()
        hb.shape(fnt, buf, None)  # default feature set, as a browser would
        return [g.codepoint for g in buf.glyph_infos]

    a = _to_ttf(before_path)
    b = _to_ttf(after_path)
    try:
        for w in words:
            ga, gb = gids(a, w), gids(b, w)
            if ga != gb:
                return "DIFFER", f"{w!r}: {ga} != {gb}"
        return "equal", None
    finally:
        os.unlink(a)
        os.unlink(b)


def main():
    ap = argparse.ArgumentParser(
        description="Set `post` to format 3.0 on a built font (drops glyph names)")
    ap.add_argument("infile")
    ap.add_argument("--out", help="Destination; flavor is taken from the extension")
    ap.add_argument("--inplace", action="store_true", help="Overwrite the input")
    ap.add_argument("--no-shape", action="store_true",
                    help="Skip the (slow) HarfBuzz equivalence check; keep the structural ones")
    ap.add_argument("--source-date-epoch", type=int,
                    help="Controlled timestamp for reproducible font metadata")
    add_json_result_argument(ap)
    a = ap.parse_args()
    diag = Diagnostics(__file__, a.json_out)
    try:
        controlled_epoch = source_date_epoch(a.source_date_epoch)
    except ValueError as exc:
        ap.error(str(exc))

    infile = Path(a.infile)
    if not infile.exists():
        if diag.json_out is not None:
            diag.fail(f"input not found: {infile}", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        print(f"[FAIL] input not found: {infile}")
        return 1
    if a.inplace:
        out = infile
    elif a.out:
        out = Path(a.out)
    else:
        if diag.json_out is not None:
            diag.fail("pass --out or --inplace", stage="input",
                      code="output_required", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="output_required")
        print("[FAIL] pass --out or --inplace")
        return 1

    font = TTFont(str(infile))
    before = _snapshot(font)
    dropped = drop_glyph_names(font)
    deterministic_font_metadata(font, controlled_epoch)
    if dropped == 0 and controlled_epoch is None:
        print(f"[OK] {infile.name}: `post` already format 3.0 — nothing to do")
        if out != infile:
            try:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(infile.read_bytes())
            except OSError as exc:
                if diag.json_out is not None:
                    diag.fail(f"could not write output: {type(exc).__name__}",
                              stage="output", code=CODE_OUTPUT_UNWRITABLE,
                              exit_code=EXIT_OUTPUT)
                    return diag.finish(EXIT_OUTPUT, stage="output",
                                       code=CODE_OUTPUT_UNWRITABLE)
                raise
        return diag.finish(0, stage="complete", details={"status": "unchanged"}) if diag.json_out is not None else 0

    if dropped == 0:
        print(f"[OK] {infile.name}: `post` already format 3.0 — normalizing metadata")

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(out) + ".tmp")
    ext = out.suffix.lower()
    font.flavor = "woff2" if ext == ".woff2" else ("woff" if ext == ".woff" else None)
    try:
        font.save(str(tmp))  # re-exercises the GSUB offset packer
    except Exception as e:  # noqa: BLE001
        print(f"[FAIL] save/pack error: {type(e).__name__}: {e}")
        if tmp.exists():
            tmp.unlink()
        if diag.json_out is not None:
            diag.fail("save/pack failed", stage="output", code=CODE_OUTPUT_UNWRITABLE,
                      exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1

    chk = TTFont(str(tmp))
    after = _snapshot(chk)
    ok = True
    for key in before:
        if before[key] != after[key]:
            print(f"[FAIL] {key} changed")
            if key in ("gsubLookupTypes", "features", "names"):
                print(f"       before={before[key]}")
                print(f"       after ={after[key]}")
            else:
                print(f"       {before[key]} -> {after[key]}")
            ok = False
    if float(chk["post"].formatType) != 3.0:
        print(f"[FAIL] post is {chk['post'].formatType}, expected 3.0")
        ok = False

    shape, detail = ("skip", None) if a.no_shape else shape_equiv(infile, tmp, PROBE_WORDS)
    if shape == "DIFFER":
        print(f"[FAIL] rendering changed: {detail}")
        ok = False

    if not ok:
        tmp.unlink()
        print("[ABORT] validation failed — destination NOT written")
        if diag.json_out is not None:
            diag.fail("validation failed", stage="validation",
                      code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        return 1

    size_before = infile.stat().st_size
    try:
        tmp.replace(out)
    except OSError as exc:
        print(f"[FAIL] could not write destination: {type(exc).__name__}: {exc}")
        if tmp.exists():
            tmp.unlink()
        if diag.json_out is not None:
            diag.fail("could not write destination", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1
    size_after = out.stat().st_size
    pct = (size_after - size_before) / size_before * 100 if size_before else 0.0
    print(f"[PASS] {out.name}: post 3.0, {dropped:,} names dropped, "
          f"{size_before:,} -> {size_after:,} B ({pct:+.1f}%), "
          f"glyphs={after['numGlyphs']} cmap={after['cmapEntries']} "
          f"lookups={after['gsubLookupCount']} shape={shape}")
    return diag.finish(0, stage="complete",
                       details={"status": "written"}) if diag.json_out is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())
