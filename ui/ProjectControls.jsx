import { useEffect, useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
import { projectBoardFacts } from '../source-map.js'
import { runUnitRecords } from '../run.js'
import { parseDiffStat } from '../diff.js'
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
  const summaries = [...new Map([...(run?.decisions || []), ...(run?.working || [])]
    .flatMap(runUnitRecords).filter(rec => rec.status === 'prepared' && (rec.summary || rec.plan?.body_draft))
    .map(rec => [rec.id, rec])).values()]
  const changedFiles = new Set([...(project.localOnlyPaths || []), ...(project.working?.paths || []).map(row => row.path)]).size || Math.max(project.localFiles || 0, project.workingFiles || 0)
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
      <header><h3>Your local work</h3></header>
      <div className="co-local-overview">
        <div><strong>{project.builtHere ? 'Only on your Möbius' : changedFiles ? 'Changes only you have' : summaries.length ? 'Prepared for sharing' : 'No unprepared changes found'}</strong>
          <p>{changedFiles ? `${changedFiles} changed ${changedFiles === 1 ? 'file' : 'files'}${project.workingFiles ? ` · ${project.workingFiles} being edited` : ''}. ` : ''}Prepare a clear proposal before sharing.</p>
        </div>
        <button className="co-btn co-btn-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => task?.open('task:prepare')}><Icon name="prepare" size={18} /> Prepare changes</button>
      </div>
      {summaries.length ? <details className="co-saved-summaries"><summary>{summaries.length} saved {summaries.length === 1 ? 'summary' : 'summaries'} · private proposals</summary>
        {summaries.map(rec => {
          const current = !!project.head_sha && rec.plan?.source_sha === project.head_sha && !project.workingFiles
          const totals = parseDiffStat(rec.plan?.diff_stat)
          const date = rec.quality_review?.reviewed_at || rec.created_at
          return <div className="co-saved-summary" key={rec.id}><strong>{rec.title || rec.plan?.title || 'Prepared change'}</strong><p>{rec.summary || 'Description available in the prepared proposal below.'}</p>
            <div className="co-detail-stats"><span>{current ? 'Prepared from this source version' : 'Earlier source · prepare again to refresh'}</span>{totals ? <span>{totals.totalFiles} files · +{totals.additions} −{totals.deletions}</span> : null}{date && Number.isFinite(Date.parse(date)) ? <time dateTime={date}>{new Date(date).toLocaleDateString()}</time> : null}</div>
          </div>
        })}
      </details> : null}
      <SourceConversations project={project} appId={appId} token={token} />
    </> : null}
    {progress ? <button className="co-work-progress-row" onClick={() => task?.open('task:prepare')}><Icon name={waiting ? 'feedback' : 'cycle'} size={18} />{waiting ? 'Your agent has a question' : paused ? 'Work paused' : 'Agent working'}<Icon name="right" size={16} /></button> : null}
    <TaskPane id="task:prepare">
      <h3>Prepare changes</h3>
      <p>Organize and review your local work before sharing.</p>
      {checking ? <p role="status">Checking existing work…</p> : null}
      <div className="co-task-scope"><span>Scope</span>{local ? <button className="co-quiet-action" onClick={() => task?.open('task:scope')}>All local changes <Icon name="chevron" size={16} /></button> : null}</div>
      {progress || <>
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={loading || checking || active || !run?.privateAction} onClick={() => start(merge && fullCycle ? fullCycle : run.privateAction)}><Icon name="prepare" size={18} /> Prepare changes</button>
        <p className="co-task-footnote">Private until you approve sharing.</p>
      </>}
      <details className="co-task-details"><summary>Options & process</summary>
        {fullCycle ? <label className="co-workflow-option"><input type="checkbox" checked={merge} onChange={event => setMerge(event.target.checked)} /><span>Continue through merge<small>Keep the agent on the full journey. Approve sharing and merging in chat or Contribute.</small></span></label> : null}
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
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
