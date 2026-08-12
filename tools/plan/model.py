"""Strict frontmatter parsing and item loading for the plan/ tree.

The accepted grammar is deliberately narrow and matches
tools/deploy/check-runbooks.py:

    key: plain scalar
    key: "double quoted scalar"
    key: [flow, list, of, scalars]
    key:
      - block list item

Tabs, duplicate keys, unknown keys, and every other YAML construct are refused.
This module adds no dependency, because the runbook precedent adds none.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

TOP_LEVEL_RE = re.compile(r"^([a-z_]+):(?: (.*))?$")
BLOCK_ITEM_RE = re.compile(r"^  - (.+)$")

MILESTONE_STATUSES = ("pending", "active", "blocked", "done")
QUESTION_STATUSES = ("open", "resolved")
STATUS_GLYPHS = {"pending": "⬜", "active": "🔨", "blocked": "⛔", "done": "✅"}

MILESTONE_KEYS = {"id", "track", "title", "spec", "depends", "status", "verify"}
MILESTONE_LIST_KEYS = {"spec", "depends", "verify"}
QUESTION_KEYS = {"id", "title", "spec_ref", "raised", "status", "resolved", "batch"}
QUESTION_LIST_KEYS: set[str] = set()
VERIFICATION_KEYS = {"id", "date", "milestone", "title"}
VERIFICATION_LIST_KEYS: set[str] = set()

# A bare date, and a date that opens a longer string. Both are needed:
# 391 of 583 Raised cells read "2026-07-22 (SQ-66/SQ-320 contract-v7 comparison)",
# so demanding a bare date there would reject two thirds of the corpus.
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\D.*)?$")


class PlanError(Exception):
    """A frontmatter file this parser refuses to interpret."""


def _scalar(raw: str, label: str, line: int) -> str:
    if raw != raw.strip() or not raw:
        raise PlanError(f"{label}:{line}: scalar must be non-empty with no edge whitespace")
    if raw[0] in "'{|>":
        raise PlanError(f"{label}:{line}: unsupported frontmatter syntax; use a plain or double-quoted single-line scalar")
    if raw.startswith('"'):
        if len(raw) < 2 or not raw.endswith('"'):
            raise PlanError(f"{label}:{line}: unmatched double quote")
        value = raw[1:-1]
        if '"' in value or any(c in value for c in "\r\n\t"):
            raise PlanError(f"{label}:{line}: double-quoted scalar must be one literal line with no embedded quote")
        if not value:
            raise PlanError(f"{label}:{line}: scalar must be non-empty")
        return value
    return raw


def _flow_list(raw: str, label: str, line: int) -> list[str]:
    inner = raw[1:-1].strip()
    if not inner:
        return []
    items: list[str] = []
    for part in _split_flow(inner, label, line):
        items.append(_scalar(part.strip(), label, line))
    return items


def _split_flow(inner: str, label: str, line: int) -> list[str]:
    """Split a flow list on commas that are outside double quotes."""
    parts: list[str] = []
    current: list[str] = []
    in_quotes = False
    for character in inner:
        if character == '"':
            in_quotes = not in_quotes
            current.append(character)
        elif character == "," and not in_quotes:
            parts.append("".join(current))
            current = []
        else:
            current.append(character)
    if in_quotes:
        raise PlanError(f"{label}:{line}: unmatched double quote in flow list")
    parts.append("".join(current))
    return parts


def parse_frontmatter(path: Path) -> tuple[dict[str, str | list[str]], str]:
    """Return (values, body). Raises PlanError on anything unrecognised."""
    label = str(path)
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        raise PlanError(f"{label}:1: file must start with --- frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError:
        raise PlanError(f"{label}:1: frontmatter has no closing --- delimiter") from None

    frontmatter = lines[1:closing]
    for number, line in enumerate(frontmatter, start=2):
        if "\t" in line:
            raise PlanError(f"{label}:{number}: tabs are forbidden in frontmatter")

    values: dict[str, str | list[str]] = {}
    index = 0
    while index < len(frontmatter):
        line = frontmatter[index]
        number = index + 2
        match = TOP_LEVEL_RE.fullmatch(line)
        if match is None:
            raise PlanError(f"{label}:{number}: expected an unindented top-level key")
        key, raw = match.groups()
        if key in values:
            raise PlanError(f"{label}:{number}: duplicate top-level key {key!r}")
        index += 1
        if raw is None:
            items: list[str] = []
            while index < len(frontmatter) and frontmatter[index].startswith("  "):
                item = BLOCK_ITEM_RE.fullmatch(frontmatter[index])
                if item is None:
                    raise PlanError(f"{label}:{index + 2}: list item must be exactly '  - <scalar>'")
                items.append(_scalar(item.group(1), label, index + 2))
                index += 1
            values[key] = items
        elif raw.startswith("["):
            if not raw.endswith("]"):
                raise PlanError(f"{label}:{number}: unterminated flow list")
            values[key] = _flow_list(raw, label, number)
        else:
            values[key] = _scalar(raw, label, number)

    body = "\n".join(lines[closing + 1 :]).strip("\n")
    return values, body


@dataclass(frozen=True)
class Milestone:
    id: str
    track: str
    title: str
    spec: tuple[str, ...]
    depends: tuple[str, ...]
    status: str
    verify: tuple[str, ...]
    body: str
    path: Path


@dataclass(frozen=True)
class Question:
    id: str
    title: str
    spec_ref: str
    raised: str
    status: str
    resolved: str | None
    batch: str
    body: str
    path: Path


@dataclass(frozen=True)
class Verification:
    id: str
    date: str | None
    milestone: str
    title: str
    body: str
    path: Path


def _check_keys(values, allowed, required, label, errors) -> bool:
    ok = True
    for key in sorted(set(values) - allowed):
        errors.append(f"{label}: unknown key {key!r}")
        ok = False
    for key in sorted(required - set(values)):
        errors.append(f"{label}: missing required key {key!r}")
        ok = False
    return ok


def _load(root: Path, subdir: str, build, errors: list[str]) -> list:
    directory = root / "plan" / subdir
    if not directory.is_dir():
        errors.append(f"plan/{subdir}: directory is missing")
        return []
    items = []
    for path in sorted(directory.glob("*.md")):
        label = f"plan/{subdir}/{path.name}"
        try:
            values, body = parse_frontmatter(path)
        except PlanError as error:
            errors.append(str(error))
            continue
        if values.get("id") != path.stem:
            errors.append(f"{label}: id {values.get('id')!r} does not match its filename")
            continue
        item = build(values, body, path, label, errors)
        if item is not None:
            items.append(item)
    return items


def load_milestones(root: Path) -> tuple[list[Milestone], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        required = {"id", "track", "title", "spec", "depends", "status"}
        if not _check_keys(values, MILESTONE_KEYS, required, label, errors):
            return None
        status = values["status"]
        if status not in MILESTONE_STATUSES:
            errors.append(f"{label}: status must be one of {MILESTONE_STATUSES}, found {status!r}")
            return None
        for key in MILESTONE_LIST_KEYS:
            if key in values and not isinstance(values[key], list):
                errors.append(f"{label}: {key} must be a list")
                return None
        return Milestone(
            id=values["id"],
            track=values["track"],
            title=values["title"],
            spec=tuple(values["spec"]),
            depends=tuple(values["depends"]),
            status=status,
            verify=tuple(values.get("verify", [])),
            body=body,
            path=path,
        )

    return _load(root, "milestones", build, errors), errors


def load_questions(root: Path) -> tuple[list[Question], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        required = {"id", "title", "spec_ref", "raised", "status", "batch"}
        if not _check_keys(values, QUESTION_KEYS, required, label, errors):
            return None
        status = values["status"]
        if status not in QUESTION_STATUSES:
            errors.append(f"{label}: status must be one of {QUESTION_STATUSES}, found {status!r}")
            return None
        # `raised` opens with a date and may carry a parenthetical after it.
        if not DATE_PREFIX_RE.fullmatch(values["raised"]):
            errors.append(f"{label}: raised must begin with YYYY-MM-DD, found {values['raised']!r}")
            return None
        resolved = values.get("resolved")
        # `resolved` is OPTIONAL even when the status is resolved: 10 of the 389
        # resolved rows record no date, and inventing one would be a fabrication.
        if resolved is not None and not DATE_RE.fullmatch(resolved):
            errors.append(f"{label}: resolved must be YYYY-MM-DD, found {resolved!r}")
            return None
        if status == "open" and resolved:
            errors.append(f"{label}: an open question must not carry a resolved: date")
            return None
        return Question(
            id=values["id"],
            title=values["title"],
            spec_ref=values["spec_ref"],
            raised=values["raised"],
            status=status,
            resolved=resolved,
            batch=values["batch"],
            body=body,
            path=path,
        )

    return _load(root, "questions", build, errors), errors


def load_verifications(root: Path) -> tuple[list[Verification], list[str]]:
    errors: list[str] = []

    def build(values, body, path, label, errors):
        # `date` is optional: 12 of the 224 verification rows carry no date in
        # their Status cell, and the converter must not invent one.
        required = {"id", "milestone", "title"}
        if not _check_keys(values, VERIFICATION_KEYS, required, label, errors):
            return None
        date = values.get("date")
        if date is not None and not DATE_RE.fullmatch(date):
            errors.append(f"{label}: date must be YYYY-MM-DD, found {date!r}")
            return None
        return Verification(
            id=values["id"],
            date=date,
            milestone=values["milestone"],
            title=values["title"],
            body=body,
            path=path,
        )

    return _load(root, "verifications", build, errors), errors
