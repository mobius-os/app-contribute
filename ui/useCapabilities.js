import { useEffect, useState } from 'react'
import { collaborationRequest } from '../collaboration.js'

// What this Möbius can do for the owner (Merge among it), asked once while GitHub is connected. An older Möbius answers
// 404 and keeps the menu as it was: `capabilities` stays null. The setter is for a window that learns them first.
export function useCapabilities(token, appId, connected) {
  const [capabilities, setCapabilities] = useState(null)
  useEffect(() => {
    if (capabilities || !connected) return undefined
    let alive = true
    collaborationRequest(token, appId, 'review-presets').then(value => { if (alive) setCapabilities(value.capabilities || {}) }, () => {})
    return () => { alive = false }
  }, [connected, token, appId])
  return [capabilities, setCapabilities]
}
