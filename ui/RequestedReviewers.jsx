import { Avatar, DateLabel } from './GithubParts.jsx'

// Who was asked to review this PR and where each review stands: the person, the day they were asked and one current
// badge (reviewers.js words the rows). Assigning someone is a different thing and is never shown here. It stays out of
// the way until there is something to show: nothing while it reads, and nothing when no one was asked. A read that came
// back partial says so (the list may be missing people) instead of passing for the whole.
export function RequestedReviewers({ entry, onRetry }) {
  if (!entry || entry.loading) return null
  if (entry.error) return <p className="co-reviewers-error" role="alert">Could not read who was asked to review. <button className="co-btn" onClick={onRetry}>Try again</button></p>
  const rows = entry.data?.reviewers || []
  const notes = (entry.data?.errors || []).map(message => <p key={message} className="co-reviewers-error" role="alert">{message} <button className="co-btn" onClick={onRetry}>Try again</button></p>)
  if (!rows.length) return notes.length ? <>{notes}</> : null
  return <section className="co-reviewers" aria-labelledby="co-reviewers-title">
    <header>
      <h4 id="co-reviewers-title">Requested reviewers <span className="co-tab-count">{rows.length}</span></h4>
      <p>Who was asked, and where each review stands.</p>
    </header>
    <ul>
      {rows.map(row => <li className="co-reviewer" key={row.key}>
        <Avatar login={row.name} size={28} />
        <div><strong>{row.name}</strong>{row.requestedAt ? <p>{row.again ? 'Requested again ' : 'Requested '}<DateLabel value={row.requestedAt} time /></p> : null}</div>
        <span className={('co-desk-chip ' + row.tone).trim()}>{row.label}</span>
      </li>)}
    </ul>
    {notes}
  </section>
}
