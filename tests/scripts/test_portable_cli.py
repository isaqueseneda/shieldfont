"""Regression checks for the portable console dispatcher."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "scripts" / "portable_cli.py"


class PortableCliTests(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(CLI), *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_top_level_help_lists_commands(self):
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("generate_font", result.stdout)
        self.assertIn("reseed_mapping", result.stdout)
        self.assertIn("audit_font", result.stdout)
        self.assertIn("Advanced release build", result.stdout)
        self.assertIn("--document-nonce", result.stdout)

    def test_generate_help_is_forwarded(self):
        result = self.run_cli("generate_font", "--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--base-path", result.stdout)
        self.assertIn("--gsub-optimization", result.stdout)

    def test_audit_help_is_forwarded(self):
        result = self.run_cli("audit_font", "--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--font", result.stdout)
        self.assertIn("--artifact-dir", result.stdout)

    def test_reseed_is_forwarded_and_writes_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "mapping.json"
            result = self.run_cli(
                "reseed_mapping",
                "--seed",
                "17",
                "--out",
                str(output),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            contract = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(contract["schema"], "shieldfont.mapping.v2")
            self.assertTrue(contract["groups"])
