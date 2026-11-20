import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  adopt, allowed, apply, checkTables, newVector, observe, shownAttention, statusOf, tick, waitingOn,
} from '../lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'

const read = name => readFileSync(new URL(name, import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const lock = JSON.parse(read('./lifecycle.lock.json'))
const file = JSON.parse(read('./lifecycle.cases.json'))

// The same rendering as Python's json.dumps(sort_keys=True, separators=(',', ':')).
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const startOf = start => {
  if (!start) return null
  const vector = newVector(TABLES, start.states, start.now, start.attention)
  if (start.flags) vector.attention.flags = [...start.flags]
  for (const [region, deadline] of Object.entries(start.deadlines || {})) vector.regions[region].deadline = deadline
  return vector
}

const OPS = {
  apply: (vector, payload, now) => apply(TABLES, vector, payload, now),
  tick: (vector, payload, now) => tick(TABLES, vector, now),
  observe: (vector, payload, now) => observe(TABLES, vector, payload, now),
  adopt: (vector, payload, now) => adopt(TABLES, vector, payload, now),
}

test('the generated JavaScript tables are the Python tables', () => {
  assert.equal(sha256(canonical(TABLES)), lock.tables_sha256)
})

test('the case file is the one the lock pins', () => {
  assert.equal(sha256(read('./lifecycle.cases.json')), lock.cases_sha256)
})

test('the tables obey their own rules', () => {
  assert.deepEqual(checkTables(TABLES), [])
})

test('every shared case gives the stored answer, step by step', () => {
  for (const item of file.cases) {
    let vector = startOf(item.start)
    for (const [index, step] of item.steps.entries()) {
      const result = OPS[step.op](vector, step.payload, step.now)
      assert.deepEqual(result, step.result, `${item.name} (step ${index})`)
      if (!result) continue
      vector = result.vector
      assert.deepEqual(waitingOn(TABLES, vector), step.waiting, `${item.name} (step ${index}) waiting`)
      if (vector.regions.publication) assert.equal(statusOf(TABLES, vector), step.status, `${item.name} (step ${index}) status`)
    }
  }
})

test('an event with no row for the state is refused and changes nothing', () => {
  for (const [region, state, type] of file.refusals) {
    const vector = newVector(TABLES, { [region]: state }, 1, false)
    const result = apply(TABLES, vector, { type, source: 'test' }, 2)
    assert.equal(result.refusal?.reason, 'no_transition', `${region} ${state} ${type}`)
    assert.deepEqual(result.vector.regions, vector.regions)
    assert.equal(allowed(TABLES, vector, type), false)
  }
})

test('every publication and update pair has the stored status word', () => {
  for (const [publication, update, status] of file.statuses) {
    assert.equal(statusOf(TABLES, newVector(TABLES, { publication, update }, 1)), status)
  }
})

test('the shown flag is the first by priority', () => {
  const vector = newVector(TABLES, { publication: 'OPEN' }, 1)
  assert.equal(shownAttention(vector), null)
  vector.attention.flags = ['checks_failed', 'github_activity']
  assert.equal(shownAttention(vector), 'checks_failed')
})

// The platform carries the same tables, engine and cases. Two repositories cannot share one
// CI run, so each pins the lock, and the two locks are compared wherever a checkout of the
// platform is named (LIFECYCLE_PLATFORM_LOCK). Never by default: an installed platform of
// another version must not turn this suite red.
test('the platform copy pins the same lock, when one is named', t => {
  const sibling = process.env.LIFECYCLE_PLATFORM_LOCK
  if (!sibling) return t.skip('LIFECYCLE_PLATFORM_LOCK is not set')
  assert.ok(existsSync(sibling), `${sibling} does not exist`)
  assert.deepEqual(JSON.parse(readFileSync(sibling)), lock)
})
