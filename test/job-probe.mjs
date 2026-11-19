// The job's own planner (lifecycle_job.py) run over a record a screen stored, so a test can check the meeting of the two (test/plan_probe.py).
// A helper, not a test: node --test only runs *.test.mjs.
import { spawnSync } from 'node:child_process'

const PROBE = new URL('./plan_probe.py', import.meta.url).pathname
const ROOT = new URL('../', import.meta.url).pathname

// `passes` are the job's reads one after another: `{ node, now }` (now in whole seconds). -> [{ record, actions, polled }], one per pass.
export function jobPasses(record, passes) {
  const run = spawnSync('python3', [PROBE], { cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT }, input: JSON.stringify({ record, passes }), encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`the job's planner failed:\n${run.stderr}`)
  return JSON.parse(run.stdout)
}

// The GitHub read of a merged PR as the job's batched query returns it (test_lifecycle_job.py `node`).
export const mergedNode = (base, defaultBranch = 'main') => ({ __typename: 'PullRequest', state: 'MERGED', isDraft: false, baseRefName: base, mergedAt: '2026-11-17T00:00:00Z', repository: { defaultBranchRef: { name: defaultBranch } } })
export const closedNode = (base = 'main', defaultBranch = 'main') => ({ __typename: 'PullRequest', state: 'CLOSED', isDraft: false, baseRefName: base, repository: { defaultBranchRef: { name: defaultBranch } } })

export const publicationOf = record => record.lifecycle?.regions?.publication?.state
export const updateOf = record => record.lifecycle?.regions?.update?.state
