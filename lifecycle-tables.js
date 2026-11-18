// GENERATED from lifecycle_tables.py by `python3 lifecycle_tables.py --emit-js`. Do not edit:
// test/lifecycle-engine.test.mjs fails when this file and the Python tables differ.
export const LIFECYCLE_TABLES = {
 "attention": {
  "priority": [
   "human_required",
   "merge_conflict",
   "checks_failed",
   "changes_requested",
   "github_activity",
   "outside_activity"
  ],
  "rules": [
   {
    "action": "raise",
    "event": "CHECKS_CHANGED",
    "flags": [
     "checks_failed"
    ],
    "guard": "at least one failing check does not also fail on the default branch",
    "logged": false,
    "vs": "same",
    "when": {
     "all_inherited": [
      false,
      null
     ],
     "state": "failing"
    }
   },
   {
    "action": "clear",
    "event": "CHECKS_CHANGED",
    "flags": [
     "checks_failed"
    ],
    "guard": "every failing check also fails on the default branch",
    "logged": true,
    "vs": "new",
    "when": {
     "all_inherited": true,
     "state": "failing"
    }
   },
   {
    "action": "clear",
    "event": "CHECKS_CHANGED",
    "flags": [
     "checks_failed"
    ],
    "guard": "",
    "logged": false,
    "vs": "same",
    "when": {
     "state": "passing"
    }
   },
   {
    "action": "keep",
    "event": "CHECKS_CHANGED",
    "flags": [],
    "guard": "a run in progress decides nothing",
    "logged": false,
    "vs": "same",
    "when": {
     "state": "pending"
    }
   },
   {
    "action": "raise",
    "event": "REVIEW_CHANGED",
    "flags": [
     "changes_requested"
    ],
    "guard": "a trusted reviewer requests changes",
    "logged": false,
    "vs": "same",
    "when": {
     "changes_requested": true,
     "trusted": [
      true,
      null
     ]
    }
   },
   {
    "action": "keep",
    "event": "REVIEW_CHANGED",
    "flags": [],
    "guard": "an untrusted reviewer's request raises nothing",
    "logged": true,
    "vs": "same",
    "when": {
     "changes_requested": true,
     "trusted": false
    }
   },
   {
    "action": "clear",
    "event": "REVIEW_CHANGED",
    "flags": [
     "changes_requested"
    ],
    "guard": "no change request stands any more",
    "logged": false,
    "vs": "changed",
    "when": {
     "changes_requested": false
    }
   },
   {
    "action": "keep",
    "event": "REVIEW_CHANGED",
    "flags": [],
    "guard": "the read did not ask for the review decision, so it decides nothing",
    "logged": false,
    "vs": "same",
    "when": {
     "changes_requested": null
    }
   },
   {
    "action": "keep",
    "event": "COMMENTED",
    "flags": [],
    "guard": "written by you",
    "logged": true,
    "vs": "new",
    "when": {
     "by_owner": true
    }
   },
   {
    "action": "raise",
    "event": "COMMENTED",
    "flags": [
     "github_activity"
    ],
    "guard": "written by someone else, trusted",
    "logged": false,
    "vs": "same",
    "when": {
     "by_owner": [
      false,
      null
     ],
     "trusted": [
      true,
      null
     ]
    }
   },
   {
    "action": "raise",
    "event": "COMMENTED",
    "flags": [
     "outside_activity"
    ],
    "guard": "written by someone outside the project",
    "logged": false,
    "vs": "same",
    "when": {
     "by_owner": [
      false,
      null
     ],
     "trusted": false
    }
   },
   {
    "action": "clear",
    "event": "ANSWERED",
    "flags": [
     "github_activity",
     "outside_activity"
    ],
    "guard": "a round settled it, or you replied",
    "logged": false,
    "vs": "same",
    "when": {}
   },
   {
    "action": "raise",
    "event": "MERGEABLE_CHANGED",
    "flags": [
     "merge_conflict"
    ],
    "guard": "",
    "logged": false,
    "vs": "same",
    "when": {
     "state": "conflicting"
    }
   },
   {
    "action": "clear",
    "event": "MERGEABLE_CHANGED",
    "flags": [
     "merge_conflict"
    ],
    "guard": "",
    "logged": false,
    "vs": "same",
    "when": {
     "state": "mergeable"
    }
   },
   {
    "action": "keep",
    "event": "MERGEABLE_CHANGED",
    "flags": [],
    "guard": "GitHub has not computed it yet",
    "logged": false,
    "vs": "same",
    "when": {
     "state": "unknown"
    }
   },
   {
    "action": "raise",
    "event": "ESCALATED",
    "flags": [
     "human_required"
    ],
    "guard": "an agent needs a person; held, never overwritten",
    "logged": false,
    "vs": "changed",
    "when": {}
   },
   {
    "action": "clear",
    "event": "RESUME",
    "flags": [
     "human_required"
    ],
    "guard": "you pressed Resume",
    "logged": false,
    "vs": "changed",
    "when": {}
   },
   {
    "action": "clear",
    "event": "STAGE_UPDATE",
    "flags": [
     "merge_conflict",
     "checks_failed",
     "changes_requested",
     "github_activity",
     "outside_activity"
    ],
    "guard": "the update answers what GitHub raised",
    "logged": true,
    "vs": "changed",
    "when": {}
   },
   {
    "action": "clear_all",
    "event": "PR_FINISHED",
    "flags": [],
    "guard": "merged or closed: every flag goes, the waiting ones too",
    "logged": false,
    "vs": "changed",
    "when": {}
   },
   {
    "action": "keep",
    "event": "HEAD_PUSHED",
    "flags": [],
    "guard": "checks and conflict are read again for the new head",
    "logged": false,
    "vs": "same",
    "when": {}
   }
  ]
 },
 "history_limit": 30,
 "level_edges": [
  {
   "events": [
    "MARKED_READY"
   ],
   "level": {
    "is_draft": false,
    "pr": "OPEN",
    "queued": [
     false,
     null
    ]
   },
   "where": [
    "DRAFT"
   ]
  },
  {
   "events": [
    "MARKED_READY",
    "QUEUE_ENTERED"
   ],
   "level": {
    "is_draft": false,
    "pr": "OPEN",
    "queued": true
   },
   "where": [
    "DRAFT"
   ]
  },
  {
   "events": [
    "MARKED_DRAFT"
   ],
   "level": {
    "is_draft": true,
    "pr": "OPEN"
   },
   "where": [
    "OPEN"
   ]
  },
  {
   "events": [
    "QUEUE_ENTERED"
   ],
   "level": {
    "is_draft": false,
    "pr": "OPEN",
    "queued": true
   },
   "where": [
    "OPEN"
   ]
  },
  {
   "events": [
    "MARKED_DRAFT"
   ],
   "level": {
    "is_draft": true,
    "pr": "OPEN"
   },
   "where": [
    "QUEUED"
   ]
  },
  {
   "events": [
    "QUEUE_LEFT"
   ],
   "level": {
    "is_draft": false,
    "pr": "OPEN",
    "queued": [
     false,
     null
    ]
   },
   "where": [
    "QUEUED"
   ]
  },
  {
   "events": [
    "MERGED"
   ],
   "level": {
    "pr": "MERGED"
   },
   "where": [
    "DRAFT",
    "OPEN",
    "QUEUED",
    "CLOSED",
    "CLOSED_QUIET"
   ]
  },
  {
   "events": [
    "BASE_OBSERVED"
   ],
   "level": {
    "base_is_default": false,
    "pr": "MERGED"
   },
   "where": [
    "MERGED"
   ]
  },
  {
   "events": [
    "CLOSED"
   ],
   "level": {
    "pr": "CLOSED"
   },
   "where": [
    "DRAFT",
    "OPEN",
    "QUEUED"
   ]
  },
  {
   "events": [
    "REOPENED"
   ],
   "level": {
    "pr": "OPEN",
    "queued": [
     false,
     null
    ]
   },
   "where": [
    "CLOSED",
    "CLOSED_QUIET"
   ]
  },
  {
   "events": [
    "REOPENED",
    "QUEUE_ENTERED"
   ],
   "level": {
    "is_draft": false,
    "pr": "OPEN",
    "queued": true
   },
   "where": [
    "CLOSED",
    "CLOSED_QUIET"
   ]
  },
  {
   "events": [
    "OBSERVED_PR"
   ],
   "level": {
    "pr": "OPEN"
   },
   "where": [
    "UNCERTAIN",
    "NOT_CONFIRMED"
   ]
  },
  {
   "events": [
    "OBSERVED_PR",
    "MERGED"
   ],
   "level": {
    "pr": "MERGED"
   },
   "where": [
    "UNCERTAIN",
    "NOT_CONFIRMED"
   ]
  },
  {
   "events": [
    "OBSERVED_PR",
    "CLOSED"
   ],
   "level": {
    "pr": "CLOSED"
   },
   "where": [
    "UNCERTAIN",
    "NOT_CONFIRMED"
   ]
  }
 ],
 "regions": {
  "followup": {
   "host": "record",
   "initial": "OFF",
   "states": {
    "BLOCKED": {
     "final": false,
     "text": "Needs a person: an escalation or two failed rounds.",
     "waits": "owner"
    },
    "CLOSED_OUT": {
     "final": true,
     "text": "The PR is finished; grant off, chat hidden.",
     "waits": "none"
    },
    "IDLE": {
     "final": false,
     "text": "Following; nothing to answer.",
     "waits": "none"
    },
    "OFF": {
     "final": false,
     "text": "Not following this PR.",
     "waits": "none"
    },
    "PAUSED": {
     "final": false,
     "text": "You paused it.",
     "waits": "owner"
    },
    "RESPONDING": {
     "deadline": {
      "event": "LEASE_EXPIRED",
      "seconds": 2700,
      "to": "IDLE"
     },
     "final": false,
     "text": "A round is working on feedback.",
     "waits": "agent"
    }
   },
   "title": "Follow-up",
   "transitions": [
    {
     "effects": [
      "STAMP_GRANT",
      "MIRROR"
     ],
     "event": "FOLLOW_ON",
     "from": "OFF",
     "guard": "",
     "raises": [],
     "to": "IDLE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "FOLLOW_OFF",
     "from": "IDLE",
     "guard": "",
     "raises": [],
     "to": "OFF",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "FOLLOW_OFF",
     "from": "PAUSED",
     "guard": "",
     "raises": [],
     "to": "OFF",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "FOLLOW_OFF",
     "from": "BLOCKED",
     "guard": "",
     "raises": [],
     "to": "OFF",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "FOLLOW_OFF",
     "from": "RESPONDING",
     "guard": "",
     "raises": [],
     "to": "OFF",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "PAUSE",
     "from": "IDLE",
     "guard": "",
     "raises": [],
     "to": "PAUSED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "ROUND_STARTED",
     "from": "IDLE",
     "guard": "attention that is not a human-required flag",
     "raises": [],
     "to": "RESPONDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "ROUND_DONE",
     "from": "RESPONDING",
     "guard": "",
     "raises": [],
     "to": "IDLE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "COUNT_FAILURE",
      "MIRROR"
     ],
     "event": "ROUND_FAILED",
     "from": "RESPONDING",
     "guard": "first failure",
     "raises": [],
     "to": "IDLE",
     "vs": "same",
     "when": {
      "blocks": [
       false,
       null
      ]
     }
    },
    {
     "effects": [
      "REQUEST_OWNER",
      "MIRROR"
     ],
     "event": "ROUND_FAILED",
     "from": "RESPONDING",
     "guard": "second failure in a row",
     "raises": [],
     "to": "BLOCKED",
     "vs": "same",
     "when": {
      "blocks": true
     }
    },
    {
     "effects": [
      "REQUEST_OWNER",
      "MIRROR"
     ],
     "event": "ESCALATED",
     "from": "RESPONDING",
     "guard": "",
     "raises": [],
     "to": "BLOCKED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER",
      "MIRROR"
     ],
     "event": "ESCALATED",
     "from": "IDLE",
     "guard": "an escalation recorded after the round ended",
     "raises": [],
     "to": "BLOCKED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "COUNT_FAILURE",
      "MIRROR"
     ],
     "event": "LEASE_EXPIRED",
     "from": "RESPONDING",
     "guard": "45 minutes without a result",
     "raises": [],
     "to": "IDLE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "CLEAR_ONLY_HUMAN_REQUIRED",
      "MIRROR"
     ],
     "event": "RESUME",
     "from": "BLOCKED",
     "guard": "",
     "raises": [],
     "to": "IDLE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "RESUME",
     "from": "PAUSED",
     "guard": "",
     "raises": [],
     "to": "IDLE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "PR_FINISHED",
     "from": "OFF",
     "guard": "",
     "raises": [],
     "to": "CLOSED_OUT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TURN_OFF_GRANT",
      "HIDE_CHAT",
      "MIRROR"
     ],
     "event": "PR_FINISHED",
     "from": "IDLE",
     "guard": "",
     "raises": [],
     "to": "CLOSED_OUT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TURN_OFF_GRANT",
      "HIDE_CHAT",
      "MIRROR"
     ],
     "event": "PR_FINISHED",
     "from": "RESPONDING",
     "guard": "",
     "raises": [],
     "to": "CLOSED_OUT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TURN_OFF_GRANT",
      "HIDE_CHAT",
      "MIRROR"
     ],
     "event": "PR_FINISHED",
     "from": "PAUSED",
     "guard": "",
     "raises": [],
     "to": "CLOSED_OUT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TURN_OFF_GRANT",
      "HIDE_CHAT",
      "MIRROR"
     ],
     "event": "PR_FINISHED",
     "from": "BLOCKED",
     "guard": "",
     "raises": [],
     "to": "CLOSED_OUT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "MIRROR"
     ],
     "event": "PR_REOPENED",
     "from": "CLOSED_OUT",
     "guard": "",
     "raises": [],
     "to": "OFF",
     "vs": "new",
     "when": {}
    }
   ]
  },
  "publication": {
   "host": "record",
   "initial": "PREPARED",
   "states": {
    "ABANDONED": {
     "final": true,
     "text": "Discarded before sending. Restorable.",
     "waits": "none"
    },
    "CLOSED": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 2592000,
      "to": "CLOSED_QUIET"
     },
     "final": false,
     "text": "Closed without merging. Watched for 30 days in case it is reopened.",
     "waits": "none"
    },
    "CLOSED_QUIET": {
     "final": true,
     "text": "Closed for over 30 days; no longer polled. A manual Sync still revives it.",
     "waits": "none"
    },
    "DRAFT": {
     "final": false,
     "text": "Public draft PR.",
     "waits": "none"
    },
    "MERGED": {
     "final": true,
     "text": "Merged into the default branch.",
     "waits": "none"
    },
    "MERGED_ELSEWHERE": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 1209600,
      "to": "ORPHANED"
     },
     "final": false,
     "text": "Merged into another branch; waiting to see whether that branch reaches the default branch.",
     "waits": "github"
    },
    "NOT_CONFIRMED": {
     "final": false,
     "text": "Could not confirm. Never resent; you decide.",
     "waits": "owner"
    },
    "OPEN": {
     "final": false,
     "text": "Public PR ready for review.",
     "waits": "none"
    },
    "ORPHANED": {
     "final": false,
     "text": "Merged into a branch that never reached the default branch. Needs you.",
     "waits": "owner"
    },
    "PREPARED": {
     "final": false,
     "text": "Private, reviewed, waiting for you to send it.",
     "waits": "owner"
    },
    "QUEUED": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 21600,
      "to": "QUEUED"
     },
     "final": false,
     "text": "In GitHub's merge queue.",
     "waits": "github"
    },
    "SENDING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 300,
      "to": "UNCERTAIN"
     },
     "final": false,
     "text": "Send pressed; the platform is publishing.",
     "waits": "platform"
    },
    "SUPERSEDED": {
     "final": true,
     "text": "Replaced by other work (successor recorded).",
     "waits": "none"
    },
    "UNCERTAIN": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 600,
      "to": "NOT_CONFIRMED"
     },
     "final": false,
     "text": "The answer was lost; reading GitHub to find out.",
     "waits": "github"
    }
   },
   "title": "Publication",
   "transitions": [
    {
     "effects": [
      "CLAIM_RECORD"
     ],
     "event": "SEND_CONFIRMED",
     "from": "PREPARED",
     "guard": "all clear for this exact version and no attention",
     "raises": [],
     "to": "SENDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "DELETE_CHECKOUT_LATER"
     ],
     "event": "DISCARD",
     "from": "PREPARED",
     "guard": "",
     "raises": [],
     "to": "ABANDONED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "RECORD_SUCCESSOR",
      "NOTIFY_ONCE"
     ],
     "event": "LANDED_ELSEWHERE",
     "from": "PREPARED",
     "guard": "the reviewed work reached the default branch by another path",
     "raises": [],
     "to": "SUPERSEDED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "RESTORE",
     "from": "ABANDONED",
     "guard": "the checkout still exists",
     "raises": [],
     "to": "PREPARED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "STAMP_PR",
      "STAMP_FOLLOWUP"
     ],
     "event": "SUBMIT_OK",
     "from": "SENDING",
     "guard": "",
     "raises": [],
     "to": "*PUBLIC",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "SUBMIT_REFUSED",
     "from": "SENDING",
     "guard": "the platform refused; nothing was pushed",
     "raises": [],
     "to": "PREPARED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "SUBMIT_LOST",
     "from": "SENDING",
     "guard": "",
     "raises": [],
     "to": "UNCERTAIN",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "TIMEOUT",
     "from": "SENDING",
     "guard": "",
     "raises": [],
     "to": "UNCERTAIN",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "STAMP_PR"
     ],
     "event": "OBSERVED_PR",
     "from": "UNCERTAIN",
     "guard": "GitHub shows the PR",
     "raises": [],
     "to": "*PUBLIC",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "SUBMIT_REFUSED",
     "from": "UNCERTAIN",
     "guard": "the read proved nothing was pushed",
     "raises": [],
     "to": "PREPARED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "UNCERTAIN",
     "guard": "10 minutes without finding it",
     "raises": [],
     "to": "NOT_CONFIRMED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "STAMP_PR"
     ],
     "event": "OBSERVED_PR",
     "from": "NOT_CONFIRMED",
     "guard": "GitHub shows the PR",
     "raises": [],
     "to": "*PUBLIC",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "OWNER_CHECKS",
     "from": "NOT_CONFIRMED",
     "guard": "",
     "raises": [],
     "to": "UNCERTAIN",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "SUBMIT_REFUSED",
     "from": "NOT_CONFIRMED",
     "guard": "the read proved nothing was pushed",
     "raises": [],
     "to": "PREPARED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "NOT_CONFIRMED",
     "guard": "",
     "raises": [],
     "to": "ABANDONED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "MARKED_READY",
     "from": "DRAFT",
     "guard": "",
     "raises": [],
     "to": "OPEN",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "MARKED_DRAFT",
     "from": "OPEN",
     "guard": "",
     "raises": [],
     "to": "DRAFT",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "MARKED_DRAFT",
     "from": "QUEUED",
     "guard": "",
     "raises": [],
     "to": "DRAFT",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "QUEUE_ENTERED",
     "from": "OPEN",
     "guard": "",
     "raises": [],
     "to": "QUEUED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "QUEUE_LEFT",
     "from": "QUEUED",
     "guard": "not merged",
     "raises": [],
     "to": "OPEN",
     "vs": "new",
     "when": {
      "merged": [
       false,
       null
      ]
     }
    },
    {
     "effects": [
      "ASK_GITHUB"
     ],
     "event": "TIMEOUT",
     "from": "QUEUED",
     "guard": "",
     "raises": [],
     "to": "QUEUED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "MERGED",
     "from": "DRAFT",
     "guard": "the base is the default branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED",
     "vs": "same",
     "when": {
      "base_is_default": [
       true,
       null
      ]
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "MERGED",
     "from": "OPEN",
     "guard": "the base is the default branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED",
     "vs": "same",
     "when": {
      "base_is_default": [
       true,
       null
      ]
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "MERGED",
     "from": "QUEUED",
     "guard": "the base is the default branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED",
     "vs": "same",
     "when": {
      "base_is_default": [
       true,
       null
      ]
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "MERGED",
     "from": "CLOSED",
     "guard": "GitHub may list closed before merged",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED",
     "vs": "same",
     "when": {
      "base_is_default": [
       true,
       null
      ]
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "MERGED",
     "from": "CLOSED_QUIET",
     "guard": "seen by a manual Sync",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED",
     "vs": "new",
     "when": {
      "base_is_default": [
       true,
       null
      ]
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "MERGED",
     "from": "DRAFT",
     "guard": "the base is another branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "MERGED",
     "from": "OPEN",
     "guard": "the base is another branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "MERGED",
     "from": "QUEUED",
     "guard": "the base is another branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "MERGED",
     "from": "CLOSED",
     "guard": "the base is another branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "MERGED",
     "from": "CLOSED_QUIET",
     "guard": "the base is another branch",
     "raises": [
      "PR_FINISHED",
      "TARGET_MERGED"
     ],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "START_ROUTE_WATCH"
     ],
     "event": "BASE_OBSERVED",
     "from": "MERGED",
     "guard": "a writer recorded merged before the base was known",
     "raises": [],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {
      "base_is_default": false
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "ROUTE_RESOLVED",
     "from": "MERGED_ELSEWHERE",
     "guard": "that branch reached the default branch after this merge",
     "raises": [],
     "to": "MERGED",
     "vs": "new",
     "when": {
      "reached": "after"
     }
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "ROUTE_RESOLVED",
     "from": "MERGED_ELSEWHERE",
     "guard": "that branch landed before this merge, or was dropped",
     "raises": [],
     "to": "ORPHANED",
     "vs": "new",
     "when": {
      "reached": [
       "before",
       "dropped"
      ]
     }
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "MERGED_ELSEWHERE",
     "guard": "14 days without an answer",
     "raises": [],
     "to": "ORPHANED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "RECORD_SUCCESSOR"
     ],
     "event": "OWNER_RELANDS",
     "from": "ORPHANED",
     "guard": "the owner re-lands it as new work",
     "raises": [],
     "to": "SUPERSEDED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "ROUTE_RESOLVED",
     "from": "ORPHANED",
     "guard": "the branch reached the default branch after all",
     "raises": [],
     "to": "MERGED",
     "vs": "new",
     "when": {
      "reached": "after"
     }
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "CLOSED",
     "from": "DRAFT",
     "guard": "",
     "raises": [
      "PR_FINISHED",
      "TARGET_CLOSED"
     ],
     "to": "CLOSED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "CLOSED",
     "from": "OPEN",
     "guard": "",
     "raises": [
      "PR_FINISHED",
      "TARGET_CLOSED"
     ],
     "to": "CLOSED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "CLOSE_OUT_FOLLOWUP"
     ],
     "event": "CLOSED",
     "from": "QUEUED",
     "guard": "",
     "raises": [
      "PR_FINISHED",
      "TARGET_CLOSED"
     ],
     "to": "CLOSED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE"
     ],
     "event": "REOPENED",
     "from": "CLOSED",
     "guard": "",
     "raises": [
      "PR_REOPENED"
     ],
     "to": "*PUBLIC",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "TIMEOUT",
     "from": "CLOSED",
     "guard": "30 days closed",
     "raises": [],
     "to": "CLOSED_QUIET",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE"
     ],
     "event": "REOPENED",
     "from": "CLOSED_QUIET",
     "guard": "seen by a manual Sync",
     "raises": [
      "PR_REOPENED"
     ],
     "to": "*PUBLIC",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "REOPENED",
     "from": "MERGED",
     "guard": "never happens on GitHub; kept and logged",
     "raises": [],
     "to": "MERGED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "CLOSED",
     "from": "MERGED",
     "guard": "GitHub lists closed right after merged",
     "raises": [],
     "to": "MERGED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "QUEUE_LEFT",
     "from": "MERGED",
     "guard": "the queue entry ends when the PR merges",
     "raises": [],
     "to": "MERGED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "CLOSED",
     "from": "MERGED_ELSEWHERE",
     "guard": "GitHub lists closed right after merged",
     "raises": [],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "QUEUE_LEFT",
     "from": "MERGED_ELSEWHERE",
     "guard": "the queue entry ends when the PR merges",
     "raises": [],
     "to": "MERGED_ELSEWHERE",
     "vs": "new",
     "when": {}
    }
   ]
  },
  "respond": {
   "host": "respond_result",
   "initial": "NONE",
   "states": {
    "APPROVED": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 30,
      "to": "NOT_STARTED"
     },
     "final": false,
     "text": "You pressed Post; waiting for the chat to start the post.",
     "waits": "platform"
    },
    "DISCARDED": {
     "final": true,
     "text": "Discarded.",
     "waits": "none"
    },
    "FAILED": {
     "final": false,
     "text": "Stopped part-way. Try again skips what already went out.",
     "waits": "owner"
    },
    "NONE": {
     "final": false,
     "text": "No saved answer.",
     "waits": "none"
    },
    "NOT_STARTED": {
     "final": false,
     "text": "The chat did not start. Send again or take it back.",
     "waits": "owner"
    },
    "OUT_OF_DATE": {
     "final": false,
     "text": "The PR moved after the answer was built. Respond again or discard.",
     "waits": "owner"
    },
    "POSTED": {
     "final": true,
     "text": "Posted.",
     "waits": "none"
    },
    "POSTING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 180,
      "to": "FAILED"
     },
     "final": false,
     "text": "The helper is pushing and posting, step by step.",
     "waits": "platform"
    },
    "READY": {
     "final": false,
     "text": "Replies ready. Waiting for you to press Post.",
     "waits": "owner"
    }
   },
   "title": "Respond answer",
   "transitions": [
    {
     "effects": [],
     "event": "SAVE",
     "from": "NONE",
     "guard": "",
     "raises": [],
     "to": "READY",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "SAVE",
     "from": "READY",
     "guard": "the agent saved a newer answer",
     "raises": [],
     "to": "READY",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TELL_CHAT"
     ],
     "event": "APPROVE",
     "from": "READY",
     "guard": "your confirmation was recorded",
     "raises": [],
     "to": "APPROVED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "READY",
     "guard": "",
     "raises": [],
     "to": "DISCARDED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "PR_MOVED",
     "from": "READY",
     "guard": "",
     "raises": [],
     "to": "OUT_OF_DATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "CHAT_STARTED",
     "from": "APPROVED",
     "guard": "",
     "raises": [],
     "to": "POSTING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "APPROVED",
     "guard": "30 seconds",
     "raises": [],
     "to": "NOT_STARTED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "PR_MOVED",
     "from": "APPROVED",
     "guard": "",
     "raises": [],
     "to": "OUT_OF_DATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "TELL_CHAT"
     ],
     "event": "APPROVE",
     "from": "NOT_STARTED",
     "guard": "",
     "raises": [],
     "to": "APPROVED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "CHAT_STARTED",
     "from": "NOT_STARTED",
     "guard": "the chat started late",
     "raises": [],
     "to": "POSTING",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "WITHDRAW",
     "from": "NOT_STARTED",
     "guard": "",
     "raises": [],
     "to": "READY",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "PR_MOVED",
     "from": "NOT_STARTED",
     "guard": "",
     "raises": [],
     "to": "OUT_OF_DATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "PROGRESS",
     "from": "POSTING",
     "guard": "a step went out; the deadline starts again",
     "raises": [],
     "to": "POSTING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "CLEAR_ANSWERED_FINDINGS",
      "ASK_REREVIEW"
     ],
     "event": "POST_OK",
     "from": "POSTING",
     "guard": "",
     "raises": [],
     "to": "POSTED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "KEEP_RECEIPTS"
     ],
     "event": "POST_FAILED",
     "from": "POSTING",
     "guard": "",
     "raises": [],
     "to": "FAILED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "RELEASE_LOCK",
      "KEEP_RECEIPTS"
     ],
     "event": "TIMEOUT",
     "from": "POSTING",
     "guard": "3 minutes without progress; the helper is gone",
     "raises": [],
     "to": "FAILED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "TELL_CHAT"
     ],
     "event": "APPROVE",
     "from": "FAILED",
     "guard": "a fresh confirmation; the PR is still where the work was built",
     "raises": [],
     "to": "APPROVED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "PR_MOVED",
     "from": "FAILED",
     "guard": "",
     "raises": [],
     "to": "OUT_OF_DATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "FAILED",
     "guard": "",
     "raises": [],
     "to": "DISCARDED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "RESPOND_AGAIN",
     "from": "OUT_OF_DATE",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "OUT_OF_DATE",
     "guard": "",
     "raises": [],
     "to": "DISCARDED",
     "vs": "same",
     "when": {}
    }
   ]
  },
  "review": {
   "host": "review_item",
   "initial": "REVIEWING",
   "states": {
    "ANSWERED": {
     "final": true,
     "text": "The findings were answered by a posted reply.",
     "waits": "none"
    },
    "ASKS": {
     "final": false,
     "text": "The agent asked you something.",
     "waits": "owner"
    },
    "CLEAR": {
     "final": false,
     "text": "Reviewed this version; nothing found.",
     "waits": "none"
    },
    "NOT_FINISHED": {
     "final": false,
     "text": "The review hit an obstacle and says so. Review again.",
     "waits": "owner"
    },
    "PROBLEMS": {
     "final": false,
     "text": "Findings. Fix them, set them aside, or post them.",
     "waits": "owner"
    },
    "REPLACED": {
     "final": true,
     "text": "A newer review replaced this one.",
     "waits": "none"
    },
    "REVIEWING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 3600,
      "to": "STALLED"
     },
     "final": false,
     "text": "The agent is reviewing.",
     "waits": "agent"
    },
    "SET_ASIDE": {
     "final": true,
     "text": "You set these findings aside (for this review only).",
     "waits": "none"
    },
    "STALE": {
     "final": false,
     "text": "The PR has new commits since this review.",
     "waits": "owner"
    },
    "STALLED": {
     "final": false,
     "text": "The agent stopped without a result. Review again or stop.",
     "waits": "owner"
    },
    "STOPPED": {
     "final": true,
     "text": "You stopped it.",
     "waits": "none"
    }
   },
   "title": "Agent review",
   "transitions": [
    {
     "effects": [],
     "event": "OUTCOME_CLEAR",
     "from": "REVIEWING",
     "guard": "",
     "raises": [],
     "to": "CLEAR",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OUTCOME_PROBLEMS",
     "from": "REVIEWING",
     "guard": "",
     "raises": [],
     "to": "PROBLEMS",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OUTCOME_BLOCKED",
     "from": "REVIEWING",
     "guard": "the agent named an obstacle",
     "raises": [],
     "to": "NOT_FINISHED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "AGENT_ASKS",
     "from": "REVIEWING",
     "guard": "",
     "raises": [],
     "to": "ASKS",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "CHAT_ENDED",
     "from": "REVIEWING",
     "guard": "the review chat is over and no result was saved",
     "raises": [],
     "to": "STALLED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "REVIEWING",
     "guard": "60 minutes",
     "raises": [],
     "to": "STALLED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "STOP",
     "from": "REVIEWING",
     "guard": "",
     "raises": [],
     "to": "STOPPED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "REVIEWING",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OWNER_ANSWERS",
     "from": "ASKS",
     "guard": "",
     "raises": [],
     "to": "REVIEWING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "CHAT_ENDED",
     "from": "ASKS",
     "guard": "",
     "raises": [],
     "to": "STALLED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "STOP",
     "from": "ASKS",
     "guard": "",
     "raises": [],
     "to": "STOPPED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OUTCOME_CLEAR",
     "from": "STALLED",
     "guard": "a late result still counts",
     "raises": [],
     "to": "CLEAR",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "OUTCOME_PROBLEMS",
     "from": "STALLED",
     "guard": "a late result still counts",
     "raises": [],
     "to": "PROBLEMS",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "OUTCOME_BLOCKED",
     "from": "STALLED",
     "guard": "a late result still counts",
     "raises": [],
     "to": "NOT_FINISHED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "CHAT_WORKING",
     "from": "STALLED",
     "guard": "the review chat works again: the owner reopened it, or its helper is back",
     "raises": [],
     "to": "REVIEWING",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "STALLED",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "STOP",
     "from": "STALLED",
     "guard": "",
     "raises": [],
     "to": "STOPPED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "NOT_FINISHED",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "PROBLEMS",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "CLEAR",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "SET_ASIDE",
     "from": "PROBLEMS",
     "guard": "tied to this review, not to the PR version",
     "raises": [],
     "to": "SET_ASIDE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "ANSWER_POSTED",
     "from": "PROBLEMS",
     "guard": "a posted reply covers every point",
     "raises": [],
     "to": "ANSWERED",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "HEAD_PUSHED",
     "from": "PROBLEMS",
     "guard": "",
     "raises": [],
     "to": "STALE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "HEAD_PUSHED",
     "from": "CLEAR",
     "guard": "",
     "raises": [],
     "to": "STALE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "HEAD_PUSHED",
     "from": "NOT_FINISHED",
     "guard": "",
     "raises": [],
     "to": "STALE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_NEW_REVIEW"
     ],
     "event": "REVIEW_AGAIN",
     "from": "STALE",
     "guard": "",
     "raises": [],
     "to": "REPLACED",
     "vs": "same",
     "when": {}
    }
   ]
  },
  "run": {
   "host": "project_cycle",
   "initial": "NONE",
   "states": {
    "DONE": {
     "final": true,
     "text": "Finished.",
     "waits": "none"
    },
    "FAILED": {
     "final": false,
     "text": "The run failed. Your move.",
     "waits": "owner"
    },
    "NONE": {
     "final": false,
     "text": "Nothing running.",
     "waits": "none"
    },
    "NOT_SENT": {
     "final": false,
     "text": "Could not confirm the start. Send again.",
     "waits": "owner"
    },
    "QUESTION": {
     "final": false,
     "text": "The agent asked you something.",
     "waits": "owner"
    },
    "RUNNING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 3600,
      "to": "RUNNING"
     },
     "final": false,
     "text": "The agent is working.",
     "waits": "agent"
    },
    "SENDING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 120,
      "to": "NOT_SENT"
     },
     "final": false,
     "text": "The start message is on its way.",
     "waits": "platform"
    },
    "STOPPED": {
     "final": false,
     "text": "The run stopped before finishing. Your move.",
     "waits": "owner"
    }
   },
   "title": "Project run",
   "transitions": [
    {
     "effects": [
      "WRITE_CYCLE_RECORD"
     ],
     "event": "START",
     "from": "NONE",
     "guard": "your confirmation",
     "raises": [],
     "to": "SENDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DELIVERED",
     "from": "SENDING",
     "guard": "the chat answered",
     "raises": [],
     "to": "RUNNING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "SENDING",
     "guard": "",
     "raises": [],
     "to": "NOT_SENT",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "SEND_AGAIN",
     "from": "NOT_SENT",
     "guard": "",
     "raises": [],
     "to": "SENDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DELIVERED",
     "from": "NOT_SENT",
     "guard": "the chat answered late",
     "raises": [],
     "to": "RUNNING",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "RUN_WAITING",
     "from": "RUNNING",
     "guard": "",
     "raises": [],
     "to": "QUESTION",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "RUN_STOPPED",
     "from": "RUNNING",
     "guard": "the platform says stopped, parked or interrupted",
     "raises": [],
     "to": "STOPPED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "RUN_FAILED",
     "from": "RUNNING",
     "guard": "",
     "raises": [],
     "to": "FAILED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "RUN_DONE",
     "from": "RUNNING",
     "guard": "",
     "raises": [],
     "to": "DONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "ASK_PLATFORM"
     ],
     "event": "TIMEOUT",
     "from": "RUNNING",
     "guard": "an hour of silence: ask the platform what the chat is doing",
     "raises": [],
     "to": "RUNNING",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "OWNER_ANSWERS",
     "from": "QUESTION",
     "guard": "",
     "raises": [],
     "to": "RUNNING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "RUN_STOPPED",
     "from": "QUESTION",
     "guard": "",
     "raises": [],
     "to": "STOPPED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "RUN_FAILED",
     "from": "QUESTION",
     "guard": "",
     "raises": [],
     "to": "FAILED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "RUN_DONE",
     "from": "QUESTION",
     "guard": "",
     "raises": [],
     "to": "DONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "WRITE_CYCLE_RECORD"
     ],
     "event": "START",
     "from": "STOPPED",
     "guard": "",
     "raises": [],
     "to": "SENDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "WRITE_CYCLE_RECORD"
     ],
     "event": "START",
     "from": "FAILED",
     "guard": "",
     "raises": [],
     "to": "SENDING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "RUN_DONE",
     "from": "STOPPED",
     "guard": "a parked run was resumed and finished",
     "raises": [],
     "to": "DONE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISMISS",
     "from": "STOPPED",
     "guard": "you stopped it yourself, or looked and need nothing more",
     "raises": [],
     "to": "DONE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISMISS",
     "from": "FAILED",
     "guard": "you looked and need nothing more",
     "raises": [],
     "to": "DONE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISMISS",
     "from": "NOT_SENT",
     "guard": "you gave up starting it",
     "raises": [],
     "to": "NONE",
     "vs": "new",
     "when": {}
    }
   ]
  },
  "update": {
   "host": "record",
   "initial": "NONE",
   "states": {
    "NONE": {
     "final": false,
     "text": "No update waiting.",
     "waits": "none"
    },
    "PREPARED_UPDATE": {
     "final": false,
     "text": "An update is reviewed and waiting for you to press Update PR.",
     "waits": "owner"
    },
    "SENDING_UPDATE": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 300,
      "to": "UPDATE_UNCERTAIN"
     },
     "final": false,
     "text": "Pushing the update.",
     "waits": "platform"
    },
    "STRANDED_UPDATE": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 604800,
      "to": "STRANDED_UPDATE"
     },
     "final": false,
     "text": "The PR merged or closed before the update went out. Needs you, with choices.",
     "waits": "owner"
    },
    "UPDATE_NOT_CONFIRMED": {
     "final": false,
     "text": "Could not confirm the push. Needs you.",
     "waits": "owner"
    },
    "UPDATE_UNCERTAIN": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 600,
      "to": "UPDATE_NOT_CONFIRMED"
     },
     "final": false,
     "text": "Answer lost; reading the PR to see whether the push arrived.",
     "waits": "github"
    }
   },
   "title": "Update",
   "transitions": [
    {
     "effects": [
      "MARK_ATTENTION_ADDRESSED"
     ],
     "event": "STAGE_UPDATE",
     "from": "NONE",
     "guard": "the PR is public (draft, open or queued)",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "MARK_ATTENTION_ADDRESSED"
     ],
     "event": "STAGE_UPDATE",
     "from": "PREPARED_UPDATE",
     "guard": "restaged after a fix",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "CLAIM_RECORD"
     ],
     "event": "SEND_UPDATE_CONFIRMED",
     "from": "PREPARED_UPDATE",
     "guard": "all clear for this exact version",
     "raises": [],
     "to": "SENDING_UPDATE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "KEEP_PUBLICATION_UNTOUCHED"
     ],
     "event": "DISCARD_UPDATE",
     "from": "PREPARED_UPDATE",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_MERGED",
     "from": "PREPARED_UPDATE",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_CLOSED",
     "from": "PREPARED_UPDATE",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "STAMP_UPDATED"
     ],
     "event": "UPDATE_OK",
     "from": "SENDING_UPDATE",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "UPDATE_REFUSED",
     "from": "SENDING_UPDATE",
     "guard": "the platform refused; nothing was pushed",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "UPDATE_LOST",
     "from": "SENDING_UPDATE",
     "guard": "",
     "raises": [],
     "to": "UPDATE_UNCERTAIN",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "TIMEOUT",
     "from": "SENDING_UPDATE",
     "guard": "",
     "raises": [],
     "to": "UPDATE_UNCERTAIN",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_MERGED",
     "from": "SENDING_UPDATE",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_CLOSED",
     "from": "SENDING_UPDATE",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "STAMP_UPDATED"
     ],
     "event": "OBSERVED_HEAD",
     "from": "UPDATE_UNCERTAIN",
     "guard": "the PR's head contains the update",
     "raises": [],
     "to": "NONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "UPDATE_REFUSED",
     "from": "UPDATE_UNCERTAIN",
     "guard": "the read proved nothing was pushed",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "REQUEST_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "UPDATE_UNCERTAIN",
     "guard": "",
     "raises": [],
     "to": "UPDATE_NOT_CONFIRMED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_MERGED",
     "from": "UPDATE_UNCERTAIN",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_CLOSED",
     "from": "UPDATE_UNCERTAIN",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "STAMP_UPDATED"
     ],
     "event": "OBSERVED_HEAD",
     "from": "UPDATE_NOT_CONFIRMED",
     "guard": "the PR's head contains the update",
     "raises": [],
     "to": "NONE",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "SHOW_REFUSAL"
     ],
     "event": "UPDATE_REFUSED",
     "from": "UPDATE_NOT_CONFIRMED",
     "guard": "the read proved nothing was pushed",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "KEEP_PUBLICATION_UNTOUCHED"
     ],
     "event": "DISCARD_UPDATE",
     "from": "UPDATE_NOT_CONFIRMED",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_MERGED",
     "from": "UPDATE_NOT_CONFIRMED",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "NOTIFY_ONCE",
      "REQUEST_OWNER"
     ],
     "event": "TARGET_CLOSED",
     "from": "UPDATE_NOT_CONFIRMED",
     "guard": "",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "RECORD_NOTE"
     ],
     "event": "COVERED_BY_MERGE",
     "from": "STRANDED_UPDATE",
     "guard": "the merged PR already contains these changes",
     "raises": [],
     "to": "NONE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "STAGE_NEW_RECORD",
      "RECORD_SUCCESSOR"
     ],
     "event": "PRESERVE_AS_NEW",
     "from": "STRANDED_UPDATE",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [
      "KEEP_PUBLICATION_UNTOUCHED"
     ],
     "event": "DISCARD_UPDATE",
     "from": "STRANDED_UPDATE",
     "guard": "",
     "raises": [],
     "to": "NONE",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [
      "REMIND_OWNER"
     ],
     "event": "TIMEOUT",
     "from": "STRANDED_UPDATE",
     "guard": "7 days",
     "raises": [],
     "to": "STRANDED_UPDATE",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "PR_REOPENED",
     "from": "STRANDED_UPDATE",
     "guard": "the PR is open again, so the update can go out",
     "raises": [],
     "to": "PREPARED_UPDATE",
     "vs": "new",
     "when": {}
    }
   ]
  },
  "verdict": {
   "host": "review_verdict",
   "initial": "NONE",
   "states": {
    "DISCARDED": {
     "final": true,
     "text": "Discarded.",
     "waits": "none"
    },
    "NONE": {
     "final": false,
     "text": "No verdict proposed.",
     "waits": "none"
    },
    "NOT_DISPATCHED": {
     "final": false,
     "text": "Nothing reached GitHub. Submit again or discard.",
     "waits": "owner"
    },
    "OUTDATED": {
     "final": true,
     "text": "The PR moved on; this proposal is for an older version.",
     "waits": "none"
    },
    "POSTED": {
     "final": true,
     "text": "On GitHub.",
     "waits": "none"
    },
    "POSTING": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 300,
      "to": "UNKNOWN"
     },
     "final": false,
     "text": "Submitting to GitHub.",
     "waits": "platform"
    },
    "PROPOSED": {
     "final": false,
     "text": "Waiting for you to submit or discard.",
     "waits": "owner"
    },
    "UNKNOWN": {
     "deadline": {
      "event": "TIMEOUT",
      "seconds": 3600,
      "to": "NOT_DISPATCHED"
     },
     "final": false,
     "text": "Answer lost; reading GitHub for the marker.",
     "waits": "github"
    }
   },
   "title": "Verdict",
   "transitions": [
    {
     "effects": [],
     "event": "PROPOSE",
     "from": "NONE",
     "guard": "",
     "raises": [],
     "to": "PROPOSED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "SUBMIT",
     "from": "PROPOSED",
     "guard": "your confirmation; one verdict per version",
     "raises": [],
     "to": "POSTING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "PROPOSED",
     "guard": "",
     "raises": [],
     "to": "DISCARDED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "HEAD_PUSHED",
     "from": "PROPOSED",
     "guard": "",
     "raises": [],
     "to": "OUTDATED",
     "vs": "changed",
     "when": {}
    },
    {
     "effects": [],
     "event": "POSTED_OK",
     "from": "POSTING",
     "guard": "",
     "raises": [],
     "to": "POSTED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "SUBMIT_LOST",
     "from": "POSTING",
     "guard": "",
     "raises": [],
     "to": "UNKNOWN",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [
      "START_OBSERVING"
     ],
     "event": "TIMEOUT",
     "from": "POSTING",
     "guard": "",
     "raises": [],
     "to": "UNKNOWN",
     "vs": "new",
     "when": {}
    },
    {
     "effects": [],
     "event": "NOT_SENT",
     "from": "POSTING",
     "guard": "GitHub refused it",
     "raises": [],
     "to": "NOT_DISPATCHED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OBSERVED_MARKER",
     "from": "UNKNOWN",
     "guard": "",
     "raises": [],
     "to": "POSTED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "TIMEOUT",
     "from": "UNKNOWN",
     "guard": "1 hour and a full scan found nothing",
     "raises": [],
     "to": "NOT_DISPATCHED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISMISS",
     "from": "UNKNOWN",
     "guard": "",
     "raises": [],
     "to": "NOT_DISPATCHED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "SUBMIT",
     "from": "NOT_DISPATCHED",
     "guard": "",
     "raises": [],
     "to": "POSTING",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "DISCARD",
     "from": "NOT_DISPATCHED",
     "guard": "",
     "raises": [],
     "to": "DISCARDED",
     "vs": "same",
     "when": {}
    },
    {
     "effects": [],
     "event": "OBSERVED_MARKER",
     "from": "NOT_DISPATCHED",
     "guard": "a late read found the marker",
     "raises": [],
     "to": "POSTED",
     "vs": "new",
     "when": {}
    }
   ]
  }
 },
 "seed": [
  {
   "events": [],
   "facts": {
    "has_pr": true,
    "is_update": true,
    "status": "prepared",
    "unconfirmed": true
   },
   "states": {
    "publication": "OPEN",
    "update": "UPDATE_UNCERTAIN"
   }
  },
  {
   "events": [],
   "facts": {
    "has_pr": true,
    "is_update": true,
    "status": "prepared"
   },
   "states": {
    "publication": "OPEN",
    "update": "PREPARED_UPDATE"
   }
  },
  {
   "events": [],
   "facts": {
    "has_pr": true,
    "is_update": true,
    "status": "submitting"
   },
   "states": {
    "publication": "OPEN",
    "update": "SENDING_UPDATE"
   }
  },
  {
   "events": [],
   "facts": {
    "status": "prepared",
    "unconfirmed": true
   },
   "states": {
    "publication": "UNCERTAIN"
   }
  },
  {
   "events": [],
   "facts": {
    "status": "prepared"
   },
   "states": {
    "publication": "PREPARED"
   }
  },
  {
   "events": [],
   "facts": {
    "status": "submitting"
   },
   "states": {
    "publication": "SENDING"
   }
  },
  {
   "events": [],
   "facts": {
    "status": "draft"
   },
   "states": {
    "publication": "DRAFT"
   }
  },
  {
   "events": [],
   "facts": {
    "status": [
     "open",
     "landing"
    ]
   },
   "states": {
    "publication": "OPEN"
   }
  },
  {
   "events": [
    "PR_FINISHED"
   ],
   "facts": {
    "status": "merged"
   },
   "states": {
    "publication": "MERGED"
   }
  },
  {
   "events": [
    "PR_FINISHED"
   ],
   "facts": {
    "status": "closed"
   },
   "states": {
    "publication": "CLOSED"
   }
  },
  {
   "events": [],
   "facts": {
    "has_pr": true,
    "is_update": true,
    "status": "abandoned"
   },
   "states": {
    "publication": "OPEN"
   }
  },
  {
   "events": [],
   "facts": {
    "status": "abandoned"
   },
   "states": {
    "publication": "ABANDONED"
   }
  },
  {
   "events": [
    "PR_FINISHED"
   ],
   "facts": {
    "status": "superseded"
   },
   "states": {
    "publication": "SUPERSEDED"
   }
  }
 ],
 "seed_followup": {
  "blocked": "BLOCKED",
  "idle": "IDLE",
  "off": "OFF",
  "paused": "PAUSED",
  "responding": "RESPONDING"
 },
 "status": [
  {
   "also": [],
   "status": "prepared",
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": [
     "PREPARED_UPDATE",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "also": [],
   "status": "submitting",
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "SENDING_UPDATE"
   }
  },
  {
   "also": [
    "prepared"
   ],
   "status": "submitting",
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "UPDATE_UNCERTAIN"
   }
  },
  {
   "also": [],
   "status": "prepared",
   "where": {
    "publication": [
     "PREPARED",
     "NOT_CONFIRMED"
    ]
   }
  },
  {
   "also": [],
   "status": "submitting",
   "where": {
    "publication": "SENDING"
   }
  },
  {
   "also": [
    "prepared"
   ],
   "status": "submitting",
   "where": {
    "publication": "UNCERTAIN"
   }
  },
  {
   "also": [],
   "status": "draft",
   "where": {
    "publication": "DRAFT"
   }
  },
  {
   "also": [
    "landing"
   ],
   "status": "open",
   "where": {
    "publication": [
     "OPEN",
     "QUEUED"
    ]
   }
  },
  {
   "also": [],
   "status": "merged",
   "where": {
    "publication": [
     "MERGED",
     "MERGED_ELSEWHERE",
     "ORPHANED"
    ]
   }
  },
  {
   "also": [],
   "status": "closed",
   "where": {
    "publication": [
     "CLOSED",
     "CLOSED_QUIET"
    ]
   }
  },
  {
   "also": [],
   "status": "abandoned",
   "where": {
    "publication": "ABANDONED"
   }
  },
  {
   "also": [],
   "status": "superseded",
   "where": {
    "publication": "SUPERSEDED"
   }
  }
 ],
 "status_edges": [
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "SEND_CONFIRMED"
    }
   ],
   "facts": {
    "status": "submitting"
   },
   "where": {
    "publication": "PREPARED"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {
      "is_draft": true
     },
     "region": "publication",
     "type": "SUBMIT_OK"
    }
   ],
   "facts": {
    "status": "draft"
   },
   "where": {
    "publication": "SENDING"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {
      "is_draft": false
     },
     "region": "publication",
     "type": "SUBMIT_OK"
    }
   ],
   "facts": {
    "status": "open"
   },
   "where": {
    "publication": "SENDING"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "SUBMIT_LOST"
    }
   ],
   "facts": {
    "status": "prepared",
    "unconfirmed": true
   },
   "where": {
    "publication": "SENDING"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "SUBMIT_REFUSED"
    }
   ],
   "facts": {
    "status": "prepared"
   },
   "where": {
    "publication": "SENDING"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {
      "is_draft": true
     },
     "region": "publication",
     "type": "OBSERVED_PR"
    }
   ],
   "facts": {
    "status": "draft"
   },
   "where": {
    "publication": [
     "UNCERTAIN",
     "NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {
      "is_draft": false
     },
     "region": "publication",
     "type": "OBSERVED_PR"
    }
   ],
   "facts": {
    "status": "open"
   },
   "where": {
    "publication": [
     "UNCERTAIN",
     "NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "SUBMIT_REFUSED"
    }
   ],
   "facts": {
    "status": "prepared",
    "unconfirmed": [
     false,
     null
    ]
   },
   "where": {
    "publication": [
     "UNCERTAIN",
     "NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "OWNER_CHECKS"
    }
   ],
   "facts": {
    "status": "submitting"
   },
   "where": {
    "publication": "NOT_CONFIRMED"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "DISCARD"
    }
   ],
   "facts": {
    "status": "abandoned"
   },
   "where": {
    "publication": [
     "PREPARED",
     "NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "RESTORE"
    }
   ],
   "facts": {
    "status": "prepared"
   },
   "where": {
    "publication": "ABANDONED"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "MARKED_READY"
    }
   ],
   "facts": {
    "status": "open"
   },
   "where": {
    "publication": "DRAFT",
    "update": "NONE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "MARKED_DRAFT"
    }
   ],
   "facts": {
    "status": "draft"
   },
   "where": {
    "publication": [
     "OPEN",
     "QUEUED"
    ],
    "update": "NONE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "MERGED"
    }
   ],
   "facts": {
    "status": "merged"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED",
     "CLOSED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "publication",
     "type": "CLOSED"
    }
   ],
   "facts": {
    "status": "closed"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": null,
     "type": "STAGE_UPDATE"
    }
   ],
   "facts": {
    "is_update": true,
    "status": "prepared"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "NONE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "SEND_UPDATE_CONFIRMED"
    }
   ],
   "facts": {
    "status": "submitting"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "PREPARED_UPDATE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_LOST"
    }
   ],
   "facts": {
    "status": "prepared",
    "unconfirmed": true
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "SENDING_UPDATE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_REFUSED"
    }
   ],
   "facts": {
    "status": "prepared"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "SENDING_UPDATE"
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_REFUSED"
    }
   ],
   "facts": {
    "status": "prepared",
    "unconfirmed": [
     false,
     null
    ]
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": [
     "UPDATE_UNCERTAIN",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_OK"
    },
    {
     "data": {},
     "region": "update",
     "type": "OBSERVED_HEAD"
    }
   ],
   "facts": {
    "status": "draft"
   },
   "where": {
    "publication": "DRAFT",
    "update": [
     "SENDING_UPDATE",
     "UPDATE_UNCERTAIN",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_OK"
    },
    {
     "data": {},
     "region": "update",
     "type": "OBSERVED_HEAD"
    }
   ],
   "facts": {
    "status": "open"
   },
   "where": {
    "publication": [
     "OPEN",
     "QUEUED"
    ],
    "update": [
     "SENDING_UPDATE",
     "UPDATE_UNCERTAIN",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": false,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "UPDATE_OK"
    },
    {
     "data": {},
     "region": "update",
     "type": "OBSERVED_HEAD"
    },
    {
     "data": {},
     "region": "publication",
     "type": "MARKED_READY"
    }
   ],
   "facts": {
    "status": "open"
   },
   "where": {
    "publication": "DRAFT",
    "update": [
     "SENDING_UPDATE",
     "UPDATE_UNCERTAIN",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": true,
   "events": [
    {
     "data": {},
     "region": "update",
     "type": "DISCARD_UPDATE"
    }
   ],
   "facts": {
    "status": "abandoned"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": [
     "PREPARED_UPDATE",
     "UPDATE_NOT_CONFIRMED"
    ]
   }
  },
  {
   "corrects": true,
   "events": [],
   "facts": {
    "has_pr": true,
    "is_update": true,
    "status": "abandoned"
   },
   "where": {
    "publication": [
     "DRAFT",
     "OPEN",
     "QUEUED"
    ],
    "update": "NONE"
   }
  }
 ],
 "targets": {
  "*PUBLIC": {
   "field": "is_draft",
   "if_true": "DRAFT",
   "otherwise": "OPEN"
  }
 },
 "version": 1
}
