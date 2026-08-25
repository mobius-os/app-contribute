function repositorySlug(record) {
  const value = record?.plan?.repo || record?.repo || ''
  return typeof value === 'string' ? value.trim() : ''
}

export function isMobiusRepository(record) {
  const [owner, name, ...extra] = repositorySlug(record).split('/')
  return extra.length === 0 && !!name && owner?.toLowerCase() === 'mobius-os'
}

export function contributionPath(record, preference, githubState) {
  if (!isMobiusRepository(record)) return 'github'
  if (githubState !== 'connected') return 'mobius'
  return preference === 'mobius' ? 'mobius' : 'github'
}

export function contributionPathDecision(record, preference, githubState) {
  const method = contributionPath(record, preference, githubState)
  if (method === 'github' && githubState !== 'connected') {
    return {
      method,
      error: 'Connect GitHub to contribute to repositories outside mobius-os.',
    }
  }
  return { method, error: '' }
}

export function contributionStackDecision(records, preference, githubState) {
  const decisions = records.map((record) => (
    contributionPathDecision(record, preference, githubState)
  ))
  const blocked = decisions.find((decision) => decision.error)
  if (blocked) return blocked
  return {
    method: decisions.length > 0 && decisions.every((decision) => (
      decision.method === 'mobius'
    ))
      ? 'mobius'
      : 'github',
    error: '',
  }
}
