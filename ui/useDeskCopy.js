import { useEffect, useState } from 'react'
import { loadDeskCopy, saveDeskCopy } from '../desk-copy.js'
import { loadSavedFeedStamp } from '../storage.js'

// The last-known copy of the desk (desk-copy.js, with the saved feed and the project snapshot): read once when the app
// opens. `saved` is null until it was looked for, then { copy, hasFeed }; `onCopy(copy)` lets the app lay what the copy
// holds under anything a read has already answered.
export function useSavedDeskCopy({ enabled, onCopy }) {
  const [saved, setSaved] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    Promise.all([loadDeskCopy(), loadSavedFeedStamp()]).then(([copy, feed]) => {
      if (cancelled) return
      if (copy) onCopy(copy)
      setSaved({ copy, hasFeed: !!feed })
    })
    return () => { cancelled = true }
  }, [enabled])
  return { saved, savedCopy: saved?.copy || null }
}

// What the next visit opens from: saved once the open has been synced, and again when a later read moved something
// (saveDeskCopy writes only what changed). Never from a failed update: its time is the older sync's.
export function useDeskCopySave({ enabled, syncedAt, failed, login, incoming, repositories, reviewRows, reviewPulls }) {
  useEffect(() => {
    if (!enabled || !syncedAt || failed || !login) return undefined
    const timer = setTimeout(() => { void saveDeskCopy({ login, syncedAt, incoming, repositories, reviewRows, reviewPulls }) }, 1500)
    return () => clearTimeout(timer)
  }, [enabled, syncedAt, failed, login, incoming, repositories, reviewRows, reviewPulls])
}
