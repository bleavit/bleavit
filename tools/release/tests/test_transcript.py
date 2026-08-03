from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from transcript import normalized_transcript


class TranscriptNormalizerTests(unittest.TestCase):
    def test_server_ids_and_timestamps_do_not_affect_fixture(self) -> None:
        def sample(subscription: str, operation: str, timestamp: str):
            return [
                {
                    "method": "chainHead_v1_storage",
                    "params": [subscription, "0x" + "ab" * 32],
                    "response": {
                        "direct": {
                            "result": {"result": "started", "operationId": operation}
                        },
                        "events": [
                            {
                                "event": "operationStorageDone",
                                "operationId": operation,
                                "subscription": subscription,
                                "timestamp": timestamp,
                            }
                        ],
                    },
                }
            ]

        first = normalized_transcript(
            "storage.constitution.phase_flags",
            "0x" + "ab" * 32,
            sample("follow-91", "random-op-a", "2026-01-01T00:00:00Z"),
        )
        second = normalized_transcript(
            "storage.constitution.phase_flags",
            "0x" + "ab" * 32,
            sample("follow-7", "random-op-z", "2030-01-01T00:00:00Z"),
        )
        self.assertEqual(first, second)
        serialized = repr(first)
        self.assertIn("subscription-1", serialized)
        self.assertIn("operation-1", serialized)
        self.assertNotIn("timestamp", serialized)

    def test_jsonrpc_request_id_does_not_affect_fixture(self) -> None:
        """A client-chosen request counter must not reach the artifact.

        `id` runs across the whole recording session, so the *same* call recorded
        while gathering two different surfaces carried two different ids. That made
        the fixture bytes depend on the order surfaces were recorded in, and made two
        fixtures for one underlying call disagree — which a replaying consumer can
        only read as a conflict. Found by the F2 mock-runtime replay suite: 39
        `chainHead_v1_header` recordings of one block, 39 distinct responses.
        """

        def sample(request_id: int):
            return [
                {
                    "method": "chainHead_v1_header",
                    "params": ["follow-1", "0x" + "cd" * 32],
                    "response": {
                        "direct": {
                            "id": request_id,
                            "jsonrpc": "2.0",
                            "result": "0x" + "ef" * 8,
                        }
                    },
                }
            ]

        early = normalized_transcript("constant.epoch.recent_cohorts", None, sample(7))
        late = normalized_transcript("constant.epoch.recent_cohorts", None, sample(203))
        self.assertEqual(early, late)
        self.assertEqual(early["requests"][0]["response"]["direct"]["id"], 1)

    def test_a_bare_id_field_is_left_alone(self) -> None:
        """Only the JSON-RPC envelope's `id` is renumbered.

        Chain data legitimately contains `id` fields (a proposal id, an operation's
        own identifier). Rewriting those would corrupt the recording, so the rewrite
        is conditioned on the sibling `jsonrpc` key rather than on the name.
        """
        transcript = normalized_transcript(
            "api.proposal_summaries",
            None,
            [
                {
                    "method": "metadata_presence",
                    "params": {"kind": "runtime_api", "surface": "api.x"},
                    "response": {"present": True, "id": 4242},
                }
            ],
        )
        self.assertEqual(transcript["requests"][0]["response"]["id"], 4242)


if __name__ == "__main__":
    unittest.main()

