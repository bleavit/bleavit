#!/usr/bin/env python3
"""Deterministic transcript normalization helpers."""

from __future__ import annotations

import copy
import json
from typing import Any


class TranscriptNormalizer:
    """Replace server-chosen identifiers while retaining explicit block hashes."""

    def __init__(self) -> None:
        self.subscription_ids: dict[str, str] = {}
        self.operation_ids: dict[str, str] = {}
        self.request_ids: dict[int, int] = {}

    @staticmethod
    def _stable(mapping: dict[str, str], raw: str, label: str) -> str:
        if raw not in mapping:
            mapping[raw] = f"{label}-{len(mapping) + 1}"
        return mapping[raw]

    def normalize(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self.normalize(item) for item in value]
        if isinstance(value, dict):
            output: dict[str, Any] = {}
            # A JSON-RPC envelope's `id` is a *client-chosen* request counter that runs
            # across the whole recording session, so the same call recorded while
            # gathering two different surfaces carries two different ids. Left raw it
            # defeats the determinism this module exists to provide twice over: the
            # bytes depend on the order surfaces were recorded in, and two fixtures for
            # one underlying call disagree — which a replaying consumer can only read as
            # a conflict. Renumber per transcript, exactly as subscription and operation
            # ids already are. (Found by the mock-runtime replay suite, F2.)
            is_envelope = "jsonrpc" in value
            for key in sorted(value):
                item = value[key]
                if key == "id" and is_envelope and isinstance(item, int):
                    if item not in self.request_ids:
                        self.request_ids[item] = len(self.request_ids) + 1
                    output[key] = self.request_ids[item]
                elif key in ("subscription", "followSubscription") and isinstance(
                    item, str
                ):
                    output[key] = self._stable(
                        self.subscription_ids, item, "subscription"
                    )
                elif key == "operationId" and isinstance(item, str):
                    output[key] = self._stable(self.operation_ids, item, "operation")
                elif key in ("timestamp", "receivedAt", "recordedAt"):
                    continue
                else:
                    output[key] = self.normalize(item)
            return output
        return copy.deepcopy(value)


def normalized_transcript(
    surface: str,
    block_hash: str | None,
    requests: list[dict[str, Any]],
) -> dict[str, Any]:
    normalizer = TranscriptNormalizer()
    normalized_requests: list[dict[str, Any]] = []
    for request in requests:
        normalized = normalizer.normalize(request)
        params = normalized.get("params") if isinstance(normalized, dict) else None
        raw_params = request.get("params") if isinstance(request, dict) else None
        if (
            isinstance(normalized, dict)
            and str(request.get("method", "")).startswith("chainHead_v1_")
            and isinstance(params, list)
            and params
            and isinstance(raw_params, list)
            and isinstance(raw_params[0], str)
        ):
            params[0] = normalizer._stable(
                normalizer.subscription_ids, raw_params[0], "subscription"
            )
        normalized_requests.append(normalized)
    transcript: dict[str, Any] = {
        "surface": surface,
        "requests": normalized_requests,
    }
    if block_hash is not None:
        # The concrete hash remains visible and is named once so fixture consumers
        # can substitute their own pinned block without searching response bodies.
        transcript["headers"] = {"pinned_block": block_hash}
    return transcript


def deterministic_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
