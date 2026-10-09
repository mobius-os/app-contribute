import { collaborationRequest } from './collaboration.js'

const KEYS = ['review_prompt', 'fix_prompt', 'merge_prompt', 'max_rounds', 'autopilot', 'post_review']
export function reviewOptions(value, defaults) {
  return Object.fromEntries(KEYS.map(key => [key,
    key === 'max_rounds' && value?.[key] === null ? null : value?.[key] ?? defaults?.[key],
  ]).filter(([,value]) => value !== undefined))
}
// The exact saved prompts must back every launch, so this never falls back to
// defaults. The runtime bounds each read to a few seconds; a slow but healthy
// server gets one more attempt before the owner sees a plain retry message.
export async function workflowSettings() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await window.mobius.storage.getWithVersion('review-workflow.json')
      if (result.offline) throw new Error('Go online to check the saved workflow settings.')
      return result
    } catch (error) {
      // The storage bridge may forward only the message of the runtime's abort.
      if (error?.name !== 'AbortError' && !/\babort/i.test(error?.message || '')) throw error
      if (attempt >= 1) throw new Error('Möbius is busy and didn’t answer in time. Try again in a moment.')
    }
  }
}
export async function saveWorkflowOptions(value, version) {
  const receipt = await window.mobius.storage.durableWrite('review-workflow.json', reviewOptions(value), version ? { ifMatch:version } : { ifNoneMatch:true })
  if (receipt.durability !== 'synced') throw new Error('Settings are not confirmed saved. Go online and try again.')
  return receipt
}
export async function loadWorkflowOptions(token, appId) {
  const [presets, saved] = await Promise.all([
    collaborationRequest(token, appId, 'review-presets'), workflowSettings(),
  ])
  const defaults = presets.presets || presets
  // Settings apply to new work. A legacy budget must not silently cap a new run;
  // saved selections still pass their exact frozen options through reviewOptions.
  return { defaults, capabilities:presets.capabilities || {}, version:saved.version, options:reviewOptions({ ...saved.value, max_rounds:null }, { ...defaults, autopilot:true }) }
}
export function workflowAgent(choice) {
  if (!choice?.provider || !choice?.model) return undefined
  return { provider:choice.provider, model:choice.model, ...(choice.effort ? { effort:choice.effort } : {}) }
}
export function previewWorkflow(token, appId, mode, options, agent) {
  return collaborationRequest(token, appId, 'review-preview', { mode, options:reviewOptions(options), ...(agent ? {agent} : {}) })
}
