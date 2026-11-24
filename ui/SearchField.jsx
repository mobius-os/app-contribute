import { Icon } from './Icons.jsx'
import { NAMES } from '../names.js'

// The one search field of Contribute: Needs you, Repositories, the PR list, the changed-files filter and the
// Assign window all use it, so a search never looks like a different control on another screen. A magnifier
// that only decorates (the label names the field), a Clear button while there is text (focus goes back to the
// field), one purple edge and soft ring on focus. The input is 16px: a smaller one makes iPhones zoom the page on focus.
// `className` only places it (flex, width), `inputRef` lets a toggle focus it. `onSubmit` (the side list's repository search, 2026-11-24)
// moves the magnifier to the right end as a button that does what Enter does. What is typed here is never offered back to the owner:
// the field is in no form, so nothing is submitted for the browser to remember, and autofill, password managers, spellcheck and
// capitalising are told to leave it alone.
export function SearchField({ label, value, onChange, placeholder = label, disabled = false, inputRef = null, className = '', onSubmit = null }) {
  const enter = onSubmit && (event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit() } })
  return (
    <label className={'co-search' + (className ? ' ' + className : '')}>
      {onSubmit ? null : <Icon name="search" size={16} />}
      <input ref={inputRef} type="search" placeholder={placeholder} aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} onKeyDown={enter || undefined}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" data-1p-ignore data-lpignore="true" />
      {value && !disabled ? <button type="button" className="co-search-clear" aria-label={NAMES.clearSearch} onClick={event => { onChange(''); event.currentTarget.parentElement.querySelector('input')?.focus() }}><Icon name="close" size={16} /></button> : null}
      {onSubmit ? <button type="button" className="co-search-go" aria-label={NAMES.search} disabled={disabled} onClick={onSubmit}><Icon name="search" size={16} /></button> : null}
    </label>
  )
}
