import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

async function helpers(t) {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
    return null
  }
  return renderModule(`
    import { effortOptions, filterModelRegistry, preferredEffort } from './ui/AgentModelSettings.jsx'
    export { effortOptions, filterModelRegistry, preferredEffort }
  `)
}

test('model choices follow the live registry instead of app-owned capability lists', async t => {
  const api = await helpers(t)
  if (!api) return
  const model = { id: 'future-model', effort_levels: ['low', 'high', 'high'], default_effort: 'high' }
  assert.deepEqual(api.effortOptions(model), ['low', 'high'])
  assert.equal(api.preferredEffort(model, 'missing'), 'high')
  assert.deepEqual(api.effortOptions({ id: 'plain-model' }), [])
})

test('model search retains new providers returned by Möbius', async t => {
  const api = await helpers(t)
  if (!api) return
  const groups = api.filterModelRegistry({
    codex: [{ id: 'gpt-next', label: 'Next' }],
    local_runtime: [{ id: 'small-fast', label: 'Small Fast' }],
  }, 'small')
  assert.deepEqual(groups.map(group => [group.provider, group.label, group.models[0].id]), [
    ['local_runtime', 'Local runtime', 'small-fast'],
  ])
})
