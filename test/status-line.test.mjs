import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { renderModule } from './render-harness.mjs'
import { ACTION_COPY, postFindingsCopy } from '../action-copy.js'

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
const markup = async (element) => {
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { Shine, Words } from './ui/Shine.jsx'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    import { mergeCopy } from './action-copy.js'
    const pr = { number: 162, title: 'Remove the row', baseRefName: 'main', headRefOid: 'abcdef0123', repository: { nameWithOwner: 'o/r' } }
    export const render = name => renderToStaticMarkup({
      shine: <Shine>Merging…</Shine>,
      words: <p><Words text="**#9** is now in \`main\`." /></p>,
      asking: <ActionConfirm pr={pr} copy={mergeCopy(pr)} viaShell autoConfirm onConfirm={() => {}} onClose={() => {}} />,
    }[name])
  `)
  return render(element)
}

test('words for something under way exist once in the page; the moving copy is drawn by the stylesheet', async () => {
  assert.equal(await markup('shine'), '<span class="co-shine" data-text="Merging…">Merging…</span>')
})

test('a result line makes the PR number bold and a branch a chip', async () => {
  assert.equal(await markup('words'), '<p><b>#9</b> is now in <code class="co-chip-code">main</code>.</p>')
})

test('a window waiting on Möbius says so in the middle, with the light over the words', async () => {
  const html = await markup('asking')
  assert.match(html, /<p class="co-rw-status" role="status"><span class="co-shine" data-text="Waiting for your confirmation in Möbius…">Waiting for your confirmation in Möbius…<\/span>/)
})

test('every action that says what it is doing also names itself once you have pressed it', () => {
  const pr = { number: 9, title: 'T', baseRefName: 'main', headRefOid: 'abc', repository: { nameWithOwner: 'o/r' } }
  const copies = [...Object.values(ACTION_COPY).map(build => build(pr, { standing: { askable: [] } })), postFindingsCopy(pr, { preview: { body: 'x' } })]
  for (const copy of copies) {
    const live = copy.forPicked ? copy.forPicked([]) : copy
    assert.ok(live.working, 'an action says what it is doing')
    assert.ok(live.workingTitle && live.workingTitle !== live.title && !live.workingTitle.endsWith('?'), live.title + ' needs a working title that is a statement, not the question')
  }
})

test('the light and the arrival need motion, and stand still without it', () => {
  const theme = read('theme.js'), workspace = read('workspace-theme.js')
  assert.match(theme, /@media \(prefers-reduced-motion: no-preference\) \{\s*@supports[\s\S]*?\.co-shine::after \{[\s\S]*?animation: co-action-sweep/)
  assert.match(theme, /@media \(forced-colors: active\) \{\s*\.co-shine::after \{ display: none !important; \}/)
  // The check starts undrawn only inside the motion query: with reduced motion it is simply there.
  assert.match(workspace, /@media \(prefers-reduced-motion:no-preference\) \{[^@]*?\.co-rw-icon path \{ stroke-dasharray:24; stroke-dashoffset:24;/)
  assert.doesNotMatch(workspace.replace(/@media \(prefers-reduced-motion:no-preference\) \{[\s\S]*?\n\}/, ''), /stroke-dashoffset:24/)
})

test('busy buttons keep full strength so the moving words can be read', () => {
  assert.match(read('button-theme.js'), /\.co-btn\[aria-busy="true"\]:disabled \{ opacity: 1; cursor: progress; \}/)
})
