import { useRef, useState } from 'react'
import { actionsMenuModel } from '../actions-menu.js'
import { NAMES } from '../names.js'
import { Icon } from './Icons.jsx'
import { useDismissableMenu } from './useDismissableMenu.js'
import { useKeepOnScreen } from './useKeepOnScreen.js'

// "Actions ▾": what you can do yourself with a PR, and what an agent can do for
// it. Choosing only opens the confirm sheet or review window; nothing starts
// until the owner confirms there. `align` names the trigger edge the menu lines
// up with: 'end' for a trigger at the right of its row, 'start' for one at the
// left, so the menu opens inward. On a phone the menu is a sheet from the bottom edge instead
// (CSS only, workspace-theme.js): it cannot run off a side, and the scrim dims the page behind it and
// closes it when pressed. Cancel is the sheet's way out and shows on a phone only. The head stays put and the rows
// scroll under it without a scrollbar; a fade at the foot says there are more.
function Choice({ item, onPick }) {
  const main = <button type="button" role="menuitem" aria-disabled={item.off || undefined} data-danger={item.danger || undefined} className={(item.rec ? 'is-rec ' : '') + (item.off ? 'is-off ' : '') + (item.danger ? 'is-danger' : '')} onClick={() => { if (!item.off) onPick(item.intent) }}>
    <span className="co-agent-menu-tile"><Icon name={item.icon} size={17} /></span><span><strong>{item.title}</strong><small>{item.off ? item.reason : item.detail}</small></span>
  </button>
  if (!item.side) return main
  // One row, two choices: the action, and a smaller one beside it (Merge, and how it lands).
  return <div className="co-agent-menu-pair">{main}
    <button type="button" role="menuitem" className={'co-agent-menu-side' + (item.off ? ' is-off' : '')} aria-disabled={item.off || undefined} aria-label={`${item.side.title} ${item.side.detail}`} title={item.side.detail} onClick={() => { if (!item.off) onPick(item.side.intent) }}>
      <Icon name="chevron" size={16} />
    </button>
  </div>
}

// One box at the top. `brief` is a menu opened under the PR's own title (its page): the number, where it stands and the
// facts on one line. Anywhere else the machine's sentence follows, because the row behind the menu is covered.
function MenuHead({ model: { header, standing, headline }, brief }) {
  const facts = [brief ? standing : '', header.text].filter(Boolean).join(' · ')
  return <div className="co-agent-menu-head">
    <p><b>{header.label}</b>{facts ? ` · ${facts}` : ''}</p>
    {headline && !brief ? <p className="co-agent-menu-standing">{headline}</p> : null}
  </div>
}

// With only one group the menu is a plain list; with two, each is named.
// Take over is set apart at the bottom of the agent group: rare and deliberate.
function Group({ title, items, onPick, named }) {
  if (!items.length) return null
  return <div role="group" aria-label={title}>
    {named ? <p className="co-agent-menu-group">{title}</p> : null}
    {items.map(item => <div key={item.intent} className={item.intent === 'take_over' || item.danger ? 'co-agent-menu-apart' : undefined}><Choice item={item} onPick={onPick} /></div>)}
  </div>
}

// `decisions` are the PR machine's decisions for `pulls`, in the same order.
// `defaultOpen` shows the list on first render, which is how the menu's own words are tested.
export function ActionsMenu({ onChoose, pulls = [], decisions = [], record = null, capabilities = null, disabled = false, variant = 'ghost', label = 'Actions', ariaLabel, align = 'end', defaultOpen = false, brief = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef(null)
  const list = useRef(null)
  const model = actionsMenuModel(pulls, decisions, { record, capabilities })
  useDismissableMenu(root, open, setOpen)
  useKeepOnScreen(list, open)
  // The trigger takes focus back first, so whatever opens next returns there.
  function close() {
    setOpen(false)
    root.current?.querySelector('button')?.focus({ preventScroll: true })
  }
  function choose(intent) {
    close()
    onChoose(intent)
  }
  const named = model.you.length > 0
  return <div className={`co-agent-menu is-align-${align}`} ref={root}>
    <button type="button" className={`co-btn ${variant === 'button' ? '' : 'co-btn-quiet '}co-agent-menu-button is-${variant}`} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <Icon name="act" size={16} /><span>{label}</span><Icon name="chevron" size={14} />
    </button>
    {open ? <>
      <div className="co-agent-menu-scrim" aria-hidden="true" onClick={close} />
      <div className="co-agent-menu-list" ref={list} role="menu" aria-label="Actions" tabIndex={-1}>
        {model.header ? <MenuHead model={model} brief={brief} /> : null}
        <div className="co-agent-menu-rows">
          <Group title="You" items={model.you} onPick={choose} named={named} />
          <Group title="Agent" items={model.agent} onPick={choose} named={named} />
        </div>
        <button type="button" className="co-btn co-agent-menu-cancel" onClick={close}>{NAMES.cancel}</button>
      </div>
    </> : null}
  </div>
}
