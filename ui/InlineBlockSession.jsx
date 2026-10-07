import { useEffect, useLayoutEffect, useRef } from 'react'
import { createInlineSession } from '../inline-session.js'
import { loadFreshContributionRecord } from '../storage.js'

// The shell owns all visible UI. This component only exchanges bounded state
// with the source chat block; mounting and ledger hydration never send.
export function InlineBlockSession({ blockSession = null, autoActivateKey = '', onActivateRequest, records, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh }) {
  const session = useRef(null)
  const latest = useRef({ records, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh, onActivateRequest })
  latest.current = { records, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh, onActivateRequest }
  useEffect(() => { session.current?.updateLedger(records, ledgerReady, reviewStatus) }, [records, ledgerReady, reviewStatus])
  useLayoutEffect(() => {
    const valid = event => event.source === window.parent && event.origin === window.location.origin
    const initialize = data => {
      if (session.current?.sessionId === data?.sessionId) { session.current.emit(); return }
      session.current?.dispose()
      session.current = null
      if (typeof data?.sessionId !== 'string' || !Array.isArray(data.actions)) return
      const next = createInlineSession({
        sessionId: data.sessionId,
        actions: data.actions,
        publish: message => window.parent.postMessage(message, window.location.origin),
        loadExact: loadFreshContributionRecord,
        send: rec => latest.current.onSend(rec),
        sendStack: recs => latest.current.onSendStack(recs),
        refresh: () => latest.current.onRefresh?.(),
      })
      session.current = next
      next.updateLedger(latest.current.records, latest.current.ledgerReady, latest.current.reviewStatus)
      if (autoActivateKey) next.activate(autoActivateKey)
      void next.hydrate()
    }
    const onMessage = event => {
      if (!valid(event)) return
      const data = event.data
      if (data?.type === 'moebius:app-block-init') {
        initialize(data)
      } else if (data?.type === 'moebius:app-block-action' && data.sessionId === session.current?.sessionId) {
        if (data.event === 'activate') {
          if (latest.current.onActivateRequest) latest.current.onActivateRequest(data.key)
          else session.current.activate(data.key)
        }
        else if (data.event === 'cancel') session.current.cancel(data.key)
        else if (data.event === 'confirm') void session.current.confirm(data.key)
      }
    }
    window.addEventListener('message', onMessage)
    if (blockSession) initialize(blockSession)
    return () => { window.removeEventListener('message', onMessage); session.current?.dispose() }
  }, [])
  return null
}
