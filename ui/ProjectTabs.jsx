import { useEffect, useId, useRef, useState } from 'react'
import { NAMES } from '../names.js'
import { showOpenTab } from './stripScroll.js'
import { useProjectTask } from './TaskPane.jsx'

const BASE_TABS = [['all', 'All PRs'], ['requests', 'Review requests'], ['mine', 'Agent runs']]

// One tab per job under the project's controls. The PR list stays
// one mounted component whatever the tab, so its loaded pages, agent runs and
// selection survive a switch and GitHub is not read again. `inventory` is saved
// public work the live list cannot show (for example while GitHub is
// unreachable); it stays on All PRs so it is never hidden behind another tab.
// Edits is a tab only while the project has edits to show (`edits` is its
// content); the PR list stays mounted, and hidden, while it is open.
// `openTab` is the tab an opened item belongs to (its page is that tab's content): it is shown whenever the item is
// opened (`openKey` changes), also from another tab, so an item is never open somewhere the owner cannot see it.
export function ProjectTabs({ reviewCount = 0, renderPullRequests, inventory, myJobs, myWork, prepared = null, preparedCount = 0, edits = null, editsCount = null, defaultTab = 'all', openTab = '', openKey = '' }) {
  const [chosen, setTab] = useState(openTab || defaultTab)
  const [total, setTotal] = useState(null)
  const id = useId()
  const list = useRef(null)
  const TABS = [BASE_TABS[0], ...(preparedCount ? [['prepared', NAMES.preparedPrs]] : []), ...BASE_TABS.slice(1), ...(edits ? [['edits', 'Local changes']] : [])]
  const task = useProjectTask()
  useEffect(() => { if (openTab) setTab(openTab) }, [openTab, openKey])
  // Leaving the tab a page is open in closes the page, so coming back shows the list (owner's choice, 2026-11-23).
  function choose(key) {
    if (openTab && key !== openTab) task?.close()
    setTab(key)
  }
  const tab = TABS.some(([key]) => key === chosen) ? chosen : 'all'
  const counts = { all: total, prepared: preparedCount, requests: reviewCount, mine: null, edits: editsCount }
  useEffect(() => { showOpenTab(list.current, list.current?.querySelector('[role="tab"][aria-selected="true"]')) }, [tab])
  function moveWithArrows(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = TABS.findIndex(([key]) => key === tab)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]
    choose(next)
    list.current?.querySelector(`[data-tab="${next}"]`)?.focus()
    event.preventDefault()
  }
  return <>
    <div ref={list} className="co-project-tabs" role="tablist" aria-label="Project views" onKeyDown={moveWithArrows}>
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" data-tab={key} id={`${id}-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} className="co-project-tab" onClick={() => choose(key)}>
        {label}{counts[key] != null ? <span className={'co-tab-count' + (key === 'requests' && counts[key] > 0 ? ' is-you' : '') + (key === 'edits' ? ' is-files' : '')}>{key === 'edits' ? `${counts[key]} ${counts[key] === 1 ? 'file' : 'files'}` : counts[key]}</span> : null}
      </button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="co-project-tabpanel">
      {/* Fixed slots keep the PR list at one position, so React never remounts it. */}
      {tab === 'mine' ? myJobs : null}
      {renderPullRequests?.({ scope: tab, onScope: choose, onTotal: setTotal })}
      {tab === 'prepared' ? prepared : null}
      {tab === 'all' ? inventory : null}
      {tab === 'mine' ? myWork : null}
      {tab === 'edits' ? edits : null}
    </div>
  </>
}
