// The saved Respond answers are read again every 30 s: a file that did not change is not downloaded again.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadResponses, rememberResponseFolders, respondFact } from '../respond-store.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const SLUG = 'owner__repo__7'
const RESULT = `respond-results/${SLUG}.json`
const DECISION = `respond-decisions/${SLUG}.json`

// Files with a modified time and size, as the platform lists them; `calls` says what was asked.
function stampedStorage(files, { bodiesLeftOut = [], offlineReads = false, versioned = true } = {}) {
  const calls = []
  const stamps = {}
  const storage = {
    calls, files,
    touch(path) { stamps[path] = (stamps[path] || 0) + 1 },
    async listWithStatus(prefix, options = {}) {
      calls.push(['list', prefix, options.includeContent === true])
      const entries = Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => ({
        type: 'file', name: path.slice(prefix.length), path, size: JSON.stringify(content).length, modified_at: `2026-11-13T09:00:00.${String(stamps[path] || 0).padStart(6, '0')}Z`,
        ...(options.includeContent && !bodiesLeftOut.includes(path) ? { content: structuredClone(content) } : {}),
      }))
      return { entries, complete: true }
    },
    async get(path) { calls.push(['get', path]); return structuredClone(files[path] ?? null) },
  }
  if (versioned) storage.getWithVersion = async path => { calls.push(['read', path]); return { value: structuredClone(files[path] ?? null), version: 'v', offline: offlineReads } }
  return storage
}
const reads = storage => storage.calls.filter(call => call[0] === 'read' || call[0] === 'get').map(call => call[1])
const lists = storage => storage.calls.filter(call => call[0] === 'list').map(call => `${call[1]}${call[2] ? ' with content' : ''}`)
const decisionFor = result => ({ version: 1, result_id: result.id, digest: result.digest, decision: 'approved', at: '2026-11-06T09:30:00Z' })

test('the first read takes the small bodies with the listing, and the next reads only the files that changed', async () => {
  const storage = stampedStorage({ [RESULT]: example(), [DECISION]: decisionFor(example()) }, { bodiesLeftOut: [RESULT] })
  const memory = rememberResponseFolders()
  const first = await loadResponses(storage, memory)
  assert.deepEqual(lists(storage), ['respond-results/ with content', 'respond-decisions/ with content'])
  assert.deepEqual(reads(storage), [RESULT], 'a body too large for the listing is read on its own, once')

  storage.calls.length = 0
  const again = await loadResponses(storage, memory)
  assert.deepEqual(lists(storage), ['respond-results/', 'respond-decisions/'], 'later reads list names and stamps only')
  assert.deepEqual(reads(storage), [], 'nothing changed, nothing is read')
  assert.deepEqual(again, first)
})

test('an answer that changed is read again, from the server, and only that one', async () => {
  const other = { ...example(), number: 9, id: 'r-111111111111' }
  const storage = stampedStorage({ [RESULT]: example(), 'respond-results/owner__repo__9.json': other }, { bodiesLeftOut: [RESULT] })
  const memory = rememberResponseFolders()
  await loadResponses(storage, memory)
  storage.calls.length = 0
  storage.files[RESULT] = { ...example(), state: 'posting' }
  storage.touch(RESULT)
  const responses = await loadResponses(storage, memory)
  assert.deepEqual(reads(storage), [RESULT])
  assert.equal(responses.find(entry => entry.slug === SLUG).result.state, 'posting')
})

test('a decision written since the last read reaches the card', async () => {
  const storage = stampedStorage({ [RESULT]: example() })
  const memory = rememberResponseFolders()
  assert.equal((await loadResponses(storage, memory))[0].decision, null)
  storage.files[DECISION] = decisionFor(example())
  const [entry] = await loadResponses(storage, memory)
  assert.equal(entry.decision.decision, 'approved')
})

test('a file removed from the folder leaves the answers and the memory', async () => {
  const storage = stampedStorage({ [RESULT]: example() })
  const memory = rememberResponseFolders()
  assert.equal((await loadResponses(storage, memory)).length, 1)
  delete storage.files[RESULT]
  assert.deepEqual(await loadResponses(storage, memory), [])
  assert.equal(memory.results.size, 0)
})

test('a copy that did not come from the server is never remembered under a newer stamp', async () => {
  const storage = stampedStorage({ [RESULT]: example() }, { bodiesLeftOut: [RESULT], offlineReads: true })
  const memory = rememberResponseFolders()
  await loadResponses(storage, memory)
  assert.equal(memory.results.size, 0, 'an offline read of the runtime copy is shown but not kept')
  storage.calls.length = 0
  await loadResponses(storage, memory)
  assert.deepEqual(storage.calls.filter(call => call[0] === 'get').map(call => call[1]), [RESULT], 'so it is read again until the server answers')
})

test('on a runtime without versioned reads a left-out body still reads, and is read again every time', async () => {
  const storage = stampedStorage({ [RESULT]: example() }, { bodiesLeftOut: [RESULT], versioned: false })
  const memory = rememberResponseFolders()
  assert.equal((await loadResponses(storage, memory)).length, 1)
  storage.calls.length = 0
  assert.equal((await loadResponses(storage, memory)).length, 1)
  assert.deepEqual(reads(storage), [RESULT])
})

test('a listing without stamps is never taken as unchanged', async () => {
  const storage = stampedStorage({ [RESULT]: example() })
  const unstamped = { ...storage, async listWithStatus(prefix, options = {}) { const { entries, complete } = await storage.listWithStatus(prefix, options); return { complete, entries: entries.map(({ modified_at, size, ...rest }) => rest) } } }
  const memory = rememberResponseFolders()
  await loadResponses(unstamped, memory)
  assert.equal(memory.results.size, 0)
})

test('each reader of the answers has its own memory', async () => {
  const storage = stampedStorage({ [RESULT]: example(), [DECISION]: decisionFor(example()) })
  globalThis.window = { mobius: { storage } }
  const first = respondFact(() => {})
  const second = respondFact(() => {})
  await first.read()
  await second.read()
  assert.equal(lists(storage).filter(entry => entry === 'respond-results/ with content').length, 2)
  storage.calls.length = 0
  await first.read()
  assert.deepEqual(lists(storage), ['respond-results/', 'respond-decisions/'])
})
