// What the Discard confirmation says. Discarding a prepared update only drops the
// update when the engine writes the record, so only that case has its own words; every other case, and
// every case while the engine is not the writer, says what it always did.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { newVector } from '../lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const copyOf = () => renderModule(`export { dismissCopy } from './ui/ContributionCard.jsx'`)
const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')

const HEAD = 'b'.repeat(40)
const PULL = { repo: 'owner/repo', number: 12, url: 'https://github.com/owner/repo/pull/12' }
const update = (more = {}) => ({ id: 'upd', type: 'pr', status: 'prepared', ...PULL, plan: { action: 'pr_update', head_sha: HEAD }, ...more })
const fresh = (more = {}) => ({ id: 'new', type: 'pr', status: 'prepared', plan: { action: 'pr', head_sha: HEAD }, ...more })
const TODAY = { title: 'Discard this prepared pull request?', text: 'It will leave your active list and can be restored from Dismissed.' }

test('with the engine as the writer, discarding a prepared update says the pull request stays', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { dismissCopy } = await copyOf()
  const copy = dismissCopy(update(), { engine: true, isPr: true })
  assert.deepEqual(copy, { title: 'Discard this update?', text: 'Only this update is dropped. The pull request stays on GitHub and Contribute keeps following it.' })
  assert.doesNotMatch(copy.text, /restored|Dismissed|active list/, 'nothing is moved to Dismissed in this case')
  // A draft pull request is the same case, so the words do not say "open".
  const draft = update({ lifecycle: newVector(TABLES, { publication: 'DRAFT', update: 'PREPARED_UPDATE', followup: 'OFF' }, Math.floor(Date.now() / 1000)) })
  assert.deepEqual(dismissCopy(draft, { engine: true }), copy)
})

test('every other case says what it always did', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { dismissCopy } = await copyOf()
  // Shadow, the default (the setting absent or "shadow"): the update is abandoned as today, so the old words are true.
  for (const record of [update(), fresh()]) assert.deepEqual(dismissCopy(record, { engine: false, isPr: true }), TODAY)
  assert.deepEqual(dismissCopy(update()), TODAY, 'no setting at all is shadow')
  // Engine, but work that was never sent: it is abandoned, restorable from Dismissed.
  assert.deepEqual(dismissCopy(fresh(), { engine: true, isPr: true }), TODAY)
  assert.deepEqual(dismissCopy({ id: 'issue', type: 'issue', status: 'prepared', plan: { action: 'issue' } }, { engine: true, isPr: false }),
    { title: 'Discard this draft?', text: TODAY.text })
  // Engine, a record that is no longer waiting: discarding changes nothing, so no new promise is made.
  assert.deepEqual(dismissCopy(update({ status: 'open' }), { engine: true, isPr: true }), TODAY)
})

test('the card keeps its plain-language text and asks the writer setting only for an update', () => {
  assert.match(cardSource, /can be restored from Dismissed/)
  assert.match(cardSource, /title=\{discardCopy\.title\}/)
  assert.match(cardSource, /text=\{discardCopy\.text\}/)
  assert.match(cardSource, /if \(!isUpdate\) return undefined/, 'the setting is read only for a prepared update')
})
