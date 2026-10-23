// The one adapter between Contribute's inline Send session and the chat
// host's passive app-block protocol. Only this file knows message names and
// envelope shapes, so a protocol revision changes nothing else.
const INIT = 'moebius:app-block-init'
const ACTION = 'moebius:app-block-action'
const STATE = 'moebius:app-block-state'

export function readBlockSession(value) {
  if (typeof value?.sessionId !== 'string' || !value.sessionId || !Array.isArray(value.actions)) return null
  return {
    sessionId: value.sessionId,
    actions: value.actions.filter(action => typeof action?.key === 'string').map(({ key, label }) => ({ key, label })),
    checkpoint: value.checkpoint && typeof value.checkpoint === 'object' ? { id: value.checkpoint.id, data: value.checkpoint.data } : null,
    retain: value.retain === true,
    recoveryError: Boolean(value.recoveryError),
  }
}

// Host messages come only from the parent shell document on this origin.
export function listenBlockSession({ onInit, onAction }) {
  const listener = event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return
    if (event.data?.type === INIT) {
      const session = readBlockSession(event.data)
      if (session) onInit(session)
    } else if (event.data?.type === ACTION) {
      const { sessionId, key, event: name, nonce } = event.data
      onAction({ sessionId, key, event: name, nonce })
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

export function publishBlockState(state) {
  window.parent.postMessage({ type: STATE, ...state }, window.location.origin)
}
