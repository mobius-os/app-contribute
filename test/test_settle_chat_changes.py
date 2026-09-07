import argparse
import io
import json
import os
import unittest
from unittest.mock import patch

import settle_chat_changes


class Response:
  def __init__(self, payload):
    self.payload = payload

  def __enter__(self):
    return io.BytesIO(json.dumps(self.payload).encode("utf-8"))

  def __exit__(self, *_args):
    return False


class SettleChatChangesTests(unittest.TestCase):
  def test_payload_deduplicates_paths_and_preserves_review_coverage(self):
    args = argparse.Namespace(
      through="1787872878923",
      disposition="experimental",
      summary="Reviewed scratch work",
      paths=["/data/platform/a.py", "/data/platform/a.py", "/data/apps/x/b.js"],
    )

    self.assertEqual(settle_chat_changes.build_payload(args), {
      "coverage_at": 1787872878923,
      "items": [
        {"path": "/data/platform/a.py", "disposition": "experimental", "summary": "Reviewed scratch work"},
        {"path": "/data/apps/x/b.js", "disposition": "experimental", "summary": "Reviewed scratch work"},
      ],
    })

  def test_payload_preserves_iso_review_coverage(self):
    args = argparse.Namespace(
      through="2026-08-28T11:45:00Z",
      disposition="local-only",
      summary="Reviewed local work",
      paths=["/data/apps/x/index.jsx"],
    )
    self.assertEqual(
      settle_chat_changes.build_payload(args)["coverage_at"],
      "2026-08-28T11:45:00Z",
    )

  def test_missing_runtime_context_fails_before_app_discovery(self):
    with patch.dict(os.environ, {}, clear=True), patch.object(
      settle_chat_changes, "installed_app_id"
    ) as discover:
      result = settle_chat_changes.main([
        "/data/platform/a.py", "--through", "1",
      ])

    self.assertEqual(result, 2)
    discover.assert_not_called()

  def test_installed_app_discovery_selects_contribute(self):
    apps = [{"id": 7, "slug": "notes"}, {"id": 80, "slug": "contribute"}]
    with patch.object(settle_chat_changes, "urlopen", return_value=Response(apps)) as request:
      self.assertEqual(settle_chat_changes.installed_app_id("http://mobius", "secret"), 80)

    sent = request.call_args.args[0]
    self.assertEqual(sent.full_url, "http://mobius/api/apps/")
    self.assertEqual(sent.headers["Authorization"], "Bearer secret")


if __name__ == "__main__":
  unittest.main()
