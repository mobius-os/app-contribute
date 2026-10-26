// Chat blocks are destinations, never approval. Opening one navigates to an
// exact identity in the project workspace; nothing starts or is sent.
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/

export function chatBlockTarget(intent) {
  // A review run opens in the full project workspace; opening never starts one.
  const run = /^review-run:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  if (run) return { kind: 'run', id: run[1] }
  const pull = /^pull-request:([^/#\s]+)\/([^/#\s]+)#([1-9][0-9]{0,9})$/.exec(String(intent || ''))
  if (!pull) return null
  const [, owner, name, number] = pull
  if (![owner, name].every(part => REPOSITORY_PART.test(part) && !/^\.+$/.test(part))) return null
  const value = Number(number)
  return Number.isSafeInteger(value) ? { kind: 'pull', repo: `${owner}/${name}`, number: value } : null
}
