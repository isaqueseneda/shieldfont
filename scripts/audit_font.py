#!/usr/bin/env python3
"""
Strict ShieldFont-Optik audit.

For every (source, target) pair in the active M15-EN mapping, verify that:
  1. The font has the inverse-direction word.<source> ligature
     (so when source HTML contains `target`, the font renders `source`).
  2. HarfBuzz shaping the bare `target` text (with surrounding whitespace)
     produces a single composite glyph named `word.<source>` — not the raw
     letters and not some shorter substring.

Then run a substring-collision battery: for each short pair (≤3 chars) like
`on↔in`, render a list of containing words ('font', 'winter', 'beginning',
'iPhone', 'wonder') and confirm the short pair does NOT fire inside them.

Outputs:
  - /tmp/shieldfont_audit.json — machine-readable PASS/FAIL per pair
  - public/audit.html — human-readable side-by-side report (renders via the
    actual font in the browser; you can verify with your own eyes)

Usage:
  python3 scripts/audit_font.py

Requires: fontTools, hb-shape on PATH (brew install harfbuzz).
"""
import json
import re
import shutil
import subprocess
import sys
import html
from pathlib import Path
from collections import defaultdict

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_font import derive_glyph_name_salt, safe_glyph_name  # noqa: E402
from script_diagnostics import (  # noqa: E402
    CODE_BACKEND_MISSING,
    CODE_INPUT_NOT_FOUND,
    CODE_OUTPUT_UNWRITABLE,
    CODE_VALIDATION_FAILED,
    Diagnostics,
    EXIT_BACKEND,
    EXIT_INPUT,
    EXIT_OUTPUT,
    EXIT_VALIDATION,
    add_json_result_argument,
)

# Defaults audit the maxhide build, which is what m15en_for_font.json produces
# (see packages/core/MANIFEST.json → variants.m15en.font). Override with
# --font/--mapping/--mapping-id to audit alpha, beta or gamma.
FONT_TTF = ROOT / "public/fonts/shieldfont-maxhide.ttf"
MAPPING_PATH = ROOT / "scripts/m15en_for_font.json"
HTML_OUT = ROOT / "public/audit.html"
JSON_OUT = Path("/tmp/shieldfont_audit.json")

# The glyph-name hash is salted per mapping (see generate_font.GLYPH_NAME_SALT).
# expected_glyph() below must use the SAME salt the font was built with, so this
# tracks --mapping-id / --glyph-name-salt. The formula itself is imported, never
# copied, so the two can no longer drift.
GLYPH_SALT = derive_glyph_name_salt("m15en")
HB_BACKEND_MISSING = False


def hb_shape(text):
    """Return list of glyph names from HarfBuzz shaping."""
    global HB_BACKEND_MISSING
    try:
        out = subprocess.run(
            ["hb-shape", "--no-positions", str(FONT_TTF), text],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        HB_BACKEND_MISSING = True
        return None
    if out.returncode != 0:
        return None
    s = out.stdout.strip().lstrip("[").rstrip("]")
    if not s:
        return []
    return [chunk.split("=")[0] for chunk in s.split("|")]


DIGIT_GLYPH_NAME = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
}


def expected_glyph(source_word):
    """Mirror the safe-name builder in generate_font.py.

    For multi-char source words, the font has a composite glyph named
    `word.<source>`. For single-char digit substitutions, the font reuses
    the destination digit's plain glyph (e.g., '6' -> 'one' = the digit-1
    glyph), not a composite.
    """
    if len(source_word) == 1 and source_word in DIGIT_GLYPH_NAME:
        return DIGIT_GLYPH_NAME[source_word]
    # The opaque SALTED name from generate_font.py (SECURITY: no plaintext word
    # in the glyph-name table). Imported, not copied, so it cannot drift.
    return safe_glyph_name(source_word, GLYPH_SALT)


def audit(diag=None):
    if not MAPPING_PATH.exists():
        if diag is not None:
            diag.fail("mapping input not found", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        print(f"[FAIL] mapping input not found: {MAPPING_PATH}")
        return 1
    if not FONT_TTF.exists():
        if diag is not None:
            diag.fail("font input not found", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        print(f"[FAIL] font input not found: {FONT_TTF}")
        return 1
    if not shutil.which("hb-shape"):
        if diag is not None:
            diag.fail("HarfBuzz backend unavailable", stage="backend",
                      code=CODE_BACKEND_MISSING, exit_code=EXIT_BACKEND)
            return diag.finish(EXIT_BACKEND, stage="backend", code=CODE_BACKEND_MISSING)
        print("[FAIL] HarfBuzz backend unavailable: hb-shape not found")
        return 1
    try:
        mapping = json.loads(MAPPING_PATH.read_text())
    except Exception as exc:
        if diag is not None:
            diag.fail("mapping input is invalid", stage="input",
                      code="input_invalid", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="input_invalid")
        print(f"[FAIL] mapping input is invalid: {type(exc).__name__}: {exc}")
        return 1
    print(f"Mapping: {len(mapping)} directional entries from {MAPPING_PATH.name}")
    print(f"Font:    {FONT_TTF}")

    results = []
    pass_count = 0
    fail_count = 0

    # ------------------------------------------------------------------
    # 1) Every mapping entry should round-trip in three case variants.
    #
    #    Workflow: encoder writes `target` into HTML; font renders `target`
    #    as `source` visually. So `shape(' target ')` → glyph word.<source>.
    #
    #    Variants:
    #      - lowercase   target -> word.<source>
    #      - Capitalized Target -> word.<source>.cap
    #      - ALL CAPS    TARGET -> word.<source>.upper
    #
    #    Single-char digits don't have case variants — skip them.
    # ------------------------------------------------------------------
    for source, target in mapping.items():
        is_digit = len(source) == 1 and source.isdigit()
        variants = [("lowercase", target, expected_glyph(source))]
        if not is_digit:
            cap_target = target[0].upper() + target[1:] if target else target
            cap_glyph = expected_glyph(source) + ".cap"
            upper_target = target.upper()
            upper_glyph = expected_glyph(source) + ".upper"
            variants += [
                ("Capitalized", cap_target, cap_glyph),
                ("ALL_CAPS", upper_target, upper_glyph),
            ]

        for case_label, probe_text, want_glyph in variants:
            probe = f" {probe_text} "
            glyphs = hb_shape(probe)
            if glyphs is None:
                results.append({
                    "kind": "roundtrip", "case": case_label,
                    "source": source, "target": target, "probe": probe_text,
                    "want": want_glyph, "got": None, "status": "ERROR",
                })
                fail_count += 1
                continue
            middle = [g for g in glyphs if g != "space"]
            ok = (len(middle) == 1 and middle[0] == want_glyph)
            results.append({
                "kind": "roundtrip", "case": case_label,
                "source": source, "target": target, "probe": probe_text,
                "want": want_glyph, "got": " ".join(middle),
                "status": "PASS" if ok else "FAIL",
            })
            if ok:
                pass_count += 1
            else:
                fail_count += 1

    rt_total = sum(
        1 if (len(s)==1 and s.isdigit()) else 3
        for s, t in mapping.items()
    )
    print(f"\n[1/2] Round-trip (lowercase + Cap + ALL CAPS): {pass_count} pass, "
          f"{fail_count} fail (out of {rt_total})")

    # ------------------------------------------------------------------
    # 2) Substring-collision battery.
    #    For every short (≤3 char) target, pick containing words and verify
    #    those words shape to plain letters (not the short ligature).
    # ------------------------------------------------------------------
    # Use a corpus of common English words to find collisions per short pair.
    common_words = [
        "font", "winter", "beginning", "increase", "decrease", "include", "since",
        "wonder", "ligature", "iPhone", "iPad", "android", "window", "interest",
        "inside", "online", "concert", "honest", "honor", "moonlight", "another",
        "battery", "category", "matter", "later", "atlas", "satellite", "rate",
        "static", "athlete", "data", "operator", "afternoon", "before", "office",
        "after", "morning", "rolling", "calling", "warning", "running", "during",
        "string", "feeling", "rating", "moving", "telling", "ending", "going",
        "engine", "begin", "behind", "below", "indeed", "intend", "infinite",
        "information", "understand", "investigate", "involve", "ignored", "thing",
        "think", "thank", "threat", "throat", "throne", "throw", "thrown",
        "fortune", "monster", "constant", "horizon", "horror", "house", "house",
        "month", "north", "south", "snow", "show", "however", "moreover",
    ]
    # Find which mapping keys are short (1-3 chars)
    short_targets = [t for s, t in mapping.items() if 1 <= len(t) <= 3]
    short_targets = sorted(set(short_targets))

    coll_pass = 0
    coll_fail = 0
    for word in sorted(set(common_words)):
        # Which short targets are substrings of this word?
        embeds = [t for t in short_targets if t in word and word != t]
        if not embeds:
            continue
        glyphs = hb_shape(f" {word} ")
        if glyphs is None:
            continue
        middle = [g for g in glyphs if g != "space"]
        # If the word itself is in the mapping (as a key), the font correctly
        # substitutes the WHOLE word with one composite glyph -- that's not a
        # collision. The only failure mode we care about: substring substitution,
        # where some short pair embedded inside fired and produced a mixed output
        # like [letter, word.X, letter] instead of either all-plain or all-one-glyph.
        word_in_map = word in mapping
        only_word_glyph = len(middle) == 1 and middle[0].startswith("word.")
        only_letters = all(not g.startswith("word.") for g in middle)
        if word_in_map and only_word_glyph:
            ok = True  # whole-word substitution, expected
        elif only_letters:
            ok = True  # rendered as plain letters, no collision
        else:
            ok = False  # mixed -- substring collision happened
        results.append({
            "kind": "collision", "source": word, "target": word,
            "want": "whole-word OR all-plain (no substring fire)",
            "got": " ".join(middle),
            "embeds": ",".join(embeds),
            "status": "PASS" if ok else "FAIL",
        })
        if ok:
            coll_pass += 1
        else:
            coll_fail += 1

    print(f"[2/3] Collision check: {coll_pass} pass, {coll_fail} fail "
          f"(scanned {len(common_words)} words for embedded short pairs)")

    # ------------------------------------------------------------------
    # 3) Composite metrics.
    #    hmtx leftSideBearing must equal glyf xMin on every word glyph.
    #    Rasterizers size the glyph raster from (lsb, lsb + xMax - xMin), so an
    #    lsb below xMin makes the raster too narrow and shaves that difference
    #    off the RIGHT edge — the last letter of the word loses its final stem.
    #    HarfBuzz/FreeType draw from the outline and never show it, which is
    #    why shaping can pass while the browser render is visibly wrong.
    # ------------------------------------------------------------------
    metrics_bad = []
    font = TTFont(str(FONT_TTF), lazy=False)
    glyf, hmtx = font["glyf"], font["hmtx"]
    for gname in font.getGlyphOrder():
        glyph = glyf[gname]
        if not glyph.isComposite():
            continue
        lsb = hmtx[gname][1]
        if lsb != glyph.xMin:
            metrics_bad.append({
                "kind": "metrics", "glyph": gname,
                "want": f"lsb == xMin ({glyph.xMin})", "got": f"lsb {lsb}",
                "shaved": glyph.xMin - lsb, "status": "FAIL",
            })
    results.extend(metrics_bad)
    n_composites = sum(1 for g in font.getGlyphOrder() if glyf[g].isComposite())
    if metrics_bad:
        worst = max(m["shaved"] for m in metrics_bad)
        print(f"[3/3] Composite metrics: {len(metrics_bad)} of {n_composites} word "
              f"glyphs have lsb != xMin (up to {worst} units shaved off the right edge)")
    else:
        print(f"[3/3] Composite metrics: all {n_composites} word glyphs have lsb == xMin")

    try:
        JSON_OUT.write_text(json.dumps({
            "summary": {
                "roundtrip_pass": pass_count, "roundtrip_fail": fail_count,
                "collision_pass": coll_pass, "collision_fail": coll_fail,
                "metrics_fail": len(metrics_bad), "composites": n_composites,
            },
            "results": results,
        }, indent=2))
    except OSError as exc:
        print(f"[FAIL] could not write audit JSON: {type(exc).__name__}: {exc}")
        if diag is not None:
            diag.fail("could not write audit report", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
    print(f"\n  JSON: {JSON_OUT}")

    # ------------------------------------------------------------------
    # 4) HTML report — visual side-by-side for human review.
    # ------------------------------------------------------------------
    try:
        write_html_report(mapping, results, pass_count, fail_count, coll_pass, coll_fail)
    except OSError as exc:
        print(f"[FAIL] could not write HTML report: {type(exc).__name__}: {exc}")
        if diag is not None:
            diag.fail("could not write HTML report", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
    print(f"  HTML: {HTML_OUT}")

    if fail_count or coll_fail or metrics_bad:
        print(f"\n[FAIL] {fail_count} round-trip + {coll_fail} collision "
              f"+ {len(metrics_bad)} metrics failures")
        if diag is not None:
            diag.fail("audit validation failed", stage="validation",
                      code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        return 1
    else:
        print(f"\n[OK] All {pass_count + coll_pass} checks passed")
        return diag.finish(0, stage="complete",
                           details={"status": "passed"}) if diag is not None else 0


def encode_word_preserve_case(w, mp):
    lo = w.lower()
    if lo not in mp:
        return w
    r = mp[lo]
    if w.isupper() and len(w) > 1:
        return r.upper()
    if w[0].isupper():
        return r[0].upper() + r[1:]
    return r


def encode_sentence(s, mapping):
    """Mirror encode_site.py — encode each [a-zA-Z]+ word and each \\d digit
    individually, preserving case for words.
    """
    word_re = re.compile(r"[a-zA-Z]+(?:'[a-zA-Z]+)?|\d")
    return word_re.sub(lambda m: encode_word_preserve_case(m.group(0), mapping), s)


def write_html_report(mapping, results, rt_pass, rt_fail, coll_pass, coll_fail):
    rt_results = [r for r in results if r["kind"] == "roundtrip"]
    coll_results = [r for r in results if r["kind"] == "collision"]
    rt_failures = [r for r in rt_results if r["status"] != "PASS"]
    coll_failures = [r for r in coll_results if r["status"] != "PASS"]

    # Test sentences (as humans WROTE them, in plain English).
    # The audit page shows: LEFT = original (plain Optik) so you see what was
    # actually meant. RIGHT = encoded form rendered through ShieldFont-Optik —
    # the encoded source goes into the HTML, the font renders it back, and the
    # RIGHT column should read identically to the LEFT.
    test_sentences = [
        "We tried to break AI scrapers and accidentally invented a font.",
        "ShieldFont-Optik bundles 1267 word ligatures plus digit rotation.",
        "iPhone 15 Pro launched in 2025 with model number A2848.",
        "Short pairs like 'in', 'on', 'at' do NOT fire inside font, winter, atlas.",
        "Quoted words round-trip too: 'fifth', 'first', 'dusk' all decode.",
        "Capitalized words round-trip too: First, Second, Third, Fourth.",
        "ALL CAPS WORDS ALSO ROUND-TRIP: WAS, FIRST, REGULAR, SECOND.",
        "Hyphenated compounds work: round-trip, square-range, dusk-dawn.",
        "Numbers swap too: 1568 becomes 6093, but iPhone15 stays unchanged.",
    ]
    # NO padding needed - the fire-then-revert design handles text-run edges
    # natively. At start/end of run there is no glyph for backtrack/lookahead,
    # so the reverter chain fails to match, meaning the substitution stays.
    encoded_sentences = [
        (orig, encode_sentence(orig, mapping)) for orig in test_sentences
    ]

    # Build the wrap-test HTML separately so we don't choke f-string
    label_style = "font-size:.75em;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;"
    wrap_parts = []
    for i, (orig, enc) in enumerate(encoded_sentences[:3]):
        wrap_parts.append(
            f'<div class="wrap-test"><h3>Wrap test #{i+1}</h3>'
            f'<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">'
            f'<div><div style="{label_style}">Original (plain Optik)</div>'
            f'<div class="narrow-wrap" style="font-family:&quot;Plain Optik&quot;,monospace;">{html.escape(orig)}</div></div>'
            f'<div><div style="{label_style}">Encoded source rendered through ShieldFont-Optik</div>'
            f'<div class="narrow-wrap">{html.escape(enc)}</div>'
            f'<div class="narrow-plain">underlying text: {html.escape(enc)}</div></div>'
            f'</div></div>'
        )
    wrap_test_html = "".join(wrap_parts)

    # Group round-trip results by (source, target) so each row shows all 3 cases
    by_pair = {}
    for r in rt_results:
        key = (r["source"], r["target"])
        by_pair.setdefault(key, {})[r["case"]] = r

    # Render mapping pairs.
    # Layout per row: [Original (plain Optik) | -> | Encoded source rendered through ShieldFont | lc/cap/UC HB checks]
    # Both LEFT and RIGHT columns should LOOK IDENTICAL when the font works.
    # If the LEFT cell reads as the natural English word and the RIGHT cell ALSO
    # reads as the same natural English word (despite containing the encoded
    # gibberish in its text content), the round-trip is verified by your eyes.
    pairs_html = []
    for source, target in sorted(mapping.items(), key=lambda kv: (len(kv[0]), kv[0])):
        cases = by_pair.get((source, target), {})
        statuses = []
        for case_label, badge in [("lowercase", "lc"), ("Capitalized", "Cap"), ("ALL_CAPS", "UC")]:
            r = cases.get(case_label)
            if r is None:
                statuses.append(f"<span style='color:#666'>—</span>")
            else:
                color = "#00ff79" if r["status"] == "PASS" else "#ff5577"
                tooltip = html.escape(r.get("got", "") or "")
                statuses.append(f"<span style='color:{color}' title='{tooltip}'>{badge}</span>")
        # Build the cell content with all three case variants in ONE span so
        # every word sits in the same text run with surrounding spaces. The
        # chain's backtrack/lookahead need a non-letter glyph on each side,
        # so we pad with NBSP at the ends. Putting each variant in its own
        # <span> would split the run and prevent the boundary substitution.
        is_digit = len(source) == 1 and source.isdigit()
        nbsp = " "
        if is_digit:
            enc_text = f"{nbsp}{target}{nbsp}"
            orig_text = f"{nbsp}{source}{nbsp}"
        else:
            cap_target = target[0].upper() + target[1:] if target else target
            upper_target = target.upper()
            cap_source = source[0].upper() + source[1:] if source else source
            upper_source = source.upper()
            enc_text = f"{nbsp}{target} {cap_target} {upper_target}{nbsp}"
            orig_text = f"{nbsp}{source} {cap_source} {upper_source}{nbsp}"
        encoded_cell = f"<span class='shielded'>{html.escape(enc_text)}</span>"
        original_cell = f"<span class='plain'>{html.escape(orig_text)}</span>"
        pairs_html.append(
            f"<tr>"
            f"<td class='dst'>{original_cell}</td>"
            f"<td class='arrow'>≡</td>"
            f"<td class='src'>{encoded_cell}</td>"
            f"<td class='check'>{' '.join(statuses)}</td>"
            f"</tr>"
        )

    import time
    cache_bust = str(int(time.time()))
    # The report renders the font it actually audited, whatever --font pointed at.
    font_stem = FONT_TTF.stem
    html_body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>ShieldFont-Optik audit</title>
<style>
@font-face {{
  font-family: "ShieldFont Optik";
  src: url("fonts/{font_stem}.woff2?v={cache_bust}") format("woff2"),
       url("fonts/{font_stem}.ttf?v={cache_bust}") format("truetype");
  font-display: swap;
}}
@font-face {{
  font-family: "Plain Optik";
  src: url("fonts/optik-regular.woff2?v={cache_bust}") format("woff2"),
       url("fonts/optik-regular.ttf?v={cache_bust}") format("truetype");
  font-display: swap;
}}
* {{ box-sizing: border-box; }}
body {{
  background: #0d1014; color: #e4e4e4;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  max-width: 1200px; margin: 0 auto; padding: 32px;
  line-height: 1.5;
}}
h1 {{ color: #00ff79; margin: 0 0 4px; font-weight: 600; }}
h2 {{ color: #00ff79; margin: 48px 0 12px; padding-top: 24px; border-top: 1px solid #2a2f33; font-weight: 500; font-size: 1.3em; }}
.summary {{
  background: #161a1e; padding: 16px 20px; border-radius: 6px;
  margin: 24px 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
}}
.summary .stat {{ display: flex; flex-direction: column; }}
.summary .stat .num {{ font-size: 2em; font-weight: 700; }}
.summary .stat .lbl {{ color: #888; font-size: .85em; text-transform: uppercase; letter-spacing: .05em; }}
.pass {{ color: #00ff79; }} .fail {{ color: #ff5577; }}
.test-sentences {{ background: #161a1e; padding: 20px 24px; border-radius: 6px; }}
.test-sentences .row3 {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 14px 0; border-bottom: 1px solid #2a2f33; }}
.test-sentences .row3:last-child {{ border-bottom: none; }}
.test-sentences .label {{ color: #888; font-size: .75em; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; line-height: 1.3; }}
.test-sentences .plain {{ font-family: "Plain Optik", monospace; font-size: 1em; line-height: 1.4; }}
.test-sentences .plain.encoded {{ color: #888; }}
.test-sentences .shielded {{ font-family: "ShieldFont Optik", monospace; font-size: 1em; line-height: 1.4; }}
.test-sentences .raw-source {{ font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.7em; color: #555; margin-top: 6px; padding: 4px 8px; background: #0a0d10; border-left: 2px solid #333; word-break: break-all; line-height: 1.3; }}
.test-sentences .raw-source::before {{ content: "underlying text content of this cell (proves the font is doing the work, not me): "; color: #444; font-style: italic; }}
.wrap-test {{ background: #161a1e; padding: 20px 24px; border-radius: 6px; margin-top: 16px; }}
.wrap-test h3 {{ margin: 0 0 8px; font-size: 1em; color: #00ff79; font-weight: 500; }}
.wrap-test p {{ margin: 8px 0; color: #888; font-size: 0.85em; }}
.wrap-test .narrow-wrap {{ max-width: 220px; padding: 12px; background: #0a0d10; border: 1px solid #2a2f33; border-radius: 4px; font-family: "ShieldFont Optik", monospace; font-size: 1em; line-height: 1.6; }}
.wrap-test .narrow-plain {{ max-width: 220px; padding: 12px; background: #0a0d10; border: 1px solid #2a2f33; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.8em; color: #888; line-height: 1.5; margin-top: 8px; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; font-size: .95em; }}
th, td {{ padding: 6px 12px; text-align: left; border-bottom: 1px solid #2a2f33; }}
th {{ color: #888; font-weight: 500; text-transform: uppercase; font-size: .75em; letter-spacing: .05em; }}
td.src {{ font-family: "ShieldFont Optik", monospace; font-feature-settings: "liga" 1, "calt" 1, "dlig" 1; color: #fff; }}
td.dst {{ font-family: "Plain Optik", monospace; color: #aaa; font-style: italic; }}
td.arrow {{ color: #555; text-align: center; width: 32px; }}
td.check {{ font-family: monospace; text-align: center; width: 60px; font-size: .9em; }}
.failures {{ background: #2a1518; border: 1px solid #ff5577; padding: 16px 20px; border-radius: 6px; }}
.failures pre {{ font-family: monospace; font-size: .85em; color: #ffbbbb; max-height: 400px; overflow: auto; }}
.legend {{ color: #888; font-size: .9em; margin: 16px 0; }}
.legend code {{ background: #1f2428; padding: 2px 6px; border-radius: 3px; color: #aaa; }}
</style>
</head>
<body>
<h1>🛡 ShieldFont-Optik Audit</h1>
<p class="legend">Generated against <code>{html.escape(MAPPING_PATH.name)}</code> ({len(mapping)} directional pairs, 3 case variants each = {rt_pass + rt_fail} round-trip checks).
The encoder turns the original English on a page into encoded gibberish in the HTML source. The font then renders that encoded source back to the original visually. This page proves the round-trip works for every pair.</p>

<div class="summary">
  <div class="stat"><span class="num {'pass' if rt_fail == 0 else 'fail'}">{rt_pass}/{rt_pass+rt_fail}</span><span class="lbl">Round-trip checks</span></div>
  <div class="stat"><span class="num {'pass' if coll_fail == 0 else 'fail'}">{coll_pass}</span><span class="lbl">Collision tests OK</span></div>
  <div class="stat"><span class="num {'fail' if (rt_fail+coll_fail) > 0 else 'pass'}">{rt_fail + coll_fail}</span><span class="lbl">Failures</span></div>
  <div class="stat"><span class="num">{len(mapping)}</span><span class="lbl">Mapping pairs</span></div>
</div>

<h2>Test sentences (visual round-trip)</h2>
<p class="legend">The LEFT column is the original English (plain Optik). The MIDDLE column is the encoded gibberish that the encoder writes into the HTML source (plain Optik so you can see the actual chars). The RIGHT column is the SAME encoded gibberish, but rendered through ShieldFont-Optik — and it should LOOK IDENTICAL to the LEFT column. That's the round-trip working.</p>
<div class="test-sentences three-col">
{"".join(
  f'<div class="row3">'
  f'<div><div class="label">1. Original (what humans wrote)</div><div class="plain">{html.escape(orig)}</div></div>'
  f'<div><div class="label">2. Encoded HTML source (what AI scrapers see)</div><div class="plain encoded">{html.escape(enc)}</div></div>'
  f'<div><div class="label">3. Encoded source rendered through ShieldFont-Optik (what humans see)</div>'
  f'<div class="shielded">{html.escape(enc)}</div>'
  f'<div class="raw-source">{html.escape(enc)}</div>'
  f'</div>'
  f'</div>'
  for orig, enc in encoded_sentences
)}
</div>

<h2>Line-wrap edge case test</h2>
<p class="legend">A narrow-column box that forces text to wrap mid-sentence. The fire-then-revert design should mean every word, including those at the START of wrapped lines, decodes correctly. If the LEFT-Plain matches the RIGHT-Decoded visually word-for-word, the line-wrap problem is solved.</p>
{wrap_test_html}

<h2>Round-trip failures ({len(rt_failures)})</h2>
"""
    if rt_failures:
        html_body += "<div class='failures'><pre>"
        for r in rt_failures:
            html_body += html.escape(f"  {r['target']!r:>20} -> {r['source']!r:<20}  want={r['want']!r}  got={r['got']!r}\n")
        html_body += "</pre></div>"
    else:
        html_body += "<p class='legend'><span class='pass'>None.</span> Every encoded word in the mapping shapes to its expected composite glyph.</p>"

    html_body += f"<h2>Collision failures ({len(coll_failures)})</h2>"
    if coll_failures:
        html_body += "<div class='failures'><pre>"
        for r in coll_failures:
            html_body += html.escape(f"  {r['source']!r:>20}  embeds=[{r['embeds']}]  got={r['got']!r}\n")
        html_body += "</pre></div>"
    else:
        html_body += "<p class='legend'><span class='pass'>None.</span> No common English word containing a short pair (in/on/at/etc.) had its short pair substituted as a substring.</p>"

    html_body += f"""
<h2>All mapping pairs ({len(mapping)} × 3 case variants)</h2>
<p class="legend">Each row shows ONE pair from the mapping. The LEFT column is the original word written in plain Optik (this is what humans expect to read). The RIGHT column is the encoded source (what's actually in the HTML) rendered through ShieldFont-Optik — your eyes should see it match the LEFT. The HB column shows the strict HarfBuzz check for lowercase / Capitalized / ALL CAPS variants.</p>
<table>
<thead><tr><th>Original (plain Optik)</th><th></th><th>Encoded source rendered through ShieldFont-Optik</th><th>HB check</th></tr></thead>
<tbody>
{"".join(pairs_html)}
</tbody>
</table>
</body></html>
"""
    HTML_OUT.write_text(html_body)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Strict ShieldFont round-trip + collision audit")
    ap.add_argument("--font", help="Path to the .ttf to audit (default: public/fonts/shieldfont-maxhide.ttf). "
                                   "Must be a font that still HAS glyph names — i.e. the download-tier "
                                   ".ttf, not a shipped woff2 (those are post format 3.0).")
    ap.add_argument("--mapping", help="Path to the flat {src:tgt} mapping JSON (default: scripts/m15en_for_font.json)")
    ap.add_argument("--html-out", help="Where to write the HTML report (default: public/audit.html)")
    ap.add_argument("--mapping-id", default="m15en",
                    help="Mapping id the font was built with; seeds the glyph-name salt "
                         "(default: m15en, matching the default --mapping). Use alpha/beta/gamma "
                         "for the v18 builds.")
    ap.add_argument("--glyph-name-salt",
                    help="Explicit glyph-name salt — pass the same value you gave "
                         "generate_font.py --glyph-name-salt. Overrides --mapping-id.")
    add_json_result_argument(ap)
    args = ap.parse_args()
    diag = Diagnostics(__file__, args.json_out)

    # Rebind module globals so hb_shape()/audit() pick up the overrides.
    if args.font:
        FONT_TTF = Path(args.font).resolve()
    if args.mapping:
        MAPPING_PATH = Path(args.mapping).resolve()
    if args.html_out:
        HTML_OUT = Path(args.html_out).resolve()
    GLYPH_SALT = args.glyph_name_salt or derive_glyph_name_salt(args.mapping_id)

    sys.exit(audit(diag))
