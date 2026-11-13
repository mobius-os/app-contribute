// What the sync hub does for the repositories' lists (ui/useBackgroundLists.js): reads them before anyone opens them,
// by tier (list-tiers.js), one at a time, and keeps the pinned ones current from a probe. The lists themselves,
// and how each is read, are repository-lists.js's.
import { readListProbe, readOpenCounts } from './list-reads.js'

const PAUSED = 'Background reading paused'

// What the next pass is asked to do besides its own work: `moved` the pinned repositories the probe found behind GitHub,
// `probed` that the pass was started by the probe (so it only brings those up to date), `syncing` the owner's Sync.
export const newWanted = () => ({ moved: new Set(), probed: false, syncing: false })

// One pass, as far as the hub lets it go (`paused()` is true when the frame is hidden or the account low on points):
//   `wanted.moved`  brought up to date from what moved (a probe's pass does nothing else, so it never skips the hub's cooldown)
//   pinned, then active, each in order and each not yet read this visit: read in full (or, with no list yet, by its titles first)
//   quiet      one question for how many open PRs each has, so the empty ones show their empty list without a read
// `wanted.syncing` is the owner's Sync: what was read already is brought up to date from what moved. A repository whose
// read failed does not stop the others; the pass then fails as a whole, so the hub reads it again after its cooldown, and
// what the pass was asked to bring up to date (`wanted`) is asked again with it. `counted` holds the quiet repositories
// already asked about this visit.
export async function readListPass({ lists, token, tiers, paused, wanted, counted = new Set() }) {
  const asked = { moved: [...wanted.moved], probed: wanted.probed, syncing: wanted.syncing }
  Object.assign(wanted, { moved: new Set(), probed: false, syncing: false })
  try {
    await pass({ lists, token, tiers, paused, counted, ...asked })
  } catch (error) {
    asked.moved.forEach(repo => wanted.moved.add(repo))
    wanted.syncing ||= asked.syncing
    throw error
  }
}

async function pass({ lists, token, tiers, paused, counted, moved, probed, syncing }) {
  let failed = false
  const attempt = async (repo, how) => {
    if (paused()) throw new Error(PAUSED)
    try { await lists.read(repo, { token, how }) } catch { failed = true }
  }
  for (const repo of moved) await attempt(repo, 'reconcile')
  if (probed && !syncing) return failIf(failed)
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
  failIf(failed)
}

const failIf = failed => { if (failed) throw new Error('Some lists of pull requests could not be read') }

// Asks GitHub about the pinned repositories, and tells which of their lists are behind it (a PR moved, came or went since
// the list was read); a list that is not is confirmed current as of now. The same question answers it every minute, so a list
// that was not brought up to date (the read failed or was stopped) is found behind again at the next one. Null when
// GitHub did not answer for every one, so a failed probe is never a change.
export async function probePinned(token, repos, lists) {
  if (!repos.length) return null
  const probes = await readListProbe(token, repos).catch(() => null)
  if (!probes || probes.size < repos.length) return null
  return [...probes].filter(([repo, probe]) => lists.checkAgainst(repo, probe) === 'behind').map(([repo]) => repo)
}
