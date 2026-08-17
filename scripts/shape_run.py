"""Small HarfBuzz adapter used by the SeedFont generator.

The adapter deliberately keeps shaping in-process.  ``hb-shape`` is only an
optional, independent parity oracle; it is never the build backend.  Results
contain glyph IDs and positions in font units so callers can construct
composites without reimplementing OpenType layout.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import unicodedata
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

try:  # The generator remains importable for non-shaping maintenance commands.
    import uharfbuzz as hb
except ImportError:  # pragma: no cover - exercised by backend-negative tests
    hb = None


PRIMARY_MIN = (0, 56)
PRIMARY_MAX = (0, 57)


class ShapeBackendError(RuntimeError):
    """The required in-process shaping backend is unavailable or unsupported."""


class ShapeParityError(RuntimeError):
    """The optional independent HarfBuzz oracle disagreed with the primary."""


@dataclass(frozen=True)
class PositionedGlyph:
    glyph_id: int
    cluster: int
    x_advance: int
    y_advance: int
    x_offset: int
    y_offset: int


@dataclass(frozen=True)
class ShapeResult:
    glyphs: tuple[PositionedGlyph, ...]
    backend: str
    backend_version: str
    script: str
    language: str
    features_digest: str
    axis_digest: str
    text_digest: str
    elapsed_ms: float
    parity: str = "not-requested"
    normalization_case_id: str = "nfc"

    @property
    def advance(self) -> int:
        return sum(item.x_advance for item in self.glyphs)


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version)[:3])


def primary_version() -> str:
    return str(getattr(hb, "__version__", "missing")) if hb is not None else "missing"


def primary_supported() -> bool:
    if hb is None:
        return False
    version = _version_tuple(primary_version())
    return PRIMARY_MIN <= version < PRIMARY_MAX


def _digest(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def text_digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def normalize_text(text: str) -> tuple[str, str]:
    """Normalize a shaping run and return a bounded diagnostic case ID."""
    normalized = unicodedata.normalize("NFC", text)
    if normalized == text:
        return normalized, "nfc"
    if unicodedata.normalize("NFD", text) == unicodedata.normalize("NFD", normalized):
        return normalized, "nfd-equivalent"
    return normalized, "nfc-repaired"


def normalize_features(features: Any) -> dict[str, int | bool]:
    if features is None:
        return {
            "ccmp": True,
            "clig": True,
            "calt": True,
            "liga": True,
            "kern": True,
            "locl": True,
            "rlig": True,
        }
    if isinstance(features, str):
        features = [part.strip() for part in features.split(",") if part.strip()]
    if isinstance(features, dict):
        result = dict(features)
        result.setdefault("ccmp", True)
        return result
    result: dict[str, int | bool] = {}
    for item in features:
        if isinstance(item, str):
            if "=" in item:
                tag, value = item.split("=", 1)
                result[tag.strip()] = int(value.strip())
            else:
                result[item.strip()] = True
        else:
            raise ValueError("feature settings must be strings or a mapping")
    result.setdefault("ccmp", True)
    return result


def normalize_axes(axes: Any) -> dict[str, float]:
    if axes is None:
        return {}
    if isinstance(axes, str):
        axes = [part.strip() for part in axes.split(",") if part.strip()]
    if isinstance(axes, dict):
        return {str(key): float(value) for key, value in axes.items()}
    result: dict[str, float] = {}
    for item in axes:
        tag, value = str(item).split("=", 1)
        result[tag.strip()] = float(value.strip())
    return result


def font_bytes(font: Any) -> bytes:
    """Serialize a TTFont/path/bytes input for HarfBuzz."""
    if isinstance(font, bytes):
        return font
    if isinstance(font, (str, Path)):
        return Path(font).read_bytes()
    output = BytesIO()
    font.save(output, reorderTables=False)
    return output.getvalue()


def _shape_primary(
    data: bytes,
    text: str,
    script: str,
    language: str,
    features: dict[str, int | bool],
    axes: dict[str, float],
) -> tuple[PositionedGlyph, ...]:
    if not primary_supported():
        raise ShapeBackendError(
            f"uharfbuzz {primary_version()} is outside the supported "
            f"range {PRIMARY_MIN[0]}.{PRIMARY_MIN[1]} <= version < "
            f"{PRIMARY_MAX[0]}.{PRIMARY_MAX[1]}"
        )
    face = hb.Face(data)
    font = hb.Font(face)
    upem = int(face.upem or 1000)
    font.scale = (upem, upem)
    if axes:
        try:
            font.set_variations(",".join(f"{tag}={value:g}" for tag, value in axes.items()))
        except Exception as exc:
            raise ShapeBackendError("variation coordinates are unsupported") from exc
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.direction = "ltr"
    buffer.script = script
    buffer.language = language
    hb.shape(font, buffer, features)
    return tuple(
        PositionedGlyph(
            glyph_id=int(info.codepoint),
            cluster=int(info.cluster),
            x_advance=int(position.x_advance),
            y_advance=int(position.y_advance),
            x_offset=int(position.x_offset),
            y_offset=int(position.y_offset),
        )
        for info, position in zip(buffer.glyph_infos, buffer.glyph_positions)
    )


def _parse_oracle_json(stdout: str) -> tuple[PositionedGlyph, ...] | None:
    try:
        payload = json.loads(stdout)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, list):
        return None
    result = []
    for item in payload:
        if not isinstance(item, dict):
            return None
        gid = item.get("g", item.get("glyph", item.get("codepoint")))
        if isinstance(gid, str):
            match = re.search(r"\d+", gid)
            gid = int(match.group(0)) if match else None
        if gid is None:
            return None
        result.append(
            PositionedGlyph(
                glyph_id=int(gid),
                cluster=int(item.get("cl", item.get("cluster", 0))),
                x_advance=int(item.get("ax", item.get("x_advance", 0))),
                y_advance=int(item.get("ay", item.get("y_advance", 0))),
                x_offset=int(item.get("dx", item.get("x_offset", 0))),
                y_offset=int(item.get("dy", item.get("y_offset", 0))),
            )
        )
    return tuple(result)


def hb_shape_oracle(
    font: Any,
    text: str,
    *,
    script: str,
    language: str,
    features: dict[str, int | bool],
    axes: dict[str, float],
    command: str = "hb-shape",
) -> tuple[PositionedGlyph, ...] | None:
    executable = shutil.which(command)
    if executable is None:
        return None
    # A project-local in-memory font is not accepted by hb-shape.  The oracle
    # is therefore only used when the caller supplied a path.
    if not isinstance(font, (str, Path)):
        return None
    feature_arg = ",".join(
        f"{tag}={int(value) if isinstance(value, bool) else value}"
        for tag, value in features.items()
    )
    axis_arg = ",".join(f"{tag}={value:g}" for tag, value in axes.items())
    args = [
        executable,
        "--output-format=json",
        "--no-glyph-names",
        "--script",
        script,
        "--language",
        language,
        "--features",
        feature_arg,
    ]
    if axis_arg:
        args.extend(["--variations", axis_arg])
    args.extend([str(font), text])
    try:
        completed = subprocess.run(
            args, capture_output=True, text=True, timeout=30, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return _parse_oracle_json(completed.stdout)


def _same_positions(
    primary: tuple[PositionedGlyph, ...], oracle: tuple[PositionedGlyph, ...]
) -> bool:
    return primary == oracle


class ShapeRunner:
    """Reusable primary shaper with optional independent parity checking."""

    def __init__(
        self,
        font: Any,
        *,
        script: str = "latn",
        language: str = "dflt",
        features: Any = None,
        axes: Any = None,
        parity_oracle: bool = False,
        strict: bool = False,
        oracle_font: Any = None,
    ):
        self.font = font
        self.oracle_font = oracle_font if oracle_font is not None else font
        self.data = font_bytes(font)
        self.script = script
        self.language = language
        self.features = normalize_features(features)
        self.axes = normalize_axes(axes)
        self.parity_oracle = parity_oracle
        self.strict = strict
        self._parity_reported = False
        if strict and not primary_supported():
            raise ShapeBackendError(
                f"required uharfbuzz backend unavailable or unsupported: {primary_version()}"
            )

    def shape(self, text: str) -> ShapeResult:
        started = time.perf_counter()
        text, normalization_case_id = normalize_text(text)
        primary = _shape_primary(
            self.data, text, self.script, self.language, self.features, self.axes
        )
        parity = "not-requested"
        if self.parity_oracle:
            oracle = hb_shape_oracle(
                self.oracle_font,
                text,
                script=self.script,
                language=self.language,
                features=self.features,
                axes=self.axes,
            )
            if oracle is None:
                parity = "unavailable"
            elif _same_positions(primary, oracle):
                parity = "match"
            else:
                parity = "mismatch"
                if self.strict:
                    print("[FAIL] hb-shape parity oracle: mismatch")
                    self._parity_reported = True
                    raise ShapeParityError("hb-shape parity mismatch")
                print("[WARN] hb-shape parity mismatch; retaining primary result")
            if not self._parity_reported:
                level = "[OK]" if parity == "match" else "[WARN]"
                print(f"{level} hb-shape parity oracle: {parity}")
                self._parity_reported = True
        elapsed_ms = (time.perf_counter() - started) * 1000
        result = ShapeResult(
            glyphs=primary,
            backend="uharfbuzz",
            backend_version=primary_version(),
            script=self.script,
            language=self.language,
            features_digest=_digest(self.features),
            axis_digest=_digest(self.axes),
            text_digest=text_digest(text),
            elapsed_ms=elapsed_ms,
            parity=parity,
            normalization_case_id=normalization_case_id,
        )
        if os.environ.get("LOG_LEVEL", "").upper() == "DEBUG":
            print(
                f"[..] shape backend={result.backend}/{result.backend_version} "
                f"script={result.script} lang={result.language} "
                f"features={result.features_digest} axes={result.axis_digest} "
                f"normalization={result.normalization_case_id} "
                f"text={result.text_digest} glyphs={len(result.glyphs)} "
                f"advance={result.advance} elapsed_ms={result.elapsed_ms:.3f}"
            )
        return result


def shape_run(
    font: Any,
    text: str,
    *,
    script: str = "latn",
    language: str = "dflt",
    features: Any = None,
    axes: Any = None,
    parity_oracle: bool = False,
    strict: bool = False,
    oracle_font: Any = None,
) -> ShapeResult:
    """Shape one run using the pinned primary backend."""
    return ShapeRunner(
        font,
        script=script,
        language=language,
        features=features,
        axes=axes,
        parity_oracle=parity_oracle,
        strict=strict,
        oracle_font=oracle_font,
    ).shape(text)
