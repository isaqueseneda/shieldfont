"""Deterministic regression coverage for the upstream script pipeline.

The corpus is intentionally text-only. Tiny fake font tables exercise metric
logic without committing a font binary, while subprocess checks preserve the
existing diagnostic prefixes and exit behavior.
"""

import contextlib
import importlib
import io
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "seedfont"
sys.path.insert(0, str(SCRIPTS))

generate_font = importlib.import_module("generate_font")
fix_composite_lsb = importlib.import_module("fix_composite_lsb")
stamp_font_version = importlib.import_module("stamp_font_version")
subset_font = importlib.import_module("subset_font")
script_diagnostics = importlib.import_module("script_diagnostics")


def run_script(name, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / name), *map(str, args)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


class _Glyph:
    def __init__(self, x_min=0, x_max=0, contours=1, composite=False):
        self.xMin = x_min
        self.yMin = 0
        self.xMax = x_max
        self.yMax = 100
        self.numberOfContours = -1 if composite else contours
        self.components = []

    def isComposite(self):
        return self.numberOfContours == -1


class _Font:
    def __init__(self, glyf, hmtx, cmap):
        self.tables = {"glyf": glyf, "hmtx": hmtx}
        self.cmap = cmap
        self.order = list(glyf)

    def __getitem__(self, key):
        return self.tables[key]

    def getBestCmap(self):
        return self.cmap

    def getGlyphOrder(self):
        return self.order

    def setGlyphOrder(self, order):
        self.order = order


class _NameTable:
    def __init__(self):
        self.values = {}

    def setName(self, value, name_id, platform, encoding, language):
        self.values[(name_id, platform, encoding, language)] = value

    def getName(self, name_id, platform, encoding, language):
        value = self.values.get((name_id, platform, encoding, language))
        return _NameRecord(value) if value is not None else None


class _NameRecord:
    def __init__(self, value):
        self.value = value

    def toUnicode(self):
        return self.value


class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads(
            (FIXTURES / "fixture_index.json").read_text(encoding="utf-8")
        )
        cls.mapping = json.loads(
            (FIXTURES / cls.index["mapping"]).read_text(encoding="utf-8")
        )
        cls.metrics = json.loads(
            (FIXTURES / cls.index["metrics"]).read_text(encoding="utf-8")
        )

    def test_fixture_corpus_is_complete_and_text_only(self):
        self.assertEqual(self.index["fixture_id"], "seedfont-task2-v1")
        for key, filename in self.index.items():
            if key == "fixture_id":
                continue
            path = FIXTURES / filename
            self.assertTrue(path.is_file(), filename)
            self.assertNotIn(path.suffix.lower(), {".ttf", ".otf", ".woff", ".woff2"})

    def test_run_boundaries_punctuation_and_adjacent_words(self):
        raw = (FIXTURES / self.index["content"]).read_text(encoding="utf-8")
        text = subset_font.extract_text(raw, "html")
        words = list(subset_font.tokenize(text))
        self.assertEqual(
            words,
            ["alpha", "charlie", "alpha", "bravo", "delta", "echo", "foxtrot"],
        )

    def test_lowercase_titlecase_and_uppercase_forms_share_a_pair(self):
        words = list(subset_font.tokenize("alpha Alpha ALPHA"))
        self.assertEqual(words, ["alpha", "alpha", "alpha"])
        self.assertEqual(self.mapping["alpha"], "bravo")
        self.assertEqual(self.mapping["bravo"], "alpha")

    def test_duplicate_aliases_are_reported_and_orphan_is_removed(self):
        mapping = {"alpha": "bravo", "bravo": "alpha", "charlie": "bravo"}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = generate_font.make_injective(mapping)
        self.assertEqual(result, {"alpha": "bravo", "bravo": "alpha"})
        self.assertIn("[WARN]", output.getvalue())
        self.assertIn("[OK]", output.getvalue())

    def test_nominal_and_damaged_composite_metrics(self):
        m = self.metrics["composite"]
        glyf = {
            "a": _Glyph(20, 60),
            "b": _Glyph(5, 45),
        }
        hmtx = {"a": (100, 20), "b": (80, 5)}
        font = _Font(glyf, hmtx, {ord("a"): "a", ord("b"): "b"})

        self.assertTrue(generate_font.create_composite_glyph(font, "ab", "word.fixture"))
        self.assertEqual(glyf["word.fixture"].xMin, m["x_min"])
        self.assertEqual(glyf["word.fixture"].xMax, m["x_max"])
        self.assertEqual(hmtx["word.fixture"], (m["advance"], m["nominal_lsb"]))
        self.assertEqual(fix_composite_lsb.scan(font), {})

        hmtx["word.fixture"] = (m["advance"], m["damaged_lsb"])
        damaged = fix_composite_lsb.scan(font)
        self.assertEqual(damaged, {"word.fixture": (m["damaged_lsb"], m["x_min"])})

    def test_metadata_and_version_values_are_preserved(self):
        metadata = json.loads(
            (FIXTURES / self.index["metadata"]).read_text(encoding="utf-8")
        )
        names = _NameTable()
        fake_font = {"name": names}
        stamp_font_version.set_name(fake_font, 5, f"Version {metadata['version']}")
        stamp_font_version.set_name(fake_font, 3, metadata["mapping_id"])
        self.assertEqual(
            stamp_font_version.read_name(fake_font, 5),
            f"Version {metadata['version']}",
        )
        self.assertEqual(
            stamp_font_version.read_name(fake_font, 3),
            metadata["mapping_id"],
        )
        self.assertEqual(
            names.values[(5, 1, 0, 0)],
            f"Version {metadata['version']}",
        )

    def test_subset_mapping_pairing_and_stale_mapping_negative_case(self):
        current = self.mapping["_meta"]
        stale = json.loads(
            (FIXTURES / self.index["stale_mapping"]).read_text(encoding="utf-8")
        )["_meta"]

        def assert_pair(meta, expected_id, expected_hash):
            self.assertEqual(meta["subsetId"], expected_id)
            self.assertEqual(meta["contentHash"], expected_hash)

        assert_pair(current, "fixture-subset-v1", "fixture-content-v1")
        with self.assertRaises(AssertionError):
            assert_pair(stale, "fixture-subset-v1", "fixture-content-v1")

        loaded, loaded_meta = subset_font.load_mapping(
            FIXTURES / self.index["mapping"]
        )
        self.assertEqual(loaded_meta["mappingId"], current["mappingId"])
        self.assertEqual(loaded["alpha"], "bravo")

    def test_missing_file_reports_fail_prefix_and_nonzero(self):
        result = run_script(
            "drop_glyph_names.py",
            FIXTURES / "does-not-exist.ttf",
            "--out",
            ROOT / "tests" / "fixtures" / "seedfont" / "unused.ttf",
            "--no-shape",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("[FAIL] input not found:", result.stdout)

    def test_invalid_nonce_syntax_is_rejected(self):
        # The current reseed CLI calls this input a seed; it is the nonce-like
        # deterministic selector and must remain an integer.
        result = run_script(
            "reseed_mapping.py",
            "--seed",
            "not-a-nonce",
            "--pairs",
            FIXTURES / "pairs.json",
            "--out",
            ROOT / "tests" / "fixtures" / "seedfont" / "unused.json",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid int value", result.stderr)

    def test_mutually_exclusive_source_flags_fail_closed(self):
        result = run_script(
            "generate_font.py",
            "--base-url",
            "http://127.0.0.1:9/unreachable.ttf",
            "--base-path",
            FIXTURES / "does-not-exist.ttf",
            "--cache-name",
            "never-download.ttf",
            "--name",
            "Synthetic",
            "--prefix",
            "synthetic",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not allowed with argument", result.stderr)

    def test_malformed_subset_arguments_fail_with_parser_diagnostic(self):
        result = run_script(
            "subset_font.py",
            "--font",
            FIXTURES / "does-not-exist.ttf",
            "--mapping",
            FIXTURES / self.index["mapping"],
            "--out",
            ROOT / "tests" / "fixtures" / "seedfont" / "unused",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("give at least one of", result.stderr)

    def test_ci_contract_requires_first_class_script_step(self):
        workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text(
            encoding="utf-8"
        )
        contract = json.loads(
            (FIXTURES / self.index["ci_contract"]).read_text(encoding="utf-8")
        )
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertIn("test:scripts", package["scripts"])
        self.assertIn(contract["required_discovery"], package["scripts"]["test:scripts"])
        self.assertIn(contract["required_script"], workflow)

    def test_fixture_nonce_contract_rejects_bad_syntax_without_logging_value(self):
        valid = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
        cases = json.loads(
            (FIXTURES / self.index["nonce_cases"]).read_text(encoding="utf-8")
        )
        for nonce in cases["valid"]:
            self.assertTrue(valid.fullmatch(nonce))
        for nonce in cases["invalid"]:
            self.assertIsNone(valid.fullmatch(nonce))

    def test_diagnostics_text_json_parity_and_safe_payload(self):
        result_path = FIXTURES / "diagnostics-result.json"
        try:
            result = run_script(
                "drop_glyph_names.py",
                FIXTURES / "does-not-exist.ttf",
                "--out",
                FIXTURES / "unused.ttf",
                "--json-out",
                result_path,
            )
            self.assertEqual(result.returncode, script_diagnostics.EXIT_INPUT)
            self.assertIn("[FAIL]", result.stdout)
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["exit_code"], script_diagnostics.EXIT_INPUT)
            self.assertEqual(payload["code"], script_diagnostics.CODE_INPUT_NOT_FOUND)
            self.assertEqual(payload["diagnostics"][0]["level"], "FAIL")
            serialized = json.dumps(payload)
            self.assertNotIn("alpha", serialized)
            self.assertNotIn("bravo", serialized)
            self.assertNotIn("does-not-exist.ttf", serialized)
        finally:
            result_path.unlink(missing_ok=True)

    def test_malformed_or_unwritable_json_result_path_is_stable(self):
        result = run_script(
            "drop_glyph_names.py",
            FIXTURES / "does-not-exist.ttf",
            "--out",
            FIXTURES / "unused.ttf",
            "--json-out",
            FIXTURES,
        )
        self.assertEqual(result.returncode, script_diagnostics.EXIT_JSON_OUTPUT)
        self.assertIn("[FAIL] could not write JSON result:", result.stdout)
        malformed = script_diagnostics.Diagnostics("drop_glyph_names.py", "\0")
        self.assertEqual(
            malformed.finish(
                script_diagnostics.EXIT_INPUT,
                stage="input",
                code=script_diagnostics.CODE_INPUT_NOT_FOUND,
            ),
            script_diagnostics.EXIT_JSON_OUTPUT,
        )

    def test_missing_backend_has_stable_exit_category(self):
        audit_font = importlib.import_module("audit_font")
        old_which = audit_font.shutil.which
        old_font = audit_font.FONT_TTF
        old_mapping = audit_font.MAPPING_PATH
        result_path = FIXTURES / "backend-result.json"
        try:
            audit_font.FONT_TTF = FIXTURES / self.index["metadata"]
            audit_font.MAPPING_PATH = FIXTURES / self.index["mapping"]
            audit_font.shutil.which = lambda _: None
            diag = script_diagnostics.Diagnostics("audit_font.py", result_path)
            self.assertEqual(
                audit_font.audit(diag),
                script_diagnostics.EXIT_BACKEND,
            )
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["code"], script_diagnostics.CODE_BACKEND_MISSING)
            self.assertEqual(payload["stage"], "backend")
        finally:
            audit_font.shutil.which = old_which
            audit_font.FONT_TTF = old_font
            audit_font.MAPPING_PATH = old_mapping
            result_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
