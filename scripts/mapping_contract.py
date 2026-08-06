"""Shared mapping contract validation and deterministic alias selection.

The public encoder still consumes a flat dictionary.  The v2 contract adds a
versioned, grouped input format for private/document-specific mappings while
keeping old flat involutions usable without conversion flags.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from copy import deepcopy
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "shieldfont.mapping.v2"
PROFILE = "versioned-groups"
COMPATIBILITY_PROFILE = "compatibility"
CASE_FORMS = {"lower", "title", "upper", "preserve"}
GRAMMAR_ROOTS = {"adj", "adv", "legacy", "noun", "other", "special", "verb"}
_BUCKET_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$")


class MappingContractError(ValueError):
    """A stable, user-actionable mapping contract failure."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _error(code: str, message: str) -> MappingContractError:
    return MappingContractError(code, message)


def _canonical_json(value: Any) -> str:
    """Serialize compatibility inputs without depending on dictionary order."""
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def safe_digest(value: Any, *, length: int = 16) -> str:
    """Return an opaque digest suitable for diagnostics and cache names."""
    if isinstance(value, bytes):
        value = {"bytes_digest": hashlib.sha256(value).hexdigest()}
    elif isinstance(value, Path):
        value = str(value)
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()[:length]


def inventory_digest(inventory: Any) -> str:
    """Digest a word inventory while retaining counts as compatibility inputs."""
    if isinstance(inventory, dict):
        items = [(str(word), int(count)) for word, count in inventory.items()]
    else:
        counts = Counter(str(word) for word in (inventory or ()))
        items = list(counts.items())
    return safe_digest(sorted((word, count) for word, count in items))


def analyze_inventory(inventory: Any) -> dict[str, Any]:
    """Return bounded inventory facts used by build orchestration."""
    if isinstance(inventory, dict):
        counts = {str(word): int(count) for word, count in inventory.items()}
    else:
        counts = dict(Counter(str(word) for word in (inventory or ())))
    return {
        "digest": inventory_digest(counts),
        "count": len([word for word, count in counts.items() if count > 0]),
        "tokens": sum(count for count in counts.values() if count > 0),
    }


def derive_bundle_id(*, inventory: Any = None, mapping: Any = None,
                     font: Any = None, nonce: Any = None, tenant: Any = None,
                     compatibility: dict[str, Any] | None = None,
                     length: int = 24) -> str:
    """Derive an opaque identity from every input that can affect a bundle.

    Values which may contain tenant or document data are hashed before being
    included.  The returned value is therefore safe for cache keys, filenames,
    and diagnostics.
    """
    nonce_meta = nonce_info(nonce)
    payload = {
        "protocol": "shieldfont.bundle.v1",
        "inventory_digest": inventory_digest(inventory or {}),
        "mapping_digest": safe_digest(mapping or {}),
        "font_digest": safe_digest(font or {}),
        "nonce_digest": nonce_meta.get("digest_prefix", ""),
        "tenant_digest": safe_digest(str(tenant)) if tenant is not None else "",
        "compatibility": compatibility or {},
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()[:length]


def _inventory_words(inventory: Any) -> set[str]:
    if isinstance(inventory, dict):
        return {str(word).lower() for word, count in inventory.items() if int(count) > 0}
    return {str(word).lower() for word in (inventory or ())}


def _case_form(raw: Any) -> str:
    if isinstance(raw, dict):
        raw = raw.get("form", raw.get("behavior", raw.get("case")))
    if raw is None:
        return "preserve"
    value = str(raw).strip().lower()
    aliases = {"lowercase": "lower", "titlecase": "title", "uppercase": "upper"}
    value = aliases.get(value, value)
    if value not in CASE_FORMS:
        raise _error("unsupported_case_form", f"unsupported case form: {raw!r}")
    return value


def _grammar_bucket(value: Any) -> str:
    if not isinstance(value, str) or not value or not _BUCKET_RE.fullmatch(value):
        raise _error("invalid_grammar_bucket", f"invalid grammar bucket: {value!r}")
    if value.split(".", 1)[0].lower() not in GRAMMAR_ROOTS:
        raise _error("invalid_grammar_bucket", f"invalid grammar bucket: {value!r}")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise _error("invalid_text", f"{label} must be a non-empty string")
    return value


def _ordered_values(raw: Any, label: str) -> list[str]:
    if not isinstance(raw, list):
        raise _error("insufficient_aliases", f"{label} must be an ordered list")
    result: list[str] = []
    positions: list[int] = []
    for index, item in enumerate(raw):
        position = None
        value = item
        if isinstance(item, dict):
            value = item.get("alias", item.get("value", item.get("text")))
            position = item.get("position")
        if position is not None:
            if not isinstance(position, int):
                raise _error("changed_position_ordering", f"{label} position must be an integer")
            positions.append(position)
        result.append(_text(value, f"{label}[{index}]"))
    if positions and positions != list(range(len(positions))):
        raise _error("changed_position_ordering", f"{label} positions changed ordering")
    if len(set(result)) != len(result):
        raise _error("alias_reuse", f"duplicate aliases in {label}")
    return result


def _normalise_seed(raw: Any) -> tuple[str, Any]:
    if isinstance(raw, dict):
        value = raw.get("value", raw.get("seed", raw.get("id")))
        seed_id = raw.get("id", value)
    else:
        value, seed_id = raw, raw
    if value is None:
        value = 0
    if isinstance(seed_id, (dict, list)) or seed_id is None:
        seed_id = str(value)
    return str(seed_id), value


def nonce_info(raw: Any = None) -> dict[str, str]:
    """Return safe nonce metadata; never return the nonce itself."""
    if raw is None or raw == "":
        return {"source": "none", "digest_prefix": ""}
    if isinstance(raw, dict):
        value = raw.get("value", raw.get("nonce", raw.get("document_nonce")))
        source = str(raw.get("source", "provided"))
        if value is None and raw.get("digest_prefix") is not None:
            return {"source": source[:32], "digest_prefix": str(raw["digest_prefix"])[:12]}
    else:
        value, source = raw, "provided"
    if not isinstance(value, str) or not value:
        raise _error("invalid_nonce", "document nonce must be a non-empty string")
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return {"source": source[:32], "digest_prefix": digest[:12]}


def _nonce_value(raw: Any = None) -> str:
    if raw is None or raw == "":
        return ""
    if isinstance(raw, dict):
        raw = raw.get("value", raw.get("nonce", raw.get("document_nonce")))
    return "" if raw is None else str(raw)


def _source_entries(group: dict[str, Any]) -> list[dict[str, Any]]:
    raw = group.get("sources", group.get("entries", group.get("source_words")))
    if not isinstance(raw, list) or not raw:
        raise _error("insufficient_aliases", f"group {group.get('id')!r} has no sources")
    entries: list[dict[str, Any]] = []
    positions: list[int] = []
    for index, item in enumerate(raw):
        if isinstance(item, str):
            source = item
            alias_pool = group.get("aliases")
            aliases = alias_pool.get(source) if isinstance(alias_pool, dict) else alias_pool
            position = None
        elif isinstance(item, dict):
            source = item.get("source", item.get("src",
                              item.get("word", item.get("source_id"))))
            aliases = item.get("aliases", item.get("targets"))
            position = item.get("position")
        else:
            raise _error("invalid_text", f"group {group.get('id')!r} has invalid source")
        source = _text(source, "source")
        if position is not None:
            if not isinstance(position, int):
                raise _error("changed_position_ordering", "source position must be an integer")
            positions.append(position)
        if aliases is None:
            raise _error("insufficient_aliases", f"source {source!r} has no aliases")
        aliases = _ordered_values(aliases, f"aliases for {source!r}")
        if not aliases:
            raise _error("insufficient_aliases", f"source {source!r} has no aliases")
        entries.append({"source": source, "aliases": aliases, "position": position})
    if positions and positions != list(range(len(positions))):
        raise _error("changed_position_ordering", f"group {group.get('id')!r} positions changed ordering")
    if len({entry["source"] for entry in entries}) != len(entries):
        raise _error("alias_reuse", f"group {group.get('id')!r} repeats a source")
    return entries


def validate_contract(raw: Any, *, compatibility: bool = True) -> dict[str, Any]:
    """Validate and canonicalise a flat or versioned mapping document."""
    if not isinstance(raw, dict):
        raise _error("invalid_schema", "mapping must be a JSON object")
    groups_key = "groups" if "groups" in raw else "source_groups"
    if groups_key not in raw:
        if not compatibility:
            raise _error("invalid_schema", "mapping requires versioned source groups")
        flat = {key: value for key, value in raw.items() if not str(key).startswith("_")}
        for source, target in flat.items():
            _text(source, "mapping source")
            _text(target, f"mapping target for {source!r}")
        return {
            "schema": "shieldfont.mapping.v1",
            "profile": COMPATIBILITY_PROFILE,
            "case": "preserve",
            "seed_id": str(raw.get("_meta", {}).get("seed", "legacy"))
            if isinstance(raw.get("_meta"), dict) else "legacy",
            "seed": None,
            "nonce": {"source": "none", "digest_prefix": ""},
            "groups": [],
            "flat": flat,
            "legacy": True,
        }

    schema = raw.get("schema", raw.get("_schema", SCHEMA))
    if schema not in {SCHEMA, "shieldfont.mapping.v2", 2}:
        raise _error("invalid_schema", f"unsupported mapping schema: {schema!r}")
    profile = str(raw.get("profile", PROFILE))
    if profile not in {PROFILE, "groups", "versioned"}:
        raise _error("invalid_profile", f"unsupported mapping profile: {profile!r}")
    groups_raw = raw[groups_key]
    if not isinstance(groups_raw, list) or not groups_raw:
        raise _error("insufficient_aliases", "mapping groups must be a non-empty list")
    seed_id, seed = _normalise_seed(raw.get("seed", raw.get("mapping_seed")))
    nonce_raw = raw.get("document_nonce", raw.get("nonce", raw.get("nonce_meta")))
    groups: list[dict[str, Any]] = []
    seen_group_ids: set[str] = set()
    seen_alias_groups: dict[str, str] = {}
    source_names: set[str] = set()
    for group in groups_raw:
        if not isinstance(group, dict):
            raise _error("invalid_schema", "each mapping group must be an object")
        group_id = _text(group.get("id", group.get("group_id")), "group id")
        if group_id in seen_group_ids:
            raise _error("duplicate_group_id", f"duplicate group id: {group_id!r}")
        seen_group_ids.add(group_id)
        grammar = _grammar_bucket(group.get(
            "grammar", group.get("grammar_bucket", group.get("bucket"))
        ))
        entries = _source_entries(group)
        for entry in entries:
            source = entry["source"]
            if source in source_names:
                raise _error("alias_reuse", f"source reused across groups: {source!r}")
            source_names.add(source)
            for alias in entry["aliases"]:
                previous = seen_alias_groups.get(alias)
                if previous is not None and previous != group_id:
                    raise _error("alias_reuse_across_groups",
                                 f"alias reused across groups: {alias!r}")
                seen_alias_groups[alias] = group_id
        groups.append({"id": group_id, "version": str(group.get("version", "1")),
                       "grammar": grammar, "sources": entries})
    return {
        "schema": SCHEMA,
        "profile": PROFILE,
        "case": _case_form(raw.get("case", raw.get("case_behavior"))),
        "seed_id": seed_id,
        "seed": seed,
        "nonce": nonce_info(nonce_raw),
        "_nonce_value": _nonce_value(nonce_raw),
        "groups": groups,
        "legacy": False,
    }


def select_alias(group_id: str, source: str, aliases: list[str], *,
                 seed: Any = 0, nonce: str = "", used: set[str] | None = None) -> str:
    """Select one ordered alias using a keyed digest, without reuse."""
    candidates = [alias for alias in aliases if used is None or alias not in used]
    if not candidates:
        raise _error("insufficient_aliases", f"no unused aliases for source {source!r}")
    key = str(seed).encode("utf-8")
    message = f"{nonce}\0{group_id}\0{source}".encode("utf-8")
    digest = hmac.new(key, message, hashlib.sha256).digest()
    ranked = sorted(enumerate(candidates), key=lambda item: (
        hashlib.sha256(digest + str(item[0]).encode("ascii") + item[1].encode("utf-8")).digest(),
        item[0],
    ))
    return ranked[0][1]


def flatten_contract(contract: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any]]:
    """Materialise a canonical contract into the flat encoder dictionary."""
    if "groups" not in contract and not contract.get("legacy"):
        contract = validate_contract(contract)
    if contract.get("legacy"):
        return dict(contract["flat"]), contract
    selected: dict[str, str] = {}
    used: set[str] = set()
    case_counts = Counter()
    fallback_decisions: Counter[str] = Counter()
    for group in contract["groups"]:
        for entry in group["sources"]:
            source = entry["source"]
            aliases = entry["aliases"]
            try:
                alias = select_alias(
                    group["id"], source, aliases, seed=contract["seed"],
                    nonce=contract.get("_nonce_value", ""), used=used,
                )
            except MappingContractError:
                if len(aliases) == 1 and aliases[0] not in used:
                    alias = aliases[0]
                    fallback_decisions["single_alias"] += 1
                else:
                    raise
            if alias == source:
                raise _error("insufficient_aliases", f"alias equals source {source!r}")
            selected[source] = alias
            used.add(alias)
            forms = {
                "lower": ("lower",),
                "title": ("title",),
                "upper": ("upper",),
                "preserve": ("lower", "title", "upper"),
            }[contract["case"]]
            for form in forms:
                case_counts[form] += 1
    # The encoder/font contract is bidirectional.  Reject rather than silently
    # create an ambiguous reverse index.
    reverse = {}
    for source, alias in selected.items():
        if alias in selected and selected[alias] != source:
            raise _error("alias_reuse", f"selected alias is also a conflicting source: {alias!r}")
        if alias in reverse and reverse[alias] != source:
            raise _error("alias_reuse", f"selected alias reused: {alias!r}")
        reverse[alias] = source
    flat = dict(selected)
    flat.update(reverse)
    details = {
        "schema": contract["schema"],
        "profile": contract["profile"],
        "group_count": len(contract["groups"]),
        "alias_cardinality_histogram": {
            str(size): count for size, count in sorted(Counter(
                len(entry["aliases"])
                for group in contract["groups"] for entry in group["sources"]
            ).items())
        },
        "seed_id": str(contract["seed_id"])[:64],
        "nonce_source": contract["nonce"]["source"],
        "nonce_digest_prefix": contract["nonce"]["digest_prefix"],
        "case_counts": dict(case_counts),
        "fallback_decisions": dict(fallback_decisions),
    }
    return flat, {**contract, "diagnostics": details}


def select_contract_for_inventory(
    contract: dict[str, Any],
    inventory: Any = None,
    *,
    reserve_aliases: int = 0,
    reserve: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Select required groups and deterministic reserve entries.

    A grouped contract is selected at source-group granularity: seeing either
    a source or one of its aliases keeps the complete group, preserving the
    grammar and layout dependencies attached to that group.  Reserve entries
    add bounded future coverage from otherwise dropped groups.  Flat legacy
    mappings are returned unchanged.
    """
    if contract.get("legacy") or not contract.get("groups"):
        return contract
    if reserve_aliases < 0:
        raise _error("invalid_reserve", "reserve aliases must not be negative")
    words = _inventory_words(inventory)
    groups = contract["groups"]
    required_ids: list[str] = []
    for group in groups:
        group_words = {
            entry["source"].lower()
            for entry in group["sources"]
        }
        group_words.update(
            alias.lower()
            for entry in group["sources"]
            for alias in entry["aliases"]
        )
        if words.intersection(group_words):
            required_ids.append(group["id"])

    explicit = {str(item).lower() for item in (reserve or ())}
    known_words = {
        word
        for group in groups
        for entry in group["sources"]
        for word in (entry["source"].lower(), *(a.lower() for a in entry["aliases"]))
    }
    unknown_explicit = explicit - known_words
    if unknown_explicit:
        raise _error(
            "reserve_exhausted",
            f"configured reserve aliases are unavailable ({len(unknown_explicit)})",
        )
    selected_entries: list[tuple[str, dict[str, Any]]] = []
    dropped_groups = []
    kept_groups = []
    for group in groups:
        if group["id"] in required_ids:
            kept_groups.append(group["id"])
            continue
        for entry in group["sources"]:
            candidates = {entry["source"].lower(), *(a.lower() for a in entry["aliases"])}
            if explicit.intersection(candidates):
                selected_entries.append((group["id"], entry))
        if group["id"] not in required_ids:
            dropped_groups.append(group["id"])

    available = [
        (group["id"], entry)
        for group in groups
        if group["id"] not in required_ids
        for entry in group["sources"]
        if (group["id"], entry) not in selected_entries
    ]
    reserve_count = len(selected_entries) + reserve_aliases
    if reserve_count > len(available) + len(selected_entries):
        raise _error(
            "reserve_exhausted",
            f"requested {reserve_count} reserve aliases but only "
            f"{len(available) + len(selected_entries)} are available",
        )
    selected_entries.extend(available[:reserve_aliases])
    selected_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group_id, entry in selected_entries:
        selected_by_group[group_id].append(deepcopy(entry))

    selected_groups = []
    for group in groups:
        if group["id"] in required_ids:
            selected_groups.append(deepcopy(group))
        elif group["id"] in selected_by_group:
            selected_groups.append({
                "id": group["id"],
                "version": group["version"],
                "grammar": group["grammar"],
                "sources": selected_by_group[group["id"]],
            })
            if group["id"] not in kept_groups:
                kept_groups.append(group["id"])
    result = {key: deepcopy(value) for key, value in contract.items()
              if key not in {"groups", "diagnostics", "_nonce_value"}}
    result["groups"] = selected_groups
    selection = {
        "inventory_digest": inventory_digest(inventory or {}),
        "inventory_count": len(words),
        "required_groups": required_ids,
        "kept_groups": kept_groups,
        "dropped_groups": [gid for gid in dropped_groups if gid not in kept_groups],
        "reserve_requested": reserve_count,
        "reserve_selected": len(selected_entries),
    }
    if not selected_groups:
        # An empty document is a valid build input.  Keep the canonical
        # contract metadata but allow the selected group list to be empty.
        validated = {
            key: deepcopy(value) for key, value in contract.items()
            if key not in {"groups", "selection", "diagnostics"}
        }
        validated["groups"] = []
    else:
        validated = validate_contract(result, compatibility=False)
    validated["selection"] = selection
    return validated


def validate_mapping_font_binding(mapping: dict[str, str],
                                  font_words: set[str] | list[str] | tuple[str, ...],
                                  *, strict: bool = True) -> dict[str, Any]:
    """Validate exact mapping/font word coverage, rejecting stale pairings."""
    mapping_words = {
        str(target).lower() for target in mapping.values()
        if isinstance(target, str) and len(target) > 1
    }
    font_word_set = {str(word).lower() for word in font_words if len(str(word)) > 1}
    missing = sorted(mapping_words - font_word_set)
    extra = sorted(font_word_set - mapping_words)
    details = {
        "binding_status": "matched" if not missing and not extra else "mismatch",
        "mapping_word_count": len(mapping_words),
        "font_word_count": len(font_word_set),
        "missing_count": len(missing),
        "extra_count": len(extra),
    }
    if strict and (missing or extra):
        raise _error(
            "binding_mismatch",
            f"mapping/font binding mismatch: missing={len(missing)} extra={len(extra)}",
        )
    return details


# Descriptive aliases used by build adapters and older orchestration callers.
select_source_groups = select_contract_for_inventory
derive_cache_identity = derive_bundle_id
validate_bundle_binding = validate_mapping_font_binding


def load_contract(path: str | Path, *, compatibility: bool = True,
                  nonce_override: str | None = None) -> dict[str, Any]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if nonce_override is not None and "groups" in raw:
        raw["document_nonce"] = nonce_override
    return validate_contract(raw, compatibility=compatibility)


def write_contract(path: str | Path, contract: dict[str, Any]) -> None:
    """Write only public contract fields, never the private nonce value."""
    output = {key: value for key, value in contract.items()
              if not key.startswith("_") and key not in {"flat", "legacy", "diagnostics"}}
    if "document_nonce" in output or "nonce" in output:
        raw_nonce = output.pop("document_nonce", output.pop("nonce", None))
        output["nonce_meta"] = nonce_info(raw_nonce)
    Path(path).write_text(json.dumps(output, ensure_ascii=False, indent=0) + "\n",
                          encoding="utf-8")
