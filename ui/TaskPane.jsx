import { createContext, useContext, useId, useLayoutEffect, useRef } from 'react'
import { Icon } from './Icons.jsx'
import { ReviewDialog } from './ReviewDialog.jsx'

// A work surface for one project action. A docked one (Send to GitHub, Mark ready) is a window over the page (DESIGN.md,
// The Window Rule); the others sit inline and keep project browsing and exact workflow scope. The project owns
// selection; each workflow owns its durable state and consent.
export const TaskContext = createContext(null)
export const useProjectTask = () => useContext(TaskContext)

export function focusActionRegion(region, target = region) {
  if (!region) return
  target?.focus({ preventScroll: true })
  if (region.closest('.co-task-dock')) return
  // The project restores its scroll position in a parent layout effect, after
  // this one runs. Scroll on the next frame, and only as far as needed: a pane
  // opened right under its trigger stays put, one opened further down is shown.
  requestAnimationFrame(() => {
    if (!region.isConnected) return
    region.style.scrollMarginBlock = '16px'
    region.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  })
}

export function TaskPane({ id, children, dock = true }) {
  const task = useProjectTask()
  const content = useRef(null)
  const headingId = useId()
  const visible = task?.activeId === id
  useLayoutEffect(() => {
    const heading = content.current?.querySelector('h3, h2')
    if (heading) heading.id = headingId
    if (visible && task?.explicit) focusActionRegion(content.current)
  }, [visible, task?.explicit, headingId])
  if (!task) return children
  if (!visible) return null
  const pane = <section ref={content} tabIndex={-1} className={'co-task-content' + (dock ? ' co-task-dock' : '')} data-task={id} role="region" aria-labelledby={headingId} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); task.close() } }}>
    <button className="co-btn co-btn-quiet co-btn-icon co-inline-close" aria-label="Close action" onClick={task.close}><Icon name="close" size={18} /></button>
    {children}
  </section>
  return dock ? <ReviewDialog label="Project action" onClose={task.close}>{pane}</ReviewDialog> : pane
}
