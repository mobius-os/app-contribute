import { useSyncExternalStore } from 'react'

// A finger is the pointer and nothing hovers: a phone or a tablet. A laptop with a touch screen still has a mouse, so it is not one.
const TOUCH_SCREEN = '(hover: none) and (pointer: coarse)'
const subscribe = notify => {
  const query = window.matchMedia(TOUCH_SCREEN)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

export const useTouchScreen = () => useSyncExternalStore(subscribe, () => window.matchMedia(TOUCH_SCREEN).matches, () => false)
