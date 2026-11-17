import json
import os
import tempfile
import unittest

import review_again_alerts
from review_again_alerts import Alerts, notification, stale_change_requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
OLD, NEW, NEWER = "a" * 40, "b" * 40, "c" * 40


def pull(number=7, head=NEW, state="CHANGES_REQUESTED", reviewed=OLD, reviewer="me", repo="Team/Repo"):
    return {"number": number, "title": "Fix the thing", "headRefOid": head,
            "repository": {"nameWithOwner": repo}, "author": {"login": "maker"},
            "latestOpinionatedReviews": {"nodes": [
                {"state": "APPROVED", "author": {"login": "someone"}, "commit": {"oid": head}},
                {"state": state, "author": {"login": reviewer}, "commit": {"oid": reviewed}}]}}


def github(*pulls):
    return {"viewer": {"login": "Me"}, "search": {"nodes": list(pulls)}}


class Platform:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def __call__(self, method, path, body=None, **_):
        if self.fail:
            raise OSError("offline")
        self.sent.append((method, path, body))


class ReviewAgainAlertsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.platform = Platform()

    def run_pass(self, data, platform=None, state_dir="default"):
        alerts = Alerts(platform or self.platform, "10", self.dir.name if state_dir == "default" else state_dir,
                        read=lambda: data)
        alerts.run()
        return alerts

    def test_only_the_owners_own_change_request_on_an_older_commit_counts(self):
        data = github(pull(1), pull(2, reviewed=NEW), pull(3, state="APPROVED"), pull(4, reviewer="someone-else"),
                      pull(5, state="COMMENTED"))
        self.assertEqual([item["key"] for item in stale_change_requests(data)], ["team/repo#1"])

    def test_the_first_pass_records_the_backlog_without_announcing_it(self):
        self.assertEqual(self.run_pass(github(pull(1), pull(2))).sent, [])
        self.assertEqual(self.platform.sent, [])

    def test_a_push_after_the_change_request_is_announced_once_per_new_head(self):
        self.run_pass(github())
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"])
        self.assertEqual(self.run_pass(github(pull(7))).sent, [], "the same head is never announced twice")
        self.assertEqual(self.run_pass(github(pull(7, head=NEWER))).sent, ["team/repo#7"], "a later push is new")
        method, path, body = self.platform.sent[0]
        self.assertEqual((method, path), ("POST", "/api/notifications/send"))
        self.assertEqual(body["target"], "/shell/?app=10&intent=pr:Team:Repo:7")
        self.assertEqual(body["tag"], "pr:Team:Repo:7")
        self.assertIn("maker pushed new commits to #7 Fix the thing since you asked for changes", body["body"])

    def test_a_notification_that_could_not_be_sent_is_tried_again_next_pass(self):
        self.run_pass(github())
        self.assertEqual(self.run_pass(github(pull(7)), platform=Platform(fail=True)).sent, [])
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"])

    def test_an_unreadable_github_changes_nothing_and_announces_nothing(self):
        self.run_pass(github())
        self.run_pass(github(pull(7)))
        self.run_pass(None)
        self.assertEqual(self.run_pass(github(pull(7))).sent, [], "the saved head survived the failed read")

    def test_without_a_state_directory_nothing_is_sent_because_repeats_could_not_be_prevented(self):
        self.assertEqual(self.run_pass(github(pull(7)), state_dir=None).sent, [])
        self.assertEqual(self.platform.sent, [])

    def test_lost_or_damaged_state_starts_quietly_again(self):
        self.run_pass(github())
        with open(os.path.join(self.dir.name, review_again_alerts.STATE_FILE), "w", encoding="utf-8") as handle:
            handle.write("{not json")
        self.assertEqual(self.run_pass(github(pull(7))).sent, [])

    def test_a_pr_that_is_no_longer_waiting_is_forgotten(self):
        self.run_pass(github())
        self.run_pass(github(pull(7)))
        self.run_pass(github(pull(7, reviewed=NEW)))
        with open(os.path.join(self.dir.name, review_again_alerts.STATE_FILE), encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["heads"], {})

    def test_an_overlong_link_falls_back_to_the_app(self):
        sent = notification("10", {"repo": "o" * 90 + "/" + "r" * 90, "number": 7, "title": "", "author": "maker"})
        self.assertEqual(sent["target"], "/shell/?app=10")
        self.assertNotIn("tag", sent)

    def test_the_job_runs_this_pass_before_it_can_exit_for_an_empty_ledger(self):
        with open(os.path.join(ROOT, "job.sh"), encoding="utf-8") as handle:
            job = handle.read()
        self.assertLess(job.index("review_again_alerts.Alerts("), job.index("records = LEDGER.records_needing_work()"))


if __name__ == "__main__":
    unittest.main()
