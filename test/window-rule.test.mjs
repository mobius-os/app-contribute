import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const css = read('workspace-theme.js')

// DESIGN.md, The Window Rule: every pop-up over the page is one blurred, darkened backdrop and one round card.
test('every window backdrop is darkened and blurred, and every window card takes the window radius', () => {
  for (const selector of ['.co-dialog::backdrop', '.co-picture-viewer::backdrop', '  .co-agent-menu-scrim']) {
    const rule = css.split('\n').find(line => line.startsWith(`${selector} {`)) || ''
    assert.match(rule, /background:rgba\(0,0,0,\.7\); -webkit-backdrop-filter:blur\(8px\); backdrop-filter:blur\(8px\);/, `${selector} is darkened and blurred`)
  }
  for (const selector of ['.co-dialog', '.co-picture-viewer']) {
    const rule = css.split('\n').find(line => line.startsWith(`${selector} {`)) || ''
    assert.match(rule, /border-radius:var\(--co-radius-window\)/, `${selector} is a round card`)
    assert.match(rule, /border:1px solid color-mix\(in srgb,var\(--accent\) 28%,var\(--border\)\)/, `${selector} has the faint accent edge`)
  }
  assert.match(css, /border-top:1px solid color-mix\(in srgb,var\(--accent\) 28%,var\(--border\)\); border-radius:var\(--co-radius-window\) var\(--co-radius-window\) 0 0;/, 'the phone Actions sheet has the same edge and a round top, and no accent line')
})

test('the pop-ups all open in the one shared window, and none draws its own backdrop', () => {
  assert.match(read('ui/TaskPane.jsx'), /dock \? <ReviewDialog label="Project action" onClose=\{task\.close\}>\{pane\}<\/ReviewDialog> : pane/, 'Send to GitHub and Mark ready')
  assert.match(read('ui/ConfirmWindow.jsx'), /<ReviewDialog role="alertdialog"/, 'Withdraw and Discard')
  for (const file of ['ui/PullRequests.jsx']) assert.match(read(file), /<ReviewDialog onClose=/, `${file} opens the agent, confirm and Set aside windows in it`)
  const backdrops = ['theme.js', 'workspace-theme.js', 'button-theme.js'].flatMap(file => read(file).split('\n').filter(line => /^\s*\.[\w-]*(backdrop|scrim)[\w-]*\s*\{/.test(line)).map(line => line.trim().split(' ')[0]))
  assert.deepEqual([...new Set(backdrops)].sort(), ['.co-agent-menu-scrim'], 'the other backdrops are the windows\' own native ::backdrop (the shared window and the picture viewer)')
})

test('a window keeps its foot on screen and stacks its buttons, the main one on top, on a phone', () => {
  assert.match(css, /\.co-rw-foot \{ position:sticky; bottom:0;/)
  assert.match(css, /\.co-rw-actions \{ flex-direction:column-reverse; align-items:stretch; \}/)
  assert.match(css, /\.co-task-dock > \.co-run-approval \.co-run-approval-actions \{ display:flex; flex-direction:column-reverse; align-items:stretch; \}/)
})

test('a sized window keeps its foot reachable over a bulk selection: the PR list in the head scrolls in its own box', () => {
  assert.match(css, /\.co-dialog > \.co-review-window\.is-sized > \.co-rw-head \.co-rw-list \{ max-height:min\(168px,24vh\); overflow-y:auto;/)
})
