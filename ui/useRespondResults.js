import { useCallback, useEffect, useState } from 'react'
import { respondFact } from '../respond-store.js'

// The saved Respond-to-feedback answers and what the owner decided about them, kept on the app's one sync hub like the review runs:
// read at once, again on the hub's cadence (closely while a post is under way, see respondFact), and on `refresh` after Post or Discard.
// `ready` is true once the first read has answered, whether it read the answers or could not.
export function useRespondResults({ hub, enabled }) {
  const [responses, setResponses] = useState([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    const fact = respondFact(setResponses)
    return hub.fact('responses', { ...fact, apply: list => { fact.apply(list); setReady(true) }, failed: () => setReady(true) })
  }, [hub, enabled])
  const refresh = useCallback(() => hub.refresh('responses'), [hub])
  // A fact is read once by whoever registers it; the hub keeps it fresh from then on.
  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  return { responses, ready, refresh }
}
