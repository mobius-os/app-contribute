// The lists of open PRs of the repositories, kept in one place: the screen of a repository opens from what is
// known of its list (the last visit's copy, an earlier read, or a background read) and updates it in place, and the
// background reads (ui/useBackgroundLists.js) fill the same lists before anyone asks. Each entry is what the PR list
// screen used to keep for itself while the app was open: the rows and paging (`view`, `data`), the PR pages'
// snapshots (`details`) and the generation that orders reads. A list is read one way at a time per repository:
//   refresh    the first page in full, in place; with no list yet, the titles first and the details behind them
//   reconcile  ask which PRs moved (a point), read only those, drop the ones that closed, take in the new ones
import { PAGE_SIZE, discoverPulls, mergeSelection, prKey } from './collaboration.js'
import { moveSignature, readListProbe, readPullGroups, readTitles } from './list-reads.js'
import { acknowledgeAssignment, emptyPullView, isOpenPull, observePulls } from './pull-view.js'

const NO_ANSWER = 'GitHub did not answer. Sync to try again.'
const NO_SELECTION = new Set()

// `loading` is a read with nothing to show (the skeleton); `updating` one that changes a list already shown; `partial`
// that some rows still hold only their titles.
const settledData = (page = {}) => ({ total: page.total || 0, hasNextPage: !!page.hasNextPage, endCursor: page.endCursor || null, loading: false, updating: false, partial: false, error: '' })

// A list nothing is known of is waiting to be read: a screen shows placeholders for it, never an empty list.
const unknownData = () => ({ ...settledData(), loading: true })
const NO_FIRST = Object.freeze({ keys: [], total: 0, hasNextPage: false, endCursor: null })

const newEntry = repo => ({
  repo, version: 0,
  view: emptyPullView(), data: unknownData(), first: NO_FIRST,
  details: new Map(), generation: 0, requestId: 0, holds: new Set(),
  // `listed`: there is a list to show (restored, or read). `settled`: a read has finished, with an answer or an error.
  // `sessionRead`: a read of this visit answered in full, so what the list shows is no older than the open. `counted`: it is
  // empty only because a count said so (applyCounts): that is asked again at every open, so the copy does not keep it.
  listed: false, settled: false, sessionRead: false, counted: false, syncedAt: '', openedAt: '',
})

export function createRepositoryLists({ now = () => Date.now() } = {}) {
  const entries = new Map()
  const listeners = new Set()
  const flights = new Map()
  const stamp = () => new Date(now()).toISOString()

  function entry(repo) {
    const key = repo.toLowerCase()
    if (!entries.has(key)) entries.set(key, newEntry(key))
    return entries.get(key)
  }
  // `confirmed`: only the time the list was last known current moved, so nothing needs saving.
  function notify(list, { confirmed = false } = {}) {
    list.version += 1
    for (const listener of listeners) listener(list.repo, { confirmed })
  }
  function setData(list, patch) {
    list.data = { ...list.data, ...patch }
    notify(list)
  }
  const issue = list => ++list.generation

  // Every writer shows its answer through here, so the screens holding this list (selection, a focused PR) hear the
  // change as it lands. `inventory` is the list's membership and order; `data` is what the read leaves.
  function publish(list, pulls, issued, { inventory = list.view.inventory, announce = false, data = null } = {}) {
    const before = list.view
    const pinned = [...list.holds].map(hold => hold.focus()).filter(Boolean)
    list.view = observePulls(before, pulls, issued, { inventory, pinned })
    if (data) list.data = { ...list.data, ...data }
    for (const hold of list.holds) hold.published?.({ before, after: list.view, announce })
    notify(list)
  }

  // The screens that hold this list say which PR they focus and which they have ticked: a read keeps those rows.
  function hold(repo, held) {
    const list = entry(repo)
    list.holds.add(held)
    return () => { list.holds.delete(held) }
  }
  const selectedKeys = list => new Set([...list.holds].flatMap(held => [...(held.selected?.() || NO_SELECTION)]))

  // The first page in full. A first-page refresh must not discard selections from later pages: they are read too.
  async function readFirstPage(list, token, id) {
    const first = await discoverPulls(token, list.repo)
    let page = first
    while (page.hasNextPage && [...selectedKeys(list)].some(key => !page.pulls.some(pr => prKey(pr) === key))) {
      if (id !== list.requestId) return null
      const more = await discoverPulls(token, list.repo, page.endCursor)
      page = { ...more, pulls: mergeSelection(page.pulls, more.pulls) }
    }
    return id === list.requestId ? { first, page } : null
  }

  function settle(list) {
    Object.assign(list, { listed: true, settled: true, sessionRead: true, counted: false, syncedAt: stamp() })
  }

  // `announce`: the owner asked for this read, so a notice the screen still shows about an earlier change is cleared by it.
  async function refreshPage(list, token, id, announce) {
    const issued = issue(list)
    const read = await readFirstPage(list, token, id)
    if (!read) return
    const { first, page } = read
    list.first = { keys: first.pulls.map(prKey), total: first.total, hasNextPage: first.hasNextPage, endCursor: first.endCursor }
    settle(list)
    publish(list, page.pulls, issued, { inventory: page.pulls.map(prKey), announce, data: settledData(page) })
  }

  // A repository with no list yet: the titles at once (about a second), then the details in groups behind them.
  async function readTitlesFirst(list, token, id, announce) {
    const issued = issue(list)
    const light = await readTitles(token, list.repo)
    if (id !== list.requestId) return
    const keys = light.pulls.map(prKey)
    list.first = { keys, total: light.total, hasNextPage: light.hasNextPage, endCursor: light.endCursor }
    Object.assign(list, { listed: true, settled: true })
    // A row that is already whole (the last visit's, restored while this read was out) is not replaced by one with less in it.
    const lessThanKnown = pr => { const known = list.view.rows.get(prKey(pr))?.pr; return known && !known.titlesOnly }
    publish(list, light.pulls.filter(pr => !lessThanKnown(pr)), issued, { inventory: keys, announce, data: { ...settledData(light), updating: true, partial: true } })
    const refs = light.pulls.map(pr => ({ repo: list.repo, number: pr.number }))
    await readPullGroups(token, refs, { onGroup: pulls => { if (id === list.requestId) publish(list, pulls, issued) } })
    if (id !== list.requestId) return
    settle(list)
    setData(list, { updating: false, partial: false })
  }

  // A list that is the whole page it shows, read in full this visit, can be brought up to date from what moved.
  const canReconcile = list => list.listed && list.sessionRead && !list.data.hasNextPage && !list.data.partial

  // What a probe says of a list that is a whole page: the PRs in the order GitHub lists them (`inventory`), those whose rows
  // are not what GitHub holds (`moved`: they changed, came, or hold only their titles) and whether the list shows exactly that.
  function compare(list, probe) {
    const keyOf = number => `${list.repo}#${number}`
    const inventory = probe.pulls.map(found => keyOf(found.number))
    const moved = probe.pulls.filter(({ number, signature }) => {
      const known = list.view.rows.get(keyOf(number))?.pr
      return !known || known.titlesOnly || moveSignature(known) !== signature
    })
    const sameMembers = inventory.length === list.view.inventory.length && inventory.every((key, index) => key === list.view.inventory[index])
    return { inventory, moved, current: !moved.length && sameMembers }
  }

  // What a probe says of a list read in full this visit that is a whole page: `current` (its time moves, and nothing needs
  // saving), `behind` GitHub, or `unchecked` (a list read some other way, or of more than a page, is the read's to settle).
  function checkAgainst(repo, probe) {
    const list = entry(repo)
    if (!canReconcile(list) || probe.total > PAGE_SIZE) return 'unchecked'
    if (!compare(list, probe).current) return 'behind'
    list.syncedAt = stamp()
    notify(list, { confirmed: true })
    return 'current'
  }

  async function reconcile(list, token, id, announce) {
    const probe = (await readListProbe(token, [list.repo])).get(list.repo)
    if (!probe) throw new Error(NO_ANSWER)
    if (id !== list.requestId) return
    // More than a page: its paging (the total, the cursor) is read, not worked out from a probe.
    if (probe.total > PAGE_SIZE) return refreshPage(list, token, id, announce)
    const { inventory, moved, current } = compare(list, probe)
    if (current) { list.syncedAt = stamp(); list.data = { ...list.data, updating: false }; return notify(list, { confirmed: true }) }
    const issued = issue(list)
    const read = await readPullGroups(token, moved.map(({ number }) => ({ repo: list.repo, number })))
    if (id !== list.requestId) return
    // A PR GitHub no longer returns, or returns closed since the probe (it moved away, was deleted, merged), leaves the list.
    const asked = new Set(moved.map(({ number }) => `${list.repo}#${number}`)), got = new Set(read.filter(isOpenPull).map(prKey))
    const kept = inventory.filter(key => !asked.has(key) || got.has(key))
    list.first = { keys: kept, total: kept.length, hasNextPage: false, endCursor: null }
    settle(list)
    publish(list, read, issued, { inventory: kept, data: settledData({ total: kept.length }) })
  }

  async function perform(list, token, how, announce) {
    const id = ++list.requestId
    setData(list, { loading: !list.listed, updating: list.listed, error: '' })
    try {
      if (how === 'reconcile' && canReconcile(list)) await reconcile(list, token, id, announce)
      else if (list.listed) await refreshPage(list, token, id, announce)
      else await readTitlesFirst(list, token, id, announce)
    } catch (error) {
      if (id === list.requestId) { list.settled = true; setData(list, { loading: false, updating: false, error: error.message }) }
      throw error
    }
  }

  // A list the owner has paged past its first page is theirs until they ask for a read (Sync, an action): another read would
  // collapse the pages they opened, and the PR they have open with them.
  const pagedPast = list => list.view.inventory.length > list.first.keys.length

  // Reads the list of a repository: `refresh` or `reconcile` (see the top). A read already running is joined, not
  // repeated: a refresh covers a reconcile, and a refresh asked for while a reconcile runs follows it. A read the owner
  // asks for after what they just did (`fresh`: an action, Sync) never joins one that began before it, and the answer of
  // that older read is dropped, so a list from before the action never shows again.
  function read(repo, { token, how = 'refresh', fresh = false }) {
    const list = entry(repo)
    if (!fresh && list.listed && pagedPast(list)) return Promise.resolve()
    const running = flights.get(list.repo)
    if (running && !fresh && (running.how === how || how === 'reconcile')) return running.promise
    if (running && fresh) list.requestId += 1
    const promise = (async () => {
      if (running) await running.promise.catch(() => {})
      await perform(list, token, how, fresh)
    })().finally(() => { if (flights.get(list.repo)?.promise === promise) flights.delete(list.repo) })
    flights.set(list.repo, { how, promise })
    return promise
  }

  // The next page, when the owner asks for it.
  async function loadMore(repo, token) {
    const list = entry(repo)
    if (!list.data.hasNextPage) return
    const id = ++list.requestId, issued = issue(list)
    setData(list, { loading: true, error: '' })
    try {
      const next = await discoverPulls(token, list.repo, list.data.endCursor)
      if (id !== list.requestId) return
      publish(list, next.pulls, issued, { inventory: [...new Set([...list.view.inventory, ...next.pulls.map(prKey)])], data: { ...settledData(next), partial: list.data.partial } })
    } catch (error) {
      if (id === list.requestId) setData(list, { loading: false, error: error.message })
    }
  }

  function acknowledge(repo, keys, login) {
    const list = entry(repo)
    list.view = acknowledgeAssignment(list.view, keys, login, issue(list))
    notify(list)
  }

  // Whether the list was confirmed current within `ms`.
  const confirmedWithin = (repo, ms) => !!entry(repo).syncedAt && now() - Date.parse(entry(repo).syncedAt) < ms

  function opened(repo) {
    const list = entry(repo)
    list.openedAt = stamp()
    notify(list)
  }

  // The counts of open PRs of repositories nothing has read: none shows its empty list at once, and a saved empty list
  // that GitHub now says is not empty is no longer known, so opening it reads instead of saying there is nothing.
  function applyCounts(counts) {
    for (const [repo, total] of counts) {
      const list = entry(repo)
      if (total === 0 && !list.sessionRead) {
        list.view = emptyPullView()
        list.first = NO_FIRST
        Object.assign(list, { listed: true, settled: true, counted: true, syncedAt: stamp() })
        setData(list, settledData())
      } else if (total > 0 && list.listed && !list.sessionRead && !list.view.inventory.length) {
        Object.assign(list, { listed: false, syncedAt: '' })
        setData(list, unknownData())
      }
    }
  }

  // The lists restored from the last visit. Anything a read has already answered is newer than the copy.
  function restore(saved) {
    for (const copy of saved) {
      const list = entry(copy.repo)
      list.openedAt ||= copy.openedAt
      if (list.listed) continue
      const keys = copy.pulls.map(prKey)
      list.view = observePulls(emptyPullView(), copy.pulls, 0, { inventory: keys })
      list.first = { keys, total: copy.total, hasNextPage: copy.hasNextPage, endCursor: copy.endCursor }
      Object.assign(list, { listed: true, settled: true, counted: false, syncedAt: copy.syncedAt })
      setData(list, settledData(copy))
    }
  }

  // The lists of another account are not this one's: what was only restored, not read, goes.
  function forgetRestored() {
    for (const list of entries.values()) {
      if (list.sessionRead || !list.listed) continue
      Object.assign(list, { view: emptyPullView(), first: NO_FIRST, listed: false, settled: false, syncedAt: '', openedAt: '' })
      setData(list, unknownData())
    }
  }

  // What the next visit opens from: the first page of every list that is whole (its titles-only rows are not) and read,
  // not just counted.
  function listsToSave() {
    return [...entries.values()].filter(list => list.listed && list.syncedAt && !list.data.partial && !list.counted).map(list => ({
      repo: list.repo, syncedAt: list.syncedAt, openedAt: list.openedAt,
      total: list.first.total, hasNextPage: list.first.hasNextPage, endCursor: list.first.endCursor,
      pulls: list.first.keys.map(key => list.view.rows.get(key)?.pr).filter(pr => pr && !pr.titlesOnly),
    }))
  }

  return {
    entry, hold, issue, publish, read, loadMore, acknowledge, checkAgainst, confirmedWithin, opened, applyCounts, restore, forgetRestored, listsToSave,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
