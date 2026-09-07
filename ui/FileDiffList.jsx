import { useEffect, useState } from 'react'
import { parseDiffStat } from '../diff.js'
import UnifiedDiff from './diff/UnifiedDiff.jsx'

function FileStat({ additions, deletions }) {
  return (
    <span className="co-file-stat" role="img" aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className="co-file-add">+{additions}</span>
      <span className="co-file-del">−{deletions}</span>
    </span>
  )
}

function statRows(stat) {
  return (stat?.files || []).map((file) => ({
    path: file.path,
    insertions: file.additions,
    deletions: file.deletions,
  }))
}

// Load the exact stored patch once, then hand raw parsing, file matching,
// disclosures, truncation, and line rendering to the canonical diff module.
export function FileDiffList({ rec, loadDiff }) {
  const plan = rec.plan || {}
  const totals = parseDiffStat(plan.diff_stat)
  const [state, setState] = useState({ phase: 'loading', diff: '' })

  useEffect(() => {
    let cancelled = false
    async function run() {
      const diff = typeof loadDiff === 'function' ? await loadDiff(rec) : null
      if (cancelled) return
      setState({
        phase: typeof diff === 'string' && diff.trim() ? 'ready' : 'fallback',
        diff: typeof diff === 'string' ? diff : '',
      })
    }
    run()
    return () => { cancelled = true }
  }, [rec.id, loadDiff, plan.diff_sha256])

  if (state.phase === 'loading') {
    return <div className="co-files is-loading" role="status">Loading changes…</div>
  }
  if (!totals && !state.diff) return null

  return (
    <div className="co-files">
      {totals ? (
        <div className="co-files-head">
          <span className="co-files-count">
            {totals.totalFiles} {totals.totalFiles === 1 ? 'file' : 'files'}
          </span>
          <FileStat additions={totals.additions} deletions={totals.deletions} />
        </div>
      ) : null}
      <UnifiedDiff
        diff={state.diff}
        summaryOverrides={statRows(totals)}
        diffTruncated={false}
      />
      {state.phase === 'fallback' ? (
        <p className="co-files-note">The full diff is no longer available; file totals remain.</p>
      ) : null}
    </div>
  )
}
