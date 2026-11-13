import { useEffect, useState } from 'react'
import { collaborationRequest } from '../collaboration.js'

// What this Möbius can do for the owner (Merge among it), asked once while GitHub is connected. An older Möbius answers
// 404 and keeps the menu as it was: `capabilities` stays null. The setter is for a window that learns them first; `known` is a copy
// the app already read, which stands in so a screen under it asks nothing twice.
export function useCapabilities(token, appId, connected, known = null) {
  const [read, setCapabilities] = useState(null)
  const capabilities = read || known
  useEffect(() => {
    if (capabilities || !connected) return undefined
    let alive = true
    collaborationRequest(token, appId, 'review-presets').then(value => { if (alive) setCapabilities(value.capabilities || {}) }, () => {})
    return () => { alive = false }
  }, [connected, token, appId, known])
  return [capabilities, setCapabilities]
}
