import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { discoverPull, prKey } from '../collaboration.js'
import { createRepositoryLists } from '../repository-lists.js'
import { SYNC_POLICY } from '../refresh.js'

// The app's lists of open PRs (repository-lists.js): index.jsx provides them, background reads fill them, and every
// screen of a repository shows what they hold. A screen rendered on its own keeps its lists in this one, for as long as the page lives.
export const RepositoryListsContext = createContext(null)
const standalone = createRepositoryLists()
export const useRepositoryLists = () => useContext(RepositoryListsContext) || standalone

// A repository's list on its screen: the rows and paging it holds now (from the last visit, a background read or this
// screen's own), kept up to date in place. A list confirmed current within a minute (the probe's cadence) is not read
// again when the screen opens. `held` says which PR the screen is on and which it has ticked (repository-lists.js hold);
// `onFocusError(error)` hears a PR that could not be read exactly.
export function useRepositoryList({ repo, token, connected, refreshKey, publicRevision, focusRef, held, onFocusError, presentation }) {
  const lists = useRepositoryLists()
  const list = lists.entry(repo)
  const subscribe = useCallback(listener => lists.subscribe(changed => { if (changed === list.repo) listener() }), [lists, list.repo])
  const getVersion = () => list.version
  useSyncExternalStore(subscribe, getVersion, getVersion)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => (repo ? lists.hold(repo, held) : undefined), [lists, repo, held])
  // The PR pages' snapshots belong to the list, and a first-page read clears them: the page of a PR shows what GitHub says now.
  const [detailRevision, setDetailRevision] = useState(0)
  const detailSnapshot = pr => {
    const key = `${prKey(pr)}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
    if (!list.details.has(key)) list.details.set(key, { entries: {}, stale: false })
    return list.details.get(key)
  }
  const readFocus = useCallback(async focus => {
    const issued = lists.issue(list)
    const current = () => alive.current && focusRef.current?.key === focus.key && focusRef.current.nonce === focus.nonce
    try {
      const pr = await discoverPull(token, focus.repo, focus.number)
      if (current()) lists.publish(list, [pr], issued)
    } catch (error) {
      if (current()) onFocusError({ key: focus.key, nonce: focus.nonce, issued, message: error.message })
    }
  }, [lists, list, token, focusRef, onFocusError])
  // The first page, or with a cursor the page after what is shown. The owner's reads (Sync, a changed record, an action's
  // aftermath, Try again) begin now, so what an action did is in the answer; a screen that only opens joins a read running.
  const load = useCallback(async (cursor = null, { fresh = true } = {}) => {
    if (cursor) { await lists.loadMore(list.repo, token); return }
    try { await lists.read(list.repo, { token, fresh }) } catch { return } // the list says what failed
    if (!alive.current) return
    // The owner's own reads show the PRs' pages as GitHub says now; a page that is open while the screen only updated is left as it is.
    if (fresh) { list.details.clear(); setDetailRevision(value => value + 1) }
    // Absence from the open list is not closure: re-read a pinned destination.
    const focus = focusRef.current
    if (focus && !list.view.inventory.includes(focus.key)) void readFocus(focus)
  }, [lists, list, token, focusRef, readFocus])
  // Open: the list the app already holds, updated in place unless it was confirmed lately. Sync or a changed record of
  // the owner's own: read again in place, so the rows stay where they are.
  const asked = useRef(null)
  useEffect(() => {
    if (!connected || !repo) return
    const key = `${refreshKey}|${publicRevision}`
    const moved = asked.current !== null && asked.current !== key
    asked.current = key
    if (moved) void load(null)
    else {
      if (presentation !== 'page') lists.opened(repo)
      if (!lists.fresh(repo, SYNC_POLICY.probeMs)) void load(null, { fresh: false })
    }
  }, [lists, connected, repo, token, refreshKey, publicRevision])
  return { view: list.view, data: list.data, read: list.settled, listed: list.listed, syncedAt: list.syncedAt, load, readFocus, detailSnapshot, detailRevision,
    acknowledge: (keys, login) => lists.acknowledge(list.repo, keys, login) }
}
