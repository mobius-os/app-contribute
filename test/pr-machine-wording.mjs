// Every owner-visible string of the PR machine, per shared case, as the text the platform's copy of the machine is held to
// (backend/tests/fixtures/contribution_pr_machine_wording.json there, test/pr-machine.wording.json here: the same bytes).
// pr-machine-wording.test.mjs compares this output with the committed fixture, so a changed word fails here first.
// Regenerate after a deliberate change:  node test/pr-machine-wording.mjs > test/pr-machine.wording.json
// then copy the file into the platform's fixture and update its lock (tests/fixtures/contribution_machine_cases_lock.json).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { decide } from '../pr-machine.js'

export const sharedCases = () => JSON.parse(readFileSync(new URL('./pr-machine.cases.json', import.meta.url), 'utf8')).cases

export function wordingText(cases) {
  const seen = new Set()
  const lines = cases.map(item => {
    if (seen.has(item.name)) throw new Error(`duplicate case name: ${item.name}`)
    seen.add(item.name)
    const decision = decide(item.facts)
    const actions = decision.actions.map(({ id, title, detail, reason }) => `   ${JSON.stringify({ id, title, detail, reason })}`)
    return ` ${JSON.stringify(item.name)}: {\n  "label": ${JSON.stringify(decision.label)},\n  "headline": ${JSON.stringify(decision.headline)},\n  "waiting_on": ${JSON.stringify(decision.waitingOn)},\n  "actions": [\n${actions.join(',\n')}\n  ]\n }`
  })
  return `{\n${lines.join(',\n')}\n}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(wordingText(sharedCases()))
