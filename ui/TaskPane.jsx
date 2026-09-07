import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// One task outlet; the owning workflow keeps its state and exact approvals.
// The existing project/work navigation remains the only history owner.
export const TaskContext = createContext(null)
export const useProjectTask = () => useContext(TaskContext)

export function TaskPane({ id, children }) {
  const task = useProjectTask()
  const content = useRef(null)
  const visible = task?.activeId === id
  useLayoutEffect(() => {
    if (!visible || !task?.explicit || !content.current) return
    task.host?.scrollTo({ top: 0 })
    content.current.focus({ preventScroll: true })
  }, [visible, task?.explicit, task?.host])
  if (!task) return children
  if (!visible || !task.host) return null
  return createPortal(<div ref={content} tabIndex={-1} className="co-task-content">{children}</div>, task.host)
}
