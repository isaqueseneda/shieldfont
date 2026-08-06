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
import unicodedata
import unittest
from io import BytesIO
from unittest import mock
from pathlib import Path

from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "seedfont"
sys.path.insert(0, str(SCRIPTS))

generate_font = importlib.import_module("generate_font")
shape_run = importlib.import_module("shape_run")
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

    def test_shape_contract_has_explicit_run_inputs(self):
        contract = json.loads(
            (FIXTURES / self.index["shape_contract"]).read_text(encoding="utf-8")
        )
        self.assertEqual(contract["fixture_id"], "seedfont-task4-v1")
        self.assertEqual(contract["script"], "latn")
        self.assertEqual(contract["language"], "dflt")
        self.assertEqual(
            shape_run.normalize_features(contract["features"]),
            {tag: True for tag in contract["features"]},
        )
        self.assertEqual(shape_run.normalize_axes(contract["axes"])["wght"], 400.0)

    def test_unicode_contract_covers_nfc_nfd_marks_scripts_and_absent_lang(self):
        contract = json.loads(
            (FIXTURES / self.index["unicode_contract"]).read_text(encoding="utf-8")
        )
        self.assertEqual(contract["fixture_id"], "seedfont-task5-v1")
        self.assertEqual(
            unicodedata.normalize("NFC", contract["nfd_cases"][0]), "\u0451"
        )
        self.assertEqual(
            unicodedata.normalize("NFC", contract["nfd_cases"][1]), "\u0439"
        )
        self.assertEqual(subset_font.detect_html_language(contract["html_without_lang"]), None)
        self.assertEqual(
            subset_font.resolve_html_language(contract["html_without_lang"]), "dflt"
        )
        self.assertEqual(contract["languages"], ["RUS", "UKR", "BEL", "SRB"])

    def test_task5_mapping_normalization_rejects_ambiguity_without_text(self):
        mapping = {
            "cafe\u0301": "resume",
            "caf\u00e9": "resume",
            "a\u0308": "one",
            "\u00e4": "two",
        }
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            normalized = generate_font.normalize_mapping(mapping)
        self.assertEqual(normalized["caf\u00e9"], "resume")
        self.assertNotIn("\u00e4", normalized)
        self.assertIn("rejected ambiguous normalized mapping", output.getvalue())
        self.assertNotIn("cafe", output.getvalue())

    def test_task5_explicit_script_langsys_and_mark_set_are_bounded(self):
        self.assertEqual(
            generate_font.parse_script_langsys_specs(
                ["latn:ENG", "cyrl:RUS", "cyrl:UKR", "cyrl:BEL", "cyrl:SRB", "cyrl:default"]
            ),
            {"latn": ["ENG"], "cyrl": ["RUS", "UKR", "BEL", "SRB", None]},
        )
        marks, mark_set_id = generate_font.parse_supported_mark_set(
            explicit_marks="0x301,0x306,0x308"
        )
        self.assertEqual(marks, {0x301, 0x306, 0x308})
        self.assertTrue(mark_set_id.startswith("custom-"))
        with self.assertRaises(ValueError):
            generate_font.parse_supported_mark_set(
                explicit_marks=",".join(f"{cp:X}" for cp in range(300))
            )

    def test_task5_supported_marks_do_not_join_unsupported_boundaries(self):
        lookup = mock.Mock(LookupFlag=0)
        generate_font._set_lookup_mark_filter(lookup, 3)
        self.assertEqual(lookup.LookupFlag, 0x10)
        self.assertEqual(lookup.MarkFilteringSet, 3)
        self.assertEqual(
            list(subset_font.tokenize("a\u0301\u0323 b\u036f")),
            [unicodedata.normalize("NFC", "a\u0301\u0323"), "b\u036f"],
        )
        self.assertEqual(list(subset_font.tokenize("c\u1ab0")), ["c"])

    def test_task5_scoped_ligature_and_gdef_tables_serialize(self):
        font = TTFont(ROOT / "packages" / "font" / "optik-n.woff2")
        cmap = font.getBestCmap()
        gpos_count = len(font["GPOS"].table.LookupList.Lookup)
        locl_present = any(
            record.FeatureTag == "locl"
            for record in font["GSUB"].table.FeatureList.FeatureRecord
        )
        shaper = mock.Mock()
        shaper.shape.return_value = mock.Mock(
            glyphs=(
                shape_run.PositionedGlyph(font.getGlyphID(cmap[ord("a")]), 0, 500, 0, 0, 0),
                shape_run.PositionedGlyph(font.getGlyphID(cmap[ord("b")]), 1, 500, 0, 0, 0),
            )
        )
        self.assertTrue(
            generate_font.create_composite_glyph(
                font, "ab", "word.task5", shaper=shaper
            )
        )
        generate_font.build_gsub_word_boundary_ligatures(
            font,
            {"word.task5": [cmap[ord("c")], cmap[ord("d")]]},
            supported_marks={0x301, 0x306, 0x308},
            script_langsys={"latn": [None]},
        )
        output = BytesIO()
        font.save(output)
        self.assertGreater(len(output.getvalue()), 0)
        self.assertEqual(font["GDEF"].table.Version, 0x00010002)
        self.assertEqual(len(font["GPOS"].table.LookupList.Lookup), gpos_count)
        self.assertEqual(
            any(
                record.FeatureTag == "locl"
                for record in font["GSUB"].table.FeatureList.FeatureRecord
            ),
            locl_present,
        )

    def test_task6_feature_contract_and_caret_validation(self):
        contract = json.loads(
            (FIXTURES / self.index["feature_contract"]).read_text(encoding="utf-8")
        )
        self.assertEqual(contract["fixture_id"], "seedfont-task6-v1")
        self.assertEqual(
            generate_font.SOURCE_FEATURE_TAGS,
            tuple(contract["required_source"]),
        )
        self.assertEqual(
            generate_font.RESTORATION_FEATURE_TAG,
            contract["required_restoration"],
        )
        self.assertEqual(
            generate_font.OPTIONAL_FEATURE_TAG,
            contract["optional"][0],
        )
        self.assertEqual(
            generate_font._validated_caret_coordinates(
                [0, 200, 200, 500, 40000, -40000], 500
            ),
            ([0, 200, 500], 2),
        )
        self.assertEqual(
            generate_font._validated_caret_coordinates([0, -20, -20], -20),
            ([0, -20], 0),
        )

    def test_task6_staged_lookup_order_carets_and_optional_features(self):
        font = TTFont(ROOT / "packages" / "font" / "optik-n.woff2")
        font.flavor = None
        cmap = font.getBestCmap()
        shaper = mock.Mock()
        shaper.shape.return_value = mock.Mock(
            glyphs=(
                shape_run.PositionedGlyph(
                    font.getGlyphID(cmap[ord("a")]), 0, 200, 0, -15, 0
                ),
                shape_run.PositionedGlyph(
                    font.getGlyphID(cmap[ord("b")]), 1, 100, 0, 0, 10
                ),
                shape_run.PositionedGlyph(
                    font.getGlyphID(cmap[ord("a")]), 2, 300, 0, 5, -5
                ),
            )
        )
        self.assertTrue(
            generate_font.create_composite_glyph(
                font, "aba", "word.task6", shaper=shaper
            )
        )
        generate_font.build_gsub_word_boundary_ligatures(
            font,
            {"word.task6": [cmap[ord("c")], cmap[ord("d")]]},
            supported_marks={0x301},
        )
        gdef = font["GDEF"].table
        lig_carets = gdef.LigCaretList
        index = lig_carets.Coverage.glyphs.index("word.task6")
        caret = lig_carets.LigGlyph[index]
        self.assertEqual(caret.CaretCount, 2)
        self.assertEqual(
            [item.Coordinate for item in caret.CaretValue],
            [200, 300],
        )
        self.assertTrue(all(item.Format == 1 for item in caret.CaretValue))

        gsub = font["GSUB"].table
        records = {
            record.FeatureTag: record.Feature
            for record in gsub.FeatureList.FeatureRecord
        }
        self.assertIn("ccmp", records)
        self.assertIn("rlig", records)
        self.assertEqual(len(records["ccmp"].LookupListIndex), 1)
        self.assertEqual(len(records["rlig"].LookupListIndex), 2)
        self.assertLess(
            gsub.FeatureList.FeatureRecord.index(
                next(
                    item for item in gsub.FeatureList.FeatureRecord
                    if item.FeatureTag == "ccmp"
                )
            ),
            gsub.FeatureList.FeatureRecord.index(
                next(
                    item for item in gsub.FeatureList.FeatureRecord
                    if item.FeatureTag == "rlig"
                )
            ),
        )
        lookup_ids = records["ccmp"].LookupListIndex + records["rlig"].LookupListIndex
        self.assertEqual(
            [gsub.LookupList.Lookup[i].LookupType for i in lookup_ids],
            [4, 6, 6],
        )

        output = BytesIO()
        font.save(output)
        runner = shape_run.ShapeRunner(
            output.getvalue(),
            features="ccmp,locl,rlig,-calt,-dlig,-liga,-clig",
            strict=True,
        )
        custom_gid = font.getGlyphID("word.task6")
        self.assertEqual(
            [item.glyph_id for item in runner.shape(" cd ").glyphs],
            [font.getGlyphID("space"), custom_gid, font.getGlyphID("space")],
        )
        self.assertNotIn(
            custom_gid,
            [item.glyph_id for item in runner.shape("xcd y").glyphs],
        )

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

    def test_positioned_run_uses_glyph_ids_offsets_and_shaped_advance(self):
        glyf = {
            "a": _Glyph(20, 60),
            "b": _Glyph(5, 45),
        }
        font = _Font(glyf, {"a": (100, 20), "b": (80, 5)}, {})
        shaper = mock.Mock()
        shaper.shape.return_value = mock.Mock(
            glyphs=(
                shape_run.PositionedGlyph(0, 0, 100, 0, 0, 0),
                shape_run.PositionedGlyph(1, 1, 80, 0, -10, 20),
            )
        )

        self.assertTrue(
            generate_font.create_composite_glyph(
                font, "source", "word.positioned", shaper=shaper
            )
        )
        glyph = glyf["word.positioned"]
        self.assertEqual((glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax), (20, 0, 135, 120))
        self.assertEqual(font["hmtx"]["word.positioned"], (180, 20))
        self.assertEqual([(c.glyphName, c.x, c.y) for c in glyph.components],
                         [("a", 0, 0), ("b", 90, 20)])

    def test_positioned_run_rejects_signed_bounds_and_unsigned_advance_overflow(self):
        font = _Font({"a": _Glyph(0, 10)}, {"a": (1, 0)}, {})
        too_far = mock.Mock()
        too_far.shape.return_value = mock.Mock(
            glyphs=(shape_run.PositionedGlyph(0, 0, 1, 0, 40000, 0),)
        )
        with self.assertRaises(ValueError):
            generate_font.create_composite_glyph(
                font, "a", "word.bounds", shaper=too_far
            )

        too_wide = mock.Mock()
        too_wide.shape.return_value = mock.Mock(
            glyphs=(shape_run.PositionedGlyph(0, 0, 65536, 0, 0, 0),)
        )
        with self.assertRaises(ValueError):
            generate_font.create_composite_glyph(
                font, "a", "word.advance", shaper=too_wide
            )

    def test_missing_positioned_glyph_fails_without_mutating_font(self):
        font = _Font({"a": _Glyph(0, 10)}, {"a": (1, 0)}, {})
        shaper = mock.Mock()
        shaper.shape.return_value = mock.Mock(
            glyphs=(shape_run.PositionedGlyph(99, 0, 1, 0, 0, 0),)
        )
        self.assertFalse(
            generate_font.create_composite_glyph(
                font, "a", "word.missing", shaper=shaper
            )
        )
        self.assertNotIn("word.missing", font["glyf"])

    def test_parity_mismatch_is_detected_in_strict_mode(self):
        primary = (
            shape_run.PositionedGlyph(0, 0, 10, 0, 0, 0),
        )
        oracle = (
            shape_run.PositionedGlyph(1, 0, 10, 0, 0, 0),
        )
        with mock.patch.object(shape_run, "_shape_primary", return_value=primary), \
                mock.patch.object(shape_run, "hb_shape_oracle", return_value=oracle):
            runner = shape_run.ShapeRunner(
                b"fixture", parity_oracle=True, strict=True, oracle_font="fixture.ttf"
            )
            with self.assertRaises(shape_run.ShapeParityError):
                runner.shape("safe")

    def test_strict_runner_fails_closed_without_pinned_primary(self):
        with mock.patch.object(shape_run, "hb", None):
            with self.assertRaises(shape_run.ShapeBackendError):
                shape_run.ShapeRunner(b"fixture", strict=True)

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
