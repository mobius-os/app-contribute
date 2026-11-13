import { useSyncExternalStore } from 'react'

// A finger is the pointer and nothing hovers: a phone or a tablet. A laptop with a touch screen still has a mouse, so it is not one.
const TOUCH_SCREEN = '(hover: none) and (pointer: coarse)'
let touchQuery = null
const touch = () => (touchQuery ||= window.matchMedia(TOUCH_SCREEN))
const subscribe = notify => {
  const query = touch()
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

export const useTouchScreen = () => useSyncExternalStore(subscribe, () => touch().matches, () => false)
