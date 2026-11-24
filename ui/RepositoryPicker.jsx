import { useState } from 'react'
import { NAMES } from '../names.js'
import { Icon } from './Icons.jsx'
import { AddRepositoryWindow } from './AddRepositoryWindow.jsx'

// The button that opens the Add repository window. `variant`: 'heading' (the side list's title row, one word), 'lookup' (under a
// search that found nothing, with the typed words already in the window), or 'button' (the directory's own, with the full name).
export function RepositoryPicker({ token, connected, onAdded, variant = 'button', initialText = '' }) {
  const [open, setOpen] = useState(false)
  const words = { heading: NAMES.addRepositoryShort, lookup: NAMES.lookUpOnGitHub }[variant]
  return <>
    <button type="button" className={`co-btn co-repository-trigger is-${variant}` + (variant === 'heading' ? ' co-btn-quiet' : '')} aria-haspopup="dialog"
      aria-label={variant === 'heading' ? NAMES.addRepository : undefined} onClick={() => setOpen(true)}>
      <Icon name={variant === 'lookup' ? 'search' : 'plus'} size={16} /><span>{words || NAMES.addRepository}</span>
    </button>
    {open ? <AddRepositoryWindow token={token} connected={connected} initialText={initialText} onAdded={onAdded} onClose={() => setOpen(false)} /> : null}
  </>
}
