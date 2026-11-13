import { Fragment, useEffect, useRef, useState } from 'react'
import { sameLogin } from '../domain.js'
import { watchOverflow } from './watchOverflow.js'

// The one layout of a desk row, wherever it lists a PR (Needs you, Review requests, My PRs, Agent runs, Merged):
// the title, then "#number · who · when", then the status pills, then a one-line reason when there is one.

// A status pill's colour by the tone review-list.js decisionChip gives it: yours to do is amber, a PR that
// is good to go green, an agent at work or a request to you purple.
const PILL_CLASS = { owner: 'is-waiting', running: 'is-you', you: 'is-you', good: 'is-ready', blocker: 'is-blocker', quiet: '' }
export const StatusPill = ({ chip }) => <span className={'co-desk-chip ' + PILL_CLASS[chip.tone]}>{chip.label}</span>

// Whose PR it is, as the owner reads it.
export const whoOf = (author, login) => (sameLogin(author, login) ? 'yours' : author || '')

// "#7 · yours · updated 2 days ago": the parts that exist, joined by dots.
export const DotLine = ({ parts }) => parts.filter(Boolean).map((part, index) => <Fragment key={index}>{index ? ' · ' : ''}{part}</Fragment>)

// The reason is one line however long the saved note is; the rest waits behind Show more. It sits outside the
// button that opens the PR (a button cannot hold another), and is measured so the control shows exactly when text is hidden.
function RowReason({ text }) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const line = useRef(null)
  useEffect(() => (!open && line.current ? watchOverflow(line.current, setClipped) : undefined), [text, open])
  return <div className="co-desk-note">
    <span ref={line} className={'co-desk-row-why' + (open ? ' is-open' : '')}>{text}</span>
    {clipped || open ? <button type="button" className="co-btn co-btn-quiet" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Show less' : 'Show more'}</button> : null}
  </div>
}

// `tone` colours a saved decision's row (its icon and pill). `action` is the row's own answer, a button beside it. A row
// with no `onOpen` has nowhere to go and is not a button.
export function DeskRow({ icon, title, facts, labels = null, pills = [], reason = '', aside = null, action = null, tone = '', onOpen = null }) {
  const body = <>
    {icon}
    <span className="co-desk-row-main">
      <span className="co-desk-row-title">{title}</span>
      <span className="co-desk-row-meta">{facts}</span>
      {labels}
      {pills.length ? <span className="co-row-pills">{pills}</span> : null}
    </span>
    {aside}
  </>
  const className = 'co-desk-row' + (tone ? ' is-' + tone : '')
  return <div className={'co-desk-item' + (action ? ' co-desk-row-split' : '')}>
    {onOpen ? <button type="button" className={className} onClick={onOpen}>{body}</button> : <div className={className + ' is-static'}>{body}</div>}
    {reason ? <RowReason text={reason} /> : null}
    {action}
  </div>
}
