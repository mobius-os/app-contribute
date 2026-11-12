import test from 'node:test'
import assert from 'node:assert/strict'
import { authorLine, authorNames, checkWords, commitGroups, commitStats, copyText, madeWithAgent, reviewMarker } from '../pull-commits.js'
import { loadPullCommitFiles, loadPullCommits } from '../pull-details.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const commit = (oid, extra = {}) => ({ oid: oid.repeat(40).slice(0, 40), abbreviatedOid: oid.repeat(7).slice(0, 7), url: `https://github.com/o/r/commit/${oid}`, messageHeadline: `Commit ${oid}`, messageBody: '', committedDate: '2026-11-05T13:32:53Z',
  authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }] }, statusCheckRollup: { state: 'SUCCESS' }, ...extra })

test('authors read like GitHub: one name, "A and B", "A, B and C"; co-authors come from the commit', () => {
  const agent = { name: 'Möbius Agent', user: { login: 'mobius-agent' } }
  assert.deepEqual(authorNames(commit('a', { authors: { nodes: [{ name: 'Sam', user: null }, agent, null] } })), ['Sam', 'mobius-agent'])
  assert.equal(authorLine(['a']), 'a')
  assert.equal(authorLine(['a', 'b']), 'a and b')
  assert.equal(authorLine(['a', 'b', 'c']), 'a, b and c')
  assert.equal(authorLine([]), '')
})

test('a commit made with the agent is marked, by its account or display name, and no one else is', () => {
  assert.equal(madeWithAgent(commit('a', { authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }, { name: 'Möbius Agent', user: { login: 'mobius-agent' } }] } })), true)
  assert.equal(madeWithAgent(commit('a', { authors: { nodes: [{ name: 'Mobius Agent', user: null }] } })), true)
  assert.equal(madeWithAgent(commit('a')), false)
  assert.equal(madeWithAgent(commit('a', { authors: null })), false)
})

test('the check result is in words, and a commit with no result says nothing instead of "fail"', () => {
  assert.deepEqual(checkWords(commit('a')), { text: 'checks pass', tone: 'ok' })
  assert.deepEqual(checkWords(commit('a', { statusCheckRollup: { state: 'FAILURE' } })), { text: 'checks fail', tone: 'bad' })
  assert.deepEqual(checkWords(commit('a', { statusCheckRollup: { state: 'PENDING' } })), { text: 'checks running', tone: 'warn' })
  assert.equal(checkWords(commit('a', { statusCheckRollup: null })), null)
  assert.equal(checkWords(null), null)
})

test('Copy says it copied only after the clipboard write succeeded', async () => {
  const written = []
  assert.equal(await copyText('abc', { writeText: async text => { written.push(text) } }), true)
  assert.deepEqual(written, ['abc'])
  // A write the browser refuses (permission denied, page not focused) rejects: that is not "Copied", and it is handled.
  assert.equal(await copyText('abc', { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }), false)
  assert.equal(await copyText('abc', { writeText: () => { throw new Error('sync') } }), false)
  // No clipboard at all (an insecure page): not "Copied" either.
  assert.equal(await copyText('abc', undefined), false)
  assert.equal(await copyText('abc', {}), false)
})

test('commits group by the day they were committed, in GitHub order', () => {
  const groups = commitGroups([commit('a', { committedDate: '2026-11-04T09:00:00Z' }), commit('b', { committedDate: '2026-11-04T10:00:00Z' }), commit('c', { committedDate: '2026-11-05T09:00:00Z' })])
  assert.deepEqual(groups.map(group => group.commits.map(item => item.oid[0])), [['a', 'b'], ['c']])
  assert.deepEqual(commitGroups([]), [])
})

test('the review marker sits after the commit the review covered; a rewritten branch has none', () => {
  const list = [commit('a'), commit('b'), commit('c')]
  assert.deepEqual(reviewMarker(list, list[0].oid), { at: 0, newCount: 2 })
  assert.deepEqual(reviewMarker(list, list[2].oid), { at: 2, newCount: 0 })
  // A force-push drops the reviewed commit: nothing is claimed about which are new.
  assert.deepEqual(reviewMarker(list, 'f'.repeat(40)), { at: -1, newCount: 0 })
  assert.deepEqual(reviewMarker(list, ''), { at: -1, newCount: 0 })
})

test('the commit read asks for one page with its cursor, checks the PR version, and keeps a missing list as an error', async () => {
  const previous = globalThis.fetch
  const sent = []
  const pr = { number: 7, repository: { nameWithOwner: 'o/r' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
  const answer = commits => ({ ok: true, json: async () => ({ data: { repository: { pullRequest: { headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, baseRefName: 'main', commits } } } }) })
  try {
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return answer({ totalCount: 60, pageInfo: { hasNextPage: true, endCursor: 'Mg' }, nodes: [{ commit: commit('a') }, null] }) }
    const page = await loadPullCommits('token', pr, 'cursor-1')
    assert.equal(sent[0].variables.after, 'cursor-1')
    assert.match(sent[0].query, /commits\(first:50, after:\$after\)/)
    assert.deepEqual([page.commits.length, page.total, page.hasMore, page.nextCursor], [1, 60, true, 'Mg'])
    globalThis.fetch = async () => answer(null)
    const none = await loadPullCommits('token', pr)
    assert.deepEqual(none.commits, [])
    assert.deepEqual(none.errors, ['The commit list is unavailable.'])
    await assert.rejects(loadPullCommits('token', pr, 'x'.repeat(2000)), /Invalid commit cursor/)
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { repository: { pullRequest: { headRefOid: 'c'.repeat(40), baseRefOid: pr.baseRefOid, baseRefName: 'main', commits: { nodes: [] } } } } }) })
    await assert.rejects(loadPullCommits('token', pr), error => error.code === 'stale')
  } finally { globalThis.fetch = previous }
})

let renderer
const screens = () => (renderer ||= renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { CommitChangesHead, PullCommits } from './ui/PullCommits.jsx'
  import { PullFiles } from './ui/PullFiles.jsx'
  import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
  export const commits = props => renderToStaticMarkup(React.createElement(PullCommits, props))
  export const changesHead = props => renderToStaticMarkup(React.createElement(CommitChangesHead, props))
  export const files = props => renderToStaticMarkup(React.createElement(PullFiles, props))
  export const detail = props => renderToStaticMarkup(React.createElement(PullRequestDetail, props))
`))

test('the Commits tab shows title, authors, time, checks in words, and the short hash that copies itself', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { commits } = await screens()
  const list = [commit('a', { messageBody: 'Because of the thing.', authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }, { name: 'Möbius Agent', user: { login: 'mobius-agent' } }] } }), commit('b', { statusCheckRollup: null })]
  const html = commits({ data: { commits: list, hasMore: false } })
  assert.match(html, /Commits on /)
  assert.match(html, /<button type="button" class="co-commit-title" data-commit="a{40}">Commit a<span class="co-visually-hidden"> — See changes: commit aaaaaaa<\/span><\/button>/, 'the title opens the commit\'s changes')
  assert.match(html, /<button type="button" class="co-commit-toggle" aria-expanded="false" aria-controls="[^"]+" aria-label="Show the full message">/, 'a commit with a message has a chevron for it')
  assert.equal((html.match(/co-commit-toggle/g) || []).length, 1, 'a commit with no message body has no chevron')
  assert.doesNotMatch(html, /Because of the thing\./, 'the long message opens from its chevron, not before')
  assert.match(html, /octocat and mobius-agent committed <\/span><time/)
  assert.match(html, /checks pass/)
  assert.match(html, /class="co-commit-hash co-tip" data-tip="Copy hash" aria-label="Copy hash aaaaaaa"[^>]*><code>aaaaaaa<\/code>/, 'the short hash is the Copy control')
  assert.doesNotMatch(html, /<span>Copy hash<\/span>/, 'no separate Copy hash button')
  assert.match(html, /aria-label="View on GitHub: commit aaaaaaa"[^>]*data-tip="View on GitHub"/)
  assert.match(html, /co-commit-agent/)
  assert.equal((html.match(/co-commit-checks/g) || []).length, 1, 'a commit with no result shows no check text')
  assert.doesNotMatch(html, /Last review covered|new commit/)
})

test('after a review, a line shows where it stopped and a banner offers Review again for the new commits', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { commits } = await screens()
  const list = [commit('a'), commit('b'), commit('c')]
  const html = commits({ data: { commits: list, hasMore: false }, reviewedHead: list[0].oid, again: { id: 'review', title: 'Review again' } })
  assert.match(html, /2 new commits since your last review/)
  assert.match(html, /co-btn co-commits-again">Review again</)
  assert.doesNotMatch(html, /co-btn-primary/, 'the page\'s one filled button is the next step, not this banner')
  const pinned = commits({ data: { commits: list, hasMore: false }, reviewedHead: list[0].oid, again: { id: 'review', title: 'Review again' }, pinned: true })
  assert.match(pinned, /co-commits-again is-pinned/, 'a phone shows the same step in the foot bar, so the banner hides its copy')
  assert.ok(html.indexOf('Commit a') < html.indexOf('Last review covered up to here') && html.indexOf('Last review covered up to here') < html.indexOf('Commit b'))
  const one = commits({ data: { commits: list.slice(0, 2), hasMore: false }, reviewedHead: list[0].oid, again: null })
  assert.match(one, /1 new commit since your last review/)
  assert.doesNotMatch(one, /Review again/, 'no button when the next review is not yours to start')
  const more = commits({ data: { commits: list.slice(0, 2), hasMore: true }, reviewedHead: list[0].oid })
  assert.match(more, /1\+ new commits/)
  assert.doesNotMatch(commits({ data: { commits: list, hasMore: false }, reviewedHead: list[2].oid }), /new commit/)
  assert.match(commits({ data: { commits: [], hasMore: false } }), /No commits yet\./)
})

test('the PR page puts Commits right after Comments, with GitHub\'s count, and loads the list only when opened', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { detail } = await screens()
  const pr = { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7', commits: { totalCount: 27 } }
  const html = detail({ pr, cacheStore: { entries: {} } })
  const order = ['Comments', 'Commits', 'Files', 'Checks', 'Review'].map(name => html.indexOf(`>${name}`))
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), `tab order ${order}`)
  assert.match(html, />Commits<span class="co-tab-count">27<\/span>/)
  const opened = detail({ pr, initialTab: 'commits', cacheStore: { entries: { 'description:1': { data: { body: 'x' }, loading: false }, 'commits:': { data: { commits: [commit('a')], hasMore: true, nextCursor: 'Mg' }, loading: false } } } })
  assert.match(opened, /aria-pressed="true">Commits/)
  assert.match(opened, /Commit a/)
  assert.match(opened, /Show more commits/)
})

test('a commit row says how much it changed, and says nothing when GitHub cannot count it', () => {
  assert.deepEqual(commitStats(commit('a', { changedFilesIfAvailable: 7, additions: 132, deletions: 45 })), { files: 7, additions: 132, deletions: 45 })
  assert.deepEqual(commitStats(commit('a', { changedFilesIfAvailable: 0, additions: 0, deletions: 0 })), { files: 0, additions: 0, deletions: 0 })
  assert.equal(commitStats(commit('a', { changedFilesIfAvailable: null, additions: 3, deletions: 1 })), null, 'an uncounted commit is not "0 files"')
  assert.equal(commitStats(commit('a')), null)
  assert.equal(commitStats(null), null)
})

test('each commit opens inside the app from its title, with one GitHub icon and its size in the row', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { commits, changesHead } = await screens()
  const html = commits({ data: { commits: [commit('a', { changedFilesIfAvailable: 7, additions: 132, deletions: 45 }), commit('b')], hasMore: false } })
  assert.match(html, /<button type="button" class="co-commit-title" data-commit="a{40}">Commit a<span class="co-visually-hidden"> — See changes: commit aaaaaaa<\/span><\/button>/)
  assert.doesNotMatch(html, />See changes<\/button>/, 'no separate See changes button')
  assert.match(html, /7 files <b class="co-file-add">\+132<\/b> <b class="co-file-del">−45<\/b>/)
  assert.equal((html.match(/co-commit-stats/g) || []).length, 1, 'a commit GitHub cannot count shows no size')
  assert.match(html, /aria-label="View on GitHub: commit aaaaaaa"/, 'View on GitHub stays as the way out, as an icon')
  assert.doesNotMatch(html, /<span>View on GitHub<\/span>/, 'the GitHub link in a row is the icon alone')
  const head = changesHead({ commit: commit('a'), onBack: () => {} })
  assert.match(head, /Back to commits/)
  assert.match(head, /<code>aaaaaaa<\/code> Commit a/)
  assert.match(head, /aria-label="View on GitHub: commit aaaaaaa"/)
})

test('a commit read asks GitHub for the commit itself, checks it is that commit, and flags a list cut at 300 files', async () => {
  const previous = globalThis.fetch
  const sent = []
  const pr = { number: 7, repository: { nameWithOwner: 'o/r' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
  const oid = 'c'.repeat(40)
  const answer = body => ({ ok: true, status: 200, json: async () => body })
  const files = count => Array.from({ length: count }, (_, index) => ({ filename: `f${index}.js`, additions: 1, deletions: 0, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }))
  try {
    globalThis.fetch = async url => { sent.push(String(url)); return answer({ sha: oid, files: files(2), stats: { additions: 2, deletions: 0 } }) }
    const read = await loadPullCommitFiles('token', pr, oid)
    assert.deepEqual(sent, [`/api/github/api/repos/o/r/commits/${oid}`], 'one read through the read-only route')
    assert.deepEqual([read.files.length, read.totals, read.hasMore, read.truncated], [2, { files: 2, additions: 2, deletions: 0 }, false, false])
    globalThis.fetch = async () => answer({ sha: oid, files: files(300), stats: { additions: 300, deletions: 0 } })
    assert.equal((await loadPullCommitFiles('token', pr, oid)).truncated, true, 'a full 300 may be cut short, so the page says so')
    globalThis.fetch = async () => answer({ sha: 'd'.repeat(40), files: files(1) })
    await assert.rejects(loadPullCommitFiles('token', pr, oid), /did not return the files of this commit/)
    globalThis.fetch = async () => answer({ sha: oid })
    await assert.rejects(loadPullCommitFiles('token', pr, oid), /did not return the files of this commit/)
    for (const bad of ['', 'abc', '../x', `${oid}/../..`]) await assert.rejects(loadPullCommitFiles('token', pr, bad), /Choose a valid commit/)
  } finally { globalThis.fetch = previous }
})

test('the commit page says when GitHub cut its file list short', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { files } = await screens()
  const data = { files: [{ filename: 'a.js', additions: 1, deletions: 0, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }], totals: { files: 1, additions: 1, deletions: 0 }, page: 1, hasMore: false }
  assert.doesNotMatch(files({ data }), /at most 300 files/)
  const cut = files({ data: { ...data, totals: { ...data.totals, files: 300 }, truncated: true } })
  assert.match(cut, /GitHub lists at most 300 files for one commit\. The rest are on GitHub\./)
  assert.match(cut.replace(/<!-- -->/g, ''), /Showing 300\+ changed files with/, 'a cut list is not read as the whole commit')
  assert.match(files({ data }).replace(/<!-- -->/g, ''), /Showing 1 changed file with/)
  // A commit's few files open unfolded; the Files changed tab keeps its files folded.
  assert.match(files({ data, startOpen: true }), /<details class="co-file-disclosure" open="">/)
  assert.doesNotMatch(files({ data }), /<details class="co-file-disclosure" open="">/)
})

test('the commit list asks GitHub for each commit\'s size so the row can show it', async () => {
  const previous = globalThis.fetch
  let query = ''
  const pr = { number: 7, repository: { nameWithOwner: 'o/r' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
  try {
    globalThis.fetch = async (url, init) => { query = JSON.parse(init.body).query; return { ok: true, json: async () => ({ data: { repository: { pullRequest: { headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, baseRefName: 'main', commits: { nodes: [] } } } } }) } }
    await loadPullCommits('token', pr)
    assert.match(query, /additions deletions changedFilesIfAvailable/)
  } finally { globalThis.fetch = previous }
})
