// A chat link's navigation lease on one PR. It is held while `held` is true
// and handed back (once) when that stops, when GitHub stops being connected,
// or when the project view unmounts.
import { useEffect, useRef } from 'react'

export function useFocusLease({ nonce, held, connected, release }) {
  const releaseRef = useRef(release)
  releaseRef.current = release
  const nonceRef = useRef(nonce)
  nonceRef.current = nonce
  const shown = useRef('')
  useEffect(() => {
    if (held) { shown.current = nonce; return }
    const was = shown.current
    shown.current = ''
    if (was) releaseRef.current?.(was)
  }, [held, nonce])
  // A disconnect ends the link's purpose; release it rather than leaving it
  // pending until the next link or unmount.
  const wasConnected = useRef(connected)
  useEffect(() => {
    const before = wasConnected.current
    wasConnected.current = connected
    if (before && !connected && nonceRef.current) {
      shown.current = ''
      releaseRef.current?.(nonceRef.current)
    }
  }, [connected])
  useEffect(() => () => { if (nonceRef.current) releaseRef.current?.(nonceRef.current) }, [])
}
