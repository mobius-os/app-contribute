import { useCallback, useEffect, useRef, useState } from 'react'
import { githubRemainingPoints } from '../api.js'
import { SYNC_POLICY, onShownAgain } from '../refresh.js'
import { SYNC_LINE_MS, syncLine } from '../sync-summary.js'

// The one full sync of the open app and what the header says about it.
//   refreshEverything({ quiet }) reads everything Sync reads and answers { ok, upstream }; quiet reads GitHub's facts through the hub's automatic path
//   facts             what the desk shows now (sync-summary.js syncFacts), compared before and after
// The owner's press shows its progress and says what it changed; a quiet sync (the app shown again after a while) does
// neither, and a failed quiet one leaves the last good time to age on its own. `markSynced` is for the first load,
// which is a sync too.
export function useDeskSync({ refreshEverything, facts, booted, connected, enabled = true }) {
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshNote, setRefreshNote] = useState(null)
  const [syncResult, setSyncResult] = useState(null)
  const syncingRef = useRef(false)
  const lastSyncRef = useRef(0)
  const beforeRef = useRef(null)
  const latest = useRef(null)
  latest.current = { refreshEverything, facts, booted, connected }

  const syncAll = useCallback(async ({ quiet = false } = {}) => {
    if (syncingRef.current) return undefined
    syncingRef.current = true
    if (!quiet) setRefreshingAll(true)
    const before = latest.current.facts
    try {
      const outcome = await latest.current.refreshEverything({ quiet })
      if (outcome?.ok && outcome?.upstream?.ok !== false) {
        lastSyncRef.current = Date.now()
        setRefreshNote({ at: new Date().toISOString(), failed: false })
        if (!quiet) beforeRef.current = before
      } else if (!quiet) setRefreshNote(old => ({ at: old?.at || null, failed: true }))
      return outcome
    } catch {
      if (!quiet) setRefreshNote(old => ({ at: old?.at || null, failed: true }))
      return null
    } finally {
      syncingRef.current = false
      if (!quiet) setRefreshingAll(false)
    }
  }, [])

  // The state the sync set is on screen once the button settles; only then is the line compared with the start.
  useEffect(() => {
    if (refreshingAll || !beforeRef.current) return
    setSyncResult({ text: syncLine(beforeRef.current, latest.current.facts), id: Date.now() })
    beforeRef.current = null
  }, [refreshingAll])
  useEffect(() => {
    if (!syncResult) return undefined
    const timer = setTimeout(() => setSyncResult(null), SYNC_LINE_MS)
    return () => clearTimeout(timer)
  }, [syncResult])

  // The frame shown again after a while catches up on everything Sync reads, so the header's time stays true for what is
  // on screen. It waits out the GitHub cooldown and stops when the account runs low, as every automatic read does.
  useEffect(() => (enabled ? onShownAgain(() => {
    const { booted: ready, connected: online } = latest.current
    if (!ready || !online || Date.now() - lastSyncRef.current < SYNC_POLICY.githubCooldownMs) return
    if ((githubRemainingPoints() ?? Infinity) < SYNC_POLICY.lowPoints) return
    void syncAll({ quiet: true })
  }) : undefined), [enabled, syncAll])

  const markSynced = useCallback(() => { lastSyncRef.current = Date.now() }, [])
  return { refreshingAll, refreshNote, setRefreshNote, syncResult, syncAll, markSynced }
}
