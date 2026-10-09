import { useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { incomingCount, projectBoardFacts, projectCycleIdentity } from '../source-map.js'
import { Icon } from './Icons.jsx'
import { SourceConversations } from './SourceConversations.jsx'
import { useProjectCycle } from './useProjectCycle.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import { DateLabel } from './PullRequestDetail.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

const CYCLE_CSS = `
.co-cycle-outlet{margin:12px 0 20px;border-bottom:1px solid var(--border)}
.co-cycle-outlet .co-work-progress-row{margin:0}
.co-cycle-outlet .co-task-content{margin:12px 0 16px}
.co-work-route{display:flex;align-items:center;gap:10px;margin:16px 0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px}
.co-work-route strong{font-weight:650}
.co-work-route .co-icon{color:var(--accent);flex:none}
.co-cycle-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.co-cycle-history{padding-left:20px}
.co-cycle-history li{margin:4px 0}
`

function WorkRoute({ pull = false }) {
  return <div className="co-work-route" role="img" aria-label={pull ? 'Accepted GitHub work moves into your local project' : 'Local work becomes a GitHub proposal only after your approval'}>
    <strong>{pull ? 'GitHub' : 'Local work'}</strong><Icon name="right" size={18} /><strong>{pull ? 'Local project' : 'GitHub proposal'}</strong>
  </div>
}

export function ProjectControls({ appId, token, project, run, onStart, loading, children }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(projectCycleIdentity(project), onStart)
  const { cycle } = workflow
  const [error, setError] = useState('')
  const [prepareAgent, setPrepareAgent] = useState({ provider: '', model: '', effort: '' })
  const [pullAgent, setPullAgent] = useState({ provider: '', model: '', effort: '' })
  const [cycleAgent, setCycleAgent] = useState({ provider: '', model: '', effort: '' })
  const checking = ['restoring', 'checking', 'unknown'].includes(cycle.phase)
  const active = ['starting', 'running', 'checking', 'stopping'].includes(cycle?.phase)
  const moving = ['starting', 'running'].includes(cycle?.phase)
  const waiting = cycle?.phase === 'waiting'
  const statusLabel = {
    restoring: 'Checking saved work', checking: 'Checking work status',
    starting: 'Starting agent', stopping:'Stopping work', running: cycle.event === 'update_source_projects' ? 'Pulling accepted changes' : 'Preparing changes',
    waiting: 'Your agent has a question', paused: 'Work paused', failed: 'Work failed',
    stopped: 'Work stopped', inactive: 'Agent not running', complete: 'Run completed', unknown: 'Status unknown',
  }[cycle.phase] || 'Status unknown'
  const canUpdate = project.available && project.canonical_repo && project.kind !== 'external'
  const local = project.kind !== 'external'
  const changedFiles = Math.max(project.localFiles || 0, project.workingFiles || 0)
  // Plain upstream position, like the local file count beside it. Counting
  // merged records that touch incoming files overstated pending updates.
  const incoming = project.incomingFiles > 0 || (!project.semanticAvailable && project.originBehind > 0) ? incomingCount(project) : ''
  async function start(action, agent) {
    setError('')
    try {
      const result = await workflow.start({ ...action, agent })
      if (!result?.ok) setError(result?.error || 'Could not start. Try again.')
    } catch { setError('Could not start. Try again.') }
  }
  const canStart = !loading && !checking && !active && !waiting
  const blockedReason = checking ? 'Checking saved work before another cycle can start.'
    : active || waiting ? 'Current work must finish or be cancelled before another cycle starts.'
    : loading ? 'Project status is still loading.' : ''
  const fullCycleAction = contributionCycleAction(run, [project])
  const progressRow = <section className="co-cycle-outlet" aria-label="Full merge cycles">
    <button type="button" className="co-work-progress-row" onClick={() => task?.open('task:cycle')} aria-expanded={task?.activeId === 'task:cycle'} aria-busy={active}>
      <span className={moving ? 'co-working-icon' : ''}><Icon name={waiting ? 'feedback' : 'prepare'} size={18} /></span>
      <span><strong>Full merge cycles</strong><small>{cycle.chatId ? `${cycle.title || 'Current work'} · ${statusLabel}` : 'Start or review project work'}</small></span><Icon name="right" size={16} />
    </button>
    {cycle.phase === 'unknown' ? <button type="button" className="co-btn" onClick={workflow.recheck}><Icon name="refresh" /> Recheck saved work</button> : null}
    <TaskPane id="task:cycle" dock={false}>
      <h3>Full merge cycles</h3>
      {cycle.chatId ? <p><strong>Current:</strong> {cycle.title || 'Project work'} · {statusLabel}{cycle.startedAt ? <> · <DateLabel value={cycle.startedAt} prefix="Started " /></> : null}</p> : <p>No current cycle.</p>}
      <div className="co-cycle-actions">
        <button type="button" className="co-btn" disabled={cycle.phase === 'checking' || cycle.phase === 'restoring' || cycle.phase === 'starting' || cycle.phase === 'stopping'} onClick={workflow.recheck}><Icon name="refresh" /> Recheck saved work</button>
        {cycle.chatId ? <button type="button" className="co-btn" onClick={() => workflow.open()}>{waiting ? 'Answer question' : 'Open current conversation'}</button> : null}
        {['running', 'waiting', 'paused'].includes(cycle.phase) ? <button type="button" className="co-btn" onClick={workflow.stop}>{cycle.phase === 'paused' ? 'Cancel paused work' : 'Cancel active work'}</button> : null}
      </div>
      {fullCycleAction ? <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={cycleAgent} onChange={next => { setCycleAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(fullCycleAction, cycleAgent)}>Start fresh full merge cycle</button>
      </> : null}
      {blockedReason || cycle.error || error ? <p role="status">{blockedReason || cycle.error || error}</p> : null}
      {cycle.history?.length ? <details><summary>Previous cycles ({cycle.history.length})</summary><ul className="co-cycle-history">{cycle.history.map(item => <li key={item.chat_id}><button type="button" className="co-quiet-action" onClick={() => workflow.open(item.chat_id)}>{item.title || 'Previous project work'}{item.started_at ? <> · <DateLabel value={item.started_at} prefix="Started " /></> : null}</button></li>)}</ul></details> : null}
    </TaskPane>
  </section>
  const controls = <section className="co-local-work" aria-label={`Actions for ${project.name}`}>
    <style>{CYCLE_CSS}</style>
    {local ? <div className="co-project-position" aria-label="Local and upstream changes">
      <div className="co-position-line">
        <Icon name="prepare" size={18} />
        <button type="button" className="co-position-inspect" onClick={() => task?.open('task:files')}><span>Local</span><strong>{project.builtHere ? 'Only on your Möbius' : changedFiles ? `${changedFiles} changed ${changedFiles === 1 ? 'file' : 'files'}` : 'No changes'}</strong></button>
        <button className="co-btn" disabled={!run?.privateAction} onClick={() => task?.open('task:prepare')}>Prepare changes</button>
      </div>
      {canUpdate ? <div className="co-position-line">
        <Icon name="refresh" size={18} />
        <button type="button" className="co-position-inspect" onClick={() => task?.open('task:update')}><span>Upstream</span><strong>{incoming ? `${incoming} incoming` : projectBoardFacts(project).shared}</strong></button>
        <button type="button" className="co-btn" onClick={() => task?.open('task:update')}>Pull updates</button>
      </div> : null}
    </div> : null}
    {local ? <SourceConversations project={project} appId={appId} token={token} /> : null}
    <TaskPane id="task:prepare" dock={false}>
      <h3>Prepare changes</h3>
      <p>Turn your local work into a clear proposal for private review.</p>
      <WorkRoute />
      {cycle.phase === 'restoring' ? <p role="status">Checking existing work…</p> : null}
      {local ? <button type="button" className="co-prepare-scope" onClick={() => task?.open('task:scope')}><span><small>Includes</small><strong>{changedFiles ? `${changedFiles} local ${changedFiles === 1 ? 'file' : 'files'}` : 'All local changes'}</strong></span><Icon name="right" size={16} /></button> : null}
      <AgentModelSettings token={token} defaultHint="Your chat default" choice={prepareAgent} onChange={next => { setPrepareAgent(next); return true }} />
      <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart || !run?.privateAction} onClick={() => start(run.privateAction, prepareAgent)}><Icon name="prepare" size={18} /> Start preparation</button>
      <p className="co-task-footnote">{blockedReason || 'Private until you approve sharing.'}</p>
      <details className="co-task-details"><summary>How preparation works</summary>
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
      {error || cycle?.error ? <div className="co-alert" role="alert"><strong>{cycle.phase === 'unknown' ? 'Couldn’t check work status' : 'Work needs attention'}</strong><p className="co-alert-text">{error || cycle.error}</p></div> : null}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update" dock={false}>
      <Icon name="refresh" size={23} /><h3>Pull updates</h3>
      <p>Check {project.name} against the newest shared version first, then bring the accepted work in. Unfinished local work stays safe.</p>
      <WorkRoute pull />
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><span>Previous check</span></div>
      <AgentModelSettings token={token} defaultHint="Your chat default" choice={pullAgent} onChange={next => { setPullAgent(next); return true }} />
      <button className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(projectUpdateAction([project], Date.now()), pullAgent)}>Start pull</button>
      {blockedReason ? <p className="co-task-footnote">{blockedReason}</p> : null}
      <details className="co-task-details"><summary>How it works</summary>
        <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Test the combined result away from your live installation.</li><li>Bring conflicts back to you.</li></ul>
        <p className="co-task-footnote">A merged PR does not update this installation automatically.</p>
      </details>
      {error || cycle?.error ? <div className="co-alert" role="alert"><strong>{cycle.phase === 'unknown' ? 'Couldn’t check work status' : 'Work needs attention'}</strong><p className="co-alert-text">{error || cycle.error}</p></div> : null}
    </TaskPane> : null}
  </section>
  return children ? children({ controls, progress: progressRow }) : <>{controls}{progressRow}</>
}
