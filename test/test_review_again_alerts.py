import json
import os
import tempfile
import unittest

import review_again_alerts
from review_again_alerts import Alerts, notification, read_github, stale_change_requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
OLD, NEW, NEWER = "a" * 40, "b" * 40, "c" * 40


def pull(number=7, head=NEW, state="CHANGES_REQUESTED", reviewed=OLD, reviewer="me", repo="Team/Repo",
         review_page=None):
    return {"number": number, "title": "Fix the thing", "headRefOid": head,
            "repository": {"nameWithOwner": repo}, "author": {"login": "maker"},
            "latestOpinionatedReviews": {"pageInfo": review_page or {"hasNextPage": False}, "nodes": [
                {"state": "APPROVED", "author": {"login": "someone"}, "commit": {"oid": head}},
                {"state": state, "author": {"login": reviewer}, "commit": {"oid": reviewed}}]}}


def github(*pulls, more=False):
    return {"viewer": {"login": "Me"},
            "search": {"pageInfo": {"hasNextPage": more}, "nodes": list(pulls)}}


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

    def test_a_head_hidden_by_a_short_search_window_is_not_announced_again_on_re_entry(self):
        self.run_pass(github())
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"])
        self.run_pass(github(more=True))  # #7 drops out of a truncated window
        self.assertEqual(self.run_pass(github(pull(7))).sent, [],
                         "the same head must not be announced again after re-entering the window")

    def test_a_pr_absent_from_a_complete_window_is_forgotten(self):
        self.run_pass(github())
        self.run_pass(github(pull(7)))
        self.run_pass(github())  # a complete window without #7: confirmed no longer waiting
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"],
                         "a PR gone from a full read is forgotten and announced afresh")

    def test_read_github_pages_reviews_until_the_owners_opinion_is_found(self):
        node = {"number": 7, "title": "Fix the thing", "headRefOid": NEW,
                "repository": {"nameWithOwner": "Team/Repo"}, "author": {"login": "maker"},
                "latestOpinionatedReviews": {"pageInfo": {"hasNextPage": True, "endCursor": "c1"},
                                             "nodes": [{"state": "APPROVED", "author": {"login": "someone"},
                                                        "commit": {"oid": NEW}}]}}
        first = {"viewer": {"login": "Me"}, "search": {"pageInfo": {"hasNextPage": False}, "nodes": [node]}}
        second = {"repository": {"pullRequest": {"latestOpinionatedReviews": {
            "pageInfo": {"hasNextPage": False, "endCursor": None},
            "nodes": [{"state": "CHANGES_REQUESTED", "author": {"login": "me"}, "commit": {"oid": OLD}}]}}}}
        calls = []

        def run(query, variables=None):
            calls.append((query, variables))
            return second if variables else first

        data = read_github(run=run)
        self.assertEqual([item["key"] for item in stale_change_requests(data)], ["team/repo#7"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1], {"owner": "Team", "name": "Repo", "number": 7, "after": "c1"})

    def test_read_github_stops_paging_reviews_when_the_connection_is_exhausted(self):
        node = {"number": 7, "title": "Fix the thing", "headRefOid": NEW,
                "repository": {"nameWithOwner": "Team/Repo"}, "author": {"login": "maker"},
                "latestOpinionatedReviews": {"pageInfo": {"hasNextPage": True, "endCursor": "c1"},
                                             "nodes": [{"state": "APPROVED", "author": {"login": "someone"},
                                                        "commit": {"oid": NEW}}]}}
        first = {"viewer": {"login": "Me"}, "search": {"pageInfo": {"hasNextPage": False}, "nodes": [node]}}
        last = {"repository": {"pullRequest": {"latestOpinionatedReviews": {
            "pageInfo": {"hasNextPage": False, "endCursor": None},
            "nodes": [{"state": "APPROVED", "author": {"login": "other"}, "commit": {"oid": NEW}}]}}}}
        calls = []

        def run(query, variables=None):
            calls.append(variables)
            return last if variables else first

        data = read_github(run=run)
        self.assertEqual(stale_change_requests(data), [], "no owner opinion means nothing to announce")
        self.assertEqual(len(calls), 2, "paging halts once the connection ends")

    def test_a_review_page_that_fails_to_load_keeps_the_saved_head_until_the_read_recovers(self):
        made = pull(7, review_page={"hasNextPage": True, "endCursor": "c1"})
        made["latestOpinionatedReviews"]["nodes"] = made["latestOpinionatedReviews"]["nodes"][:1]
        first = github(made)

        def read(second):
            fresh = json.loads(json.dumps(first))
            return read_github(run=lambda query, variables=None: second if variables else fresh)

        self.run_pass(github())
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"])
        # The owner's review sits on page two, and that request fails (None is a timeout or a GitHub error).
        self.assertEqual(self.run_pass(read(None)).sent, [])
        self.assertEqual(self.run_pass(read({"repository": {"pullRequest": None}})).sent, [])
        # Recovered: the owner's unchanged change request on the same head must not be announced again.
        self.assertEqual(self.run_pass(github(pull(7))).sent, [])
        with open(os.path.join(self.dir.name, review_again_alerts.STATE_FILE), encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["heads"], {"team/repo#7": NEW})

    def test_a_pr_whose_reviews_loaded_fully_without_the_owner_is_still_forgotten(self):
        self.run_pass(github())
        self.run_pass(github(pull(7)))
        self.run_pass(github(pull(7, reviewer="someone-else")))
        self.assertEqual(self.run_pass(github(pull(7))).sent, ["team/repo#7"])

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
