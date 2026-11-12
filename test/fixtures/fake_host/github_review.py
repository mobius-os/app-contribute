"""A fake Möbius core (SCRIPTS_DIR/github_review.py) for the gate on `post`. It knows the app and answers the Post helper's
`POST /api/owner-grants/consume`; FAKE_HOST_CONSUME says how ('refused': the owner has not confirmed, 403; 'missing': a Möbius without
the route, 404; anything else spends the grant). FAKE_HOST_LOG, when set, is a file that receives each consume request as a JSON line.
Shared by test_respond_result.py, test_respond_screenshots.py and respond-contract.test.mjs."""
import io
import json
import os
from urllib.error import HTTPError


def api(path, *, method="GET", data=None, headers=None):
  if path == "/api/apps/":
    return [{"id": 7, "slug": "contribute"}]
  if path == "/api/owner-grants/consume" and method == "POST":
    if os.environ.get("FAKE_HOST_LOG"):
      with open(os.environ["FAKE_HOST_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps(data) + "\n")
    answer = os.environ.get("FAKE_HOST_CONSUME", "")
    if answer in ("refused", "missing"):
      raise HTTPError(path, 403 if answer == "refused" else 404, answer, {}, io.BytesIO(b"{}"))
    return {"consumed": True}
  raise AssertionError(f"the gate asked for something it should not: {path}")


def review_path(app_id, suffix):
  return f"/api/github/contributions/{app_id}{suffix}"


def prepare_selection(*args, **kwargs):
  raise NotImplementedError


freeze_preview = verify_selection = start_body = prepare_selection
