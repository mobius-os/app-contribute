import { useCallback, useEffect, useMemo, useRef } from 'react'
import { probePinned, readListPass } from '../background-lists.js'
import { sameLogin } from '../domain.js'
import { listTiers } from '../list-tiers.js'
import { listCopyOf, loadListCopy, saveListCopy } from '../repository-list-copy.js'

// The copy is written once things have settled, not at every change of lists that move while reads answer.
const SAVE_AFTER_MS = 3000
const FACT = 'repositoryLists'

// The repositories' lists of open PRs (repository-lists.js) as the app keeps them. `lists` is the store the screens read.
//   copy      the last visit's lists open at once (restored here), and the next visit's are saved from what was read
//   tiers     once the desk's own reads have answered (`started`) the hub reads the pinned repositories, then the active
//             ones, then counts the quiet ones (background-lists.js); with every rule of the hub's budget: nothing while the
//             frame is hidden, nothing once the account runs low, and a cooldown between automatic passes
//   probe     the pinned repositories are asked once a minute what moved, and only that is read again
// `syncLists()` is the owner's Sync: it brings every list up to date, in the background, without holding the Sync back.
export function useBackgroundLists({ hub, lists, token, sendOnly, connected, started, login, projects, pinned, runs, respondChats }) {
  const enabled = !sendOnly && connected
  const tiers = useMemo(() => listTiers({ projects, pinned, login, runs, respondChats, openedAt: repo => lists.entry(repo).openedAt }), [projects, pinned, login, runs, respondChats, lists])
  const latest = useRef(null)
  latest.current = { tiers, token }
  // What the next pass is asked to do: the repositories the probe saw something move in, and whether the owner pressed Sync.
  const wanted = useRef({ moved: new Set(), syncing: false })
  const counted = useRef(new Set())

  const copyLogin = useRef('')
  useEffect(() => {
    if (sendOnly) return undefined
    let cancelled = false
    void loadListCopy().then(copy => {
      if (cancelled || !copy) return
      copyLogin.current = copy.login
      lists.restore(copy.lists)
    })
    return () => { cancelled = true }
  }, [sendOnly, lists])
  // Another account's lists are not this one's, whichever of the two answers first.
  useEffect(() => {
    if (login && copyLogin.current && !sameLogin(login, copyLogin.current)) lists.forgetRestored()
  }, [login, lists])

  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact(FACT, {
      github: true,
      read: ({ paused }) => {
        const { moved, syncing } = wanted.current
        wanted.current = { moved: new Set(), syncing: false }
        return readListPass({ lists, token: latest.current.token, tiers: latest.current.tiers, paused, moved: [...moved], syncing, counted: counted.current })
      },
      apply: () => {},
      failed: () => {}, // what was not read is read by the next pass; the lists show what they last knew
    })
  }, [hub, lists, enabled])
  const syncLists = useCallback(() => {
    wanted.current.syncing = true
    return hub.refresh(FACT)
  }, [hub])

  // The first pass starts when the desk's own reads have answered, so it never slows the opening; a repository that
  // becomes active or pinned later is read by the next one, after the cooldown the hub keeps between automatic reads.
  const tiersKey = [...tiers.pinned, '|', ...tiers.active].join(',')
  const startedBefore = useRef(false)
  useEffect(() => {
    if (!enabled || !started) return
    if (startedBefore.current) void hub.automatic(FACT)
    else { startedBefore.current = true; void hub.changed(FACT) }
  }, [hub, enabled, started, tiersKey])

  useEffect(() => {
    if (!enabled || !started) return undefined
    return hub.watch(
      () => probePinned(latest.current.token, latest.current.tiers.pinned, lists),
      moved => { moved.forEach(repo => wanted.current.moved.add(repo)); void hub.changed(FACT) },
      'lists',
    )
  }, [hub, lists, enabled, started])

  // What the next visit opens from.
  useEffect(() => {
    if (!enabled || !started || !login) return undefined
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
  }, [enabled, started, login, lists])

  return { syncLists, tiers }
}
