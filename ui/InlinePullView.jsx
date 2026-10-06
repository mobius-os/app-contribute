import { useEffect, useState } from 'react'
import { fetchLiveStates } from '../api.js'
import { collaborationRequest, loadReviewRuns, PR_FIELDS, REVIEW_STATE_NAMES, reviewRunTitle } from '../collaboration.js'
import { pullConversations, recordsForPull } from '../chat-blocks.js'
import { PullRequestDetail } from './PullRequestDetail.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'
import { ResolvedPrompt } from './ReviewPromptSettings.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { RepoLink } from './ContributionCard.jsx'

export function InlinePullView({ target, appId, token, records, onClose, onProject }) {
  const [state, setState] = useState({ loading: true })
  const [revision, setRevision] = useState(0)
  function openFullView() {
    const intent = target.kind === 'pull' ? `pull-request:${target.repo}#${target.number}` : `chat-review-run:${target.id}`
    window.parent.postMessage({type:'moebius:open-app',appId,intent},'*')
  }
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    async function load() {
      if (target.kind === 'run') {
        const data = await loadReviewRuns(token, appId)
        const run = data.runs?.find(item => item.id === target.id)
        if (!run) throw new Error('This review run is not available in the current history.')
        return { run }
      }
      const [owner, name] = target.repo.split('/')
      const [data, runs] = await Promise.all([
        fetchLiveStates(token, `query ContributePullBlock { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { pullRequest(number:${target.number}) { ${PR_FIELDS} state mergedAt } } }`),
        collaborationRequest(token, appId, 'review-runs').catch(error => ({ runs: [], error: error.message })),
      ])
      if (!data?.repository?.pullRequest) throw new Error('Could not read this PR. Check GitHub access or try again.')
      return { pr: data.repository.pullRequest, runs: runs.runs, runError: runs.error }
    }
    load().then(value => { if (alive) setState(value) }).catch(error => { if (alive) setState({ error: error.message }) })
    return () => { alive = false }
  }, [target.kind, target.repo, target.number, target.id, appId, token, revision])
  return <section className={`co-projects-view co-workspace co-inline-view${target.embedded ? ' is-embedded' : ''}`} aria-label="Contribution details">
    <style>{`.co-inline-view > h2 { font-size:26px; line-height:1.3; margin:16px 0; overflow-wrap:anywhere; } .co-workspace.co-inline-view.is-embedded { padding:16px 20px 40px; } .co-inline-view.is-embedded > h2 { font-size:20px; margin:12px 0; } .co-inline-view > .co-board-actions { display:flex; flex-wrap:wrap; gap:12px; } .co-inline-view .co-pr-note { font-size:14px; line-height:1.6; }`}</style>
    <div className="co-board-actions">{target.embedded ? <button className="co-quiet-action" onClick={openFullView}>Open in Contribute <Icon name="right" /></button> : <button className="co-quiet-action" onClick={onClose}><Icon name="left" /> Projects</button>}<button className="co-quiet-action" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" /> Refresh</button></div>
    {state.loading ? <p role="status">Reading this contribution…</p> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.pr ? <>
      <h2>#{state.pr.number} {state.pr.title}</h2>
      <p className="co-detail-stats"><RepoLink repo={state.pr.repository.nameWithOwner} /><span>{state.pr.state === 'MERGED' ? 'Merged' : state.pr.state === 'CLOSED' ? 'Closed, not merged' : state.pr.isDraft ? 'Draft PR' : 'Open PR'}</span><span>{state.pr.author?.login}</span><span className="co-change-total">{state.pr.changedFiles} {state.pr.changedFiles===1 ? 'file' : 'files'} <b>+{state.pr.additions}</b><em>−{state.pr.deletions}</em></span></p>
      <PullRequestDetail key={`${state.pr.headRefOid}:${state.pr.baseRefOid}`} pr={state.pr} token={token} readOnly
        onRefresh={() => setRevision(value => value + 1)} record={recordsForPull(records, state.pr)[0]}
        provenance={pullConversations(records, state.runs, state.pr)} />
      {state.runError ? <p role="status">Review conversation links unavailable: {state.runError}</p> : null}
      {!target.embedded ? <button className="co-btn" onClick={() => onProject(state.pr.repository)}>Open project controls</button> : null}
    </> : null}
    {state.run ? <>
      <h2>{reviewRunTitle(state.run)}</h2>
      <p>{REVIEW_STATE_NAMES[state.run.execution_state === 'awaiting_owner' ? 'awaiting_owner' : state.run.state] || state.run.state}</p>{state.run.summary ? <p>{state.run.summary}</p> : null}
      {state.run.items?.map(item => <article key={`${item.repo}#${item.number}`}><strong>{item.repo} #{item.number} · {REVIEW_STATE_NAMES[item.state] || item.state}</strong>{item.summary ? <MarkdownView markdown={item.summary} /> : <p>Findings will appear when the agent records them.</p>}{item.tests ? <p>{item.tests}</p> : null}</article>)}
      <details className="co-task-details"><summary>Instructions used by this run</summary>{state.run.options ? <ResolvedPrompt snapshot={state.run.options} /> : <p>This older run did not retain a prompt snapshot.</p>}</details>
      <button className="co-btn" onClick={() => openAgentConversation(state.run.chat_id)}>Open owning conversation</button>
    </> : null}
  </section>
}
