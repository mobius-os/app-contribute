import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// The one window over the page (DESIGN.md, The Window Rule): blurred backdrop, round card. The page behind stays put,
// Tab stays inside, Escape or a click outside closes it, and focus returns to whatever opened it. `role` is
// "alertdialog" for a question that must be answered (Withdraw, Discard).
export function ReviewDialog({ onClose, label = 'Agent workflow', role = 'dialog', children }) {
  const panel = useRef(null)
  // Read while rendering, before the window's own children take focus in their effects.
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }, [])
  function keepFocusInside(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = [...(panel.current?.querySelectorAll(FOCUSABLE) || [])]
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault() }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault() }
  }
  return <div className="co-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} className="co-dialog" role={role} aria-modal="true" aria-label={label} onKeyDown={keepFocusInside}>{children}</div>
  </div>
}
