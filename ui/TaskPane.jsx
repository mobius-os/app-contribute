import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { Icon } from './Icons.jsx'

// A task is an inline disclosure, not another screen or history entry.
// The project owns selection; each workflow owns its durable state and consent.
export const TaskContext = createContext(null)
export const useProjectTask = () => useContext(TaskContext)

export function focusActionRegion(region, target = region) {
  if (!region) return
  if (!region.closest('.co-task-dock')) {
    region.style.scrollMarginTop = '16px'
    region.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  target?.focus({ preventScroll: true })
}

export function TaskPane({ id, children, dock = false }) {
  const task = useProjectTask()
  const content = useRef(null)
  const visible = task?.activeId === id
  useLayoutEffect(() => {
    if (visible && task?.explicit) focusActionRegion(content.current)
  }, [visible, task?.explicit])
  useLayoutEffect(() => {
    const node = content.current
    if (!visible || !dock || !node) return
    const root = node.closest('.co-root')
    const measure = () => root?.style.setProperty('--co-task-height', `${node.getBoundingClientRect().height + 32}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(node); measure()
    return () => { observer.disconnect(); root?.style.removeProperty('--co-task-height') }
  }, [visible, dock])
  if (!task) return children
  if (!visible) return null
  return <section ref={content} tabIndex={-1} className={'co-task-content' + (dock ? ' co-task-dock' : '')} data-task={id}>
    <button className="co-quiet-action co-inline-close" aria-label="Close action" onClick={task.close}><Icon name="close" size={18} /></button>
    {children}
  </section>
}
