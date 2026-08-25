// Parse `git diff --stat` for compact contribution summaries and legacy
// records whose exact unified patch is no longer stored.
export function parseDiffStat(input) {
  const text = String(input || '')
  if (!text.trim()) return null

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim())

  const files = []
  let totalFiles = 0
  let additions = 0
  let deletions = 0
  let sawSummary = false

  for (const line of lines) {
    const summary = line.match(/(\d+)\s+files?\s+changed/)
    if (summary && !line.includes('|')) {
      totalFiles = Number(summary[1]) || 0
      additions = Number(line.match(/(\d+)\s+insertions?\(\+\)/)?.[1] || 0)
      deletions = Number(line.match(/(\d+)\s+deletions?\(-\)/)?.[1] || 0)
      sawSummary = true
      continue
    }

    const row = line.match(/^(.*\S)\s+\|\s+(.+)$/)
    if (!row) continue
    const path = row[1].trim()
    const rest = row[2].trim()
    if (/^Bin\b/.test(rest)) {
      files.push({ path, additions: 0, deletions: 0, binary: true })
      continue
    }
    const total = Number(rest.match(/^(\d+)/)?.[1] || 0)
    const plus = (rest.match(/\+/g) || []).length
    const minus = (rest.match(/-/g) || []).length
    const added = total > 0 && plus + minus > 0
      ? Math.round((total * plus) / (plus + minus))
      : total
    files.push({
      path,
      additions: added,
      deletions: total - added,
      binary: false,
    })
  }

  if (!sawSummary && files.length === 0) return null
  if (!sawSummary) {
    totalFiles = files.length
    additions = files.reduce((sum, file) => sum + file.additions, 0)
    deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  } else if (totalFiles === 0) {
    totalFiles = files.length
  }
  return { totalFiles, additions, deletions, files }
}
