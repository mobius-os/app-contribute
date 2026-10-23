import { useEffect, useLayoutEffect, useRef } from 'react'
import { createInlineSession } from '../inline-session.js'
import { listenBlockSession, publishBlockState, readBlockSession } from '../block-protocol.js'
import { loadFreshContributionRecord } from '../storage.js'

// Headless: the chat host renders every control. This only connects the
// host's session to the inline Send model and the app's publication runtime.
export function InlineBlockSession({ blockSession, runtime, onNeedRuntime }) {
  const session = useRef(null)
  const latest = useRef({ runtime, onNeedRuntime })
  latest.current = { runtime, onNeedRuntime }
  useLayoutEffect(() => {
    function start(init) {
      if (session.current?.sessionId === init.sessionId) { session.current.start(); return }
      session.current?.dispose()
      session.current = createInlineSession({ ...init, publish: publishBlockState, loadExact: loadFreshContributionRecord,
        onNeedRuntime: () => latest.current.onNeedRuntime?.() })
      if (latest.current.runtime) session.current.updateRuntime(latest.current.runtime)
      session.current.start()
    }
    const stop = listenBlockSession({
      onInit: start,
      onAction: event => { if (event.sessionId === session.current?.sessionId) session.current.handleEvent(event) },
    })
    const initial = readBlockSession(blockSession)
    if (initial) start(initial)
    return () => { stop(); session.current?.dispose(); session.current = null }
  }, [])
  useEffect(() => { if (runtime) session.current?.updateRuntime(runtime) }, [runtime])
  return null
}
