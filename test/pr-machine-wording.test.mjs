// The words the owner reads (chip, headline, who it waits on, each action's title, detail and refusal) are pinned per shared case.
// The platform's PR machine is held to the same bytes (its fixture is a copy of test/pr-machine.wording.json, locked by hash), so a word
// changed in pr-machine.js fails this suite until the fixture, then the platform's copy and its lock, follow.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { sharedCases, wordingText } from './pr-machine-wording.mjs'

const fixtureText = readFileSync(new URL('./pr-machine.wording.json', import.meta.url), 'utf8')

test('the wording fixture covers exactly the shared cases', () => {
  assert.deepEqual(Object.keys(JSON.parse(fixtureText)).sort(), sharedCases().map(item => item.name).sort())
})

test('every owner-visible string of every shared case is the one the fixture pins', () => {
  const words = JSON.parse(wordingText(sharedCases()))
  const pinned = JSON.parse(fixtureText)
  for (const name of Object.keys(pinned)) assert.deepEqual(words[name], pinned[name], `${name}: regenerate with node test/pr-machine-wording.mjs`)
})

test('the fixture is byte for byte what the machine says now', () => {
  assert.equal(wordingText(sharedCases()), fixtureText, 'regenerate: node test/pr-machine-wording.mjs > test/pr-machine.wording.json')
})
