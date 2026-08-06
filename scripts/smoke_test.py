#!/usr/bin/env python3
"""smoke_test.py — prove every script in scripts/ still starts and can find the
files it points at. Not a correctness test: a "does smoke come out" test.

WHY THIS EXISTS
  reseed_mapping.py shipped for two days pointing at `benchmarks/v7/data/`, a
  folder that had been reorganised to `benchmark/data/v7/`. Every JS test, the
  font check and the build stayed green the whole time, because nothing in CI
  ever ran a script in this directory. The bug surfaced when an outside
  contributor hit the traceback and opened a PR to fix it (#3).

  A hardcoded path is a *string*. No compiler, linter or type checker looks
  inside it, so a rename breaks it silently and it stays broken until a human
  runs that exact line.

WHAT IT CHECKS
  1. Every script loads — catches syntax errors, bad imports, and failures in
     module-level code (stamp_mapping_meta.py reads MANIFEST.json on import).
  2. Every module-level Path constant aimed inside the repo still resolves —
     unless git ignores it, which means it is a build artifact (the whole of
     public/ is generated) and is legitimately absent from a fresh clone. Ask
     git rather than guessing from the constant's name: a first attempt matched
     names like *_OUT and passed locally, where public/ happened to be full,
     then failed in CI where it does not exist at all.
  3. Four self-contained scripts actually run, into a temp dir. Their inputs
     must be tracked files for the same reason. The other five:
     fix_composite_lsb.py is already exercised by the neighbouring CI step;
     generate_font.py downloads a base font over the network; audit_font.py and
     subset_font.py need a full HarfBuzz/content setup; stamp_mapping_meta.py
     rewrites tracked files, which a test should not do as a side effect.

  It does NOT check that any output is correct — that a mapping conceals well,
  or that a font renders. Crashes and missing files only.

Usage:
  python3 scripts/smoke_test.py
"""
import json
import runpy
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = sorted(p for p in (ROOT / "scripts").glob("*.py")
                 if p.name != Path(__file__).name)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL {msg}")


def load(script: Path) -> dict | None:
    """Execute a script's module-level code and hand back its globals.

    run_name is deliberately not "__main__", so the `if __name__ == "__main__"`
    guard at the foot of each script does not fire and we only run the top.
    sys.argv is neutralised because stamp_mapping_meta.py parses it on import.
    """
    saved_argv, saved_path = sys.argv[:], sys.path[:]
    sys.argv = [str(script)]
    try:
        return runpy.run_path(str(script), run_name="shieldfont_smoke_test")
    except Exception as e:
        fail(f"{script.name} does not load: {type(e).__name__}: {e}")
        return None
    finally:
        sys.argv, sys.path = saved_argv, saved_path


def in_repo_paths(script: Path, ns: dict) -> list[tuple[str, Path]]:
    found = []
    for name, value in sorted(ns.items()):
        if name.startswith("_") or not isinstance(value, Path):
            continue
        if not value.is_absolute():
            continue
        try:  # only constants aimed inside the repo; /tmp scratch is not ours
            value.relative_to(ROOT)
        except ValueError:
            continue
        found.append((name, value))
    return found


PROBE = ".smoke-probe"


def git_ignored(paths: list[Path]) -> set[Path] | None:
    """Which of these does the repo generate rather than commit? None if git
    cannot answer.

    Ignored means generated — everything under public/ is built by
    generate_font.py and never committed — so a fresh clone not having it is
    correct, not a fault.

    Each path is asked about twice: itself, and a child that cannot exist. The
    child is what catches a *directory* whose contents are all generated:
    `public/fonts/*` ignores everything inside public/fonts without ignoring
    the folder itself, so asking only about the folder says "not ignored" and
    a fresh clone, which has no public/ at all, fails for no reason.
    """
    if not paths:
        return set()
    queries = [str(p) for p in paths] + [str(p / PROBE) for p in paths]
    try:
        proc = subprocess.run(
            ["git", "check-ignore", "--stdin"],
            cwd=ROOT,
            input="\n".join(queries).encode(),
            capture_output=True,
        )
    except OSError:
        return None
    if proc.returncode not in (0, 1):  # 0 = some ignored, 1 = none; 128 = no git
        return None
    # Git quotes absolute Windows paths and may include CRLF in its output.
    # Normalize both forms so a fresh checkout does not report generated paths
    # as missing merely because this probe runs on Windows.
    hits = set()
    for raw in proc.stdout.splitlines():
        line = raw.decode(errors="replace").strip()
        if not line:
            continue
        if line.startswith('"') and line.endswith('"'):
            try:
                line = json.loads(line)
            except json.JSONDecodeError:
                line = line.strip('"')
        hits.add(line)
    return {p for p in paths if str(p) in hits or str(p / PROBE) in hits}


def run(label: str, argv: list[str]) -> bool:
    proc = subprocess.run([sys.executable, *argv], capture_output=True,
                          text=True, cwd=ROOT)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        fail(f"{label} exited {proc.returncode}: {' / '.join(tail)}")
        return False
    return True


def end_to_end(tmp: Path) -> None:
    pairs = ROOT / "benchmark/data/v7/pairs_v7_alpha_v15_0_1_0_0_0_0.json"
    mapping = tmp / "mapping.json"

    if run("reseed_mapping.py", ["scripts/reseed_mapping.py", "--seed",
                                 "12345", "--out", str(mapping)]):
        m = json.loads(mapping.read_text())
        # every pair must map both ways, or the encoder cannot round-trip
        broken = [s for s, t in m.items() if m.get(t) != s]
        if broken:
            fail(f"reseed_mapping.py: {len(broken)} entries do not map back "
                 f"(e.g. {broken[0]!r})")
        elif len(m) < 1000:
            fail(f"reseed_mapping.py: only {len(m)} entries, expected ~12k")

    if run("build_alpha_mapping.py", ["scripts/build_alpha_mapping.py",
                                      str(pairs), str(mapping)]):
        if len(json.loads(mapping.read_text())) < 1000:
            fail("build_alpha_mapping.py: implausibly small mapping")

    # The font pair runs against a font the repo actually commits. Everything
    # under public/ is generated and gitignored, so a fresh clone has none of
    # it. --no-shape skips the HarfBuzz render check; we are asking whether the
    # script runs, not whether the glyphs are right — audit_font.py owns that.
    font = ROOT / "packages/font/optik-m.woff2"
    if not font.is_file():
        fail(f"shipped font missing — {font.relative_to(ROOT)}")
        return

    run("drop_glyph_names.py", ["scripts/drop_glyph_names.py", str(font),
                                "--out", str(tmp / "dropped.woff2"), "--no-shape"])
    run("stamp_font_version.py", ["scripts/stamp_font_version.py", str(font),
                                  "alpha", "--out", str(tmp / "stamped.woff2"),
                                  "--no-shape"])


def main() -> int:
    print(f"[smoke] {len(SCRIPTS)} scripts in scripts/")

    print("[smoke] loading each script and checking its paths")
    constants: list[tuple[Path, str, Path]] = []
    for script in SCRIPTS:
        ns = load(script)
        if ns is not None:
            constants += [(script, n, v) for n, v in in_repo_paths(script, ns)]

    ignored = git_ignored([v for _, _, v in constants])
    if ignored is None:
        print("[smoke] git cannot say what is generated — checking parent "
              "folders only")
    for script, name, value in constants:
        rel = value.relative_to(ROOT)
        if ignored is None:
            if not value.parent.is_dir():
                fail(f"{script.name}: {name} sits in a folder that does not "
                     f"exist — {rel}")
        elif value in ignored:
            continue  # generated artifact; absent from a fresh clone by design
        elif not value.exists():
            fail(f"{script.name}: {name} points at something that does not "
                 f"exist — {rel}")

    print("[smoke] running the self-contained scripts for real")
    with tempfile.TemporaryDirectory() as tmp:
        end_to_end(Path(tmp))

    if failures:
        print(f"\n[smoke] FAILED — {len(failures)} problem(s) above")
        return 1
    print("\n[smoke] OK — every script loads, every path resolves")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
