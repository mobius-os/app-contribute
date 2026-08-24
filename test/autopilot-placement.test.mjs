import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const cardSource = readFileSync(
  new URL('../ui/ContributionCard.jsx', import.meta.url),
  'utf8',
)
const connectionSource = readFileSync(
  new URL('../ui/ConnectionCard.jsx', import.meta.url),
  'utf8',
)

test('autopilot defaults on and lives only in Contribute settings', () => {
  assert.match(appSource, /useState\(true\)/)
  assert.match(appSource, /autopilotDefault=\{autopilotDefault\}/)
  assert.match(appSource, /onToggleAutopilotDefault=\{onToggleAutopilotDefault\}/)
  assert.doesNotMatch(appSource, /className="co-autopilot-default/)
  assert.match(connectionSource, /className="co-autopilot-setting"/)
  assert.match(connectionSource, /<strong>Follow sent PRs<\/strong>/)
  assert.doesNotMatch(cardSource, /After you send, autopilot answers reviews/)
  assert.doesNotMatch(cardSource, /autopilotOn/)
})
