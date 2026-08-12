from __future__ import annotations

import unittest
import urllib.error
from types import SimpleNamespace
from unittest import mock

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import attestation_monitor as am
from common import MetricStore


class WebhookRedactionTests(unittest.TestCase):
    def test_failure_log_never_contains_secret_bearing_url_or_exception_text(self) -> None:
        secret = "super-secret-webhook-token"
        url = f"https://user:{secret}@paging.invalid/hook/{secret}?token={secret}"
        config = SimpleNamespace(webhooks={"paging": (url,)})
        store = MetricStore(am.SERIES)
        failure = urllib.error.URLError(f"transport failed for {url}")
        with mock.patch.object(am.urllib.request, "urlopen", side_effect=failure):
            with self.assertLogs("bleavit-attestation-monitor", level="ERROR") as logs:
                am.post_webhooks(config, {"alert": "fixture"}, store)
        rendered = "\n".join(logs.output)
        self.assertNotIn(secret, rendered)
        self.assertNotIn("paging.invalid", rendered)
        self.assertIn("paging webhook delivery failed: transport str", rendered)
        self.assertIn(
            "bleavit_release_monitor_webhook_failures_total 1", store.render()
        )

    def test_even_monitoring_error_text_is_redacted(self) -> None:
        secret = "another-secret-webhook-token"
        config = SimpleNamespace(
            webhooks={"community": (f"https://community.invalid/{secret}",)}
        )
        store = MetricStore(am.SERIES)
        failure = am.MonitoringError(f"failed at https://community.invalid/{secret}")
        with mock.patch.object(am.urllib.request, "urlopen", side_effect=failure):
            with self.assertLogs("bleavit-attestation-monitor", level="ERROR") as logs:
                am.post_webhooks(config, {"alert": "fixture"}, store)
        rendered = "\n".join(logs.output)
        self.assertNotIn(secret, rendered)
        self.assertNotIn("community.invalid", rendered)
        self.assertIn("community webhook delivery failed: MonitoringError", rendered)


if __name__ == "__main__":
    unittest.main()
