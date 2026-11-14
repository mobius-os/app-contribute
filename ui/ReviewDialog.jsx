import { useLayoutEffect, useRef } from 'react'

// Light dismiss (a press outside the card) is the browser's own where `closedby` exists; Safari has none, so the same press is caught here.
const nativeLightDismiss = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype
const outsideCard = (event, card) => {
  const box = card.getBoundingClientRect()
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
}

// The one window over the page (DESIGN.md, The Window Rule), on the browser's own modal <dialog>: the page behind is inert, Tab stays
// inside, Escape (and in Chrome the Android Back gesture) closes it, and focus returns to what opened it. React still owns whether it is
// open: a close request only calls `onClose`, and the window goes when it stops being rendered. `role` is "alertdialog" for a question
// that must be answered (Withdraw, Discard).
export function ReviewDialog({ onClose, label = 'Agent workflow', role, children }) {
  const card = useRef(null)
  const pressedOutside = useRef(false)
  // Opened in the layout phase, before the window's own effects run, so what they focus (Keep, in a question) is already on screen.
  // Removing an open dialog from the page gives focus back to nothing, so it is closed first: that is what returns focus to the opener.
  useLayoutEffect(() => {
    const dialog = card.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const outsidePress = nativeLightDismiss ? {} : {
    onPointerDown: event => { pressedOutside.current = outsideCard(event, card.current) },
    onPointerUp: event => { if (pressedOutside.current && outsideCard(event, card.current)) onClose() },
  }
  return <dialog ref={card} className="co-dialog" role={role} aria-label={label} closedby="any" onCancel={event => { event.preventDefault(); onClose() }} {...outsidePress}>{children}</dialog>
}
