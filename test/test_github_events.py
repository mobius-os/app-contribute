import os
import unittest

from github_events import (
  attention_from_trusted_author, latest_events, review_events, trusted_changes_request,
)


def comment(at, association, login="someone", url=None):
  return {
    "url": url or "https://github.com/o/r/pull/1#issuecomment-%s" % at,
    "createdAt": at,
    "authorAssociation": association,
    "author": {"login": login},
  }


def review(at, association, state="COMMENTED", login="someone"):
  return {
    "url": "https://github.com/o/r/pull/1#pullrequestreview-%s" % at,
    "submittedAt": at,
    "state": state,
    "authorAssociation": association,
    "author": {"login": login},
  }


def pr(comments=(), reviews=()):
  return {
    "__typename": "PullRequest",
    "comments": {"nodes": list(comments)},
    "reviews": {"nodes": list(reviews)},
  }


class LatestEventsTest(unittest.TestCase):

  def test_a_strangers_comment_cannot_start_a_round(self):
    latest, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", "NONE", "drive-by")]))
    self.assertEqual(latest["author"], "drive-by")
    self.assertFalse(latest["trusted"])
    self.assertIsNone(trusted)

  def test_past_contributors_are_not_trusted(self):
    for association in ("CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN"):
      _, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", association)]))
      self.assertIsNone(trusted, association)

  def test_owner_member_and_collaborator_are_trusted(self):
    for association in ("OWNER", "MEMBER", "COLLABORATOR"):
      _, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", association)]))
      self.assertTrue(trusted and trusted["trusted"], association)

  def test_a_later_stranger_comment_does_not_hide_a_maintainer_review(self):
    node = pr(
      comments=[comment("2026-10-26T09:05:00Z", "NONE", "drive-by")],
      reviews=[review("2026-10-26T09:00:00Z", "MEMBER", login="maintainer")],
    )
    latest, trusted = latest_events(node)
    self.assertEqual(latest["author"], "drive-by")
    self.assertEqual(trusted["author"], "maintainer")
    self.assertEqual(trusted["kind"], "review")

  def test_the_platforms_own_replies_are_ignored(self):
    own = comment("2026-10-26T09:00:00Z", "OWNER", url="https://github.com/o/r/pull/1#own")
    self.assertEqual(latest_events(pr([own]), {own["url"]}), (None, None))

  def test_missing_association_is_untrusted(self):
    node = pr([{"url": "u", "createdAt": "2026-10-26T09:00:00Z", "author": None}])
    (event,) = review_events(node)
    self.assertFalse(event["trusted"])
    self.assertEqual(event["author"], "GitHub")


class TrustedChangesRequestTest(unittest.TestCase):

  def test_only_a_trusted_reviewer_requesting_changes_counts(self):
    stranger = review("2026-10-26T09:00:00Z", "NONE", "CHANGES_REQUESTED")
    self.assertIsNone(trusted_changes_request(pr(reviews=[stranger])))
    member = review("2026-10-26T08:00:00Z", "MEMBER", "CHANGES_REQUESTED", "maintainer")
    found = trusted_changes_request(pr(reviews=[stranger, member]))
    self.assertEqual(found["author"], "maintainer")

  def test_a_trusted_comment_review_is_not_a_change_request(self):
    self.assertIsNone(trusted_changes_request(pr(reviews=[review("2026-10-26T09:00:00Z", "OWNER")])))


class AttentionProvenanceTest(unittest.TestCase):

  def attention(self, kind, event):
    at = event.get("createdAt") or event.get("submittedAt")
    return {"type": kind, "key": "%s:%s" % (kind, at), "url": event["url"]}

  def test_pending_activity_must_name_a_trusted_event_on_the_thread(self):
    member = comment("2026-10-26T09:00:00Z", "MEMBER")
    stranger = comment("2026-10-26T09:05:00Z", "NONE")
    node = pr([member, stranger])
    self.assertTrue(attention_from_trusted_author(self.attention("github_activity", member), node))
    self.assertFalse(attention_from_trusted_author(self.attention("github_activity", stranger), node))
    # The event left the fetched window, or the key and URL disagree.
    self.assertFalse(attention_from_trusted_author(self.attention("github_activity", member), pr([stranger])))
    mixed = dict(self.attention("github_activity", member), url=stranger["url"])
    self.assertFalse(attention_from_trusted_author(mixed, node))
    # The platform's own replies never prove anything.
    self.assertFalse(attention_from_trusted_author(
      self.attention("github_activity", member), node, {member["url"]}))

  def test_requested_changes_must_name_a_trusted_change_request(self):
    request = review("2026-10-26T09:00:00Z", "MEMBER", "CHANGES_REQUESTED")
    remark = review("2026-10-26T09:01:00Z", "MEMBER")
    node = pr(reviews=[request, remark])
    self.assertTrue(attention_from_trusted_author(self.attention("changes_requested", request), node))
    self.assertFalse(attention_from_trusted_author(self.attention("changes_requested", remark), node))

  def test_only_author_attention_types_with_a_key_and_url_qualify(self):
    member = comment("2026-10-26T09:00:00Z", "MEMBER")
    node = pr([member])
    for attention in (
      None, {}, dict(self.attention("github_activity", member), url=""),
      dict(self.attention("github_activity", member), type="outside_activity"),
      dict(self.attention("github_activity", member), type="checks_failed"),
    ):
      self.assertFalse(attention_from_trusted_author(attention, node), attention)


class JobWiringTest(unittest.TestCase):

  def setUp(self):
    path = os.path.join(os.path.dirname(__file__), "..", "job.sh")
    with open(path) as handle:
      self.job = handle.read()

  def test_the_job_requests_author_association_and_uses_the_shared_classifier(self):
    self.assertIn("latest_events(node, ignore_urls=ignore_urls)", self.job)
    self.assertIn("comments(last: 10) { nodes { %(comment)s } }", self.job)
    self.assertIn("reviews(last: 10) { nodes { %(review)s } }", self.job)
    self.assertNotIn("def _latest_event", self.job)

  def test_outside_activity_is_never_routed_to_autopilot(self):
    actionable = self.job[self.job.index("ACTIONABLE_ATTENTION = frozenset(("):]
    actionable = actionable[:actionable.index("))")]
    self.assertNotIn("outside_activity", actionable)
    self.assertIn('"type": "outside_activity"', self.job)


if __name__ == "__main__":
  unittest.main()
