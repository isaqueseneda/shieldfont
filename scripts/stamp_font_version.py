#!/usr/bin/env python3
"""stamp_font_version.py — write the ShieldFont release version + mappingId into
a font's name table so the FONT FILE self-reports which generation it is.

  nameID 5 (Version string)   := "Version <version>"
  nameID 3 (Unique font ID)   := "<mappingId>"   e.g. shieldfont-en-v18-alpha@0.1.0
  head.fontRevision           := float(version's major.minor)

Re-serialising a 36k-glyph GSUB font re-exercises the offset packer (the table
that once overflowed), so this VALIDATES after every save and refuses to write
the destination unless validation passes:
  - save() raised no overflow / packing error
  - numGlyphs unchanged
  - GSUB present with the same lookup count
  - nameID 5 / 3 read back correct
  - (best effort) harfbuzz still fires a ligature on an encoded word
  - (best effort) ots-sanitize passes

Usage:
  # validate to a scratch copy (default — never touches the input):
  python3 scripts/stamp_font_version.py in.woff2 shieldfont-en-v18-alpha@0.1.0 --out /tmp/out.woff2
  # overwrite in place ONLY after you've confirmed a scratch run passes:
  python3 scripts/stamp_font_version.py in.woff2 shieldfont-en-v18-alpha@0.1.0 --inplace
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from script_diagnostics import (  # noqa: E402
    CODE_BACKEND_MISSING,
    CODE_INPUT_NOT_FOUND,
    CODE_OUTPUT_UNWRITABLE,
    CODE_VALIDATION_FAILED,
    Diagnostics,
    EXIT_INPUT,
    EXIT_OUTPUT,
    EXIT_VALIDATION,
    add_json_result_argument,
)


def set_name(font: TTFont, name_id: int, value: str) -> None:
    name = font["name"]
    name.setName(value, name_id, 3, 1, 0x409)  # Windows / Unicode BMP / en-US
    name.setName(value, name_id, 1, 0, 0)       # Mac / Roman / English


def read_name(font: TTFont, name_id: int) -> str | None:
    rec = font["name"].getName(name_id, 3, 1, 0x409) or font["name"].getName(name_id, 1, 0, 0)
    return rec.toUnicode() if rec else None


def shape_equiv(orig_path: Path, stamped_path: Path, words: list[str]) -> str:
    """Prove the stamp did not change rendering: convert BOTH fonts to TTF
    (harfbuzz can't decode woff2 in this wheel) and confirm every word shapes to
    an identical glyph sequence. Returns 'equal', 'DIFFER', or 'skip'."""
    try:
        import uharfbuzz as hb
    except Exception:
        return "skip"
    import os
    import tempfile

    def to_ttf(src: Path) -> str:
        f = TTFont(str(src))
        f.flavor = None
        fd, p = tempfile.mkstemp(suffix=".ttf")
        os.close(fd)
        f.save(p)
        return p

    def gids(ttf: str, word: str) -> list[int]:
        blob = hb.Blob.from_file_path(ttf)
        face = hb.Face(blob)
        fnt = hb.Font(face)
        buf = hb.Buffer()
        buf.add_str(word)
        buf.guess_segment_properties()
        hb.shape(fnt, buf, None)  # default feature set, as a browser would
        return [g.codepoint for g in buf.glyph_infos]

    a_ttf = to_ttf(orig_path)
    b_ttf = to_ttf(stamped_path)
    try:
        for w in words:
            if gids(a_ttf, w) != gids(b_ttf, w):
                return "DIFFER"
        return "equal"
    finally:
        os.unlink(a_ttf)
        os.unlink(b_ttf)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("mapping_id")
    ap.add_argument("--version", default="0.1.0")
    ap.add_argument("--family", help="nameID 1 / 16, e.g. 'ShieldFont Optik'")
    ap.add_argument("--subfamily", help="nameID 2 / 17, e.g. 'Alpha'")
    ap.add_argument("--description", help="nameID 10, human-readable self-doc")
    ap.add_argument("--out")
    ap.add_argument("--inplace", action="store_true")
    ap.add_argument("--no-shape", action="store_true",
                    help="skip the (slow) harfbuzz render-equivalence check; keep the cheap packer/glyph/name checks")
    ap.add_argument("--shape-word", default="analyze", help="an ENCODED word expected to fire a ligature")
    add_json_result_argument(ap)
    a = ap.parse_args()
    diag = Diagnostics(__file__, a.json_out)

    infile = Path(a.infile)
    if a.inplace:
        out = infile
    elif a.out:
        out = Path(a.out)
    else:
        out = infile.with_suffix(".stamped" + infile.suffix)

    if not infile.exists():
        if diag.json_out is not None:
            diag.fail("input not found", stage="input", code=CODE_INPUT_NOT_FOUND,
                      exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        print(f"[FAIL] input not found: {infile}")
        return 1

    try:
        src = TTFont(str(infile))
    except Exception as exc:
        if diag.json_out is not None:
            diag.fail("could not read input font", stage="input",
                      code="input_invalid", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="input_invalid")
        print(f"[FAIL] could not read input font: {type(exc).__name__}: {exc}")
        return 1
    glyphs_before = src["maxp"].numGlyphs
    lookups_before = len(src["GSUB"].table.LookupList.Lookup) if "GSUB" in src else 0

    mm = a.version.split(".")
    set_name(src, 5, f"Version {a.version}")
    set_name(src, 3, a.mapping_id)
    if a.family:
        set_name(src, 1, a.family)
        set_name(src, 16, a.family)
    if a.subfamily:
        set_name(src, 2, a.subfamily)
        set_name(src, 17, a.subfamily)
    if a.family and a.subfamily:
        # For a Regular-weight standalone family, the full name is just the family
        # (not "Family Regular") — this is what Word/Office show in the font list.
        full = a.family if a.subfamily == "Regular" else f"{a.family} {a.subfamily}"
        set_name(src, 4, full)
        set_name(src, 6, f"{a.family.replace(' ', '')}-{a.subfamily}")
    if a.description:
        set_name(src, 10, a.description)
    src["head"].fontRevision = float(f"{mm[0]}.{mm[1]}") if len(mm) >= 2 else float(mm[0])

    tmp = Path(str(out) + ".tmp")
    try:
        src.save(str(tmp))  # ← the critical step: raises on GSUB overflow / pack failure
    except Exception as e:  # noqa
        print(f"[FAIL] save/pack error: {type(e).__name__}: {e}")
        if tmp.exists():
            tmp.unlink()
        if diag.json_out is not None:
            diag.fail("save/pack failed", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1

    try:
        chk = TTFont(str(tmp))
    except Exception as exc:
        if tmp.exists():
            tmp.unlink()
        if diag.json_out is not None:
            diag.fail("could not validate output font", stage="validation",
                      code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        print(f"[FAIL] could not validate output font: {type(exc).__name__}: {exc}")
        return 1
    ok = True
    if chk["maxp"].numGlyphs != glyphs_before:
        print(f"[FAIL] glyph count changed {glyphs_before} -> {chk['maxp'].numGlyphs}"); ok = False
    lookups_after = len(chk["GSUB"].table.LookupList.Lookup) if "GSUB" in chk else 0
    if lookups_after != lookups_before or lookups_before == 0:
        print(f"[FAIL] GSUB lookups {lookups_before} -> {lookups_after}"); ok = False
    if read_name(chk, 5) != f"Version {a.version}":
        print(f"[FAIL] nameID 5 = {read_name(chk,5)!r}"); ok = False
    if read_name(chk, 3) != a.mapping_id:
        print(f"[FAIL] nameID 3 = {read_name(chk,3)!r}"); ok = False

    shape = "skip" if a.no_shape else shape_equiv(
        infile, tmp, ["analyze", "office", "determines", "publish", "the", "shield", "january", "x"])
    if shape == "skip" and not a.no_shape:
        print("[WARN] HarfBuzz backend unavailable; render-equivalence check skipped")
        if diag.json_out is not None:
            diag.warn("render-equivalence check skipped", stage="backend",
                      code=CODE_BACKEND_MISSING, details={"backend": "uharfbuzz"})
    if shape == "DIFFER":
        print("[FAIL] rendering changed: glyph sequence differs (orig vs stamped)"); ok = False

    ots = "skip"
    if shutil.which("ots-sanitize"):
        r = subprocess.run(["ots-sanitize", str(tmp)], capture_output=True, text=True)
        ots = "pass" if r.returncode == 0 else "FAIL"
        if r.returncode != 0:
            print(f"[FAIL] ots-sanitize: {r.stderr.strip()[:200]}"); ok = False
    elif diag.json_out is not None:
        diag.warn("ots-sanitize unavailable; sanitizer check skipped", stage="backend",
                  code=CODE_BACKEND_MISSING, details={"backend": "ots-sanitize"})

    if not ok:
        tmp.unlink()
        print("[ABORT] validation failed — destination NOT written")
        if diag.json_out is not None:
            diag.fail("validation failed", stage="validation",
                      code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        return 1

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
    print(f"[PASS] {out.name}: glyphs={glyphs_before} lookups={lookups_before} "
          f"nameID5={read_name(chk,5)!r} nameID3={read_name(chk,3)!r} shape={shape} ots={ots}")
    return diag.finish(0, stage="complete",
                       details={"status": "written"}) if diag.json_out is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())
