#!/usr/bin/env python3
"""Portable ShieldFont console entry point.

The executable built from this module keeps the upstream scripts as the
canonical implementation. It only selects a command, forwards every
remaining argument unchanged, and makes generated files resolve from the
caller's working directory instead of the PyInstaller extraction directory.
"""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


COMMANDS = {
    "generate_font": "generate_font.py",
    "generate-font": "generate_font.py",
    "reseed_mapping": "reseed_mapping.py",
    "reseed-mapping": "reseed_mapping.py",
}

USAGE = """ShieldFont portable console utility

Usage:
  shieldfont-tools-win64.exe generate_font [generate_font options]
  shieldfont-tools-win64.exe reseed_mapping [reseed_mapping options]

Commands:
  generate_font   Build a shielded TrueType/WOFF2 font. All options from
                  scripts/generate_font.py are forwarded unchanged.
  reseed_mapping  Create a deterministic mapping contract. All options from
                  scripts/reseed_mapping.py are forwarded unchanged.

Run '<command> --help' for the complete parameter descriptions.
The utility is self-contained and does not require Python, Node.js, or an
installed ShieldFont checkout at runtime.
"""


def _script_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "scripts"
    return Path(__file__).resolve().parent


def _print_usage() -> None:
    print(USAGE.rstrip())


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments or arguments[0] in {"-h", "--help"}:
        _print_usage()
        return 0

    command = arguments.pop(0)
    script_name = COMMANDS.get(command)
    if script_name is None:
        print(f"Unknown command: {command}", file=sys.stderr)
        _print_usage()
        return 2

    script_path = _script_root() / script_name
    if not script_path.is_file():
        print(f"Bundled command script is missing: {script_path}", file=sys.stderr)
        return 2

    # The upstream generator deliberately uses its project directory for
    # default output paths. In a one-file build that directory is temporary.
    os.environ.setdefault("SHIELDFONT_PROJECT_DIR", str(Path.cwd()))
    os.environ.setdefault(
        "SHIELDFONT_FONT_CACHE_DIR",
        str(Path.cwd() / ".shieldfont-cache"),
    )
    sys.argv = [str(script_path), *arguments]
    try:
        runpy.run_path(str(script_path), run_name="__main__")
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
