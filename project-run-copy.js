// The words of a project's agent run that waits on the owner (the lifecycle's `run` region), as a row of Needs you says them: what happened,
// the pill, the date's lead-in and what the owner can do. Plain words; every sentence says its own result.
// A run that ended with nothing more to do can be dismissed: the row leaves and does not come back for that run (a new run is a new row). A run that
// asks you has no Dismiss: answering it is the way out.
const DISMISS_RUN = { label: 'Dismiss', hint: 'You looked and need nothing more from this run. Starting the work again begins a new run.', failed: 'Could not dismiss the run. Sync and try again.' }
export const RUN_ROW = {
  STOPPED: { title: 'The agent’s run stopped', label: 'Stopped', since: 'stopped', reason: 'It stopped before it finished. Open the project to see where it got to, or start it again.', dismiss: DISMISS_RUN },
  FAILED: { title: 'The agent’s run failed', label: 'Failed', since: 'failed', reason: 'It failed. Open the project to see why, or start it again.', dismiss: DISMISS_RUN },
  QUESTION: { title: 'The agent has a question for you', label: 'Agent asks you', since: 'asked', reason: 'Open the project to answer it. The agent waits for you.' },
  NOT_SENT: { title: 'The agent’s run did not start', label: 'Not started', since: 'sent', reason: 'Its start was not confirmed. Open the project and send it again; a message that already arrived is not sent twice.', dismiss: { label: 'Dismiss', hint: 'Gives up this start. Starting the work again begins a new run.', failed: 'Could not dismiss the run. Sync and try again.' } },
}

// The row's words for a state of the run region; a state with none of its own reads as stopped.
export const runRowWords = state => RUN_ROW[state] || RUN_ROW.STOPPED
