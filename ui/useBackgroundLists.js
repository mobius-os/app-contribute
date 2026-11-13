import { useCallback, useEffect, useMemo, useRef } from 'react'
import { newWanted, probePinned, readListPass } from '../background-lists.js'
import { sameLogin } from '../domain.js'
import { listTiers } from '../list-tiers.js'
import { listCopyOf, listsForAccount, loadListCopy, saveListCopy } from '../repository-list-copy.js'

// The copy is written once things have settled, not at every change of lists that move while reads answer.
const SAVE_AFTER_MS = 3000
const FACT = 'repositoryLists'

// The last visit's lists open at once (restored when the app starts, unless they are another account's), and the next
// visit's are saved from what was read (`saving`: once the desk's own reads have answered and the account is known).
function useListCopy({ lists, sendOnly, saving, login }) {
  const copyLogin = useRef('')
  const loginRef = useRef(login)
  loginRef.current = login
  useEffect(() => {
    if (sendOnly) return undefined
    let cancelled = false
    void loadListCopy().then(copy => {
      if (cancelled || !copy) return
      copyLogin.current = copy.login
      lists.restore(listsForAccount(copy, loginRef.current))
    })
    return () => { cancelled = true }
  }, [sendOnly, lists])
  // Another account's lists are not this one's, whichever of the two answers first.
  useEffect(() => {
    if (login && copyLogin.current && !sameLogin(login, copyLogin.current)) lists.forgetRestored()
  }, [login, lists])
  useEffect(() => {
    if (!saving || !login) return undefined
    // What the file holds already (the lists of the last visit, unchanged) is not written again.
    let saved = JSON.stringify(listCopyOf({ login, lists: lists.listsToSave() }))
    let timer = null
    const save = () => {
      const copy = listCopyOf({ login, lists: lists.listsToSave() })
      const text = JSON.stringify(copy)
      if (text !== saved) void saveListCopy(copy).then(done => { if (done) saved = text })
    }
    // A list only confirmed current (the probe found nothing moved) changes nothing to save.
    const stop = lists.subscribe((repo, { confirmed }) => { if (confirmed) return; clearTimeout(timer); timer = setTimeout(save, SAVE_AFTER_MS) })
    return () => { stop(); clearTimeout(timer) }
  }, [saving, login, lists])
}

// The repositories' lists of open PRs (repository-lists.js) as the app keeps them. `lists` is the store the screens read.
//   copy      the last visit's lists open at once and the next visit's are saved (useListCopy)
//   tiers     once the desk's own reads have answered (`started`) the hub reads the pinned repositories, then the active
//             ones, then counts the quiet ones (background-lists.js); with every rule of the hub's budget: nothing while the
//             frame is hidden, nothing once the account runs low, and a cooldown between automatic passes
//   probe     the pinned repositories are asked once a minute what moved, and only that is read again
// `syncLists()` is the owner's Sync: it brings every list up to date, in the background, without holding the Sync back.
export function useBackgroundLists({ hub, lists, token, sendOnly, connected, started, login, projects, pinned, runs, respondChats }) {
  const enabled = !sendOnly && connected
  useListCopy({ lists, sendOnly, saving: enabled && started, login })
  const tiers = useMemo(() => listTiers({ projects, pinned, login, runs, respondChats, openedAt: repo => lists.entry(repo).openedAt }), [projects, pinned, login, runs, respondChats, lists])
  const latest = useRef(null)
  latest.current = { tiers, token }
  const wanted = useRef(newWanted())
  const counted = useRef(new Set())

  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact(FACT, {
      github: true,
      read: ({ paused }) => readListPass({ lists, token: latest.current.token, tiers: latest.current.tiers, paused, wanted: wanted.current, counted: counted.current }),
      apply: () => {},
      failed: () => {}, // what was not read is read by the next pass; the lists show what they last knew
    })
  }, [hub, lists, enabled])
  const syncLists = useCallback(() => {
    wanted.current.syncing = true
    return hub.refresh(FACT)
  }, [hub])

  // The first pass starts when the desk's own reads have answered, so it never slows the opening. A repository the owner
  // pins is read at once; one that becomes active is read by the next pass, after the cooldown the hub keeps between
  // automatic reads.
  const pinnedKey = tiers.pinned.join(','), activeKey = tiers.active.join(',')
  const passed = useRef(null)
  useEffect(() => {
    if (!enabled || !started) return
    const before = passed.current
    passed.current = { pinnedKey, activeKey }
    if (!before || before.pinnedKey !== pinnedKey) void hub.changed(FACT)
    else if (before.activeKey !== activeKey) void hub.automatic(FACT)
  }, [hub, enabled, started, pinnedKey, activeKey])

  // Each answer of the probe is compared with the lists themselves (probePinned), so what is behind is found again at the
  // next minute however an earlier read ended; the hub's own comparison of answers has nothing to add.
  useEffect(() => {
    if (!enabled || !started) return undefined
    return hub.watch(async () => {
      const behind = await probePinned(latest.current.token, latest.current.tiers.pinned, lists)
      if (behind?.length) {
        behind.forEach(repo => wanted.current.moved.add(repo))
        wanted.current.probed = true
        void hub.changed(FACT)
      }
      return behind && new Map()
    }, () => {}, 'lists')
  }, [hub, lists, enabled, started])

  return { syncLists }
}
