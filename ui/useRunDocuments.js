import { useEffect, useRef, useState } from 'react'
import { collaborationRequest } from '../collaboration.js'

// The list of review runs is the short one (collaboration.js loadReviewRuns): runs and items without their documents
// (the findings in full, what a review ran, a drafted verdict's text, each fix's files, the run's own instructions). A
// screen that shows those reads the one run: when it opens, and again when the list says the run changed. Until the first
// answer it holds (`reading`) instead of showing a cut copy of the findings or a verdict without its words. After that it
// keeps the last full copy on screen, also when a newer read fails or an action's own full answer is replaced by the short
// list again, but says it is not `current`, so the screen switches off what would decide on it. A run that is already full
// (an older Möbius, or an action's own answer) is shown as it is.
const samePull = (a, b) => String(a?.repo).toLowerCase() === String(b?.repo).toLowerCase() && a?.number === b?.number

export function useRunDocuments({ token, appId, run, item = null }) {
  const short = run?.summary_only === true
  // What the list says about the run: when this changes, the run did.
  const stamp = short ? JSON.stringify(run) : ''
  const [read, setRead] = useState({ id: '', stamp: '', run: null, failed: false })
  const lastFull = useRef(null)
  if (run && !short) lastFull.current = run
  useEffect(() => {
    if (!short) return undefined
    let current = true
    collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}`).then(
      answer => { if (current) setRead({ id: run.id, stamp, run: answer?.run || null, failed: !answer?.run }) },
      () => { if (current) setRead(old => (old.id === run.id && old.run ? old : { id: run.id, stamp: '', run: null, failed: true })) },
    )
    return () => { current = false }
  }, [short, stamp, token, appId])
  if (!short) return { run, item, reading: false, failed: false, current: true }
  const mine = read.id === run.id && read.run
  const full = mine || (lastFull.current?.id === run.id ? lastFull.current : null)
  if (!full) return { run, item, reading: !(read.id === run.id && read.failed), failed: read.id === run.id && read.failed, current: false }
  return { run: full, item: item ? full.items?.find(candidate => samePull(candidate, item)) || item : null, reading: false, failed: false, current: !!mine && read.stamp === stamp }
}
