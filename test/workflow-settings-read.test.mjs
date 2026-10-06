import assert from 'node:assert/strict'
import test from 'node:test'
import { workflowSettings } from '../review-prompts.js'

function storageWith(results) {
  const calls = []
  globalThis.window = { mobius: { storage: { getWithVersion: async path => {
    calls.push(path)
    const next = results.shift()
    if (next instanceof Error) throw next
    return next
  } } } }
  return calls
}

test('a slow settings read gets one more attempt instead of failing the launch', async () => {
  const calls = storageWith([new Error('signal is aborted without reason'), { value: { review_prompt: 'Mine' }, version: 'v1' }])
  assert.deepEqual(await workflowSettings(), { value: { review_prompt: 'Mine' }, version: 'v1' })
  assert.equal(calls.length, 2)
})

test('a server that stays busy gets a plain message and never falls back to default prompts', async () => {
  const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  storageWith([aborted, aborted])
  await assert.rejects(workflowSettings(), /Möbius is busy/)
})

test('real storage errors are reported, not retried', async () => {
  const calls = storageWith([new Error('HTTP 500')])
  await assert.rejects(workflowSettings(), /HTTP 500/)
  assert.equal(calls.length, 1)
})
