import { useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
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

const STATUS_LABELS = {
  restoring: 'Checking saved work', checking: 'Checking work status', starting: 'Starting agent', stopping: 'Stopping work',
  waiting: 'Your agent has a question', paused: 'Work paused', failed: 'Work failed', stopped: 'Work stopped',
  inactive: 'Agent not running', complete: 'Run completed', unknown: 'Status unknown',
}

// Why a reserved start cannot be finished here, naming only controls that exist.
// Finishing replays the owner's already-chosen start under its own scope, so
// it is never re-gated by today's merge rights: the gate decides whether a
// *new* cycle may start, and GitHub plus the platform's merge executor still
// enforce rights at merge time. A start with saved work is always finishable.
export function reservedStartBlocker({ action, canDiscard }) {
  if (action) return ''
  return canDiscard ? 'This older start did not save its exact work. Discard it, then start again.'
    : 'This older start did not save its exact work, and this Möbius cannot safely cancel it, so it stays reserved. Check again finds its conversation if it started.'
}

export function ProjectControls({ appId, token, project, run, onStart, loading, children }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(projectCycleIdentity(project), onStart)
  const { cycle } = workflow
  const [error, setError] = useState('')
  const [follow, setFollow] = useState(false)
  const [prepareAgent, setPrepareAgent] = useState({ provider: '', model: '', effort: '' })
  const [pullAgent, setPullAgent] = useState({ provider: '', model: '', effort: '' })
  const [cycleAgent, setCycleAgent] = useState({ provider: '', model: '', effort: '' })
  const checking = ['restoring', 'checking', 'unknown'].includes(cycle.phase)
  const active = ['starting', 'running', 'checking', 'stopping'].includes(cycle.phase)
  const moving = ['starting', 'running'].includes(cycle.phase)
  const waiting = cycle.phase === 'waiting'
  const statusLabel = cycle.phase === 'running'
    ? (cycle.event === 'update_source_projects' ? 'Pulling accepted changes' : 'Preparing changes')
    : STATUS_LABELS[cycle.phase] || 'Status unknown'
  const canUpdate = project.available && project.canonical_repo && project.kind !== 'external'
  const local = project.kind !== 'external'
  const changedFiles = Math.max(project.localFiles || 0, project.workingFiles || 0)
  // Plain upstream position, like the local file count beside it. Counting
  // merged records that touch incoming files overstated pending updates.
  const incoming = project.incomingFiles > 0 || (!project.semanticAvailable && project.originBehind > 0) ? incomingCount(project) : ''
  // Starting a full merge cycle needs merge rights; seeing existing cycles never does.
  const cycleAction = contributionCycleAction(run, [project])
  const fullCycleAction = mayMerge(project.viewerPermission) && cycleAction ? { ...cycleAction, merge: true } : null
  // Recovery replays the reserved start exactly; it never substitutes today's
  // work or model. A full cycle still needs merge rights to be finished.
  const finishBlocker = reservedStartBlocker({ action: cycle.pendingAction, canDiscard: workflow.canDiscardStart })
  async function start(action, agent) {
    setError('')
    try {
      const result = await workflow.start({ ...action, agent })
      if (!result?.ok && !result?.reserved) setError(result?.error || 'Could not start. Try again.')
    } catch { setError('Could not start. Try again.') }
  }
  const canStart = !loading && !checking && !active && !waiting
  const blockedReason = cycle.pending ? '' : checking ? 'Checking saved work before another cycle can start.'
    : active || waiting ? 'Current work must finish or be cancelled before another cycle starts.'
    : loading ? 'Project status is still loading.' : ''
  // Cycle status and history appear once there is work to show; an idle
  // project configures new work from its Prepare action instead.
  const hasCycle = Boolean(cycle.chatId || cycle.pending || cycle.history?.length || cycle.phase === 'unknown')
  const pendingRecovery = cycle.pending && cycle.pendingId ? <div className="co-cycle-actions">
    <button type="button" className="co-btn co-btn-primary" disabled={Boolean(finishBlocker)} onClick={() => workflow.finishStart()}>Finish starting</button>
    {workflow.canDiscardStart ? <button type="button" className="co-btn" onClick={workflow.discardStart}>Discard this start</button> : null}
    {finishBlocker ? <p className="co-task-footnote">{finishBlocker}</p> : null}
  </div> : null
  const progressRow = hasCycle ? <section className="co-cycle-outlet" aria-label="Project work">
    <button type="button" className="co-work-progress-row" onClick={() => task?.open('task:cycle')} aria-expanded={task?.activeId === 'task:cycle'} aria-busy={active}>
      <span className={moving ? 'co-working-icon' : ''}><Icon name={waiting ? 'feedback' : 'prepare'} size={18} /></span>
      <span><strong>{cycle.pending ? 'A start needs checking' : !cycle.chatId ? 'Project work' : waiting ? 'Your agent has a question' : moving ? 'Agent working' : statusLabel}</strong><small>{cycle.chatId ? cycle.title || 'Current work' : 'Previous cycles and conversations'}</small></span><Icon name="right" size={16} />
    </button>
    <TaskPane id="task:cycle" dock={false}>
      <h3>Project work</h3>
      {cycle.chatId ? <p><strong>Current:</strong> {cycle.title || 'Project work'} · {statusLabel}{cycle.startedAt ? <> · <DateLabel value={cycle.startedAt} prefix="Started " /></> : null}</p> : <p>No current cycle.</p>}
      <div className="co-cycle-actions">
        <button type="button" className="co-btn" disabled={['checking', 'restoring', 'starting', 'stopping'].includes(cycle.phase)} onClick={workflow.recheck}><Icon name="refresh" /> Check again</button>
        {cycle.chatId ? <button type="button" className="co-btn" onClick={() => workflow.open()}>{waiting ? 'Answer question' : 'Open current conversation'}</button> : null}
        {['running', 'waiting', 'paused'].includes(cycle.phase) ? <button type="button" className="co-btn" onClick={workflow.stop}>{cycle.phase === 'paused' ? 'Cancel paused work' : 'Cancel active work'}</button> : null}
      </div>
      {pendingRecovery}
      {fullCycleAction && !cycle.pending ? <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={cycleAgent} onChange={next => { setCycleAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(fullCycleAction, cycleAgent)}>Start fresh full merge cycle</button>
      </> : null}
      {blockedReason || cycle.error || error ? <p role="status">{blockedReason || cycle.error || error}</p> : null}
      {cycle.history?.length ? <details><summary>Previous cycles ({cycle.history.length})</summary><ul className="co-cycle-history">{cycle.history.map(item => <li key={item.chat_id}><button type="button" className="co-quiet-action" onClick={() => workflow.open(item.chat_id)}>{item.title || 'Previous project work'}{item.started_at ? <> · <DateLabel value={item.started_at} prefix="Started " /></> : null}</button></li>)}</ul></details> : null}
    </TaskPane>
  </section> : null
  const progress = cycle.chatId && (active || waiting || ['paused', 'failed'].includes(cycle.phase)) ? <div className="co-task-progress" role="status">
    <strong>{waiting ? 'Your agent has a question' : statusLabel}</strong>
    {cycle.title ? <p>{cycle.title}</p> : null}
    <button className="co-btn co-btn-primary" onClick={() => workflow.open()}>{waiting ? 'Answer question' : 'Open conversation'}</button>
  </div> : null
  const alert = error || cycle.error ? <div className="co-alert" role="alert"><strong>{cycle.phase === 'unknown' ? 'Couldn’t check work status' : 'Work needs attention'}</strong><p className="co-alert-text">{error || cycle.error}</p>{pendingRecovery}</div> : null
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
      {fullCycleAction ? <label className={'co-follow-merge' + (follow ? ' is-selected' : '')}><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /><span><strong>Follow through to merge</strong><small>Keep the agent with this change through review. You still approve sharing and merging.</small></span></label> : null}
      {progress || <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={prepareAgent} onChange={next => { setPrepareAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart || !run?.privateAction} onClick={() => follow && fullCycleAction ? start(fullCycleAction, prepareAgent) : start(run.privateAction, prepareAgent)}><Icon name="prepare" size={18} /> {follow && fullCycleAction ? 'Prepare and follow' : 'Start preparation'}</button>
        <p className="co-task-footnote">{blockedReason || 'Private until you approve sharing.'}</p>
      </>}
      <details className="co-task-details"><summary>How preparation works</summary>
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
      {alert}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update" dock={false}>
      <Icon name="refresh" size={23} /><h3>Pull updates</h3>
      <p>Check {project.name} against the newest shared version first, then bring the accepted work in. Unfinished local work stays safe.</p>
      <WorkRoute pull />
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><span>Previous check</span></div>
      {progress || <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={pullAgent} onChange={next => { setPullAgent(next); return true }} />
        <button className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(projectUpdateAction([project], Date.now()), pullAgent)}>Start pull</button>
        {blockedReason ? <p className="co-task-footnote">{blockedReason}</p> : null}
      </>}
      <details className="co-task-details"><summary>How it works</summary>
        <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Test the combined result away from your live installation.</li><li>Bring conflicts back to you.</li></ul>
        <p className="co-task-footnote">A merged PR does not update this installation automatically.</p>
      </details>
      {alert}
    </TaskPane> : null}
  </section>
  return children ? children({ controls, progress: progressRow }) : <>{controls}{progressRow}</>
}
