"""Small, dependency-free diagnostics and result writer for pipeline scripts.

The text stream remains intentionally human-oriented.  The optional JSON
result is a separate, stable orchestration contract and contains only fixed
codes, stages, and sanitized scalar details.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_USAGE = 2
EXIT_INPUT = 10
EXIT_BACKEND = 11
EXIT_OUTPUT = 12
EXIT_VALIDATION = 13
EXIT_RUNTIME = 14
EXIT_JSON_OUTPUT = 15
EXIT_CATEGORIES = {
    "ok": EXIT_OK,
    "usage": EXIT_USAGE,
    "input": EXIT_INPUT,
    "backend": EXIT_BACKEND,
    "output": EXIT_OUTPUT,
    "validation": EXIT_VALIDATION,
    "runtime": EXIT_RUNTIME,
    "json_output": EXIT_JSON_OUTPUT,
}

CODE_OK = "ok"
CODE_INPUT_NOT_FOUND = "input_not_found"
CODE_INPUT_INVALID = "input_invalid"
CODE_BACKEND_MISSING = "backend_missing"
CODE_OUTPUT_UNWRITABLE = "output_unwritable"
CODE_VALIDATION_FAILED = "validation_failed"
CODE_RUNTIME_ERROR = "runtime_error"
CODE_JSON_OUTPUT_FAILED = "json_output_failed"

_SAFE_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_SENSITIVE = re.compile(
    r"(mapping|document|content|text|secret|credential|password|token|"
    r"authorization|cookie|raw|probe|source|target|word|value)",
    re.I,
)
_SAFE_STRING_KEYS = {
    "artifact",
    "backend",
    "format",
    "kind",
    "language_tag",
    "merge_decision",
    "normalization_case_id",
    "operation",
    "script",
    "status",
    "supported_mark_set_id",
}


def add_json_result_argument(parser: argparse.ArgumentParser) -> None:
    """Add the common optional result path without changing existing flags."""
    parser.add_argument(
        "--json-out",
        "--json-output",
        "--result-json",
        dest="json_out",
        metavar="PATH",
        help="Write a safe machine-readable result to PATH",
    )


def safe_details(details: dict[str, Any] | None) -> dict[str, Any]:
    """Keep result details bounded and free of user-provided payloads."""
    safe: dict[str, Any] = {}
    for key, value in (details or {}).items():
        if not isinstance(key, str) or not _SAFE_KEY.fullmatch(key):
            continue
        if _SENSITIVE.search(key):
            continue
        if isinstance(value, bool) or isinstance(value, int):
            safe[key] = value
        elif isinstance(value, float):
            safe[key] = value if value == value and abs(value) != float("inf") else None
        elif isinstance(value, str) and key in _SAFE_STRING_KEYS:
            safe[key] = value[:64]
    return safe


class Diagnostics:
    """Collect stable diagnostics while preserving the existing text prefixes."""

    def __init__(self, script: str, json_out: str | Path | None = None):
        self.script = Path(script).name
        self.json_out = json_out
        self.entries: list[dict[str, Any]] = []
        self.exit_code = EXIT_OK
        self.code = CODE_OK
        self.stage = "complete"
        self.details: dict[str, Any] = {}

    def emit(
        self,
        prefix: str,
        message: str,
        *,
        stage: str,
        code: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        print(f"{prefix} {message}")
        self.entries.append({
            "level": prefix.strip("[]"),
            "stage": stage,
            "code": code,
            "details": safe_details(details),
        })

    def progress(self, message: str, *, stage: str = "run", code: str = "progress") -> None:
        self.emit("[..]", message, stage=stage, code=code)

    def ok(self, message: str, *, stage: str = "run", code: str = CODE_OK,
           details: dict[str, Any] | None = None) -> None:
        self.emit("[OK]", message, stage=stage, code=code, details=details)

    def warn(self, message: str, *, stage: str = "run", code: str = "warning",
             details: dict[str, Any] | None = None) -> None:
        self.emit("[WARN]", message, stage=stage, code=code, details=details)

    def fail(self, message: str, *, stage: str, code: str,
             details: dict[str, Any] | None = None, exit_code: int = EXIT_RUNTIME) -> int:
        self.emit("[FAIL]", message, stage=stage, code=code, details=details)
        self.exit_code = exit_code
        self.code = code
        self.stage = stage
        self.details = safe_details(details)
        return exit_code

    def finish(
        self,
        exit_code: int = EXIT_OK,
        *,
        stage: str = "complete",
        code: str = CODE_OK,
        details: dict[str, Any] | None = None,
    ) -> int:
        self.exit_code = exit_code
        self.stage = stage
        self.code = code
        self.details = safe_details(details)
        if exit_code == EXIT_OK and not any(
            entry["level"] == "OK" for entry in self.entries
        ):
            self.entries.append({
                "level": "OK",
                "stage": stage,
                "code": code,
                "details": self.details,
            })
        if self.json_out is not None:
            try:
                path = Path(self.json_out)
                if not str(path) or path.exists() and path.is_dir():
                    raise OSError("result path is a directory")
                if not path.parent.exists():
                    raise OSError("result directory does not exist")
                payload = {
                    "schema": "shieldfont.script-result.v1",
                    "script": self.script,
                    "ok": exit_code == EXIT_OK,
                    "exit_code": exit_code,
                    "status": "PASS" if exit_code == EXIT_OK else "FAIL",
                    "stage": stage,
                    "code": code,
                    "details": self.details,
                    "diagnostics": self.entries,
                }
                path.write_text(
                    json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
            except (OSError, TypeError, ValueError) as exc:
                print(f"[FAIL] could not write JSON result: {type(exc).__name__}: {exc}")
                return EXIT_JSON_OUTPUT
        return exit_code


DiagnosticResult = Diagnostics
