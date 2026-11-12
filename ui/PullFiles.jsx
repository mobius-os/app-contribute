import { useState } from 'react'
import { pullFileDiff } from '../pull-details.js'
import DiffView from './diff/DiffView.jsx'
import { SearchField } from './SearchField.jsx'

const FILTER_AFTER = 10

// The changed files of one PR, each opening to its diff. The Files tab reads them from GitHub; a saved Respond answer
// hands over the same shape from its own commits.
// `startOpen`: a short list (one commit's few files) arrives already open, so its diff is on screen without a second tap.
export function PullFiles({ data, startOpen = false }) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(startOpen)
  const totals = data?.totals
  const counts = [
    Number.isInteger(totals?.additions) ? `${totals.additions} additions` : null,
    Number.isInteger(totals?.deletions) ? `${totals.deletions} deletions` : null,
  ].filter(Boolean).join(' and ')
  const needle = filter.trim().toLowerCase()
  const shownFiles = (data?.files || []).filter(file => !needle || file.filename.toLowerCase().includes(needle))
  return <>
    {Number.isInteger(totals?.files) ? <p className="co-pr-note">Showing {totals.files}{data?.truncated ? '+' : ''} changed {totals.files === 1 ? 'file' : 'files'}{counts ? ` with ${counts}` : ''}{data?.page > 1 ? ` · page ${data.page}` : ''}. GitHub may omit or shorten large patches.</p> : null}
    {(data?.files || []).length > FILTER_AFTER ? <div className="co-file-tools">
      <SearchField className="co-file-search" label="Filter files by name" value={filter} onChange={setFilter} />
      <button type="button" className="co-btn co-btn-quiet" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse all' : 'Expand all'}</button>
    </div> : null}
    {shownFiles.map(file => <details key={`${file.filename}:${expanded}`} className="co-file-disclosure" open={expanded}><summary><span className="co-file-name">{file.filename}</span>{file.status && file.status !== 'modified' ? <em className="co-file-status">{file.status}</em> : null}<span className="co-file-stat"><b className="co-file-add">+{file.additions}</b><b className="co-file-del">−{file.deletions}</b></span></summary>{file.previous_filename ? <p>Previously {file.previous_filename}</p> : null}{file.patch ? <DiffView file={pullFileDiff(file)} /> : <p>No text patch is available for this file; it may be binary or too large.</p>}</details>)}
    {!data?.files?.length ? <p>No changed files returned on this page.</p> : null}
    {data?.files?.length && !shownFiles.length ? <p>No file on this page matches “{filter}”.</p> : null}
    {data?.truncated ? <p className="co-pr-note">GitHub lists at most 300 files for one commit. The rest are on GitHub.</p> : null}
    {data?.capped ? <p>GitHub’s 3,000-file limit has been reached. More files may be omitted; open the review chat for the full source.</p> : null}
  </>
}
