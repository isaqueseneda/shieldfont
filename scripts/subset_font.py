#!/usr/bin/env python3
"""
Content-scoped subsetting for a built ShieldFont — "Tailwind for the font".

A full ShieldFont carries every pair in its dictionary: ~12,000 source words x 3
case variants = ~36,000 composite glyphs, ~825 KB of woff2. Almost no site uses
more than a fraction of that vocabulary. This tool reads the site's own content,
works out which pairs the content can actually trigger, and throws the rest away
at build time.

  vocabulary 500 pairs  ->  ~82 KB      2,000 pairs  ->  ~197 KB
             5,000      -> ~402 KB     12,011 (all)  -> ~825 KB

WHY `pyftsubset` ALONE DOES NOT WORK
------------------------------------
The obvious `pyftsubset --text=...` does nothing: GSUB layout closure walks the
LigatureSubst and pulls every word composite back in, so the font stays at 36k
glyphs and ~1 MB at every vocabulary size. The layout rules have to be pruned
FIRST -- LigatureSubst ligature sets, the MultipleSubst reversal map, and the
chain-context coverages -- and only then is glyph subsetting able to drop
anything. That is what this script does.

THE FIRE-THEN-REVERT BOUNDARY LOGIC MUST SURVIVE
------------------------------------------------
generate_font.py builds five lookups (see build_gsub_word_boundary_ligatures):

    A  LigatureSubst   decoy letters -> word.<hash>            (fires anywhere)
    B  SingleSubst     digit <-> digit
    C  MultipleSubst   word.<hash> -> decoy letters            (the REVERSAL)
    D  ChainContext    letter BEFORE a substituted glyph -> run C
    E  ChainContext    letter AFTER  a substituted glyph -> run C

A fires unconditionally and D/E undo it whenever the composite turned out to be
sitting inside a larger word. That is what makes `font` stay "font" while a
standalone `on` still swaps, and it is what survives line wraps and text-node
edges. Pruning is therefore done symmetrically across ALL FIVE: a dropped pair
leaves A, C, D and E simultaneously, so no coverage ever references a glyph that
no longer exists and no half-fired substitution can be left un-revertible. The
digit lookups (B, and the digit half of C/D/E) are NEVER pruned -- they are 8
entries and content-independent.

DIRECTION -- READ THIS BEFORE CHANGING THE INTERSECTION
-------------------------------------------------------
The encoder rewrites source -> decoy in the HTML. The font renders decoy ->
source. Content on disk is written in SOURCE words. So:

    keep pair (s, d)  <=>  s appears in the content

and the glyphs kept are the composites for `s` reached by the ligature whose
components spell `d`. Getting this backwards drops exactly the pairs the page
needs.

A pruned pair is a SILENT, VISIBLE failure if the encoder still knows about it:
the encoder writes the decoy into the HTML, the font no longer has the rule, and
the human reads raw gibberish. So the font is never shipped alone --

    every run also writes <out>.map.json, the mapping PRUNED TO MATCH.

Encode with that file and nothing else. Then an uncovered word is simply left in
plaintext: unprotected, but correct. That is the safe direction of failure, and
it is the whole reason the mapping is an output of this tool rather than an
input you are trusted to remember to trim yourself.

CONTENT DRIFT (what happens when the site changes after the font is built)
---------------------------------------------------------------------------
  * rebuild both font + mapping        -> correct, full coverage.
  * rebuild neither                    -> correct. New words are absent from
                                          <out>.map.json, so the encoder leaves
                                          them alone and they render as
                                          plaintext. You lose protection on the
                                          new words, nothing breaks.
  * new font, stale mapping (or the
    full dictionary as the encoder
    mapping)                           -> BROKEN. Readers see raw decoys.
Guard against the third case in CI: <out>.subset.json records a `contentHash`
over every input file plus a `subsetId` over the kept source words, and the same
`subsetId` is written into <out>.map.json's `_meta`. Re-run the tool and diff the
manifest; if `contentHash` moved, the font must be rebuilt and redeployed
together with its mapping. `--keep-min N` buys coverage headroom for words the
content does not have YET -- it is protection insurance, not a safety net.

USAGE
-----
    python3 scripts/subset_font.py \\
      --font public/fonts/shieldfont-alpha.ttf \\
      --mapping public/fonts/shieldfont-alpha.map.json \\
      --content 'site/app/**/*.tsx' --content content/ \\
      --out public/fonts/shieldfont-alpha-subset \\
      --keep-min 500 --report

    # or feed a word list / a pipe instead of files
    python3 scripts/subset_font.py ... --wordlist top-2000.txt
    cat page.html | python3 scripts/subset_font.py ... --stdin --format html

Outputs <out>.ttf (glyph names kept: download tier + audit), <out>.woff2 (post
format 3.0, the browser payload), <out>.map.json (the matched encoder mapping)
and <out>.subset.json (build manifest). `--css` adds an @font-face stub.

Verify a subset with the normal battery:
    python3 scripts/audit_font.py --font <out>.ttf --mapping <out>.map.json \\
                                  --mapping-id <id>

Requires: fontTools, brotli. `--self-check` additionally needs hb-shape
(brew install harfbuzz).
"""
import argparse
import glob as globlib
import hashlib
import html as htmllib
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_font import drop_glyph_names, make_injective  # noqa: E402
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

# Composite word glyphs are the only thing we ever prune. Everything else --
# Latin base, punctuation, Optik's own fi/fl ligatures, the digit glyphs -- is
# kept unconditionally; it is ~526 glyphs and it is the ~50 KB fixed floor.
WORD_GLYPH_PREFIX = "word."

# Mirrors packages/core/src/html.ts:SKIP_TAGS. Text inside these is never
# encoded, so words that only occur there can never trigger a substitution.
SKIP_TAGS = ("script", "style", "code", "pre", "textarea", "svg", "math", "noscript")

# Mirrors packages/core/src/encode.ts:WORD_RE = /\p{L}+/gu -- Unicode letter runs
# over NFC-normalised text. `[^\W\d_]` is the stdlib-re spelling of \p{L}.
WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

CONTENT_EXTENSIONS = {
    ".txt", ".text", ".md", ".mdx", ".markdown", ".html", ".htm", ".xhtml",
    ".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".svelte", ".json", ".yml",
    ".yaml", ".rst",
}

FORMAT_BY_EXT = {
    ".md": "markdown", ".mdx": "markdown", ".markdown": "markdown", ".rst": "markdown",
    ".html": "html", ".htm": "html", ".xhtml": "html", ".vue": "html", ".svelte": "html",
    ".tsx": "jsx", ".jsx": "jsx", ".ts": "jsx", ".js": "jsx", ".mjs": "jsx",
}


# ---------------------------------------------------------------------------
# 1. Vocabulary extraction
# ---------------------------------------------------------------------------
# Over-extraction is the SAFE direction: an extra pair costs ~74-93 bytes and
# nothing else, while a missed word costs protection on that word. So every
# extractor below errs towards keeping too much text, not too little.

_FENCE_RE = re.compile(r"^[ \t]*(```|~~~).*?^[ \t]*\1", re.S | re.M)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_MD_URL_RE = re.compile(r"\]\([^)\s]*(?:\s+\"[^\"]*\")?\)")
_TAG_RE = re.compile(r"<[!/]?[a-zA-Z][^>]*?>", re.S)
_LINE_COMMENT_RE = re.compile(r"(?<![:/])//[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
_IMPORT_RE = re.compile(r"^\s*(?:import|export)\b[^\n]*?from\s+['\"][^'\"]+['\"];?\s*$", re.M)
_BARE_IMPORT_RE = re.compile(r"^\s*import\s+['\"][^'\"]+['\"];?\s*$", re.M)
_STRING_RE = re.compile(
    r"'((?:[^'\\\n]|\\.)*)'"      # 'single'
    r"|\"((?:[^\"\\\n]|\\.)*)\""  # "double"
    r"|`((?:[^`\\]|\\.)*)`",      # `template`
    re.S,
)
_JSX_TEXT_RE = re.compile(r">([^<>{}]+)<")
_HTML_LANG_RE = re.compile(r"<html\b[^>]*\blang\s*=\s*(['\"])(.*?)\1", re.I | re.S)


def _strip_skip_tags(text):
    for tag in SKIP_TAGS:
        text = re.sub(
            rf"<{tag}\b[^>]*>.*?</{tag}\s*>", " ", text, flags=re.S | re.I
        )
    return text


def extract_text(raw, fmt):
    """Reduce a source file to the prose a reader would actually see."""
    if fmt == "text":
        return raw
    if fmt == "html":
        return htmllib.unescape(_TAG_RE.sub(" ", _strip_skip_tags(raw)))
    if fmt == "markdown":
        out = _FENCE_RE.sub(" ", raw)
        out = _INLINE_CODE_RE.sub(" ", out)
        out = _MD_URL_RE.sub("]", out)
        return htmllib.unescape(_TAG_RE.sub(" ", _strip_skip_tags(out)))
    if fmt == "jsx":
        # Prose in a TSX page lives in two places: JSX text nodes and string /
        # template literals. Identifiers (className, useState, ...) are dropped,
        # which is why a component tree subsets to prose and not to React's API.
        out = _BLOCK_COMMENT_RE.sub(" ", raw)
        out = _LINE_COMMENT_RE.sub(" ", out)
        out = _IMPORT_RE.sub(" ", out)
        out = _BARE_IMPORT_RE.sub(" ", out)
        chunks = [m.group(1) for m in _JSX_TEXT_RE.finditer(out)]
        for m in _STRING_RE.finditer(out):
            chunks.append(m.group(1) or m.group(2) or m.group(3) or "")
        joined = " ".join(chunks)
        return htmllib.unescape(_TAG_RE.sub(" ", joined))
    raise ValueError(f"unknown format {fmt!r}")


def detect_html_language(raw):
    """Return the declared HTML language, or None when it is absent/invalid."""
    match = _HTML_LANG_RE.search(raw)
    if not match:
        return None
    value = match.group(2).strip()
    return value or None


def resolve_html_language(raw, default="dflt"):
    """Use the declared language when present, otherwise the safe default."""
    return detect_html_language(raw) or default


def tokenize(text):
    """Mirror the encoder: NFC, letter runs, attached combining marks."""
    normalized = unicodedata.normalize("NFC", text)
    supported_marks = set(range(0x0300, 0x0370))
    tokens = []
    index = 0
    while index < len(normalized):
        if not normalized[index].isalpha():
            index += 1
            continue
        end = index + 1
        while end < len(normalized):
            char = normalized[end]
            if char.isalpha() or (
                ord(char) in supported_marks
                and unicodedata.category(char).startswith("M")
            ):
                end += 1
            else:
                break
        tokens.append(normalized[index:end].lower())
        index = end
    return iter(tokens)


def resolve_inputs(patterns):
    """Expand globs / directories / plain paths into a sorted file list."""
    seen, files = set(), []
    for pattern in patterns:
        p = Path(pattern)
        if p.is_dir():
            matches = [q for q in sorted(p.rglob("*")) if q.is_file()]
        elif p.is_file():
            matches = [p]
        else:
            matches = [Path(m) for m in sorted(globlib.glob(pattern, recursive=True))]
            matches = [m for m in matches if m.is_file()]
        for m in matches:
            if m.suffix.lower() not in CONTENT_EXTENSIONS and not p.is_file():
                continue
            key = str(m.resolve())
            if key not in seen:
                seen.add(key)
                files.append(m)
    return files


def build_vocabulary(files, forced_format, wordlists, use_stdin, stdin_format):
    """Return (Counter of lowercase tokens, list of (path, sha1, tokens))."""
    counts = Counter()
    per_file = []
    for path in files:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            print(f"[WARN] Unreadable, skipped: {path} ({exc})")
            continue
        fmt = forced_format or FORMAT_BY_EXT.get(path.suffix.lower(), "text")
        tokens = list(tokenize(extract_text(raw, fmt)))
        counts.update(tokens)
        per_file.append((str(path), hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16],
                         len(tokens), fmt))
    for wl in wordlists:
        raw = Path(wl).read_text(encoding="utf-8", errors="replace")
        tokens = list(tokenize(raw))
        counts.update(tokens)
        per_file.append((str(wl), hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16],
                         len(tokens), "wordlist"))
    if use_stdin:
        raw = sys.stdin.read()
        tokens = list(tokenize(extract_text(raw, stdin_format)))
        counts.update(tokens)
        per_file.append(("<stdin>", hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16],
                         len(tokens), stdin_format))
    return counts, per_file


# ---------------------------------------------------------------------------
# 2. Index the font's own GSUB: decoy spelling -> composite glyph names
# ---------------------------------------------------------------------------
# Built from the font rather than from the mapping + glyph-name salt, so the
# tool works on a font whose salt it does not know and so any font/mapping
# disagreement shows up as an explicit warning instead of a missing pair.

def _inner(subtable):
    return subtable.ExtSubTable if hasattr(subtable, "ExtSubTable") else subtable


def _effective_type(lookup, subtable):
    if getattr(lookup, "LookupType", None) == 7 and hasattr(subtable, "ExtensionLookupType"):
        return subtable.ExtensionLookupType
    return getattr(lookup, "LookupType", None)


def index_font(font):
    """decoy-spelling (lowercased) -> sorted list of word.* glyph names.

    The three case variants of one pair (`word.X`, `word.X.cap`, `word.X.upper`)
    have decoy spellings that differ only in case, so lowercasing collapses them
    onto one key: selecting a pair always selects all three of its glyphs.
    """
    reverse_cmap = {}
    for cp, gname in font.getBestCmap().items():
        reverse_cmap.setdefault(gname, chr(cp))

    decoy_to_glyphs = defaultdict(set)
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            st = _inner(sub)
            ligatures = getattr(st, "ligatures", None)
            if not ligatures:
                continue
            for first, lig_list in ligatures.items():
                for lig in lig_list:
                    if not lig.LigGlyph.startswith(WORD_GLYPH_PREFIX):
                        continue  # Optik's own fi/fl/ff -- never pruned
                    spelling = "".join(
                        reverse_cmap.get(g, "�") for g in [first] + list(lig.Component)
                    )
                    decoy_to_glyphs[spelling.lower()].add(lig.LigGlyph)
    return {k: sorted(v) for k, v in decoy_to_glyphs.items()}


# ---------------------------------------------------------------------------
# 3. Prune the layout rules (the step pyftsubset cannot do for us)
# ---------------------------------------------------------------------------

def prune_gsub(font, keep_glyphs):
    """Drop every word composite outside `keep_glyphs` from A, C, D and E.

    Symmetry is the correctness property: a pair leaves the LigatureSubst, the
    MultipleSubst reversal and every chain-context coverage in the same pass, so
    the fire-then-revert invariant ("anything A can produce, C can undo, and D/E
    can see") holds over the reduced set exactly as it did over the full one.
    Digit glyphs do not carry the word. prefix and are therefore untouched, which
    keeps the letter-flanked-digit behaviour identical.
    """
    stats = Counter()
    gsub = font["GSUB"].table

    def keep(g):
        return (not g.startswith(WORD_GLYPH_PREFIX)) or g in keep_glyphs

    for lookup in gsub.LookupList.Lookup:
        for sub in lookup.SubTable:
            st = _inner(sub)
            ltype = _effective_type(lookup, sub)

            # A -- LigatureSubst (type 4)
            ligatures = getattr(st, "ligatures", None)
            if ligatures is not None:
                for first in list(ligatures.keys()):
                    kept = [lig for lig in ligatures[first] if keep(lig.LigGlyph)]
                    stats["lig_rules_dropped"] += len(ligatures[first]) - len(kept)
                    if kept:
                        ligatures[first] = kept
                    else:
                        del ligatures[first]

            # C -- MultipleSubst reversal (type 2). SingleSubst also exposes
            # `.mapping`, so gate on the lookup type: never touch type 1.
            mapping = getattr(st, "mapping", None)
            if mapping is not None and ltype == 2:
                for src in list(mapping.keys()):
                    if not keep(src):
                        del mapping[src]
                        stats["revert_rules_dropped"] += 1

            # D / E -- chain-context coverages (and any format-3 coverage list).
            for attr in ("Coverage", "BacktrackCoverage", "InputCoverage", "LookAheadCoverage"):
                value = getattr(st, attr, None)
                if value is None:
                    continue
                covs = value if isinstance(value, list) else [value]
                for cov in covs:
                    if cov is None or not hasattr(cov, "glyphs"):
                        continue
                    before = len(cov.glyphs)
                    pruned = [g for g in cov.glyphs if keep(g)]
                    if not pruned and before:
                        # Would leave an empty coverage -> the subtable can never
                        # match and some shapers reject it. Cannot happen for the
                        # ShieldFont chains (letters and digit glyphs always
                        # survive) but refuse to emit a broken font if it does.
                        raise RuntimeError(
                            f"pruning emptied {attr} on a lookup type {ltype} subtable; "
                            "refusing to write a font whose chain rules can never match"
                        )
                    stats["coverage_entries_dropped"] += before - len(pruned)
                    cov.glyphs = pruned
            # Format-3 chains carry an explicit count beside each coverage list.
            for attr, count_attr in (
                ("BacktrackCoverage", "BacktrackGlyphCount"),
                ("InputCoverage", "InputGlyphCount"),
                ("LookAheadCoverage", "LookAheadGlyphCount"),
            ):
                value = getattr(st, attr, None)
                if isinstance(value, list) and hasattr(st, count_attr):
                    setattr(st, count_attr, len(value))
    return stats


def subset_glyphs(font, keep_glyphs, keep_names):
    opts = subset.Options()
    opts.layout_features = ["*"]     # ccmp/liga/calt/kern all stay wired
    opts.name_IDs = ["*"]            # keep the family name so @font-face matches
    opts.notdef_outline = True
    opts.glyph_names = keep_names
    opts.hinting = True
    opts.recalc_bounds = False
    opts.drop_tables = []
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(glyphs=sorted(keep_glyphs))
    subsetter.subset(font)


# ---------------------------------------------------------------------------
# 4. Self-check
# ---------------------------------------------------------------------------

HB_BACKEND_MISSING = False


def hb_shape(font_path, text):
    global HB_BACKEND_MISSING
    try:
        out = subprocess.run(
            ["hb-shape", "--no-positions", str(font_path), text],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        HB_BACKEND_MISSING = True
        return None
    if out.returncode != 0:
        return None
    s = out.stdout.strip().lstrip("[").rstrip("]")
    return [] if not s else [chunk.split("=")[0] for chunk in s.split("|")]


def self_check(font_path, kept_pairs, decoy_index, sample_size, seed=0):
    """Shape a random sample of kept pairs through the SUBSET font.

    Each pair must still collapse the decoy to exactly one composite glyph in
    all three case variants. A regression here means a reader sees gibberish.
    """
    rng = random.Random(seed)
    pairs = sorted(kept_pairs)
    if sample_size < len(pairs):
        pairs = rng.sample(pairs, sample_size)
    failures, checks = [], 0
    for source, decoy in pairs:
        glyphs_for_pair = decoy_index.get(decoy.lower(), [])
        base = next((g for g in glyphs_for_pair
                     if not g.endswith(".cap") and not g.endswith(".upper")), None)
        if base is None:
            continue
        variants = [
            (decoy, base),
            (decoy[0].upper() + decoy[1:], base + ".cap"),
            (decoy.upper(), base + ".upper"),
        ]
        for probe, want in variants:
            if want not in glyphs_for_pair:
                continue
            checks += 1
            got = hb_shape(font_path, f" {probe} ")
            middle = [g for g in (got or []) if g != "space"]
            if len(middle) != 1 or middle[0] != want:
                failures.append((source, decoy, probe, want, " ".join(middle)))
    return checks, failures


# ---------------------------------------------------------------------------
# 5. Main
# ---------------------------------------------------------------------------

def load_mapping(path):
    data = json.loads(Path(path).read_text())
    meta = data.pop("_meta", None)
    return data, meta


def main():
    parser = argparse.ArgumentParser(
        description="Content-scoped subsetting for a built ShieldFont",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="A subset font is only correct when paired with the <out>.map.json "
               "this run emits. Encode with that file, never with the full dictionary.",
    )
    parser.add_argument("--font", required=True,
                        help="Built ShieldFont .ttf to subset (the download-tier one, "
                             "with glyph names -- e.g. public/fonts/shieldfont-alpha.ttf).")
    parser.add_argument("--mapping", required=True,
                        help="The mapping the font was built from: flat {source: decoy} JSON, "
                             "with or without a `_meta` block. Prefer the emitted "
                             "public/fonts/<variant>.map.json (already injective).")
    parser.add_argument("--content", action="append", default=[], metavar="PATH|GLOB",
                        help="Content to scope to. Repeatable. Accepts a file, a directory "
                             "(walked recursively) or a glob such as 'content/**/*.md'. "
                             "Quote the glob so this tool expands it rather than the shell.")
    parser.add_argument("--wordlist", action="append", default=[], metavar="PATH",
                        help="Extra vocabulary, one word per line (a frequency list makes a "
                             "far better coverage floor than --keep-min). Repeatable.")
    parser.add_argument("--stdin", action="store_true", help="Also read content from stdin.")
    parser.add_argument("--format", choices=("auto", "text", "markdown", "html", "jsx"),
                        default="auto",
                        help="Force an extractor instead of choosing by file extension. "
                             "'jsx' pulls JSX text nodes and string literals out of TSX/JS. "
                             "Also selects the extractor for --stdin (default there: text).")
    parser.add_argument("--out", required=True, metavar="PREFIX",
                        help="Output prefix -> PREFIX.ttf, PREFIX.woff2, PREFIX.map.json, "
                             "PREFIX.subset.json.")
    parser.add_argument("--keep-min", type=int, default=0, metavar="N",
                        help="Keep at least N pairs, padding the content-derived set in the "
                             "mapping's own key order. Coverage headroom for words the content "
                             "does not have yet -- NOT a safety net (see the module docstring).")
    parser.add_argument("--post-format-3", choices=("auto", "both", "none"), default="auto",
                        help="Drop glyph names. 'auto' (DEFAULT): on for the .woff2, off for the "
                             ".ttf, matching generate_font.py. 'both': also on the .ttf. 'none': "
                             "keep names everywhere.")
    parser.add_argument("--css", action="store_true", help="Also write PREFIX.css (@font-face).")
    parser.add_argument("--family", help="font-family name for --css (default: read from the font).")
    parser.add_argument("--no-woff2", action="store_true", help="Skip the .woff2 (TTF only).")
    parser.add_argument("--self-check", type=int, default=0, metavar="N",
                        help="After building, HarfBuzz-shape N random kept pairs (x3 case "
                             "variants) through the SUBSET font and fail if any does not "
                             "collapse to its composite. Needs hb-shape. 0 = off.")
    parser.add_argument("--baseline-woff2", metavar="PATH",
                        help="Full-dictionary .woff2 to report the reduction against "
                             "(default: the .woff2 sitting next to --font, if any).")
    parser.add_argument("--report", action="store_true",
                        help="Print the long report: top uncovered words, extractor per file, "
                             "and the byte breakdown.")
    add_json_result_argument(parser)
    args = parser.parse_args()
    diag = Diagnostics(__file__, args.json_out)

    started = time.time()
    font_path = Path(args.font)
    out_prefix = Path(args.out)
    try:
        out_prefix.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"[FAIL] could not prepare output directory: {type(exc).__name__}: {exc}")
        if diag.json_out is not None:
            diag.fail("could not prepare output directory", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1

    print("=" * 68)
    print("ShieldFont content-scoped subsetter")
    print("=" * 68)

    if not args.content and not args.wordlist and not args.stdin:
        parser.error("give at least one of --content / --wordlist / --stdin")

    # ---- vocabulary -------------------------------------------------------
    files = resolve_inputs(args.content)
    if args.content and not files:
        if diag.json_out is not None:
            diag.fail("content input matched no files", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        print(f"[FAIL] --content matched no files: {args.content}")
        return 1
    forced = None if args.format == "auto" else args.format
    stdin_fmt = forced or "text"
    counts, per_file = build_vocabulary(files, forced, args.wordlist, args.stdin, stdin_fmt)
    if not counts:
        if diag.json_out is not None:
            diag.fail("no words extracted from content", stage="input",
                      code="input_empty", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="input_empty")
        print("[FAIL] No words extracted from the supplied content")
        return 1
    print(f"[OK] Content: {len(per_file)} input(s), {sum(counts.values()):,} tokens, "
          f"{len(counts):,} distinct words")

    # ---- mapping ----------------------------------------------------------
    try:
        mapping, meta = load_mapping(args.mapping)
    except FileNotFoundError:
        if diag.json_out is not None:
            diag.fail("mapping input not found", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        raise
    except Exception as exc:
        if diag.json_out is not None:
            diag.fail("mapping input is invalid", stage="input",
                      code="input_invalid", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="input_invalid")
        raise
    mapping = make_injective(dict(mapping))
    multi = {s: d for s, d in mapping.items() if len(s) > 1}
    digits = {s: d for s, d in mapping.items() if len(s) == 1}

    # ---- the intersection -------------------------------------------------
    # Content is written in SOURCE words; keep the pair whose SOURCE is present.
    needed = [s for s in multi if s in counts]
    if args.keep_min > len(needed):
        have = set(needed)
        for s in multi:                       # mapping key order == dictionary order
            if len(needed) >= args.keep_min:
                break
            if s not in have:
                needed.append(s)
                have.add(s)
    needed_sorted = sorted(needed)

    try:
        font = TTFont(str(font_path))
    except FileNotFoundError:
        if diag.json_out is not None:
            diag.fail("font input not found", stage="input",
                      code=CODE_INPUT_NOT_FOUND, exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code=CODE_INPUT_NOT_FOUND)
        raise
    except Exception:
        if diag.json_out is not None:
            diag.fail("font input is invalid", stage="input",
                      code="input_invalid", exit_code=EXIT_INPUT)
            return diag.finish(EXIT_INPUT, stage="input", code="input_invalid")
        raise
    glyphs_before = font["maxp"].numGlyphs
    decoy_index = index_font(font)
    print(f"[OK] Font: {glyphs_before:,} glyphs, {len(decoy_index):,} word pairs in GSUB")

    keep_glyphs, kept_pairs, missing = set(), [], []
    for source in needed_sorted:
        decoy = multi[source].lower()
        glyphs = decoy_index.get(decoy)
        if not glyphs:
            missing.append((source, decoy))
            continue
        keep_glyphs.update(glyphs)
        kept_pairs.append((source, multi[source]))
    if missing:
        print(f"[WARN] {len(missing)} mapping pair(s) have no ligature in this font "
              f"(font/mapping mismatch?) -- e.g. {missing[:5]}")

    total_pairs = len(decoy_index)
    dropped_pairs = total_pairs - len(kept_pairs)
    covered_tokens = sum(counts[s] for s, _ in kept_pairs)
    total_tokens = sum(counts.values())
    uncovered = [(w, c) for w, c in counts.most_common()
                 if w not in multi and not w.isdigit()]

    print(f"[OK] Pairs kept {len(kept_pairs):,} / {total_pairs:,} "
          f"({dropped_pairs:,} dropped, {100 * len(kept_pairs) / total_pairs:.1f}% kept)")
    print(f"[OK] Token coverage: {covered_tokens:,} / {total_tokens:,} "
          f"({100 * covered_tokens / total_tokens:.1f}% of the words on the page get shielded)")

    # ---- prune + subset ---------------------------------------------------
    print("[..] Pruning GSUB (LigatureSubst / MultipleSubst / chain coverages)...")
    stats = prune_gsub(font, keep_glyphs)
    print(f"[OK] Dropped {stats['lig_rules_dropped']:,} ligature rules, "
          f"{stats['revert_rules_dropped']:,} reversal rules, "
          f"{stats['coverage_entries_dropped']:,} coverage entries")

    base_glyphs = [g for g in font.getGlyphOrder() if not g.startswith(WORD_GLYPH_PREFIX)]
    keep_all = set(base_glyphs) | keep_glyphs
    print(f"[..] Subsetting to {len(keep_all):,} glyphs "
          f"({len(base_glyphs):,} base + {len(keep_glyphs):,} composites)...")
    subset_glyphs(font, keep_all, keep_names=(args.post_format_3 != "both"))
    glyphs_after = font["maxp"].numGlyphs

    ttf_path = out_prefix.with_suffix(".ttf")
    font.flavor = None
    if args.post_format_3 == "both":
        drop_glyph_names(font)
    try:
        font.save(str(ttf_path))
    except OSError as exc:
        print(f"[FAIL] could not write TTF: {type(exc).__name__}: {exc}")
        if diag.json_out is not None:
            diag.fail("could not write TTF", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1
    ttf_bytes = ttf_path.stat().st_size
    print(f"[OK] Saved TTF: {ttf_path} ({ttf_bytes:,} bytes)")

    woff2_bytes = None
    if not args.no_woff2:
        woff2_path = out_prefix.with_suffix(".woff2")
        font2 = TTFont(str(ttf_path))
        if args.post_format_3 in ("auto", "both"):
            drop_glyph_names(font2)
        font2.flavor = "woff2"
        try:
            font2.save(str(woff2_path))
        except OSError as exc:
            print(f"[FAIL] could not write WOFF2: {type(exc).__name__}: {exc}")
            if diag.json_out is not None:
                diag.fail("could not write WOFF2", stage="output",
                          code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
                return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
            return 1
        woff2_bytes = woff2_path.stat().st_size
        print(f"[OK] Saved WOFF2: {woff2_path} ({woff2_bytes:,} bytes)")

    # ---- the matched mapping ---------------------------------------------
    subset_id = hashlib.sha1(
        "\n".join(f"{s}\t{d}" for s, d in sorted(kept_pairs)).encode("utf-8")
    ).hexdigest()[:12]
    content_hash = hashlib.sha256(
        "\n".join(f"{p}\t{h}" for p, h, _, _ in sorted(per_file)).encode("utf-8")
    ).hexdigest()[:16]

    subset_mapping = {s: d for s, d in sorted(kept_pairs)}
    subset_mapping.update(digits)   # digit swaps are content-independent
    out_meta = dict(meta or {})
    out_meta.update({
        "pairs": len(subset_mapping),
        "subsetOf": out_meta.get("mappingId") or Path(args.mapping).name,
        "subsetId": subset_id,
        "contentHash": content_hash,
        "font": ttf_path.with_suffix(".woff2").name,
    })
    if out_meta.get("mappingId"):
        out_meta["mappingId"] = f"{out_meta['mappingId']}+subset.{subset_id}"
    map_path = Path(str(out_prefix) + ".map.json")
    try:
        map_path.write_text(json.dumps({"_meta": out_meta, **subset_mapping}, indent=2) + "\n")
    except OSError as exc:
        print(f"[FAIL] could not write mapping output: {type(exc).__name__}: {exc}")
        if diag.json_out is not None:
            diag.fail("could not write mapping output", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1
    print(f"[OK] Saved matched mapping: {map_path} ({len(subset_mapping):,} entries)")

    # ---- manifest ---------------------------------------------------------
    baseline = args.baseline_woff2 or font_path.with_suffix(".woff2")
    baseline_bytes = Path(baseline).stat().st_size if Path(baseline).exists() else None
    manifest = {
        "tool": "scripts/subset_font.py",
        "font_in": str(font_path),
        "mapping_in": str(args.mapping),
        "out": str(out_prefix),
        "subsetId": subset_id,
        "contentHash": content_hash,
        "inputs": [{"path": p, "sha1": h, "tokens": t, "format": f} for p, h, t, f in per_file],
        "vocabulary": len(counts),
        "tokens": total_tokens,
        "pairs_total": total_pairs,
        "pairs_kept": len(kept_pairs),
        "pairs_dropped": dropped_pairs,
        "pairs_from_content": len([s for s in multi if s in counts]),
        "pairs_from_keep_min": max(0, len(needed_sorted) - len([s for s in multi if s in counts])),
        "token_coverage": round(covered_tokens / total_tokens, 4),
        "glyphs_before": glyphs_before,
        "glyphs_after": glyphs_after,
        "ttf_bytes": ttf_bytes,
        "woff2_bytes": woff2_bytes,
        "baseline_woff2_bytes": baseline_bytes,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    manifest_path = Path(str(out_prefix) + ".subset.json")
    try:
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    except OSError as exc:
        print(f"[FAIL] could not write manifest output: {type(exc).__name__}: {exc}")
        if diag.json_out is not None:
            diag.fail("could not write manifest output", stage="output",
                      code=CODE_OUTPUT_UNWRITABLE, exit_code=EXIT_OUTPUT)
            return diag.finish(EXIT_OUTPUT, stage="output", code=CODE_OUTPUT_UNWRITABLE)
        return 1

    if args.css:
        family = args.family
        if not family:
            font3 = TTFont(str(ttf_path))
            family = font3["name"].getDebugName(16) or font3["name"].getDebugName(1) or "ShieldFont"
        css_path = Path(str(out_prefix) + ".css")
        css_path.write_text(
            f"@font-face {{\n  font-family: '{family}';\n"
            f"  src: url('{out_prefix.name}.woff2') format('woff2'),\n"
            f"       url('{out_prefix.name}.ttf') format('truetype');\n"
            f"  font-weight: normal;\n  font-style: normal;\n  font-display: block;\n}}\n"
        )
        print(f"[OK] Saved CSS: {css_path}")

    # ---- self-check -------------------------------------------------------
    rc = 0
    if args.self_check:
        print(f"[..] Self-check: shaping {min(args.self_check, len(kept_pairs))} kept pairs "
              f"x3 case variants through the subset font...")
        checks, failures = self_check(ttf_path, kept_pairs, decoy_index, args.self_check)
        if HB_BACKEND_MISSING:
            rc = EXIT_BACKEND
            print("[FAIL] HarfBuzz backend unavailable: hb-shape not found")
            if diag.json_out is not None:
                diag.fail("HarfBuzz backend unavailable", stage="backend",
                          code=CODE_BACKEND_MISSING, exit_code=EXIT_BACKEND)
        elif failures:
            rc = 1
            print(f"[FAIL] {len(failures)} / {checks} round-trip checks failed:")
            for src, decoy, probe, want, got in failures[:20]:
                print(f"       {probe!r} -> want {want!r}, got {got!r} (pair {src!r}/{decoy!r})")
        else:
            print(f"[OK] Self-check: {checks} round-trip checks passed, 0 failures")

    # ---- report -----------------------------------------------------------
    print()
    print("-" * 68)
    print("SUBSET REPORT")
    print("-" * 68)
    print(f"  input vocabulary      {len(counts):>12,} distinct words "
          f"({total_tokens:,} tokens)")
    print(f"  pairs kept            {len(kept_pairs):>12,}")
    print(f"  pairs dropped         {dropped_pairs:>12,}")
    print(f"  token coverage        {100 * covered_tokens / total_tokens:>11.1f}%")
    print(f"  glyphs   before/after {glyphs_before:>12,} -> {glyphs_after:,} "
          f"({glyphs_before / max(glyphs_after, 1):.1f}x)")
    print(f"  ttf      before/after {font_path.stat().st_size:>12,} -> {ttf_bytes:,} "
          f"({font_path.stat().st_size / max(ttf_bytes, 1):.1f}x)")
    if woff2_bytes is not None:
        if baseline_bytes:
            print(f"  woff2    before/after {baseline_bytes:>12,} -> {woff2_bytes:,} "
                  f"({baseline_bytes / max(woff2_bytes, 1):.1f}x)")
        else:
            print(f"  woff2  (browser bytes) {woff2_bytes:>11,}")
    print(f"  elapsed               {time.time() - started:>11.1f}s")
    print(f"  subsetId              {subset_id:>12}")
    print(f"  contentHash           {content_hash:>12}")

    if args.report:
        print()
        print("  inputs:")
        for p, h, t, f in per_file:
            print(f"    {f:<9} {t:>8,} tok  {h}  {p}")
        print()
        print("  top content words with no pair in this dictionary (never shielded):")
        for word, n in uncovered[:15]:
            print(f"    {n:>7,}  {word}")

    print()
    print("  NEXT: encode with the mapping this run emitted, not the full dictionary:")
    print(f"      {map_path}")
    print("        The font can no longer render the pairs it dropped. Encoding with the")
    print("        full dictionary would put decoys on the page that this font cannot")
    print("        turn back -- readers would see the raw gibberish. Pairing them keeps")
    print("        uncovered words in plaintext instead: unprotected, but correct.")
    print("  Re-run whenever the content changes; diff contentHash in "
          f"{manifest_path.name} in CI.")
    print("=" * 68)
    if diag.json_out is not None:
        if rc == EXIT_BACKEND:
            return diag.finish(EXIT_BACKEND, stage="backend",
                               code=CODE_BACKEND_MISSING)
        if rc:
            diag.fail("self-check validation failed", stage="validation",
                      code=CODE_VALIDATION_FAILED, exit_code=EXIT_VALIDATION)
            return diag.finish(EXIT_VALIDATION, stage="validation",
                               code=CODE_VALIDATION_FAILED)
        return diag.finish(0, stage="complete", details={"status": "written"})
    return rc


if __name__ == "__main__":
    sys.exit(main())
