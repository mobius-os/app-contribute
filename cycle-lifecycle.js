// A project's run (its one durable agent conversation) as the lifecycle's `run` region (lifecycle_tables.py RUN). Pure: no clock of its
// own, no storage, no platform call. The project's cycle record (storage.js) is not changed: a run's truth is the cycle record plus
// what the platform says about the conversation, so the region is derived from those words every time (RUN_WORDS) and every deadline
// that has passed takes effect when it is asked. `now` is whole seconds, like the engine's.
import { newVector, waitingOn } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { catchUp } from './lifecycle-catch-up.js'

const REGION = 'run'
const nowSeconds = () => Math.floor(Date.now() / 1000)
const seconds = text => { const at = Date.parse(text || ''); return Number.isFinite(at) ? Math.floor(at / 1000) : null }

// THE TABLE of this host, both directions. `words` are what is stored or observed: `unsent` (the current cycle was recorded and no
// conversation confirmed its start: loadCycleState's `cycle`, neither delivered nor closed), `chat` (a conversation is recorded),
// `phase` (what the platform says about it, ui/useProjectCycle.js projectCyclePhase; a list means any of) and `dismissed` (the owner
// dismissed this run on its cycle record, or the platform says the owner stopped it: the table's DISMISS rows, which end a stop or a
// failure that needs nothing more). The first row that matches is the state. The phase word the screens show stays what it was.
export const RUN_WORDS = [
  { region: 'SENDING', words: { unsent: true } },
  { region: 'NONE', words: { chat: false } },
  { region: 'QUESTION', words: { phase: 'waiting' } },
  { region: 'DONE', words: { dismissed: true, phase: ['stopped', 'failed'] } },
  { region: 'STOPPED', words: { phase: 'stopped' } },
  { region: 'FAILED', words: { phase: 'failed' } },
  { region: 'DONE', words: { phase: ['complete', 'inactive'] } },
  // Running, scheduled (work the platform resumes by itself, parked included), paused by the owner, and a status that could not be
  // read: nothing says the run ended, so the agent still holds it.
  { region: 'RUNNING', words: {} },
]
// The phase word a state is shown as, the other way. NOT_SENT is a start that needs sending again: the screens' `unsent`.
export const RUN_PHASES = { NONE: 'idle', SENDING: 'starting', NOT_SENT: 'idle', RUNNING: 'running', QUESTION: 'waiting', STOPPED: 'stopped', FAILED: 'failed', DONE: 'complete' }

const fits = (words, found) => Object.entries(words).every(([key, value]) => (Array.isArray(value) ? value : [value]).includes(found[key]))

export const runStateOf = found => RUN_WORDS.find(row => fits(row.words, found))?.region ?? 'RUNNING'

// Whether the platform says the OWNER stopped this run. Its run status tells an explicit Stop ("stopped", what the project's Cancel active
// work does) from a run that ended by itself or was cut off (a restart or a crash: "interrupted"); the phase word the screens show reads
// both as `stopped`, which is right for them. Only a Stop the owner pressed needs nothing more from the owner.
export const stoppedByOwner = (runtime, phase) => phase === 'stopped' && runtime?.run_status === 'stopped'

// The cycle the project record still waits on: recorded, never confirmed, never closed.
export const unsentCycle = record => Boolean(record?.cycle) && !record.cycle.delivered && !record.cycle.closed

// When the region's clock starts. A phase read from the platform just now restarts the hour of RUNNING (the platform was asked);
// a record nobody has read yet keeps the time it was begun, so it asks again once an hour has passed.
function sinceOf(record, region, { phase, observedAt, now }) {
  if (region === 'SENDING') return seconds(record?.cycle?.started_at) ?? now
  if (phase === null) return seconds(record?.started_at) ?? now
  return seconds(observedAt) ?? now
}

// -> { vector, effects }. `record` is the project's cycle record (loadCycleState) or null; `phase` what the platform says about its
// conversation (null: not read yet); `observedAt` when it said so (the runtime's `updated_at`), which dates a stop or a failure;
// `ownerStopped` that the platform says the owner stopped it (stoppedByOwner).
// Effects are for the caller: REQUEST_OWNER is what the selector below reports, ASK_PLATFORM is the status read the hook already
// makes every few seconds while the project is shown.
export function runVectorOf({ record = null, phase = null, observedAt = null, ownerStopped = false, now = nowSeconds() } = {}) {
  const found = { unsent: unsentCycle(record), chat: Boolean(record?.chat_id), phase, dismissed: record?.dismissed === true || ownerStopped }
  const region = runStateOf(found)
  return catchUp(newVector(TABLES, { [REGION]: region }, sinceOf(record, region, { phase, observedAt, now }), false), now)
}

// THE selector: what this project's run waits on, as engine.waitingOn rows ([] when nothing is owed), for any screen that lists
// what needs the owner. A run the platform says stopped, failed or interrupted is `STOPPED` / `FAILED` with `waits: 'owner'`; a start
// that was never confirmed becomes `NOT_SENT` (`waits: 'owner'`) two minutes after it was recorded; a question is `QUESTION`.
export const runWaitingOn = args => waitingOn(TABLES, runVectorOf(args).vector)
