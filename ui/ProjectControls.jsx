import { useEffect, useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
import { projectBoardFacts } from '../source-map.js'
import { Icon } from './Icons.jsx'
import { SourceConversations } from './SourceConversations.jsx'
import { useProjectCycle } from './useProjectCycle.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'

export function ProjectControls({ appId, token, project, run, mergeRun, onStart, loading }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(project.key, onStart)
  const { cycle } = workflow
  useEffect(() => { task?.setCycle(cycle) }, [cycle, task?.setCycle])
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
  const acceptedCount = (mergeRun?.items || []).filter(item => item?.state === 'merged').length
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
  return <section className="co-local-work" aria-label={`Actions for ${project.name}`}>
    {acceptedCount > 0 && canUpdate ? <div className="co-accepted-banner" role="status">
      <div><strong>{acceptedCount} accepted {acceptedCount === 1 ? 'change is' : 'changes are'} ready to pull</strong><p>Bring the merged work into this project without replacing unfinished local changes.</p></div>
      <button type="button" className="co-btn co-btn-primary" onClick={() => task?.open('task:update')}>Bring accepted changes here</button>
    </div> : null}
    {local ? <>
      <div className="co-local-overview">
        <div><strong>{project.builtHere ? 'Only on your Möbius' : changedFiles ? `${changedFiles} local ${changedFiles === 1 ? 'file' : 'files'}` : 'No local changes'}</strong>
          <p>{project.workingFiles ? `${project.workingFiles} ${project.workingFiles === 1 ? 'file is' : 'files are'} still being edited. ` : ''}{changedFiles ? 'Private until you prepare and approve sharing.' : 'Nothing new needs preparing.'}</p>
          <button type="button" className="co-quiet-action co-local-files" onClick={() => task?.open('task:files')}>{changedFiles ? 'Review changed files' : 'Review versions'} <Icon name="right" size={15} /></button>
        </div>
        <button className="co-btn co-btn-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => task?.open('task:prepare')}><Icon name="prepare" size={18} /> Prepare changes</button>
      </div>
      <SourceConversations project={project} appId={appId} token={token} />
    </> : null}
    {progress ? <button className="co-work-progress-row" onClick={() => task?.open('task:prepare')}><Icon name={waiting ? 'feedback' : 'cycle'} size={18} />{waiting ? 'Your agent has a question' : paused ? 'Work paused' : 'Agent working'}<Icon name="right" size={16} /></button> : null}
    <TaskPane id="task:prepare">
      <h3>Prepare changes</h3>
      <p>Turn your local work into a clear proposal for private review.</p>
      {checking ? <p role="status">Checking existing work…</p> : null}
      {local ? <button type="button" className="co-prepare-scope" onClick={() => task?.open('task:scope')}><span><small>Includes</small><strong>{changedFiles ? `${changedFiles} local ${changedFiles === 1 ? 'file' : 'files'}` : 'All local changes'}</strong></span><Icon name="right" size={16} /></button> : null}
      {fullCycle ? <label className={'co-follow-merge' + (merge ? ' is-selected' : '')}><input type="checkbox" checked={merge} onChange={event => setMerge(event.target.checked)} /><span><strong>Follow through to merge</strong><small>Keep the agent with this change through review. You still approve sharing and merging.</small></span></label> : null}
      {progress || <>
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => start(merge && fullCycle ? fullCycle : run.privateAction)}><Icon name="prepare" size={18} /> {merge && fullCycle ? 'Prepare and follow' : 'Prepare changes'}</button>
        <p className="co-task-footnote">Private until you approve sharing.</p>
      </>}
      <details className="co-task-details"><summary>How preparation works</summary>
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
      {error || cycle?.error ? <p className="co-run-error" role="alert">{error || cycle.error}</p> : null}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update">
      <Icon name="refresh" size={23} /><h3>Check for shared updates</h3>
      <p>Compare {project.name} with the newest shared version. Unfinished local work stays safe.</p>
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><span>Previous check</span></div>
      {progress || <button className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active} onClick={() => start(projectUpdateAction([project], Date.now()))}>Check now</button>}
      <details className="co-task-details"><summary>How it works</summary>
        <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Test the combined result away from your live installation.</li><li>Bring conflicts back to you.</li></ul>
        <p className="co-task-footnote">A merged PR does not update this installation automatically.</p>
      </details>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </TaskPane> : null}
  </section>
}
