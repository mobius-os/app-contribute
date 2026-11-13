// What the sync hub does for the repositories' lists (ui/useBackgroundLists.js): reads them before anyone opens them,
// by tier (list-tiers.js), one at a time, and keeps the pinned ones current from a probe. The lists themselves,
// and how each is read, are repository-lists.js's.
import { readListProbe, readOpenCounts } from './list-reads.js'

const PAUSED = 'Background reading paused'

// One pass, as far as the hub lets it go (`paused()` is true when the frame is hidden or the account low on points):
//   `moved`    the pinned repositories the probe saw something move in: brought up to date from what moved
//   pinned, then active, each in order and each not yet read this visit: read in full (or, with no list yet, by its titles first)
//   quiet      one question for how many open PRs each has, so the empty ones show their empty list without a read
// `syncing` is the owner's Sync: what was read already is brought up to date from what moved. A repository whose read
// failed does not stop the others; the pass then fails as a whole, so the hub reads it again after its cooldown.
// `counted` holds the quiet repositories already asked about this visit.
export async function readListPass({ lists, token, tiers, paused, moved = [], syncing = false, counted = new Set() }) {
  let failed = false
  const attempt = async (repo, how) => {
    if (paused()) throw new Error(PAUSED)
    try { await lists.read(repo, { token, how }) } catch { failed = true }
  }
  for (const repo of moved) await attempt(repo, 'reconcile')
  for (const repo of [...tiers.pinned, ...tiers.active]) {
    if (!lists.entry(repo).sessionRead) await attempt(repo, 'refresh')
    else if (syncing && !moved.includes(repo)) await attempt(repo, 'reconcile')
  }
  const unknown = tiers.quiet.filter(repo => !lists.entry(repo).sessionRead && (syncing || !counted.has(repo)))
  if (unknown.length) {
    if (paused()) throw new Error(PAUSED)
    try {
      lists.applyCounts(await readOpenCounts(token, unknown))
      unknown.forEach(repo => counted.add(repo))
    } catch { failed = true }
  }
  if (failed) throw new Error('Some lists of pull requests could not be read')
}

// What the pinned repositories look like to the hub's probe: one signature each, of everything their lists show that
// moves, so the hub reports the repositories in which anything moved, a PR came or one went. A list that shows exactly
// what the probe saw is confirmed current as it is asked. Null when GitHub did not answer for every one, so a failed
// probe is never a change.
export async function probePinned(token, repos, lists) {
  if (!repos.length) return null
  const probes = await readListProbe(token, repos).catch(() => null)
  if (!probes || probes.size < repos.length) return null
  probes.forEach((probe, repo) => lists.confirm(repo, probe))
  return new Map([...probes].map(([repo, probe]) => [repo, `${probe.total}|${probe.pulls.map(pull => `${pull.number}:${pull.signature}`).join(',')}`]))
}
