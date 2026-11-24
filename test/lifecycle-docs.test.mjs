// The agent's ledger and card-ask documents teach the lifecycle the tables define,
// so a state or status word added to the tables cannot go unmentioned here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'

const read = name => readFileSync(new URL(`../contributing/${name}`, import.meta.url), 'utf8')
const flat = name => read(name).replace(/\s+/g, ' ')

const listed = value => (Array.isArray(value) ? value : [value]).filter(Boolean)
const statesOf = rows => [...new Set(rows.flatMap(({ where }) => Object.values(where).flatMap(listed)))]

test('ledger.md lists every status word the engine writes, and says only the engine path writes it', () => {
  const ledger = flat('ledger.md')
  const words = [...new Set(TABLES.status.flatMap(row => [row.status, ...row.also]))]
  assert.ok(words.includes('superseded'))
  for (const word of words) assert.match(ledger, new RegExp(`\`${word}\``), word)
  const statusList = ledger.match(/`status` ∈ `([^;]*?)`;/)[1]
  for (const word of [...words, 'commented']) assert.ok(statusList.includes(word), `${word} is in the status list`)
  assert.match(ledger, /`superseded_by`/)
  assert.match(ledger, /`landing` is the platform's own word/)
  assert.match(ledger, /only the engine path writes it/)
})

test('ledger.md maps every publication and update state to its status word', () => {
  const ledger = flat('ledger.md')
  for (const state of statesOf(TABLES.status)) assert.match(ledger, new RegExp(`\`${state}\``), state)
  assert.match(ledger, /The `lifecycle` field\*\* is optional/)
  assert.match(ledger, /`prepared` does not mean private/)
})

test('card-asks.md gives the three exits of a stranded update, and no fourth', () => {
  const section = read('card-asks.md').split('## A stranded update')[1]?.split('\n## ')[0]
  assert.ok(section, 'the section exists')
  const exits = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map(match => match[1])
  assert.deepEqual(exits, ['COVERED_BY_MERGE', 'PRESERVE_AS_NEW', 'DISCARD_UPDATE'])
  const table = TABLES.regions.update.transitions.filter(row => row.from === 'STRANDED_UPDATE').map(row => row.event)
  for (const exit of exits) assert.ok(table.includes(exit), `${exit} is an event the tables accept from STRANDED_UPDATE`)
  assert.match(section.replace(/\s+/g, ' '), /never approval to send/)
})

test('card-asks.md says how every exit a card or an agent can take is recorded, and gives the merge that never landed its own exit', () => {
  const asks = read('card-asks.md')
  const section = asks.split('## A merge that never landed')[1]
  assert.ok(section, 'the section exists')
  assert.deepEqual([...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map(match => match[1]), ['OWNER_RELANDS'])
  assert.ok(TABLES.regions.publication.transitions.some(row => row.from === 'ORPHANED' && row.event === 'OWNER_RELANDS'))
  for (const exit of ['COVERED_BY_MERGE', 'PRESERVE_AS_NEW', 'DISCARD_UPDATE', 'OWNER_RELANDS']) assert.match(asks, new RegExp(`settle_exit\\.py <[a-z-]*record-id> ${exit}`), `${exit} names the operation that records it`)
  assert.match(asks.replace(/\s+/g, ' '), /only the checked writer records an exit/)
})
