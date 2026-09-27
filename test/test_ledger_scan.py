import json
import os
import tempfile
import time
import unittest
import urllib.parse

from ledger_scan import LedgerScan


class FakeLedger:
    """Storage API double: paged metadata listing plus versioned record reads."""

    def __init__(self, records):
        self.records = {}
        self.reads = []
        self.tick = 0
        for name, record in records.items():
            self.put(name, record)

    def put(self, name, record):
        self.tick += 1
        body = json.dumps(record)
        self.records[name] = {
            "body": body,
            "modified_at": "2026-09-27T00:00:%02d.000000Z" % self.tick,
            "etag": '"v%d"' % self.tick,
        }

    def call(self, method, path, body=None, headers=None):
        assert method == "GET"
        parsed = urllib.parse.urlparse(path)
        if parsed.path.startswith("/api/storage/apps-list/"):
            entries = []
            for name, value in sorted(self.records.items()):
                entries.append({
                    "name": name, "type": "file",
                    "size": len(value["body"]),
                    "modified_at": value["modified_at"],
                })
                entries.append({"name": name[:-5] + ".diff", "type": "file",
                                "size": 10, "modified_at": "x"})
            return json.dumps({"entries": entries, "next_cursor": None}).encode(), {}
        name = parsed.path.rsplit("/", 1)[1]
        self.reads.append(name)
        assert headers == {"x-mobius-version": "1"}
        value = self.records[name]
        return value["body"].encode(), {"ETag": value["etag"]}


def scan(ledger, state_dir):
    result = LedgerScan(ledger.call, "80", state_dir)
    work = result.records_needing_work()
    return result, {name: (record["status"], version) for name, record, version in work}


class LedgerScanTests(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        self.ledger = FakeLedger({
            "settled.json": {"id": "settled", "status": "merged"},
            "open.json": {"id": "open", "status": "open", "type": "pr"},
            "prepared.json": {"id": "prepared", "status": "prepared", "type": "pr"},
            "connect.json": {
                "id": "connect", "status": "merged",
                "plan": {"after_merge": {"action": "connect_app"}},
            },
        })

    def test_unchanged_settled_history_is_not_reread_on_the_next_pass(self):
        first, work = scan(self.ledger, self.state.name)
        first.save()
        self.assertEqual(set(work), {"open.json", "prepared.json", "connect.json"})
        self.ledger.reads.clear()

        _, work = scan(self.ledger, self.state.name)

        self.assertEqual(set(work), {"open.json", "prepared.json", "connect.json"})
        self.assertNotIn("settled.json", self.ledger.reads)

    def test_records_needing_work_carry_their_current_storage_version(self):
        scan(self.ledger, self.state.name)[0].save()
        self.ledger.put("open.json", {"id": "open", "status": "open", "type": "pr"})

        _, work = scan(self.ledger, self.state.name)

        self.assertEqual(work["open.json"][1], self.ledger.records["open.json"]["etag"])

    def test_a_changed_record_is_reread_and_reclassified(self):
        scan(self.ledger, self.state.name)[0].save()
        self.ledger.put("settled.json", {"id": "settled", "status": "open", "type": "pr"})

        _, work = scan(self.ledger, self.state.name)

        self.assertEqual(work["settled.json"][0], "open")

    def test_lost_state_costs_one_full_read_not_correctness(self):
        _, work = scan(self.ledger, None)
        self.assertEqual(set(work), {"open.json", "prepared.json", "connect.json"})
        self.assertIn("settled.json", self.ledger.reads)

    def test_refused_cleanup_waits_for_the_record_or_checkout_to_change(self):
        checkout = tempfile.mkdtemp(dir=self.state.name)
        self.ledger.put("closed.json", {
            "id": "closed", "status": "closed", "plan": {"repo_path": checkout},
        })
        first, work = scan(self.ledger, self.state.name)
        self.assertIn("closed.json", work)
        self.assertTrue(first.note_cleanup_refused("closed.json", checkout))
        self.assertFalse(first.note_cleanup_refused("closed.json", checkout))
        first.save()

        _, work = scan(self.ledger, self.state.name)
        self.assertNotIn("closed.json", work)

        later = time.time() + 5
        os.utime(checkout, (later, later))
        _, work = scan(self.ledger, self.state.name)
        self.assertIn("closed.json", work)

    def test_a_removed_checkout_leaves_nothing_to_clean(self):
        self.ledger.put("closed.json", {
            "id": "closed", "status": "closed",
            "plan": {"repo_path": os.path.join(self.state.name, "gone")},
        })
        _, work = scan(self.ledger, self.state.name)
        self.assertNotIn("closed.json", work)

    def test_an_idle_pass_does_not_rewrite_the_state_file(self):
        scan(self.ledger, self.state.name)[0].save()
        path = os.path.join(self.state.name, "ledger-scan.json")
        before = os.stat(path).st_mtime_ns
        time.sleep(0.01)

        again, _ = scan(self.ledger, self.state.name)
        again.save()

        self.assertEqual(os.stat(path).st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
