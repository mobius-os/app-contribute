// Reading the saved Respond-to-feedback results and writing the owner's decision, through the app's storage.
// The helper writes `respond-results/`; the app writes `respond-decisions/` and `respond-findings/`; neither writes the other's folder.
import { DECISION_FOLDER, RESULT_FOLDER, normalizeDecision, normalizeResult, postingSoon, resultSlug } from './respond-result.js'
import { SYNC_POLICY } from './refresh.js'

const storageOf = () => window.mobius.storage

// Every .json file of a folder, by file name. A body the listing left out (too large for its page) is read on its own.
async function readFolder(storage, prefix) {
  const listing = await storage.listWithStatus(prefix, { includeContent: true })
  if (listing?.complete !== true) throw new Error('Responses could not be read completely')
  const files = new Map()
  for (const entry of listing.entries || []) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const content = Object.prototype.hasOwnProperty.call(entry, 'content') ? entry.content : await storage.get(entry.path || prefix + entry.name)
    files.set(entry.name, content)
  }
  return files
}

// Every saved response with the owner's decision about it: `{ slug, result, decision }`. Throws when the folders cannot be read
// completely, so a screen keeps what it last knew instead of showing nothing.
export async function loadResponses(storage = storageOf()) {
  const [results, decisions] = await Promise.all([readFolder(storage, RESULT_FOLDER), readFolder(storage, DECISION_FOLDER)])
  const responses = []
  for (const [name, raw] of results) {
    const result = normalizeResult(raw)
    // A file only counts under its own PR's name, so a stray or renamed file can never speak for another PR.
    if (!result || name !== `${resultSlug(result.repo, result.number)}.json`) continue
    responses.push({ slug: name.slice(0, -'.json'.length), result, decision: normalizeDecision(decisions.get(name)) })
  }
  return responses
}

// The result as the server holds it right now, for a decision that publishes. An offline answer is not trusted.
export async function readFreshResult(slug, storage = storageOf()) {
  const loaded = await storage.getWithVersion(`${RESULT_FOLDER}${slug}.json`)
  return loaded?.offline ? null : normalizeResult(loaded?.value)
}

// A file the helper or the agent reads from disk, accepted only when the server has it. `what` names it in the sentence the owner reads.
async function writeDurably(path, value, what, storage) {
  try {
    const receipt = await storage.durableWrite(path, value)
    return receipt?.durability === 'synced' ? { ok: true } : { ok: false, error: `This ${what} was not saved online. Sync before trying again.` }
  } catch {
    return { ok: false, error: `This ${what} could not be saved. Sync and try again.` }
  }
}

// The owner's decision: the helper reads it from disk before it posts anything.
export const writeDecision = (slug, { result_id: resultId, digest, decision, at }, storage = storageOf()) =>
  writeDurably(`${DECISION_FOLDER}${slug}.json`, { version: 1, result_id: resultId, digest, decision, at }, 'decision', storage)

// The whole saved review of a ticked item, where its brief tells the agent to read it (address-feedback.js). Nothing to write when none is ticked.
export function writeFindings(items, storage = storageOf()) {
  const item = items.find(item => item.checked && item.file)
  return item ? writeDurably(item.file, item.text, 'copy of the findings', storage) : { ok: true }
}

export async function clearDecision(slug, storage = storageOf()) {
  try { await storage.remove(`${DECISION_FOLDER}${slug}.json`) } catch { /* the helper only ever acts on an approval for the exact answer, so a left-over one is harmless */ }
}

// The saved answers as a fact of the sync hub (ui/useRespondResults.js): read now and then, and closely while an answer is being posted,
// so the card follows the posting script step by step. A failed read keeps what is shown. These are reads of the app's own storage.
export const respondFact = apply => ({
  read: () => loadResponses(),
  apply,
  failed: () => {},
  every: { live: SYNC_POLICY.responsesLiveMs, idle: SYNC_POLICY.runsIdleMs },
  live: list => !!list && list.some(entry => postingSoon(entry)),
})
