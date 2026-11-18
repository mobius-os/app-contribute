// A settings toggle that was not saved says so and goes back and a save moves the base the next save compares with.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { loadAppSettings, saveAppSettings, settleSetting } from '../storage.js'

const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict', status: 412 })
const SETTINGS = 'settings.json'

// A versioned store: every write bumps the version, and a conditional write against another version is a 412.
function versionedStore(files) {
  const versions = new Map(Object.keys(files).map(path => [path, 1]))
  const storage = {
    get: async path => structuredClone(files[path] ?? null),
    getWithVersion: async path => ({ value: structuredClone(files[path] ?? null), version: path in files ? String(versions.get(path)) : null }),
    set: async () => { throw new Error('a blind write') },
    durableWrite: async (path, value, options) => {
      if (options?.ifMatch !== String(versions.get(path))) throw conflict()
      files[path] = structuredClone(value)
      versions.set(path, versions.get(path) + 1)
      return { durability: 'synced' }
    },
  }
  // Another view's write: it changes the file and moves its version on.
  const change = edit => { files[SETTINGS] = edit(structuredClone(files[SETTINGS])); versions.set(SETTINGS, versions.get(SETTINGS) + 1) }
  return { storage, files, change }
}
const useStorage = (t, files) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  const store = versionedStore(files)
  globalThis.window = { mobius: { online: true, storage: store.storage } }
  return store
}

test('a later save built from the caller\'s own earlier save does not put that change back over another writer\'s newer value', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } })
  const settings = await loadAppSettings()
  const afterFirst = { ...settings, new_pr_stage: 'draft' }
  assert.equal(await saveAppSettings(afterFirst), true)
  // Another view sets the stage back, then this one saves a different setting from what it holds.
  store.change(file => ({ ...file, new_pr_stage: 'ready' }))
  assert.equal(await saveAppSettings({ ...afterFirst, autopilot_default: false }), true)
  assert.equal(store.files[SETTINGS].autopilot_default, false, 'this save\'s own change is written')
  assert.equal(store.files[SETTINGS].new_pr_stage, 'ready', 'the earlier change is not applied a second time over the other writer\'s value')
})

test('two saves built from one read still keep each other\'s changes, and a change is still written when it is new', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } })
  const settings = await loadAppSettings()
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), true)
  assert.equal(await saveAppSettings({ ...settings, autopilot_default: false }), true)
  assert.deepEqual([store.files[SETTINGS].new_pr_stage, store.files[SETTINGS].autopilot_default], ['draft', false])
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft', autopilot_default: false, review_agent: { provider: 'claude', model: 'm' } }), true)
  assert.deepEqual(store.files[SETTINGS].review_agent, { provider: 'claude', model: 'm' })
})

test('a save that did not happen leaves the base alone, so the same change is tried again by the next save', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } })
  const settings = await loadAppSettings()
  store.storage.getWithVersion = async () => ({ value: null, version: null, offline: true })
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), false, 'offline')
  store.storage.getWithVersion = async path => ({ value: structuredClone(store.files[path]), version: '1' })
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), true)
  assert.equal(store.files[SETTINGS].new_pr_stage, 'draft', 'the failed change was not taken as written')
})

test('a control goes back to what it showed when its save did not happen, unless a later pick replaced it', () => {
  let shown = 'draft'
  assert.equal(settleSetting(false, update => { shown = update(shown) }, 'draft', 'ready'), false)
  assert.equal(shown, 'ready', 'back to what it showed')
  shown = 'ready'
  settleSetting(false, update => { shown = update(shown) }, 'draft', 'draft')
  assert.equal(shown, 'ready', 'a later pick that is on screen stays')
  let touched = false
  assert.equal(settleSetting(true, () => { touched = true }, 'draft', 'ready'), true)
  assert.equal(touched, false, 'a saved setting is left as shown')
})

// ---- The screens: every settings save of index.jsx puts the control back and says so, in the words of a failed pin (ui/AlwaysLoad.jsx).
const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const pin = readFileSync(new URL('../ui/AlwaysLoad.jsx', import.meta.url), 'utf8')

test('the three toggles and the set-aside note report a failed save, in the words the pins use, and show them as errors do', () => {
  assert.match(pin, /Could not save this\. Try again\./)
  assert.match(app, /const SETTING_NOT_SAVED = 'Could not save this\. Try again\.'/)
  assert.match(app, /if \(!settleSetting\(saved, setNewPrStage, stage, before\)\) setSettingsError\(SETTING_NOT_SAVED\)/)
  assert.match(app, /if \(!settleSetting\(saved, setReviewAgent, agent, before\)\) setSettingsError\(SETTING_NOT_SAVED\)/)
  assert.match(app, /if \(!settleSetting\(saved, setAutopilotDefault, next, before\)\) setSettingsError\(SETTING_NOT_SAVED\)/)
  assert.match(app, /if \(saved\) setIgnoredReviews\(notes\)\s*\n\s*else setSettingsError\(SETTING_NOT_SAVED\)/)
  assert.match(app, /\{settingsError \? <p className="co-run-error" role="alert">\{settingsError\}<\/p> : null\}/)
  assert.equal((app.match(/void updateAppSettings\(/g) || []).length, 1, 'only the "last looked" mark is fire and forget: it is no control, and the next visit writes it again')
})

test('the note that a setting did not save goes when the owner moves to another screen, and is set again only by a failed save', () => {
  assert.match(app, /const pageKey = pullPage \? `\$\{pullPage\.repo\}#\$\{pullPage\.number\}` : ''\s*\n\s*useEffect\(\(\) => \{ setSettingsError\(''\) \}, \[deskView, projectOpen, pageKey\]\)/)
  assert.equal((app.match(/setSettingsError\(SETTING_NOT_SAVED\)/g) || []).length, 4, 'only a failed save sets it')
  assert.equal((app.match(/setSettingsError\(''\)/g) || []).length, 5, 'each save starts without it, and so does each screen')
})
