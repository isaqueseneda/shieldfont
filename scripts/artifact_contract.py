"""Deterministic artifact and manifest contracts for the font pipeline.

The helpers in this module deliberately keep the public contract small:
artifact names are canonical, hashes are required, paths are relative labels,
and timestamps are only emitted when the caller supplies SOURCE_DATE_EPOCH.
Private mapping material is never copied into the public manifest.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Iterable


MANIFEST_SCHEMA = "shieldfont.build-manifest.v1"
MAPPING_SCHEMA = "shieldfont.mapping.public.v1"
MAPPING_AUDIT_SCHEMA = "shieldfont.mapping.audit.v1"
SHAPING_SCHEMA = "shieldfont.shaping-audit.v1"
PERFORMANCE_SCHEMA = "shieldfont.performance.v1"
SECURITY_SCHEMA = "shieldfont.security-report.v1"

PUBLIC = "public"
PRIVATE = "private"
VERIFICATION = "verification"

CANONICAL_ARTIFACTS = {
    "mapping.json": (MAPPING_SCHEMA, PUBLIC),
    "mapping.audit.json": (MAPPING_AUDIT_SCHEMA, PRIVATE),
    "mapping.audit.csv": (MAPPING_AUDIT_SCHEMA, PRIVATE),
    "font-audit.ttf": ("font/ttf.v1", PRIVATE),
    "font-web.woff2": ("font/woff2.v1", PUBLIC),
    "build-manifest.json": (MANIFEST_SCHEMA, PUBLIC),
    "shaping-audit.json": (SHAPING_SCHEMA, VERIFICATION),
    "performance.json": (PERFORMANCE_SCHEMA, VERIFICATION),
    "security-report.md": (SECURITY_SCHEMA, VERIFICATION),
}

_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_ISO_TIMESTAMP_RE = re.compile(
    r"\b20\d{2}-\d{2}-\d{2}(?:[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.\d+)?Z?)?\b"
)
_ABSOLUTE_PATH_RE = re.compile(
    r"(?:[A-Za-z]:[\\/]|\\\\|/(?:Users|home|tmp|var|private|workspace|agent)/)"
)
_MAPPING_WORD_KEY_RE = re.compile(r"^(?:source|target|word|probe|text|value)$", re.I)


def _contains_plaintext_token(text: str, word: str) -> bool:
    """Match a mapping word as a token, not as an incidental substring."""
    if len(word) < 3:
        return False
    return re.search(
        rf"(?<![A-Za-z0-9]){re.escape(word)}(?![A-Za-z0-9])",
        text,
        re.IGNORECASE,
    ) is not None


def canonical_json(value: Any) -> str:
    """Serialize JSON with stable ordering and no incidental whitespace."""
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_path_label(path: str | Path) -> str:
    """Return an opaque path label suitable for diagnostics."""
    value = str(path).replace("\\", "/")
    return "path-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def source_date_epoch(value: int | str | None = None) -> int | None:
    """Resolve a controlled epoch; never invent a wall-clock timestamp."""
    raw = value if value is not None else os.environ.get("SOURCE_DATE_EPOCH")
    if raw in (None, ""):
        return None
    try:
        epoch = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("SOURCE_DATE_EPOCH must be an integer") from exc
    if epoch < 0:
        raise ValueError("SOURCE_DATE_EPOCH must not be negative")
    return epoch


def deterministic_font_metadata(font: Any, epoch: int | None = None) -> dict[str, Any]:
    """Set deterministic head timestamps while preserving required name records."""
    epoch = source_date_epoch(epoch)
    if epoch is None:
        epoch = 0
    if "head" in font:
        # OpenType timestamps are seconds since 1904-01-01.
        opentype_epoch = 2082844800 + int(epoch)
        font["head"].created = opentype_epoch
        font["head"].modified = opentype_epoch
        # fontTools otherwise refreshes `head.modified` during save, which
        # makes a supposedly deterministic build depend on wall-clock time.
        if hasattr(font, "recalcTimestamp"):
            font.recalcTimestamp = False
    return {"source_date_epoch": int(epoch), "name_records_preserved": True}


def public_mapping_payload(
    mapping: dict[str, str],
    *,
    mapping_id: str | None = None,
    bundle_id: str | None = None,
    profile: str = "compatibility",
) -> dict[str, Any]:
    """Build the public encoder mapping without private nonce/seed hints."""
    meta: dict[str, Any] = {
        "schema": MAPPING_SCHEMA,
        "profile": profile,
        "pairs": len(mapping),
        "privacy": PUBLIC,
    }
    if mapping_id:
        meta["mappingId"] = str(mapping_id)[:128]
    if bundle_id:
        meta["bundleId"] = str(bundle_id)[:64]
    return {"_meta": meta, **{key: mapping[key] for key in sorted(mapping)}}


def private_mapping_payload(
    mapping: dict[str, str],
    *,
    mapping_id: str | None = None,
    bundle_id: str | None = None,
) -> dict[str, Any]:
    """Build the private directional and reverse audit index."""
    reverse = {target: source for source, target in mapping.items()}
    payload: dict[str, Any] = {
        "schema": MAPPING_AUDIT_SCHEMA,
        "privacy": PRIVATE,
        "pairs": len(mapping),
        "mapping": {key: mapping[key] for key in sorted(mapping)},
        "reverse": {key: reverse[key] for key in sorted(reverse)},
    }
    if mapping_id:
        payload["mappingId"] = str(mapping_id)[:128]
    if bundle_id:
        payload["bundleId"] = str(bundle_id)[:64]
    return payload


def write_json(path: str | Path, payload: Any) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


def write_audit_csv(path: str | Path, mapping: dict[str, str]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(["source", "target", "source_digest", "target_digest"])
        for source, target in sorted(mapping.items()):
            writer.writerow([
                source,
                target,
                hashlib.sha256(source.encode("utf-8")).hexdigest()[:16],
                hashlib.sha256(target.encode("utf-8")).hexdigest()[:16],
            ])
    return destination


def artifact_record(
    path: str | Path,
    *,
    name: str | None = None,
    schema: str,
    role: str,
    root: str | Path | None = None,
) -> dict[str, Any]:
    source = Path(path)
    if role not in {PUBLIC, PRIVATE, VERIFICATION}:
        raise ValueError(f"unsupported privacy role: {role!r}")
    if not source.is_file():
        raise FileNotFoundError(source)
    relative = source.name if root is None else source.relative_to(Path(root)).as_posix()
    return {
        "name": name or source.name,
        "schema": schema,
        "privacy": role,
        "path": relative.replace("\\", "/"),
        "bytes": source.stat().st_size,
        "sha256": sha256_file(source),
    }


def validate_manifest(
    manifest: dict[str, Any],
    *,
    root: str | Path | None = None,
    require_files: bool = False,
) -> dict[str, Any]:
    """Validate schema, roles, stable names, and required artifact hashes."""
    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError("manifest schema mismatch")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("manifest artifacts are required")
    names: set[str] = set()
    for item in artifacts:
        if not isinstance(item, dict):
            raise ValueError("manifest artifact record must be an object")
        name = item.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("manifest artifact names must be unique")
        names.add(name)
        if item.get("privacy") not in {PUBLIC, PRIVATE, VERIFICATION}:
            raise ValueError(f"manifest privacy role missing for {name}")
        if not isinstance(item.get("schema"), str):
            raise ValueError(f"manifest artifact schema missing for {name}")
        digest = item.get("sha256")
        if not isinstance(digest, str) or not _HASH_RE.fullmatch(digest):
            raise ValueError(f"manifest artifact hash missing for {name}")
        if not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
            raise ValueError(f"manifest artifact size missing for {name}")
        if require_files:
            if root is None:
                raise ValueError("manifest root required when require_files is true")
            path = Path(root) / str(item.get("path", ""))
            if not path.is_file() or sha256_file(path) != digest:
                raise ValueError(f"manifest artifact hash mismatch for {name}")
    return manifest


def _font_plaintext_hints(path: Path, forbidden: set[str]) -> list[str]:
    try:
        from fontTools.ttLib import TTFont

        font = TTFont(str(path), lazy=False)
        hints: list[str] = []
        for glyph in font.getGlyphOrder():
            if any(_contains_plaintext_token(glyph, word) for word in forbidden):
                hints.append("glyph-name")
        for record in getattr(font.get("name"), "names", []) or []:
            try:
                text = record.toUnicode()
            except Exception:
                text = str(record)
            if any(_contains_plaintext_token(text, word) for word in forbidden):
                # Font family/license records are required and are not mapping
                # hints; only report records that are not required metadata.
                if record.nameID not in {0, 1, 2, 3, 4, 5, 6, 10, 13, 14, 16, 17}:
                    hints.append("name-table")
        if "post" in font and float(font["post"].formatType) != 3.0:
            hints.append("web-post-names")
        return hints
    except Exception:
        return ["font-unreadable"]


def scan_public_artifacts(
    root: str | Path,
    *,
    forbidden_words: Iterable[str] = (),
    exclude: Iterable[str] = ("mapping.json",),
) -> dict[str, Any]:
    """Scan public artifacts for plaintext hints, paths, and uncontrolled time."""
    base = Path(root)
    forbidden = {str(word) for word in forbidden_words if str(word)}
    excluded = set(exclude)
    declared_private: set[str] = set()
    manifest_path = base / "build-manifest.json"
    if manifest_path.is_file():
        try:
            raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            declared_private = {
                str(item.get("path", item.get("name", ""))).replace("\\", "/")
                for item in raw_manifest.get("artifacts", [])
                if item.get("privacy") != PUBLIC
            }
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            declared_private = set()
    findings: list[dict[str, Any]] = []
    files = sorted(path for path in base.rglob("*") if path.is_file())
    for path in files:
        if path.name in excluded:
            continue
        relative = path.relative_to(base).as_posix()
        if relative in declared_private or path.name in declared_private:
            continue
        if not declared_private and path.name in {
            "mapping.audit.json", "mapping.audit.csv", "font-audit.ttf",
            "shaping-audit.json", "performance.json", "security-report.md",
        }:
            findings.append({"file": path.name, "kind": "private-artifact"})
            continue
        try:
            data = path.read_bytes()
        except OSError:
            findings.append({"file": path.name, "kind": "unreadable"})
            continue
        if path.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}:
            for kind in _font_plaintext_hints(path, forbidden):
                findings.append({"file": path.name, "kind": kind})
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = ""
        if _ABSOLUTE_PATH_RE.search(text):
            findings.append({"file": path.name, "kind": "absolute-path"})
        if _ISO_TIMESTAMP_RE.search(text):
            findings.append({"file": path.name, "kind": "timestamp"})
        for word in sorted(forbidden):
            if _contains_plaintext_token(text, word):
                findings.append({"file": path.name, "kind": "plaintext-hint"})
                break
    return {
        "schema": "shieldfont.public-scan.v1",
        "status": "pass" if not findings else "fail",
        "files": len(files),
        "findings": findings,
        "finding_count": len(findings),
    }


def emit_canonical_artifacts(
    artifact_dir: str | Path,
    *,
    mapping: dict[str, str],
    audit_font: str | Path,
    web_font: str | Path,
    mapping_id: str | None = None,
    bundle_id: str | None = None,
    profile: str = "compatibility",
    shaping: dict[str, Any] | None = None,
    performance: dict[str, Any] | None = None,
    security_report: str | None = None,
    audit_payload: dict[str, Any] | None = None,
    source_date_epoch: int | None = None,
) -> dict[str, Any]:
    """Write the canonical artifact set and a hash-complete manifest."""
    root = Path(artifact_dir)
    root.mkdir(parents=True, exist_ok=True)
    try:
        from fontTools.ttLib import TTFont

        web_check = TTFont(str(web_font), lazy=False)
        if "post" not in web_check or float(web_check["post"].formatType) != 3.0:
            raise ValueError("font-web.woff2 must use post format 3.0")
        if "name" not in web_check:
            raise ValueError("font-web.woff2 is missing required name records")
    except ImportError:
        raise ValueError("fontTools is required for web font diagnostics")
    public = public_mapping_payload(
        mapping, mapping_id=mapping_id, bundle_id=bundle_id, profile=profile
    )
    write_json(root / "mapping.json", public)
    write_json(
        root / "mapping.audit.json",
        audit_payload or private_mapping_payload(
            mapping, mapping_id=mapping_id, bundle_id=bundle_id
        ),
    )
    write_audit_csv(root / "mapping.audit.csv", mapping)
    shutil.copyfile(audit_font, root / "font-audit.ttf")
    shutil.copyfile(web_font, root / "font-web.woff2")

    shaping_payload = {
        "schema": SHAPING_SCHEMA,
        "privacy": VERIFICATION,
        "status": "not-run",
        "checks": {},
    }
    shaping_payload.update(shaping or {})
    write_json(root / "shaping-audit.json", shaping_payload)
    performance_payload = {
        "schema": PERFORMANCE_SCHEMA,
        "privacy": VERIFICATION,
        "status": "recorded",
        "sizes": {
            "font_audit_bytes": (root / "font-audit.ttf").stat().st_size,
            "font_web_bytes": (root / "font-web.woff2").stat().st_size,
        },
    }
    performance_payload.update(performance or {})
    write_json(root / "performance.json", performance_payload)
    report = security_report or (
        "# ShieldFont security report\n\n"
        "This artifact records cost-raising and provenance checks only. "
        "It is not cryptography, confidentiality, authorization, or DRM.\n"
    )
    if not report.endswith("\n"):
        report += "\n"
    (root / "security-report.md").write_text(report, encoding="utf-8")

    records = []
    for name, (schema, role) in sorted(CANONICAL_ARTIFACTS.items()):
        if name == "build-manifest.json":
            # A manifest cannot contain its own hash without a recursive
            # rewrite. Its schema/hash is validated by its parent build.
            continue
        records.append(artifact_record(root / name, schema=schema, role=role, root=root))
    manifest: dict[str, Any] = {
        "schema": MANIFEST_SCHEMA,
        "version": 1,
        "privacy": "public",
        "profile": profile,
        "mappingId": mapping_id or "",
        "bundleId": bundle_id or "",
        "artifacts": records,
        "deterministic": source_date_epoch is not None or os.environ.get("SOURCE_DATE_EPOCH") is not None,
    }
    epoch = source_date_epoch if source_date_epoch is not None else os.environ.get("SOURCE_DATE_EPOCH")
    if epoch not in (None, ""):
        manifest["sourceDateEpoch"] = int(epoch)
    validate_manifest(manifest)
    write_json(root / "build-manifest.json", manifest)
    return validate_manifest(json.loads((root / "build-manifest.json").read_text(encoding="utf-8")))
