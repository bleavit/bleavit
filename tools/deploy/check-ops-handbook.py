#!/usr/bin/env python3
"""Bind the ops handbook to doc 12's operational layer (F15).

12 §6 opens with the sentence this checker exists to make true: *"Every row
names an owner role (an accountable person holds each role; assignments are
published in the ops handbook) and a treasury budget line whose amount is
normative in 08."* The document owns the commitments; the handbook owns the
assignments; and nothing before this made the two agree.

Three sections of doc 12 are bound here, and each binding is **bidirectional**,
for the reason every other gate in this repository is: a checker that only
walked the handbook would pass a handbook that quietly dropped a commitment, and
a checker that only walked the document would pass a handbook that invented one.
Both are failures, and they are different failures — a dropped row is a
commitment nobody owns, an invented one is a commitment nobody made.

**§6.1 — the service table.** Every service is assigned with its owner role and
funding line.

**A vacant role is declared, never omitted.** This is the design decision worth
stating, because the tempting shape is to list only the roles that are filled.
An omitted row reads as *there is no such commitment*; a row declaring
``holder: VACANT`` reads as *this commitment has no accountable person*, which
is what a launch gate needs to see and what 12 §6.5's phase entries are checked
against. So a blank holder is an error, and ``VACANT`` is a legal value that
``--strict`` refuses.

**§6.3 — the first-responder roster.** §6.3's *Ownership* paragraph states the
rule and never applies it: *"an alert's owner is the owner of its §6.1 row"*,
with protocol domains falling to the Monitoring coordinator. Applying it is the
handbook's job, and the roster is therefore **derived rather than read**: each
alert domain resolves to a runbook through §6.3's own tables, the runbook's
``owner_role`` frontmatter names the responder, and §6.1 must name that role.
The handbook must reproduce exactly what that chain produces. This is not a
restatement of ``check-runbooks.py``, which binds §6.3 to the runbook files;
here the runbooks are an *input* and the handbook is the artifact under test.

§6.3 also carries one obligation that only prose asserted until now: *"A runbook
spanning §6.3 rows that map to different §6.1 rows takes its primary row's owner
and MUST name the other row's owner in its escalation path — the Bootnodes /
Served-state-window pair is the live instance of this."* The required pairs are
derived by matching an alert domain against a §6.1 service of the same name,
which finds that documented instance; a future pair whose two names differ is
not derivable from the documents and must be declared in the handbook, where the
partner is still checked against §6.1 and against the runbook's escalation text.
That asymmetry is deliberate and is the checker's declared blind spot.

**§6.4 — the incident classes.** An incident class can be added to §6.4 with no
alert row, no runbook section and no owner, and nothing else in the repository
would notice: ``check-runbooks.py`` reads §6.4's heading only as a boundary
marker. Each class must name an accountable role and a standing response, the
response must resolve to a real runbook section, and the role must be that
runbook's own owner. The procedure itself stays in the runbook — a handbook
section that restates a runbook is worse than none.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOC = Path("docs/architecture/12-release-and-operations.md")
DEFAULT_HANDBOOK = Path("deploy/ops-handbook/README.md")
DEFAULT_RUNBOOKS = Path("deploy/runbooks")

VACANT = "VACANT"

SERVICE_HEADING = "### 6.1 Owned-and-funded ops table"
ALERT_HEADING = "### 6.3 Monitoring and alerting"
INCIDENT_HEADING = "### 6.4 Incident response"

# Both §6.3 tables reduce to this header once decoration and the parenthetical
# of "Alert (example)" are stripped.
ALERT_HEADER = ("Domain", "Key series", "Alert", "Runbook")
ROSTER_HEADER = ("First responder", "Alert domains")
ESCALATION_HEADER = ("Alert domain", "First responder", "Escalation partner")
INCIDENT_HEADER = ("Incident class", "Accountable role", "Standing response")

RUNBOOK_ID_RE = re.compile(r"RB-[A-Z]+")
# §6.4 names each class in bold, optionally annotated, before an em dash.
INCIDENT_CLASS_RE = re.compile(r"\*\*([^*]+?)\*\*(?:\s*\([^)]*\))?\s*—")
RESPONSE_RE = re.compile(r"^(RB-[A-Z]+) § (.+)$")
FRONTMATTER_ID_RE = re.compile(r"^id:\s*(.+)$", re.MULTILINE)
FRONTMATTER_OWNER_RE = re.compile(r"^owner_role:\s*(.+)$", re.MULTILINE)


@dataclass(frozen=True)
class ServiceRow:
    service: str
    owner_role: str
    funding_line: str


@dataclass(frozen=True)
class AlertRow:
    domain: str
    runbook_id: str


@dataclass(frozen=True)
class RunbookFacts:
    """The three things this gate needs from a runbook, and nothing else.

    ``check-runbooks.py`` owns runbook validity, including strict frontmatter
    syntax; reading two keys leniently here keeps one gate from failing for the
    other's reasons.
    """

    owner_role: str
    escalation: str
    sections: frozenset[str]


def strip_markdown(cell: str) -> str:
    """Reduce a table cell to its plain text.

    Link targets, emphasis and parentheticals are decoration; the service name
    is what both sides must agree on. Parentheticals are dropped because several
    rows carry a trailing "(normative values: 13)" that belongs to the value
    rather than to the name.
    """
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    text = text.replace("**", "").replace("`", "").replace("*", "")
    text = re.sub(r"\([^)]*\)", "", text)
    return " ".join(text.split()).strip()


def table_cells(line: str) -> list[str] | None:
    """Split a Markdown table row into stripped cells, or return None.

    Escaped pipes are not decoded: no table this gate reads contains one, and a
    row that grew one would land here as a cell-count error rather than as a
    silently mis-split row.
    """
    if not line.lstrip().startswith("|"):
        return None
    return [strip_markdown(cell) for cell in line.strip().strip("|").split("|")]


def is_separator(cells: list[str]) -> bool:
    return bool(cells) and all(cell and set(cell) <= set("-: ") for cell in cells)


def doc_section(doc_text: str, heading: str, what: str) -> str:
    start = doc_text.find(heading)
    if start == -1:
        raise SystemExit(f"{what} is gone; this gate has nothing to read")
    rest = doc_text[start:]
    end = rest.find("\n### ", 1)
    return rest if end == -1 else rest[:end]


def parse_service_table(doc_text: str) -> list[ServiceRow]:
    """Extract 12 §6.1's rows.

    Scoped to the section rather than to "any four-column table": doc 12 has
    several, and a checker that matched them all would compare the handbook
    against the alert tables and fail for reasons that are not about it.
    """
    section = doc_section(doc_text, SERVICE_HEADING, "12 §6.1's ops table")

    rows: list[ServiceRow] = []
    for line in section.splitlines():
        cells = table_cells(line)
        if cells is None or len(cells) != 4:
            continue
        service, _commitment, owner_role, funding_line = cells
        if service in {"Service", ""} or set(service) <= set("-: "):
            continue
        rows.append(ServiceRow(service, owner_role, funding_line))
    if not rows:
        raise SystemExit(
            "parsed no service rows out of 12 §6.1; the table shape moved and this gate "
            "would have passed by comparing against nothing"
        )
    return rows


def parse_alert_rows(doc_text: str) -> list[AlertRow]:
    """Extract every alert row of 12 §6.3's two tables, with its runbook.

    Anchored on the header rather than on cell shape, and it insists on finding
    both tables: §6.3's second table is the one this document owns, and a parser
    that silently read only the first would roster two thirds of the domains and
    look content.
    """
    section = doc_section(doc_text, ALERT_HEADING, "12 §6.3's alert tables")
    lines = section.splitlines()

    rows: list[AlertRow] = []
    tables = 0
    index = 0
    while index < len(lines):
        cells = table_cells(lines[index])
        if cells is None or tuple(cells) != ALERT_HEADER:
            index += 1
            continue
        separator = table_cells(lines[index + 1]) if index + 1 < len(lines) else None
        if separator is None or not is_separator(separator):
            raise SystemExit(
                "a 12 §6.3 alert table header has no separator row; the table shape moved"
            )
        tables += 1
        index += 2
        while index < len(lines):
            row = table_cells(lines[index])
            if row is None:
                break
            runbook = RUNBOOK_ID_RE.fullmatch(row[3]) if len(row) == 4 else None
            if len(row) != 4 or is_separator(row) or not row[0] or runbook is None:
                raise SystemExit(
                    f"unparsable 12 §6.3 alert row, so this gate cannot say who answers "
                    f"for it: {lines[index].strip()!r}"
                )
            rows.append(AlertRow(row[0], runbook.group(0)))
            index += 1

    if tables != 2:
        raise SystemExit(
            f"found {tables} parseable 12 §6.3 alert tables, expected 2; the table shape "
            "moved and this gate would have compared against nothing"
        )
    if not rows:
        raise SystemExit("parsed no alert rows out of 12 §6.3's tables")
    owners: dict[str, set[str]] = {}
    for row in rows:
        owners.setdefault(row.domain, set()).add(row.runbook_id)
    for domain, runbooks in sorted(owners.items()):
        if len(runbooks) > 1:
            raise SystemExit(
                f"12 §6.3 splits the domain {domain!r} across {', '.join(sorted(runbooks))}, "
                "so it has no single first responder to publish"
            )
    return rows


def parse_incident_classes(doc_text: str) -> list[str]:
    """Extract 12 §6.4's incident classes."""
    section = doc_section(doc_text, INCIDENT_HEADING, "12 §6.4's incident classes")
    classes = [
        strip_markdown(match.group(1)) for match in INCIDENT_CLASS_RE.finditer(section)
    ]
    if not classes:
        raise SystemExit(
            "parsed no incident classes out of 12 §6.4; the section shape moved and this "
            "gate would have passed by comparing against nothing"
        )
    seen: set[str] = set()
    for name in classes:
        if name in seen:
            raise SystemExit(f"12 §6.4 names the incident class {name!r} twice")
        seen.add(name)
    return classes


def runbook_section(text: str, heading: str) -> str:
    start = text.find(heading)
    if start == -1:
        return ""
    rest = text[start:]
    end = rest.find("\n## ", 1)
    return rest if end == -1 else rest[:end]


def load_runbooks(directory: Path) -> tuple[dict[str, RunbookFacts], list[str]]:
    """Read the O4 runbooks this gate resolves ownership through."""
    if not directory.is_dir():
        return {}, [
            f"the runbooks directory {directory} does not exist, so no alert domain can be "
            "resolved to a first responder"
        ]
    facts: dict[str, RunbookFacts] = {}
    problems: list[str] = []
    for path in sorted(directory.glob("RB-*.md")):
        text = path.read_text(encoding="utf-8")
        id_match = FRONTMATTER_ID_RE.search(text)
        owner_match = FRONTMATTER_OWNER_RE.search(text)
        if id_match is None or owner_match is None:
            problems.append(
                f"{path.name}: no id and owner_role frontmatter, so this gate cannot say "
                "who answers for the alerts it owns"
            )
            continue
        runbook_id = id_match.group(1).strip().strip('"')
        if runbook_id in facts:
            problems.append(f"{path.name}: duplicate runbook id {runbook_id}")
            continue
        sections = frozenset(
            strip_markdown(line.lstrip("#").strip())
            for line in text.splitlines()
            if line.startswith(("## ", "### "))
        )
        facts[runbook_id] = RunbookFacts(
            owner_role=owner_match.group(1).strip().strip('"'),
            escalation=runbook_section(text, "## Escalation"),
            sections=sections,
        )
    return facts, problems


@dataclass(frozen=True)
class Assignment:
    service: str
    owner_role: str
    funding_line: str
    holder: str


ASSIGNMENT = re.compile(
    r"^\|\s*(?P<service>[^|]+?)\s*\|\s*(?P<role>[^|]+?)\s*\|\s*(?P<line>[^|]+?)\s*\|"
    r"\s*(?P<holder>[^|]*?)\s*\|\s*$"
)


def handbook_section(text: str, heading: str, what: str) -> str:
    start = text.find(heading)
    if start == -1:
        raise SystemExit(f"the handbook has no '{heading}' section; {what}")
    rest = text[start:]
    end = rest.find("\n## ", 1)
    return rest if end == -1 else rest[:end]


def handbook_table(
    section: str, header: tuple[str, ...], what: str
) -> list[list[str]]:
    """Return a handbook table's data rows, anchored on its exact header."""
    lines = section.splitlines()
    starts = [
        index
        for index, line in enumerate(lines)
        if (cells := table_cells(line)) is not None and tuple(cells) == header
    ]
    if len(starts) != 1:
        raise SystemExit(
            f"found {len(starts)} tables headed {' | '.join(header)} in the handbook, "
            f"expected exactly 1; {what}"
        )
    index = starts[0]
    separator = table_cells(lines[index + 1]) if index + 1 < len(lines) else None
    if separator is None or not is_separator(separator):
        raise SystemExit(f"the handbook's {header[0]!r} table has no separator row")
    rows: list[list[str]] = []
    index += 2
    while index < len(lines):
        cells = table_cells(lines[index])
        if cells is None:
            break
        if len(cells) != len(header) or is_separator(cells):
            raise SystemExit(
                f"unparsable handbook row in the {header[0]!r} table: "
                f"{lines[index].strip()!r}"
            )
        rows.append(cells)
        index += 1
    if not rows:
        raise SystemExit(f"the handbook's {header[0]!r} table has no rows; {what}")
    return rows


def parse_handbook(text: str) -> list[Assignment]:
    section = handbook_section(
        text, "## Role assignments", "12 §6.1's services would have no published owner"
    )

    assignments: list[Assignment] = []
    for line in section.splitlines():
        match = ASSIGNMENT.match(line)
        if not match:
            continue
        service = strip_markdown(match.group("service"))
        if service in {"Service", ""} or set(service) <= set("-: "):
            continue
        holder = match.group("holder").strip()
        if not holder:
            raise SystemExit(
                f"{service}: no holder recorded. A vacancy is declared as {VACANT}, never "
                "left blank — an omitted holder reads as 'no such commitment' rather than "
                "as 'this commitment has nobody accountable'."
            )
        assignments.append(
            Assignment(
                service=service,
                owner_role=strip_markdown(match.group("role")),
                funding_line=strip_markdown(match.group("line")),
                holder=holder,
            )
        )
    return assignments


def parse_roster(text: str) -> tuple[dict[str, str], list[str]]:
    """Read the handbook's first-responder roster as domain -> role."""
    section = handbook_section(
        text,
        "## Monitoring and alerting",
        "12 §6.3's alerts would have no published first responder",
    )
    roster: dict[str, str] = {}
    failures: list[str] = []
    seen_roles: set[str] = set()
    for cells in handbook_table(
        section, ROSTER_HEADER, "no alert domain would be rostered"
    ):
        role, domain_cell = cells
        if not role:
            failures.append("the roster has a row with no first responder")
            continue
        if role in seen_roles:
            failures.append(
                f"the roster lists {role!r} twice; one role holds one list of domains"
            )
        seen_roles.add(role)
        domains = [part.strip() for part in domain_cell.split(",") if part.strip()]
        if not domains:
            failures.append(f"the roster gives {role!r} no alert domains")
        for domain in domains:
            if domain in roster:
                failures.append(
                    f"the roster names the domain {domain!r} twice, under {roster[domain]!r} "
                    f"and {role!r}; one domain has one first responder"
                )
                continue
            roster[domain] = role
    return roster, failures


def parse_escalation_pairs(text: str) -> dict[str, tuple[str, str]]:
    """Read the handbook's cross-row escalation table as domain -> (responder, partner)."""
    section = handbook_section(
        text,
        "## Monitoring and alerting",
        "12 §6.3's cross-row escalation rule would go unrecorded",
    )
    pairs: dict[str, tuple[str, str]] = {}
    for cells in handbook_table(
        section, ESCALATION_HEADER, "no escalation partner would be declared"
    ):
        domain, responder, partner = cells
        pairs[domain] = (responder, partner)
    return pairs


def parse_incidents(text: str) -> dict[str, tuple[str, str]]:
    """Read the handbook's incident table as class -> (role, response)."""
    section = handbook_section(
        text,
        "## Incident response",
        "12 §6.4's incident classes would have no accountable role",
    )
    incidents: dict[str, tuple[str, str]] = {}
    for cells in handbook_table(
        section, INCIDENT_HEADER, "no incident class would be owned"
    ):
        incident_class, role, response = cells
        incidents[incident_class] = (role, response)
    return incidents


def check_services(
    rows: dict[str, ServiceRow], assignments: dict[str, Assignment], strict: bool
) -> list[str]:
    failures: list[str] = []
    for service, row in rows.items():
        assignment = assignments.get(service)
        if assignment is None:
            failures.append(
                f"12 §6.1 names the service {service!r} and the handbook does not assign it. "
                "A dropped row is a commitment nobody owns."
            )
            continue
        if assignment.owner_role != row.owner_role:
            failures.append(
                f"{service}: 12 §6.1 owns it to {row.owner_role!r}, the handbook says "
                f"{assignment.owner_role!r}"
            )
        if assignment.funding_line != row.funding_line:
            failures.append(
                f"{service}: 12 §6.1 funds it from {row.funding_line!r}, the handbook says "
                f"{assignment.funding_line!r}"
            )

    for service in assignments:
        if service not in rows:
            failures.append(
                f"the handbook assigns {service!r}, which 12 §6.1 does not name. An invented "
                "row is a commitment nobody made."
            )

    vacancies = [a.service for a in assignments.values() if a.holder == VACANT]
    if strict and vacancies:
        failures.append(
            f"{len(vacancies)} service(s) have no accountable person: "
            f"{', '.join(sorted(vacancies))}. 12 §6 requires one per row, and 12 §6.5 gates "
            "phase entry on these commitments being live."
        )
    return failures


def check_roster(
    alert_rows: list[AlertRow],
    runbooks: dict[str, RunbookFacts],
    owner_roles: set[str],
    roster: dict[str, str],
) -> tuple[list[str], dict[str, str], dict[str, str]]:
    """Derive domain -> first responder from doc 12 and the runbooks, then compare."""
    failures: list[str] = []
    expected: dict[str, str] = {}
    runbook_by_domain: dict[str, str] = {}
    for row in alert_rows:
        if row.domain in expected:
            continue
        runbook_by_domain[row.domain] = row.runbook_id
        facts = runbooks.get(row.runbook_id)
        if facts is None:
            failures.append(
                f"12 §6.3 binds the domain {row.domain!r} to {row.runbook_id}, and no "
                "readable runbook of that id declares an owner role. An alert nobody "
                "answers for is a commitment nobody owns."
            )
            continue
        if facts.owner_role not in owner_roles:
            failures.append(
                f"{row.runbook_id} answers to {facts.owner_role!r}, which 12 §6.1 does not "
                "name as an owner role, so this gate cannot publish it as a first responder"
            )
            continue
        expected[row.domain] = facts.owner_role

    for domain, role in sorted(expected.items()):
        rostered = roster.get(domain)
        if rostered is None:
            failures.append(
                f"12 §6.3 alerts on {domain!r} and the handbook rosters no first responder "
                f"for it. 12 §6.3 makes that {role!r}, through "
                f"{runbook_by_domain[domain]}."
            )
        elif rostered != role:
            failures.append(
                f"{domain}: 12 §6.3 binds it to {runbook_by_domain[domain]}, which answers "
                f"to {role!r}; the handbook rosters {rostered!r}"
            )

    for domain, role in sorted(roster.items()):
        if domain not in expected and domain not in runbook_by_domain:
            failures.append(
                f"the handbook rosters {role!r} for the alert domain {domain!r}, which "
                "12 §6.3 does not alert on. An invented domain is a commitment nobody made."
            )
    return failures, expected, runbook_by_domain


def check_escalation_pairs(
    services: dict[str, ServiceRow],
    expected_roles: dict[str, str],
    runbook_by_domain: dict[str, str],
    runbooks: dict[str, RunbookFacts],
    owner_roles: set[str],
    declared: dict[str, tuple[str, str]],
) -> list[str]:
    """12 §6.3's cross-row rule: the other §6.1 row's owner is named in the escalation.

    Required pairs are derived by name equality between an alert domain and a
    §6.1 service, which finds the pair §6.3 itself calls the live instance. A
    future pair whose two names differ is not derivable and must be declared;
    the declaration is still checked against §6.1 and the runbook.
    """
    failures: list[str] = []
    required: dict[str, str] = {}
    for domain, responder in expected_roles.items():
        service = services.get(domain)
        if service is not None and service.owner_role != responder:
            required[domain] = service.owner_role

    for domain, partner in sorted(required.items()):
        if domain not in declared:
            failures.append(
                f"{domain}: 12 §6.1 owns the row of that name to {partner!r} while its "
                f"runbook answers to {expected_roles[domain]!r}, and the handbook declares "
                "no escalation partner. 12 §6.3 requires the other row's owner to be named."
            )
        elif declared[domain][1] != partner:
            failures.append(
                f"{domain}: 12 §6.1 owns the row of that name to {partner!r}, the handbook "
                f"escalates to {declared[domain][1]!r}"
            )

    for domain, (responder, partner) in sorted(declared.items()):
        expected_responder = expected_roles.get(domain)
        if expected_responder is None:
            failures.append(
                f"the handbook declares an escalation partner for {domain!r}, which 12 §6.3 "
                "does not alert on"
            )
            continue
        if responder != expected_responder:
            failures.append(
                f"{domain}: the escalation table names {responder!r} as first responder, "
                f"the roster derives {expected_responder!r}"
            )
        if partner not in owner_roles:
            failures.append(
                f"{domain}: the escalation partner {partner!r} is not a role 12 §6.1 names "
                "as an owner"
            )
            continue
        if partner == responder:
            failures.append(
                f"{domain}: the escalation partner is the first responder, which escalates "
                "to nobody"
            )
            continue
        runbook_id = runbook_by_domain.get(domain)
        facts = runbooks.get(runbook_id) if runbook_id else None
        if facts is None:
            continue
        if partner not in facts.escalation:
            failures.append(
                f"{runbook_id}: its Escalation section does not name {partner!r}. 12 §6.3 "
                f"requires the runbook spanning {domain!r} to name that row's owner."
            )
    return failures


def check_incidents(
    classes: list[str],
    incidents: dict[str, tuple[str, str]],
    runbooks: dict[str, RunbookFacts],
    owner_roles: set[str],
) -> list[str]:
    failures: list[str] = []
    for incident_class in classes:
        if incident_class not in incidents:
            failures.append(
                f"12 §6.4 names the incident class {incident_class!r} and the handbook gives "
                "it no accountable role. An incident class nobody owns has nobody to route "
                "it to."
            )

    known = set(classes)
    for incident_class, (role, response) in sorted(incidents.items()):
        if incident_class not in known:
            failures.append(
                f"the handbook owns the incident class {incident_class!r}, which 12 §6.4 "
                "does not name. An invented class is a commitment nobody made."
            )
            continue
        match = RESPONSE_RE.match(response)
        if match is None:
            failures.append(
                f"{incident_class}: the standing response {response!r} does not name a "
                "runbook section as 'RB-ID § Section'"
            )
            continue
        runbook_id, section = match.group(1), match.group(2)
        facts = runbooks.get(runbook_id)
        if facts is None:
            failures.append(
                f"{incident_class}: the standing response names {runbook_id}, which is not a "
                "runbook this gate can read"
            )
            continue
        if section not in facts.sections:
            failures.append(
                f"{incident_class}: {runbook_id} has no section {section!r}. A standing "
                "response with no written procedure is a name, not a procedure."
            )
        if role not in owner_roles:
            failures.append(
                f"{incident_class}: the accountable role {role!r} is not a role 12 §6.1 "
                "names as an owner"
            )
        elif role != facts.owner_role:
            failures.append(
                f"{incident_class}: the handbook makes {role!r} accountable, and "
                f"{runbook_id} answers to {facts.owner_role!r}"
            )
    return failures


def check(
    doc_text: str,
    handbook_text: str,
    runbooks: dict[str, RunbookFacts],
    strict: bool,
) -> list[str]:
    service_rows = parse_service_table(doc_text)
    services = {row.service: row for row in service_rows}
    owner_roles = {row.owner_role for row in service_rows}
    assignments = {a.service: a for a in parse_handbook(handbook_text)}

    failures = check_services(services, assignments, strict)

    alert_rows = parse_alert_rows(doc_text)
    roster, roster_failures = parse_roster(handbook_text)
    failures.extend(roster_failures)
    roster_binding, expected_roles, runbook_by_domain = check_roster(
        alert_rows, runbooks, owner_roles, roster
    )
    failures.extend(roster_binding)

    failures.extend(
        check_escalation_pairs(
            services,
            expected_roles,
            runbook_by_domain,
            runbooks,
            owner_roles,
            parse_escalation_pairs(handbook_text),
        )
    )

    failures.extend(
        check_incidents(
            parse_incident_classes(doc_text),
            parse_incidents(handbook_text),
            runbooks,
            owner_roles,
        )
    )
    return failures


def summarize(
    doc_text: str, handbook_text: str, runbooks: dict[str, RunbookFacts]
) -> str:
    rows = parse_service_table(doc_text)
    assignments = parse_handbook(handbook_text)
    vacant = sum(1 for a in assignments if a.holder == VACANT)
    roster, _failures = parse_roster(handbook_text)
    return (
        f"Ops handbook OK — {len(rows)} service commitments bound, "
        f"{len(assignments) - vacant} assigned, {vacant} declared vacant. "
        f"{len(roster)} alert domains rostered across {len(set(roster.values()))} first "
        f"responders, {len(parse_incident_classes(doc_text))} incident classes owned, "
        f"{len(runbooks)} runbooks read."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--doc", type=Path, default=ROOT / DEFAULT_DOC)
    parser.add_argument("--handbook", type=Path, default=ROOT / DEFAULT_HANDBOOK)
    parser.add_argument("--runbooks-dir", type=Path, default=ROOT / DEFAULT_RUNBOOKS)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also fail on a declared vacancy — what a launch gate runs, not what CI runs",
    )
    args = parser.parse_args()

    doc_text = args.doc.read_text(encoding="utf-8")
    handbook_text = args.handbook.read_text(encoding="utf-8")
    runbooks, problems = load_runbooks(args.runbooks_dir)
    failures = problems + check(doc_text, handbook_text, runbooks, args.strict)

    if failures:
        print("Ops handbook does not agree with doc 12:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(summarize(doc_text, handbook_text, runbooks))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
