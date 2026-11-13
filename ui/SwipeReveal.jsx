import { useState } from 'react'

// Swipe a desk row left to reach one button (swipe-to-reveal): the row and the button sit in one horizontal scroll-snap scroller,
// so the browser does the swiping, the snapping and the keyboard scrolling and no touch or pointer code runs here. Nothing runs
// on the swipe: it only shows the button. The button is inert (out of the tab order, out of the accessibility tree, out of a
// tap's way) until the row is swiped open, so only a revealed button can be reached.
// Opening one row closes the others; the class names the rows to the closer and to the stylesheet.
function closeOthers(open) {
  for (const row of document.querySelectorAll('.co-swipe')) if (row !== open && row.scrollLeft > 0) row.scrollTo({ left: 0 })
}

// `step` is { title, label, run }: the button's word, its accessible name (the word, then the row it is for) and what it does.
export function SwipeReveal({ step, children }) {
  const [open, setOpen] = useState(false)
  // Open is where the row settled: more than halfway to the button. Only a change sets state.
  function follow(event) {
    const row = event.currentTarget
    const revealed = row.scrollLeft > (row.scrollWidth - row.clientWidth) / 2
    if (revealed === open) return
    setOpen(revealed)
    if (revealed) closeOthers(row)
  }
  // Tabbing back into the row brings it over the button again; a tap does not.
  const closeForKeys = event => { if (event.target.matches(':focus-visible')) event.currentTarget.parentElement.scrollTo({ left: 0 }) }
  return <div className="co-swipe" onScroll={follow}>
    <div className="co-swipe-front" onFocus={closeForKeys}>{children}</div>
    <div className="co-swipe-panel" inert={!open}>
      <button type="button" className="co-btn co-btn-primary" aria-label={step.label} onClick={step.run}>{step.title}</button>
    </div>
  </div>
}
