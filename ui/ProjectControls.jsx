import { useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
import { incomingCount, projectBoardFacts, projectCycleIdentity } from '../source-map.js'
import { Icon } from './Icons.jsx'
import { SourceConversations } from './SourceConversations.jsx'
import { useProjectCycle } from './useProjectCycle.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'

export function ProjectControls({ appId, token, project, run, mergeRun, onStart, loading, children }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(projectCycleIdentity(project), onStart)
  const { cycle } = workflow
  const [error, setError] = useState('')
  const [merge, setMerge] = useState(false)
  const checking = cycle.phase === 'restoring'
  const active = ['starting', 'running', 'checking', 'stopping'].includes(cycle?.phase)
  const waiting = cycle?.phase === 'waiting'
  const paused = ['paused', 'failed'].includes(cycle?.phase)
  const fullCycle = mayMerge(project.viewerPermission) ? contributionCycleAction(mergeRun, [project]) : null
  const canUpdate = project.available && project.canonical_repo && project.kind !== 'external'
  const local = project.kind !== 'external'
  const changedFiles = Math.max(project.localFiles || 0, project.workingFiles || 0)
  // Plain upstream position, like the local file count beside it. Counting
  // merged records that touch incoming files overstated pending updates.
  const incoming = project.incomingFiles > 0 || (!project.semanticAvailable && project.originBehind > 0) ? incomingCount(project) : ''
  async function start(action) {
    setError('')
    try {
      const result = await workflow.start(action)
      if (!result?.ok) setError(result?.error || 'Could not start. Try again.')
    } catch { setError('Could not start. Try again.') }
  }
  const progress = active || ((waiting || paused) && cycle.chatId) ? <div className="co-task-progress" role="status">
    <strong>{waiting ? 'Your agent has a question' : paused ? 'Work paused' : 'Working on your project'}</strong>
    {cycle?.title ? <p>{cycle.title}</p> : null}
    {cycle?.chatId ? <button className="co-btn co-btn-primary" onClick={workflow.open}>{waiting ? 'Answer question' : 'Open conversation'}</button> : null}
    {cycle?.phase === 'running' ? <button className="co-quiet-action" onClick={workflow.stop}>Stop</button> : null}
  </div> : null
  const progressRow = progress ? <button className="co-work-progress-row" onClick={() => task?.open(cycle.event === 'update_source_projects' ? 'task:update' : 'task:prepare')}><Icon name={waiting ? 'feedback' : 'cycle'} size={18} />{waiting ? 'Your agent has a question' : paused ? 'Work paused' : 'Agent working'}<Icon name="right" size={16} /></button> : null
  const controls = <section className="co-local-work" aria-label={`Actions for ${project.name}`}>
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
      {checking ? <p role="status">Checking existing work…</p> : null}
      {local ? <button type="button" className="co-prepare-scope" onClick={() => task?.open('task:scope')}><span><small>Includes</small><strong>{changedFiles ? `${changedFiles} local ${changedFiles === 1 ? 'file' : 'files'}` : 'All local changes'}</strong></span><Icon name="right" size={16} /></button> : null}
      {fullCycle ? <label className={'co-follow-merge' + (merge ? ' is-selected' : '')}><input type="checkbox" checked={merge} onChange={event => setMerge(event.target.checked)} /><span><strong>Follow through to merge</strong><small>Keep the agent with this change through review. You still approve sharing and merging.</small></span></label> : null}
      {progress || <>
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => start(merge && fullCycle ? fullCycle : run.privateAction)}><Icon name="prepare" size={18} /> {merge && fullCycle ? 'Prepare and follow' : 'Start preparation'}</button>
        <p className="co-task-footnote">Private until you approve sharing.</p>
      </>}
      <details className="co-task-details"><summary>How preparation works</summary>
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
      {error || cycle?.error ? <div className="co-alert" role="alert"><strong>Work needs attention</strong><p className="co-alert-text">{error || cycle.error}</p></div> : null}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update" dock={false}>
      <Icon name="refresh" size={23} /><h3>Pull updates</h3>
      <p>Check {project.name} against the newest shared version first, then bring the accepted work in. Unfinished local work stays safe.</p>
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><span>Previous check</span></div>
      {progress || <button className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active} onClick={() => start(projectUpdateAction([project], Date.now()))}>Start pull</button>}
      <details className="co-task-details"><summary>How it works</summary>
        <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Test the combined result away from your live installation.</li><li>Bring conflicts back to you.</li></ul>
        <p className="co-task-footnote">A merged PR does not update this installation automatically.</p>
      </details>
      {error || cycle?.error ? <div className="co-alert" role="alert"><strong>Work needs attention</strong><p className="co-alert-text">{error || cycle.error}</p></div> : null}
    </TaskPane> : null}
  </section>
  return children ? children({ controls, progress: progressRow }) : <>{controls}{progressRow}</>
}
