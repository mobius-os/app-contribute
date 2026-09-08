import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { Icon } from './Icons.jsx'

// A task is an inline disclosure, not another screen or history entry.
// The project owns selection; each workflow owns its durable state and consent.
export const TaskContext = createContext(null)
export const useProjectTask = () => useContext(TaskContext)

export function focusActionRegion(region, target = region) {
  if (!region) return
  const toolbar = region.closest('.co-public-work')?.querySelector('.co-pr-selection')
  region.style.scrollMarginTop = `${(toolbar?.getBoundingClientRect().height || 0) + 16}px`
  region.scrollIntoView({ block: 'start', behavior: 'instant' })
  target?.focus({ preventScroll: true })
}

export function TaskPane({ id, children }) {
  const task = useProjectTask()
  const content = useRef(null)
  const visible = task?.activeId === id
  useLayoutEffect(() => {
    if (visible && task?.explicit) focusActionRegion(content.current)
  }, [visible, task?.explicit])
  if (!task) return children
  if (!visible) return null
  return <section ref={content} tabIndex={-1} className="co-task-content" data-task={id}>
    <button className="co-quiet-action co-inline-close" aria-label="Close action" onClick={task.close}><Icon name="close" size={18} /></button>
    {children}
  </section>
}
