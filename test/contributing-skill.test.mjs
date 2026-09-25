import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

// The skill is the `contributing/` folder: a short SKILL.md core plus mode
// files beside it that agents open, by relative link, only when that mode
// applies. The rules below may live in any of them, so assert the whole set.
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const core = read('contributing/SKILL.md')
const modeFiles = readdirSync(new URL('../contributing', import.meta.url))
  .filter((name) => name !== 'SKILL.md' && name.endsWith('.md'))
  .sort()
const mode = (name) => read(`contributing/${name}`)
const skill = [core, ...modeFiles.map(mode)].join('\n')
const prose = skill.replace(/\s+/g, ' ')
const attached = read('attached-work.md').replace(/\s+/g, ' ')
const manifest = JSON.parse(read('mobius.json'))

test('folder skill core stays small and links every mode file relatively', () => {
  assert.ok(Buffer.byteLength(core) <= 12 * 1024, `core is ${Buffer.byteLength(core)} bytes`)
  assert.match(core, /^---\nname: contributing\ndescription: /)
  const routed = [...core.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(routed)].sort(), modeFiles)
  assert.ok(modeFiles.length >= 6)
  assert.ok(manifest.skills.includes('contributing/'))
  for (const name of ['SKILL.md', ...modeFiles]) {
    assert.ok(manifest.source_files.includes(`contributing/${name}`), `${name} ships with the skill`)
  }
  for (const name of modeFiles) {
    const body = mode(name)
    assert.match(body, /\[SKILL\.md\]\(SKILL\.md\)/, `${name} points back to the core`)
    assert.doesNotMatch(body, /\/data\/apps\/contribute\/contributing/, `${name} has no stale app path`)
    for (const [, ref] of body.matchAll(/\]\(([a-z-]+\.md)\)/g)) {
      assert.ok(existsSync(new URL(`../contributing/${ref}`, import.meta.url)), `${name} links missing ${ref}`)
    }
  }
})

test('hard stops, the privacy allowlist, and the approval gate live only in the core', () => {
  for (const heading of ['## Hard stops', '## What may leave — the privacy allowlist', '## The approval gate']) {
    assert.ok(core.includes(heading), heading)
    for (const name of modeFiles) assert.ok(!mode(name).includes(heading), `${heading} duplicated in ${name}`)
  }
})

test('CI diagnosis prefers the failure summarizer over full log dumps', () => {
  assert.match(core, /scripts\/ci-failures\.sh <owner\/repo> <pr-number\\\|run-id>/)
  assert.match(mode('ci.md'), /scripts\/ci-failures\.sh <owner\/repo> <pr-number\|run-id>/)
  assert.match(mode('ci.md'), /saves the full logs to a file and prints only the failing jobs/)
})

test('explicit exact chat approval does not need a second Contribute approval', () => {
  assert.match(prose, /An explicit, unambiguous instruction in chat is a valid yes/)
  assert.match(prose, /The partner does not need to repeat that same approval in Contribute/)
  assert.match(prose, /Proceed without requiring the matching Contribute press/)
  assert.match(prose, /chat approval changes the approval surface, not the safety preflight/)
  assert.match(prose, /do not require both approval surfaces/)
})

test('app publication is one reviewed outcome with an automatic local connection', () => {
  assert.match(prose, /one publication outcome, not a later public or destructive action/)
  assert.match(prose, /never present a second \*\*Link app\*\* decision/)
  assert.match(prose, /Do not call the publication complete until the local connection is recorded/)
})

test('chat approval stays bound to the exact current public action', () => {
  assert.match(prose, /If the target, diff, head, or proposed public text changes, the old yes no longer applies/)
  assert.match(prose, /The broad cycle request alone still does not authorize an unenumerated push/)
  assert.match(prose, /Preparing is still private/)
})

test('existing PR updates require exact public metadata without mutating it', () => {
  assert.match(prose, /For every `pr_update`/)
  assert.match(prose, /plan\.pr_metadata\.old_title/)
  assert.match(prose, /plan\.pr_metadata\.old_body/)
  assert.match(prose, /copy those same exact bytes/)
  assert.match(prose, /plan\.title/)
  assert.match(prose, /plan\.body_draft/)
  assert.match(prose, /Do not normalize, summarize, or reconstruct the text/)
  assert.match(prose, /publication precondition rather than a request to edit public metadata/)
  assert.match(prose, /exactly match `plan\.title` and `plan\.body_draft` before any branch mutation/)
  assert.match(prose, /does not PATCH the pull request's title or body/)
  assert.match(prose, /GitHub does not expose an expected-version guard/)
  assert.match(prose, /Any mismatch stops for a fresh private review/)
  assert.match(prose, /a restarted attempt must prove the same metadata precondition again/)
  assert.doesNotMatch(prose, /match either the exact recorded old values or the already-reviewed desired values/)
  assert.doesNotMatch(prose, /applies `plan\.title`\/`plan\.body_draft` once after the branch update/)
})

test('chat classifications are durable outcomes rather than prose-only exclusions', () => {
  assert.match(prose, /settle_chat_changes\.py/)
  assert.match(prose, /newest `ts` actually reviewed/)
  assert.match(prose, /A later edit to the same path becomes Unsorted again/)
  assert.match(prose, /do not substitute a prose summary for this write/)
})

test('linked private reviews are locked until verified terminal cleanup', () => {
  assert.match(prose, /worktree lock/)
  assert.match(prose, /Contribute review <record-id>/)
  assert.match(prose, /Lock every linked review immediately after creation/)
  assert.match(prose, /`git worktree prune` from stranding reviewed owner work/)
  assert.match(prose, /cleanup verifies the reciprocal Git pointer and releases that exact lock/)
})

test('verification reuses exact environments and owns exceptional installs', () => {
  for (const text of [prose, attached]) {
    assert.match(text, /scripts\.wt-pytest\.sh|scripts\/wt-pytest\.sh/)
    assert.match(text, /scripts\.wt-npm\.sh|scripts\/wt-npm\.sh/)
    assert.match(text, /exact `package-lock\.json` match|`package-lock\.json` matches exactly/)
    assert.match(text, /Do not run a direct `npm ci`/)
    assert.match(text, /checkout-local `\.venv`/)
  }
  assert.match(attached, /test machinery is not/)
})

test('mixed-action stacks advance through separately approved public phases', () => {
  assert.match(prose, /existing pull requests whose branches need an update/)
  assert.match(prose, /first confirm and update the consecutive `pr_update` prefix/)
  assert.match(prose, /separately confirm and open the `pr` suffix/)
  assert.match(prose, /full chain remains visible and is revalidated on both calls/)
  assert.match(prose, /never let one phase claim, hide, or inherit approval for the deferred phase/i)
})

test('attached helpers use one private bounded playbook', () => {
  assert.match(attached, /Nothing public/)
  assert.match(attached, /agent_snapshot\.py/)
  assert.match(attached, /--work-json/)
  assert.match(attached, /do not enumerate/)
  assert.match(attached, /manifest's `source_chat_id` owns provenance/)
  assert.match(attached, /Public actions: none/)
  assert.doesNotMatch(attached, /Read and follow .*contributing/)
})


test('private publication and local installation have separate ownership', () => {
  assert.match(prose, /An ordinary PR may remain uninstalled/)
  assert.match(prose, /Never install private work or invent a source witness/)
  assert.match(prose, /Missing proof means no witness/)
  assert.match(prose, /Exact head, diff, approval, public target and retry checks remain mandatory/)
  assert.match(prose, /app-connection promise still requires its installed-source proof/)
  assert.doesNotMatch(prose, /The submit path proves `base_sha\.\.head_sha` is present in that source commit/)
})

test('a Goal waiting on a Contribute action hands off with one approval card', () => {
  assert.match(prose, /Apart from the Goal\s+handoff below, never also call/)
  assert.match(prose, /exactly one `request_approval` card for that record and head/)
  assert.match(prose, /Never re-ask for the same head/)
})

test('the general layer is project-shaped and Möbius facts live in its adapter', () => {
  const cycle = mode('cycle.md')
  const mobius = mode('adapter-mobius.md')
  const github = mode('adapter-github.md')
  for (const adapter of ['adapter-mobius.md', 'adapter-github.md']) {
    assert.ok(cycle.includes(`](${adapter})`), `cycle registers ${adapter}`)
  }
  assert.doesNotMatch(cycle, /## Current Möbius adapter/)
  assert.match(core, /under a project root its adapter registers/)
  assert.doesNotMatch(core, /the platform \(`\/data\/platform\/`\), and the shell/)
  assert.match(mobius, /the platform \(`\/data\/platform\/`\), and the shell/)
  for (const [name, body] of [['SKILL.md', core], ...['ci.md', 'prepare.md', 'branch.md'].map((n) => [n, mode(n)])]) {
    assert.doesNotMatch(body, /mobius-os\/mobius|area: ui|playwright-local|catalog\.json/, `${name} stays general`)
  }
  assert.match(github, /never assume\s+`main`/)
  assert.match(github, /defaultBranchRef/)
  assert.match(github, /\/data\/contrib\/<record-id>\/worktree/)
  assert.match(mode('ci.md'), /target repository's required checks are the final gate/)
})

test('legacy bot and maintainer-only material each have one owner', () => {
  const legacy = mode('legacy-bot.md')
  const maintainer = mode('maintainer.md')
  for (const name of modeFiles.filter((n) => n !== 'legacy-bot.md')) {
    assert.doesNotMatch(mode(name), /relay_contribution_id|relay_revision/, `${name} leaves relay fields to the legacy file`)
  }
  assert.match(legacy, /relay_contribution_id/)
  assert.match(maintainer, /permissions\.push/)
  assert.match(maintainer, /review_prs\.py/)
  assert.match(maintainer, /connect_app/)
  assert.ok(!existsSync(new URL('../contributing/review-merge.md', import.meta.url)))
  assert.doesNotMatch(mode('ledger.md'), /"repo_path": "\/data\/apps\/<slug>"/)
})

test('the co-author trailer is the default and an opt-out is explicit and disclosed', () => {
  assert.match(prose, /`coauthor_trailer: false` is the only way to omit that trailer/)
  assert.match(prose, /say so — with the reason — in the approval summary/)
  assert.match(prose, /unless the reviewed plan set `coauthor_trailer: false`/)
  assert.match(attached, /set `plan\.coauthor_trailer: false`/)
})

test('skill text states rules rather than incident history', () => {
  for (const text of [prose, attached]) {
    assert.doesNotMatch(text, /second doorway|Older platforms may still require|parallel Möbius-maintainer roster|chat-settlement|older boot cleaners|baked boot cleaner|ecosystem is young/)
  }
})
