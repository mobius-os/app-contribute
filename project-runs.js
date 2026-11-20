// What every project's agent run is doing, for the Desk: each project's saved cycle record and what the platform says about its one
// conversation, as the rows of the lifecycle's `run` region (cycle-lifecycle.js runWaitingOn). The project's own page watches its run
// while it is open (ui/useProjectCycle.js); this reads all of them, so a run that stopped or failed is on the Desk and not only in its project.
import { runWaitingOn, stoppedByOwner } from './cycle-lifecycle.js'

const nowSeconds = () => Math.floor(Date.now() / 1000)

// The projects the Desk follows, as { key, name } with the key the cycle record is saved under (source-map.js projectCycleIdentity).
export function runProjects(projects, identityOf) {
  const seen = new Set()
  return (projects || []).filter(project => project.kind !== 'external').flatMap(project => {
    const key = identityOf(project)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ key, name: project.name }]
  })
}

// One project's run, or null when nothing of it is owed. A conversation whose status could not be read keeps what was last known of it
// (`previous`): a failed read is no evidence that a stopped run was started again.
async function readOne({ key, name }, { loadState, chatStatus, phaseOf, now, previous }) {
  const record = await loadState(key)
  if (!record) return null
  let phase = null
  let observedAt = null
  let ownerStopped = false
  if (record.chat_id) {
    const runtime = await Promise.resolve().then(() => chatStatus(record.chat_id)).catch(() => null)
    if (!runtime || runtime.error) return previous.find(run => run.key === key) || null
    phase = phaseOf(runtime)
    observedAt = runtime.updated_at ?? null
    ownerStopped = stoppedByOwner(runtime, phase)
  }
  const rows = runWaitingOn({ record, phase, observedAt, ownerStopped, now })
  return rows.length ? { key, name, record, phase, observedAt, rows } : null
}

// -> [{ key, name, record, phase, observedAt, rows }] for the projects whose run owes something (to the owner, or to a machine), in the given order.
// A project whose cycle record cannot be read fails the read, so what is shown stays as it was.
export async function readProjectRuns(projects, { loadState, chatStatus, phaseOf, now = nowSeconds(), previous = [] }) {
  const runs = await Promise.all(projects.map(project => readOne(project, { loadState, chatStatus, phaseOf, now, previous })))
  return runs.filter(Boolean)
}

// A run being sent or at work is read faster than one that rests.
export const projectRunsLive = runs => (runs || []).some(run => run.rows.some(row => ['SENDING', 'RUNNING'].includes(row.state)))
