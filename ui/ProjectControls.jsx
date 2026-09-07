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
    {local ? <>
      <header><h3>Your local work</h3><button className="co-quiet-action" onClick={() => task?.open('task:prepare')}>Prepare</button></header>
      <button className="co-local-summary" onClick={() => task?.open('task:prepare')}>
        <Icon name="prepare" size={22} /><span><strong>{project.builtHere ? 'Not shared yet' : project.localFiles || project.workingFiles ? `${project.localFiles || 0} files with local differences${project.workingFiles ? ` · ${project.workingFiles} being edited` : ''}` : 'No unprepared changes found'}</strong><small>Current code · across this project’s conversations</small></span><Icon name="right" size={17} />
      </button>
      <button className="co-quiet-action" onClick={() => task?.open('task:scope')}>Choose scope</button>
      <SourceConversations project={project} appId={appId} token={token} />
    </> : null}
    {progress ? <button className="co-work-progress-row" onClick={() => task?.open('task:prepare')}><Icon name={waiting ? 'feedback' : 'cycle'} size={18} />{waiting ? 'Your agent has a question' : paused ? 'Work paused' : 'Agent working'}<Icon name="right" size={16} /></button> : null}
    <TaskPane id="task:prepare">
      <Icon name="prepare" size={23} />
      <h3>Prepare your changes</h3>
      <p>Let the agent organize and review this project’s local work before you share it.</p>
      {checking ? <p role="status">Checking existing work…</p> : null}
      <div className="co-task-scope"><strong>All local work in {project.name}</strong><p>Group related changes into the smallest sensible set of pull requests.</p>{local ? <button className="co-quiet-action" onClick={() => task?.open('task:scope')}>Change scope</button> : null}</div>
      {progress || <>
        {fullCycle ? <label className="co-workflow-option"><input type="checkbox" checked={merge} onChange={event => setMerge(event.target.checked)} /><span>Continue through merge<small>Clear work can proceed. Questions come back to you.</small></span></label> : null}
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => start(merge && fullCycle ? fullCycle : run.privateAction)}><Icon name="prepare" size={18} /> Prepare changes</button>
        <p className="co-task-footnote">Private first. You approve the exact changes before sharing{merge ? ' and merging' : ''}.</p>
      </>}
      <details className="co-task-details"><summary>What the agent will do</summary><p>Compare with upstream in isolation, preserve local and sibling work, group related changes, and thoroughly review each proposed pull request.</p><p>To prepare only one conversation’s work, use Prepare to submit in that conversation’s Changes view.</p></details>
      {error || cycle?.error ? <p className="co-run-error" role="alert">{error || cycle.error}</p> : null}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update">
      <Icon name="refresh" size={23} /><h3>Get up to date</h3>
      <p>Bring accepted changes into {project.name}, keeping unfinished local work safe.</p>
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><p>This is the last recorded comparison, not a fresh online check.</p></div>
      <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Compare and test the combined result in isolation.</li><li>Use the reviewed update flow. Bring conflicts back to you.</li></ul>
      {progress || <button className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active} onClick={() => start(projectUpdateAction([project], Date.now()))}>Check & update safely</button>}
      <p className="co-task-footnote">Merging a PR doesn’t update this installation. This step completes the return journey.</p>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </TaskPane> : null}
  </section>
}
