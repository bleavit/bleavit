"""Executes 13 §1/§2's registry bounds and cross-key safety claims.

The suite grounds the model in both checked-in limit registries, then searches
the lawful value graph.  A published claim which the graph falsifies is pinned
as a queryable failed finding; tests never pretend the desired property holds.
"""

from dataclasses import fields, replace
from decimal import Decimal
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

from bleavit_reference_model.registry import (
    ATTACK_COST_CEILINGS,
    CLASS_NAV_FLOORS_USDC,
    COUPLINGS,
    KERNEL_BOUNDED_KEYS,
    REGISTRY,
    U128_MAX,
    AmendmentClass,
    BindingSite,
    DeltaRule,
    DeltaKind,
    MARKET_BEARING,
    ObservedConsumerCheck,
    ParamKind,
    ParamRecord,
    ProposalClass,
    _production_rust_files,
    check_coupling_conformance,
    coupling_findings,
    disables_class,
    kernel_hygiene,
    kernel_orphans,
    lower_slew_bound_1e9,
    min_breaking_sequence,
    param_key_bytes,
    path_to_value,
    post_amendment_reverification,
    reserve_probe_runway,
    self_sealing_corners,
)


ROOT = Path(__file__).resolve().parents[2]
DOC_13 = ROOT / "docs/architecture/13-parameters.md"


def _plain_markdown(value: str) -> str:
    return value.replace("**", "").replace("~~", "").replace("`", "").strip()


def _doc13_rows(source: str) -> list[tuple[str, ...]]:
    """Parse the §1 Markdown table without consulting a code artifact."""
    section = source.split("## 1. Constitution keys", 1)[1].split(
        "**`collator.comp_epoch`", 1
    )[0]
    rows: list[tuple[str, ...]] = []
    for line in section.splitlines():
        if not line.startswith("| "):
            continue
        cells = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        if len(cells) == 10 and cells[0] not in {"Key", "---"}:
            rows.append(cells)
    return rows


_PER_CLASS_BASES = {
    "dec.delta": "dec.delta",
    "dec.sigma": "dec.sigma",
    "dec.v_min": "dec.v_min",
    "gate.v_min": "gate.v_min",
    "prop.bond": "prop.bond",
    "pol.b": "pol.b",
    "exec.timelock": "exec.lock",
    "trs.proposer_reward": "trs.reward",
}
_CLASS_SUFFIXES = ("param", "trs", "code", "meta")


def _doc_row_keys(key_cell: str) -> tuple[str, ...]:
    """Apply 13 rule 6's aliases and per-class materialization rules."""
    prefix = key_cell.split(" (", 1)[0]
    prefix_keys = tuple(re.findall(r"`([^`]+)`", prefix))
    if not prefix_keys or prefix_keys[0] == "ops.*":
        return ()

    alias = re.search(r"\bkeys?:", key_cell)
    if alias is not None:
        alias_clause = key_cell[alias.end() :].split(";", 1)[0].split(")", 1)[0]
        aliases = tuple(re.findall(r"`([^`]+)`", alias_clause))
        if aliases:
            return aliases

    primary = prefix_keys[0]
    if primary in _PER_CLASS_BASES:
        base = _PER_CLASS_BASES[primary]
        return tuple(f"{base}.{suffix}" for suffix in _CLASS_SUFFIXES)
    return prefix_keys


def _doc13_scales(source: str) -> dict[str, int]:
    blocks = re.search(r"Blocks at 6 s \(([\d,]+)/day\)", source)
    decimals = re.search(r"USDC (\d+) decimals, VIT (\d+) decimals", source)
    fixed = re.search(r"Fixed.*?\(1e(\d+) scale\)", source)
    if blocks is None or decimals is None or fixed is None:
        raise AssertionError("doc 13 scalar preamble is not parseable")
    return {
        "blocks_per_day": int(blocks.group(1).replace(",", "")),
        "usdc": 10 ** int(decimals.group(1)),
        "vit": 10 ** int(decimals.group(2)),
        "fixed": 10 ** int(fixed.group(1)),
        # Rule 8 states that displayed bps convert to raw Perbill by 100,000.
        "perbill_per_bps": 100_000,
    }


def _doc_kernel_bounded_keys(source: str) -> frozenset[str]:
    listing = source.split("kernel-bounded set is,", 1)[1].split(
        "Cross-key couplings", 1
    )[0]
    return frozenset(re.findall(r"`([^`]+)`", listing))


_NUMBER = re.compile(
    r"(?<![A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?(?:[kM])?)(?:\s*(yr|d|h|%|pp))?"
)


def _first_number(value: str) -> tuple[Decimal, str | None]:
    match = _NUMBER.search(_plain_markdown(value))
    if match is None:
        raise AssertionError(f"no numeric value in doc cell: {value}")
    token = match.group(1).replace(",", "")
    multiplier = Decimal(1)
    if token.endswith("k"):
        token = token[:-1]
        multiplier = Decimal(1_000)
    elif token.endswith("M"):
        token = token[:-1]
        multiplier = Decimal(1_000_000)
    return Decimal(token) * multiplier, match.group(2)


def _last_number(value: str) -> tuple[Decimal, str | None]:
    matches = list(_NUMBER.finditer(_plain_markdown(value)))
    if not matches:
        raise AssertionError(f"no numeric value in doc cell: {value}")
    match = matches[-1]
    token = match.group(1).replace(",", "")
    multiplier = Decimal(1)
    if token.endswith("k"):
        token = token[:-1]
        multiplier = Decimal(1_000)
    elif token.endswith("M"):
        token = token[:-1]
        multiplier = Decimal(1_000_000)
    return Decimal(token) * multiplier, match.group(2)


def _raw_unit(kind: ParamKind, doc_unit: str) -> str:
    unit = _plain_markdown(doc_unit)
    if kind is ParamKind.FIXED:
        return {
            "/interval": "1e-9/interval",
            "s-units": "1e-9 score",
            "prob": "1e-9 probability",
            "—": "1e-9",
            "× of (b_acc + b_rej)": "1e-9 multiple",
        }[unit]
    if kind is ParamKind.PERBILL:
        return {"bps": "ppb", "NAV": "ppb NAV", "—": "ppb fraction"}[unit]
    if kind is ParamKind.PERCENT:
        return {
            "%": "percent",
            "% of bond": "percent",
            "NAV": "percent NAV",
            "/yr": "percent/year",
        }[unit]
    if kind is ParamKind.BALANCE:
        return {
            "USDC": "µUSDC",
            "USDC/entry": "µUSDC",
            "USDC/collator": "µUSDC/collator",
            "VIT": "VIT planck",
            "µUSDC/DOT": "µUSDC/DOT",
            "planck (DOT)": "DOT planck",
            "planck / s of ref-time": "DOT planck/s",
            "planck / MiB of proof": "DOT planck/MiB",
            "µUSDC / s of ref-time": "µUSDC/s",
            "µUSDC / MiB of proof": "µUSDC/MiB",
        }[unit]
    if kind is ParamKind.U8:
        return {
            "—": "count",
            "epochs": "epochs",
            "entries/epoch": "entries/epoch",
            "of N registered": "count",
            "consecutive probes": "probes",
        }[unit]
    return unit


def _to_raw(
    value: Decimal,
    suffix: str | None,
    kind: ParamKind,
    doc_unit: str,
    scales: dict[str, int],
) -> int:
    unit = _plain_markdown(doc_unit)
    if suffix == "d":
        value *= scales["blocks_per_day"]
    elif suffix == "h":
        value *= Decimal(scales["blocks_per_day"]) / Decimal(24)
    elif suffix == "yr":
        value *= scales["blocks_per_day"] * 365

    if kind is ParamKind.FIXED:
        value *= scales["fixed"]
    elif kind is ParamKind.PERBILL:
        value *= (
            Decimal(10_000_000)
            if suffix == "%" or unit == "NAV"
            else scales["fixed"]
            if unit == "—"
            else scales["perbill_per_bps"]
        )
    elif kind is ParamKind.BALANCE:
        if unit in {"USDC", "USDC/entry", "USDC/collator"}:
            value *= scales["usdc"]
        elif unit == "VIT":
            value *= scales["vit"]
    integral = value.to_integral_value()
    if value != integral:
        raise AssertionError(f"non-integral raw value {value} for {kind}/{unit}")
    return int(integral)


def _variants(cell: str, count: int) -> tuple[str, ...]:
    plain = _plain_markdown(cell)
    head = plain.split(" — ", 1)[0]
    # A fail-closed unverified row may lead with `[VERIFY] — <seed>`; retain
    # the full cell when the qualifier itself contains no scalar.
    if _NUMBER.search(head) is None:
        head = plain
    parts = tuple(part.strip() for part in head.split("/"))
    if count > 1 and len(parts) >= count:
        return parts[:count]
    return tuple(head for _ in range(count))


def _type_endpoint(kind: ParamKind, maximum: bool, scales: dict[str, int]) -> int:
    if not maximum:
        return 0
    return {
        ParamKind.U8: 2**8 - 1,
        ParamKind.U32: 2**32 - 1,
        ParamKind.FIXED: scales["fixed"],
        ParamKind.PERBILL: 10**9,
        ParamKind.PERCENT: 100,
        ParamKind.BALANCE: 2**128 - 1,
    }[kind]


def _parse_doc13_records() -> dict[str, ParamRecord]:
    source = DOC_13.read_text(encoding="utf-8")
    rows = _doc13_rows(source)
    scales = _doc13_scales(source)
    kernel_bounded = _doc_kernel_bounded_keys(source)
    targets = set(REGISTRY)
    materialized: list[tuple[tuple[str, ...], tuple[str, ...]]] = []
    for row in rows:
        keys = tuple(key for key in _doc_row_keys(row[0]) if key in targets)
        if keys:
            materialized.append((keys, row))

    kinds: dict[str, ParamKind] = {}
    units: dict[str, str] = {}
    defaults: dict[str, int] = {}
    for keys, row in materialized:
        kind = ParamKind(_plain_markdown(row[1]))
        variants = _variants(row[3], len(keys))
        for index, key in enumerate(keys):
            kinds[key] = kind
            units[key] = _raw_unit(kind, row[2])
            if key.startswith("gate.v_min."):
                decision = defaults[f"dec.v_min.{key.rsplit('.', 1)[1]}"]
                defaults[key] = decision // 10
            elif key.startswith("trs.reward."):
                amount, suffix = _first_number(row[3] if key.endswith(".param") else "25k")
                defaults[key] = _to_raw(amount, suffix, kind, row[2], scales)
            else:
                amount, suffix = _first_number(variants[index])
                defaults[key] = _to_raw(amount, suffix, kind, row[2], scales)

    minima: dict[str, int] = {}
    maxima: dict[str, int] = {}

    def parse_bound(
        key: str,
        keys: tuple[str, ...],
        row: tuple[str, ...],
        index: int,
        maximum: bool,
    ) -> int:
        kind = kinds[key]
        cell = row[5 if maximum else 4]
        variant = _variants(cell, len(keys))[index]
        plain = _plain_markdown(variant)
        lower = plain.lower()
        suffix = key.rsplit(".", 1)[-1]

        if key.startswith("dec.sigma.") and maximum:
            return maxima[f"dec.delta.{suffix}"] // 2
        if key == "gate.eps" and maximum:
            return maxima["gate.p_max"] // 2
        if key.startswith("gate.v_min."):
            decision = defaults[f"dec.v_min.{suffix}"]
            return decision // 2 if maximum else decision // 20
        if key.startswith(("welfare.thS_", "welfare.thC_")) and not maximum:
            low_key = key[:-2] + "lo"
            return defaults[low_key]
        if key == "dis.merit_min" and not maximum:
            return defaults["orc.bond_floor"]
        if key == "keeper.rebate" and ("×" in plain or "x" in lower):
            amount, number_suffix = _last_number(plain)
            return _to_raw(amount, number_suffix, kind, row[2], scales)
        if key == "res.probe_amount" and not maximum and "µUSDC" in plain:
            amount, _ = _first_number(plain)
            return int(amount)
        if lower.startswith("= default"):
            return defaults[key]
        if not maximum and (plain == "—" or lower.startswith("budget-capped")):
            return 0
        if maximum and (
            plain == "—"
            or lower.startswith("none")
            or lower.startswith("raised only")
            or lower.startswith("as above")
        ):
            return _type_endpoint(kind, True, scales)
        if maximum and lower.startswith("amendable down only"):
            return defaults[key]
        factor_match = re.match(r"×(\d+(?:\.\d+)?)", plain)
        if factor_match is not None:
            value = Decimal(defaults[key]) * Decimal(factor_match.group(1))
            integral = value.to_integral_value()
            if value != integral:
                raise AssertionError(f"non-integral relative bound for {key}")
            return int(integral)
        amount, number_suffix = _first_number(plain)
        return _to_raw(amount, number_suffix, kind, row[2], scales)

    records: dict[str, ParamRecord] = {}
    for keys, row in materialized:
        for index, key in enumerate(keys):
            minima[key] = parse_bound(key, keys, row, index, False)
            maxima[key] = parse_bound(key, keys, row, index, True)
            delta_cell = _plain_markdown(row[6])
            if delta_cell == "—":
                delta = None
            elif "×" in delta_cell:
                amount, _ = _first_number(delta_cell.replace("×", ""))
                delta = DeltaRule(DeltaKind.FACTOR, int(amount))
            elif "%" in delta_cell and "pp" not in delta_cell:
                amount, _ = _first_number(delta_cell)
                delta = DeltaRule(DeltaKind.PERCENT, int(amount))
            else:
                amount, number_suffix = _first_number(delta_cell)
                delta = DeltaRule(
                    DeltaKind.ABSOLUTE,
                    _to_raw(amount, number_suffix, kinds[key], row[2], scales),
                )
            cooldown_cell = _plain_markdown(row[7])
            cooldown = 0 if cooldown_cell == "—" else int(_first_number(cooldown_cell)[0])
            amendment_class = AmendmentClass(_plain_markdown(row[8]).split()[0])
            records[key] = ParamRecord(
                key=key,
                kind=kinds[key],
                unit=units[key],
                value=defaults[key],
                minimum=minima[key],
                maximum=maxima[key],
                max_delta=delta,
                cooldown_epochs=cooldown,
                amendment_class=amendment_class,
                kernel_bounded=key in kernel_bounded,
            )
    if set(records) != targets:
        raise AssertionError(
            f"doc 13 parser coverage mismatch: missing={sorted(targets - set(records))}, "
            f"extra={sorted(set(records) - targets)}"
        )
    return dict(sorted(records.items()))


def _record_mismatches(
    expected: dict[str, ParamRecord],
    observed: dict[str, ParamRecord],
) -> tuple[str, ...]:
    findings: list[str] = []
    for key in sorted(set(expected) | set(observed)):
        if key not in expected or key not in observed:
            findings.append(f"{key}: missing record")
            continue
        for field in fields(ParamRecord):
            wanted = getattr(expected[key], field.name)
            actual = getattr(observed[key], field.name)
            if wanted != actual:
                findings.append(
                    f"{key}.{field.name}: doc={wanted!r}, model={actual!r}"
                )
    return tuple(findings)


def _classified_entries() -> list[dict[str, object]]:
    """Parse the tiny registry.toml subset with Python 3.10's stdlib."""
    entries: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    source = (ROOT / "tools/limit-coverage/registry.toml").read_text(
        encoding="utf-8"
    )
    for raw in source.splitlines():
        line = raw.strip()
        if line == "[[entry]]":
            if current is not None:
                entries.append(current)
            current = {}
            continue
        if current is None:
            continue
        key = re.fullmatch(r'key = "([^"]+)"', line)
        if key:
            current["key"] = key.group(1)
        elif line == "genesis = true":
            current["genesis"] = True
        elif line == "genesis = false":
            current["genesis"] = False
    if current is not None:
        entries.append(current)
    return entries


def _coupling(name: str):
    return next(coupling for coupling in COUPLINGS if coupling.name == name)


class RegistryGroundingTests(unittest.TestCase):
    """The executable table must not drift from either repository artifact."""

    def test_every_record_field_matches_doc_13_section_1(self):
        """Parse the normative table independently, including raw-unit conversion."""
        documented = _parse_doc13_records()
        self.assertEqual(_record_mismatches(documented, REGISTRY), ())

    def test_valid_but_wrong_record_value_is_detected(self):
        """Mutation witness: a valid orc.rounds=4 must still fail grounding."""
        documented = _parse_doc13_records()
        mutant = dict(REGISTRY)
        mutant["orc.rounds"] = replace(mutant["orc.rounds"], value=4)
        self.assertEqual(
            _record_mismatches(documented, mutant),
            ("orc.rounds.value: doc=3, model=4",),
        )

    def test_seeded_key_bytes_match_both_checked_in_artifacts(self):
        json_keys = json.loads(
            (ROOT / "tools/limit-coverage/genesis-keys.json").read_text(
                encoding="utf-8"
            )
        )
        entries = _classified_entries()
        classified_genesis = [
            entry["key"] for entry in entries if entry.get("genesis") is True
        ]

        model_bytes = {param_key_bytes(key) for key in REGISTRY}
        json_bytes = {param_key_bytes(key) for key in json_keys}
        classified_bytes = {param_key_bytes(key) for key in classified_genesis}
        # 194 at S7-S11; +5 with D-20's `svc.*` keys, +1 with N4's `MaxClients`,
        # +4 with N6's external-book structural envelopes, and +1 with N7's
        # `MaxServiceAttestors`. Three D-20 values (`svc.max_live`,
        # `svc.max_window`, and `svc.epsilon_min`) are genesis-seeded; the other
        # eight additions are not. These counters are the tripwire that makes
        # every registry addition explicit.
        self.assertEqual(len(entries), 205)
        self.assertEqual(len(json_keys), 110)
        self.assertEqual(len(classified_genesis), 110)
        self.assertEqual(len(model_bytes), 110)
        self.assertEqual(model_bytes, json_bytes)
        self.assertEqual(model_bytes, classified_bytes)

    def test_every_record_is_typed_bounded_and_canonically_encodable(self):
        self.assertEqual(
            {key for key, record in REGISTRY.items() if record.kernel_bounded},
            set(KERNEL_BOUNDED_KEYS),
        )
        for key, record in REGISTRY.items():
            with self.subTest(key=key):
                self.assertEqual(len(param_key_bytes(key)), 16)
                self.assertLessEqual(record.minimum, record.value)
                self.assertLessEqual(record.value, record.maximum)
                low, high = record.admissible_interval()
                self.assertLessEqual(record.minimum, low)
                self.assertLessEqual(low, record.value)
                self.assertLessEqual(record.value, high)
                self.assertLessEqual(high, record.maximum)

    def test_max_delta_rounding_is_exact_and_asymmetric_where_specified(self):
        window = REGISTRY["dec.window"]
        self.assertEqual(window.max_delta.kind, DeltaKind.PERCENT)
        self.assertEqual(window.admissible_interval(), (34_560, 51_840))

        prize = replace(
            REGISTRY["sec.prize.meta"],
            value=3,
            minimum=0,
            maximum=100,
        )
        self.assertEqual(prize.max_delta.kind, DeltaKind.FACTOR)
        # 02 §4: the factor lower edge is ceil(3/2), not floor(3/2).
        self.assertEqual(prize.admissible_interval(), (2, 6))

        p_max = REGISTRY["gate.p_max"]
        self.assertEqual(p_max.admissible_interval(), (40_000_000, 60_000_000))

    def test_missing_numeric_floor_resolves_only_to_the_stored_type_floor(self):
        p_max = REGISTRY["gate.p_max"]
        self.assertEqual(p_max.value, 50_000_000)
        self.assertEqual(p_max.minimum, 0)
        self.assertEqual(p_max.maximum, 100_000_000)
        self.assertEqual(p_max.cooldown_epochs, 4)
        self.assertEqual(p_max.amendment_class, AmendmentClass.META_VALUES)


class CouplingTests(unittest.TestCase):
    """13 rule 7's relations, searched over record-admissible amendments."""

    def test_every_coupling_holds_at_the_seeded_registry(self):
        values = {key: record.value for key, record in REGISTRY.items()}
        for coupling in COUPLINGS:
            with self.subTest(coupling=coupling.name):
                self.assertTrue(coupling.holds(values))

    def test_sq_547_required_consumer_checks_are_absent(self):
        """SQ-547. Derived: five rule-7 consumer checks are absent in Rust.

        Rule 7 itself is complete: it designates the consuming engine.  This
        finding is implementation non-conformance, while welfare.wP+wA is the
        conforming consumer-validated control.
        """
        findings = {
            finding.coupling.name: finding
            for finding in check_coupling_conformance()
            if finding.issue == "required consumer check absent"
        }
        self.assertEqual(
            set(findings),
            {
                "dec-sigma-param",
                "dec-sigma-trs",
                "dec-sigma-code",
                "dec-sigma-meta",
                "gate-epsilon",
            },
        )
        for finding in findings.values():
            with self.subTest(coupling=finding.coupling.name):
                self.assertTrue(finding.breakable_in_one)
                self.assertIs(
                    finding.coupling.normative_binding_site,
                    BindingSite.CONSUMING_ENGINE,
                )
                self.assertIs(
                    finding.coupling.observed_consumer_check,
                    ObservedConsumerCheck.ABSENT,
                )

        welfare = next(
            finding
            for finding in coupling_findings()
            if finding.coupling.name == "welfare-weights"
        )
        self.assertTrue(welfare.ok)
        self.assertIs(
            welfare.coupling.observed_consumer_check,
            ObservedConsumerCheck.CONFORMING,
        )

    def test_boundary_screened_pairs_are_positive_controls(self):
        controls = {
            coupling.name
            for coupling in COUPLINGS
            if coupling.normative_binding_site is BindingSite.BOUNDARY_SCREENED
        }
        self.assertEqual(
            controls,
            {
                "gate-v-min-param",
                "gate-v-min-trs",
                "gate-v-min-code",
                "gate-v-min-meta",
                "redemption-fee",
            },
        )
        for name in controls:
            with self.subTest(coupling=name):
                coupling = _coupling(name)
                self.assertIsNotNone(min_breaking_sequence(coupling))
                self.assertIs(
                    coupling.observed_consumer_check,
                    ObservedConsumerCheck.NOT_APPLICABLE,
                )
        self.assertEqual(
            min_breaking_sequence(_coupling("redemption-fee")).steps,
            1,
        )

    def test_unstated_cap_and_probe_orderings_are_not_modelled_as_spec_claims(self):
        self.assertTrue(
            {
                "treasury-proposal-30d",
                "treasury-30d-180d",
                "reserve-timeout-interval",
            }.isdisjoint(coupling.name for coupling in COUPLINGS)
        )

    def test_sq_548_rust_consumers_disagree_at_valid_equality(self):
        """SQ-548. Derived: Rust's two guards disagree where trailing=window."""
        coupling = _coupling("decision-trailing-window")
        equality = {key: record.value for key, record in REGISTRY.items()}
        equality["dec.window"] = equality["dec.trailing"]
        self.assertTrue(coupling.holds(equality))
        self.assertEqual(
            disables_class("dec.window", equality["dec.window"], equality),
            frozenset(),
        )
        finding = next(
            finding
            for finding in check_coupling_conformance()
            if finding.coupling is coupling
        )
        self.assertEqual(
            finding.issue,
            "consumer checks disagree with the normative predicate",
        )
        self.assertIs(
            coupling.observed_consumer_check,
            ObservedConsumerCheck.INCONSISTENT,
        )

    def test_consumer_errors_have_computed_shortest_paths(self):
        welfare = min_breaking_sequence(_coupling("welfare-weights"))
        survival = min_breaking_sequence(_coupling("survival-knees"))
        security = min_breaking_sequence(_coupling("security-knees"))
        self.assertEqual((welfare.steps, welfare.elapsed_epochs), (1, 4))
        self.assertEqual((survival.steps, survival.elapsed_epochs), (8, 16))
        self.assertEqual((security.steps, security.elapsed_epochs), (10, 20))


class AmendmentGraphTests(unittest.TestCase):
    """Shortest paths through the joint max-delta/cooldown graph."""

    def test_sq_548_trailing_can_exceed_the_decision_window(self):
        """SQ-548. 04 §7 and 05 §3.1 require trailing-window containment.

        The published ranges admit a three-amendment/four-epoch path to
        `trailing > window`.  The test quantifies the ranges and path; it does
        not pin one faulty table cell to another.
        """
        coupling = _coupling("decision-trailing-window")
        breach = min_breaking_sequence(coupling)
        self.assertEqual((breach.steps, breach.elapsed_epochs), (3, 4))
        final = dict(breach.final_values)
        self.assertGreater(final["dec.trailing"], final["dec.window"])
        self.assertFalse(coupling.holds(final))

    def test_window_floor_path_reproduces_percent_rounding(self):
        path = path_to_value("dec.window", REGISTRY["dec.window"].minimum)
        self.assertEqual(
            [amendment.after for amendment in path],
            [34_560, 27_648, 22_119, 17_696, 14_400],
        )
        self.assertEqual(path[-1].epoch, 10)
        for amendment in path:
            self.assertTrue(
                REGISTRY["dec.window"].step_admissible(
                    amendment.before,
                    amendment.after,
                )
            )

    def test_trade_phase_relation_is_safe_over_the_full_registry_box(self):
        self.assertIsNone(
            min_breaking_sequence(_coupling("decision-window-trade-phase"))
        )


class SelfSealingTests(unittest.TestCase):
    """A class must retain a route to amend the key which disables it."""

    def test_sq_546_reachable_corners_disable_their_own_repair(self):
        """SQ-546. 13's rationale protects only the loosening direction.

        The graph finds two tightening/oversizing corners whose disabled set
        contains the proposal class which owns repair.  Pinning the exact set
        is a registry/consumer change detector, not a claim about predicates
        which the model has not encoded.
        """
        corners = {corner.key: corner for corner in self_sealing_corners()}
        self.assertEqual(
            set(corners),
            {"gate.p_max", "sec.prize.meta"},
        )
        expected = {
            "gate.p_max": (0, 5, 20, "down"),
            "sec.prize.meta": (1_200_000 * 1_000_000, 1, 2, "up"),
        }
        for key, (value, steps, epochs, direction) in expected.items():
            with self.subTest(key=key):
                corner = corners[key]
                self.assertEqual(
                    (
                        corner.value,
                        len(corner.amendments),
                        corner.elapsed_epochs,
                        corner.unsafe_direction,
                    ),
                    (value, steps, epochs, direction),
                )
                self.assertIn(corner.repair_class, corner.disabled_classes)
                self.assertFalse(corner.ok)
                self.assertTrue(
                    replace(corner, disabled_classes=frozenset()).ok
                )

    def test_zero_p_max_has_no_finite_price_escape_on_the_recorded_grid(self):
        # A full default decision window contains 4,320 observation intervals.
        # Even the widest exact inward-rounded lower bound is one raw unit;
        # once there, every later positive interval remains at one, never zero.
        self.assertEqual(
            lower_slew_bound_1e9(500_000_000, 5_000_000, 4_320),
            1,
        )
        self.assertEqual(lower_slew_bound_1e9(1, 5_000_000, 4_320), 1)
        self.assertGreater(1, REGISTRY["gate.p_max"].minimum)
        self.assertEqual(disables_class("gate.p_max", 0), MARKET_BEARING)

    def test_meta_security_prize_outgrows_the_floor_nav_seed_budget(self):
        self.assertEqual(
            CLASS_NAV_FLOORS_USDC,
            {
                ProposalClass.PARAM: Decimal("4620989"),
                ProposalClass.TREASURY: Decimal("7393600"),
                ProposalClass.CODE: Decimal("13862944"),
                ProposalClass.META: Decimal("21256533"),
            },
        )
        ceiling = ATTACK_COST_CEILINGS[ProposalClass.META]
        self.assertEqual(ceiling.minimum_viable_nav, Decimal("21256533"))
        self.assertEqual(ceiling.max_seedable_prize, Decimal("669315.422810"))
        self.assertEqual(ceiling.attack_cost, Decimal("5007949.427282"))
        self.assertLess(Decimal(600_000), ceiling.max_seedable_prize)
        self.assertGreater(Decimal(1_200_000), ceiling.max_seedable_prize)
        # At cap-saturating organic depth step 9 itself could clear 1.2M; the
        # tighter failure is earlier, because Ask-scaled b cannot reach Seed.
        self.assertLessEqual(Decimal(3) * Decimal(1_200_000), ceiling.attack_cost)
        self.assertEqual(
            disables_class("sec.prize.meta", 1_200_000 * 1_000_000),
            frozenset({ProposalClass.META}),
        )

    def test_constitutional_repair_is_not_misreported_as_market_disabled(self):
        # One welfare-weight amendment invalidates every market consumer, but
        # its CONST repair projects to market-less Constitutional governance.
        disabled = disables_class("welfare.wP", 650_000_000)
        self.assertEqual(disabled, MARKET_BEARING)
        self.assertNotIn(ProposalClass.CONSTITUTIONAL, disabled)


class PostAmendmentReverificationTests(unittest.TestCase):
    """07 §8 first-arm resource checks versus later live Params changes."""

    def test_every_first_arm_only_resource_input_is_reported(self):
        findings = post_amendment_reverification()
        self.assertEqual(
            {finding.key for finding in findings},
            {
                "ops.probe_fee",
                "ops.probe_rate",
                "res.fail_thr",
                "res.probe_amount",
                "res.recover_thr",
            },
        )
        for finding in findings:
            with self.subTest(key=finding.key):
                self.assertFalse(finding.ok)
                self.assertTrue(
                    REGISTRY[finding.key].step_admissible(
                        finding.before,
                        finding.reachable_after_one,
                    )
                )

    def test_one_step_runway_increases_are_derived_in_micro_usdc(self):
        findings = {
            finding.key: finding for finding in post_amendment_reverification()
        }
        self.assertEqual(reserve_probe_runway(), 12_500_000)
        self.assertEqual(findings["ops.probe_fee"].requirement_after, 25_000_000)
        self.assertEqual(findings["ops.probe_rate"].requirement_after, 25_000_000)
        self.assertEqual(findings["res.fail_thr"].requirement_after, 645_000_000)
        self.assertEqual(
            findings["res.recover_thr"].requirement_after,
            642_500_000,
        )
        self.assertEqual(
            findings["res.probe_amount"].reachable_after_one,
            U128_MAX,
        )


class KernelHygieneTests(unittest.TestCase):
    """13 §2 symbols must be live in code or projected through metadata."""

    @classmethod
    def setUpClass(cls):
        cls.findings = kernel_hygiene(ROOT)

    def test_every_modelled_kernel_symbol_resolves_to_a_declaration(self):
        self.assertTrue(self.findings)
        self.assertEqual(
            [finding.constant.symbol for finding in self.findings if not finding.declared],
            [],
        )

    def test_quote_clamps_are_the_only_consumption_or_projection_orphans(self):
        orphans = kernel_orphans(ROOT)
        self.assertEqual(
            {finding.constant.symbol for finding in orphans},
            {"QUOTE_CLAMP_MIN_1E9", "QUOTE_CLAMP_MAX_1E9"},
        )
        for finding in orphans:
            self.assertFalse(finding.consumed)
            self.assertFalse(finding.projected)
            self.assertFalse(finding.ok)

    def test_lmsr_domain_bound_is_consumed_even_though_its_quote_clamps_are_not(self):
        domain = next(
            finding
            for finding in self.findings
            if finding.constant.symbol == "LMSR_DOMAIN_BOUND"
        )
        self.assertTrue(domain.consumed)
        self.assertTrue(domain.ok)

    def test_production_scan_prunes_excluded_directories_before_descent(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = (
                "src/live.rs",
                "target/transient.rs",
                ".git/internal.rs",
                ".claude/worktrees/copy/src/duplicate.rs",
                "tests/fixture.rs",
                "benches/fixture.rs",
                "src/tests.rs",
                "src/mock.rs",
                "src/benchmarking.rs",
            )
            for relative in paths:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("pub const SAMPLE: u8 = 1;\n", encoding="utf-8")
            with mock.patch.object(
                Path,
                "rglob",
                side_effect=AssertionError("rglob must not traverse excluded trees"),
            ):
                found = tuple(_production_rust_files(root))
        self.assertEqual(
            tuple(path.relative_to(root).as_posix() for path in found),
            ("src/live.rs",),
        )


if __name__ == "__main__":
    unittest.main()
