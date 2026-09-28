import assert from 'node:assert/strict'
import test from 'node:test'

import { openGithubSettings } from '../github-connection.js'

test('connecting GitHub asks the host to open Settings at its GitHub row', (t) => {
  const sent = []
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  globalThis.window = { parent: { postMessage: (message, target) => sent.push({ message, target }) } }
  openGithubSettings()
  assert.deepEqual(sent, [{ message: { type: 'moebius:open-settings', section: 'github' }, target: '*' }])
})
