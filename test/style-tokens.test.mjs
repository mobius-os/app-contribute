import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const sheets = ['theme.js', 'workspace-theme.js', 'button-theme.js',
  ...readdirSync(new URL('ui/', root)).filter(name => name.endsWith('.jsx')).map(name => `ui/${name}`)]
  .map(file => [file, readFileSync(new URL(file, root), 'utf8')])

// DESIGN.md's token sheet: every radius and type size is a named token.
test('every corner radius and type size names a token, never a raw value', () => {
  const raw = []
  for (const [file, text] of sheets) {
    for (const match of text.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;}\n`]+)/g)) {
      if (/\d+(\.\d+)?(px|em)/.test(match[1].replace(/var\([^)]*\)/g, ''))) raw.push(`${file}: ${match[0]}`)
    }
    for (const match of text.matchAll(/font-size:\s*([^;}\n`]+)/g)) {
      if (/\d+(\.\d+)?px/.test(match[1])) raw.push(`${file}: ${match[0]}`)
    }
    for (const match of text.matchAll(/font:\s*(\d{3}\s+)?(\d+(\.\d+)?)px/g)) raw.push(`${file}: ${match[0]}`)
    // Inline styles in JSX write camelCase: fontSize: 10, fontSize: '11px', borderRadius: 4, fontSize: Math.round(size * 0.5).
    for (const match of text.matchAll(/\b(fontSize|borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius):\s*([^,}\n]+)/g)) {
      if (!/var\(--co-/.test(match[2])) raw.push(`${file}: ${match[0]}`)
    }
  }
  assert.deepEqual(raw, [])
})

// The token sheet has two sets (DESIGN.md): the sizes every screen starts from, and the compact set a phone takes instead.
const phoneSet = theme => /@media \(max-width: 680px\) \{\s*:root \{([^}]*)\}/.exec(theme)?.[1] || ''
const sizesIn = text => Object.fromEntries([...text.matchAll(/--co-text-([a-z]+):\s*(\d+)px/g)].map(match => [match[1], Number(match[2])]))

test('the token sheet holds six radii and its type sizes, with one compact set for a phone', () => {
  const theme = readFileSync(new URL('theme.js', root), 'utf8')
  // The Window Rule (DESIGN.md): the one big radius is a window over the page, 24px, and 20px on a phone.
  const radii = [...theme.matchAll(/--co-radius-[a-z]+:\s*(\d+)px/g)].map(match => Number(match[1]))
  // The Window Rule (DESIGN.md): the one big radius is a window over the page, 24px, and 20px on a phone.
  assert.deepEqual(radii, [6, 8, 10, 12, 999, 24, 20])
  const phone = phoneSet(theme)
  assert.deepEqual(sizesIn(theme.replace(phone, '')), { meta: 14, body: 16, section: 22, title: 28, chip: 14, entry: 16, reading: 13, code: 12 })
  assert.deepEqual(sizesIn(phone), { meta: 13, body: 15, section: 20, title: 22, chip: 12 })
})

// The Compact Phone Rule (DESIGN.md): smaller to look at, never harder to use.
test('compact on a phone keeps a 44px tap, 16px typing text and nothing under 12px', () => {
  const theme = readFileSync(new URL('theme.js', root), 'utf8')
  const phone = phoneSet(theme)
  const px = name => Number(new RegExp(`--co-${name}:\\s*(\\d+)px`).exec(phone)?.[1])
  assert.equal(px('control-height') + 2 * px('tap-reach'), 44, 'a control drawn shorter is still tapped 44 tall')
  assert.ok(Object.values(sizesIn(phone)).every(size => size >= 12), 'no phone size is under 12px')
  assert.doesNotMatch(phone, /--co-text-entry/, 'the text you type keeps its 16px on a phone')
  const css = sheets.map(([, text]) => text).join('\n')
  const compact = css.slice(css.indexOf('Compact on a phone (DESIGN.md, The Compact Phone Rule)'))
  assert.match(compact, /\.co-root input:not\(\[type=checkbox\]\),\.co-root textarea,\.co-root select \{ font-size:var\(--co-text-entry\); \}/)
  // What a thumb lands on is proved in a browser (runTapBoxChecks in test/workspace-browser.mjs); these are the rules it proves.
  assert.match(compact, /::before \{ content:''; position:absolute; inset:calc\(50% - var\(--co-tap-height\) \/ 2\) 0; \}/, 'one tap box, tap-height tall, centred on the control')
  assert.match(compact, /\.co-btn-icon::before \{ inset-inline:calc\(50% - var\(--co-tap-height\) \/ 2\); \}/, 'an icon button is tapped tap-height wide too')
  assert.match(compact, /\.co-desk-seg \{ row-gap:calc\(2 \* var\(--co-tap-reach\)\); \}/, 'wrapped rows keep their tap boxes apart')
  assert.match(theme, /--co-tap-height: calc\(var\(--co-control-height\) \+ 2 \* var\(--co-tap-reach\)\);/)
  assert.match(theme, /\.co-icon \{ zoom: var\(--co-icon-scale\); \}/, 'icons scale in the stylesheet, with no inline style')
})

// The two reading sizes belong to a PR's own description on a phone (DESIGN.md); no other rule may borrow them.
test('the two reading sizes are used by the PR description only', () => {
  const found = []
  for (const [file, text] of sheets) {
    for (const line of text.split('\n')) {
      if (/var\(--co-text-(reading|code)\)/.test(line) && !line.includes('.co-desc-content')) found.push(`${file}: ${line.trim().slice(0, 80)}`)
    }
  }
  assert.deepEqual(found, [])
})

// The old per-screen button looks; a button now takes one of the three types in button-theme.js.
const RETIRED_BUTTONS = ['co-quiet-action', 'co-icon-btn', 'co-icon-action', 'co-btn-sm', 'co-btn-caution']
test('buttons use the three types, not the retired per-screen classes', () => {
  const found = sheets.flatMap(([file, text]) => RETIRED_BUTTONS.filter(name => new RegExp(`${name}(?![\\w-])`).test(text)).map(name => `${file}: ${name}`))
  assert.deepEqual(found, [])
})

// A control is one control height tall (--co-control-height: 44 px, drawn 38 on a phone with a 44 px tap). These ones are named; the rest of the list is the
// known shorter ones (inputs, labels, rows) that a later pass may lift. A new rule under 44 fails here.
test('the segment bar, filter chips, count chips, rail rows and lens tabs take the control height token', () => {
  const css = sheets.map(([, text]) => text).join('\n')
  for (const selector of ['.co-seg button', '.co-pr-filters button', '.co-filter-line button', '.co-rail-item', '.co-lens-nav button']) {
    const rule = css.split('\n').flatMap(line => (line.trimStart().startsWith(selector + ' {') ? [line] : [])).join('\n')
    assert.match(rule, /min-height:\s*var\(--co-control-height\)/, `${selector} must be var(--co-control-height) tall`)
  }
})

// The shared Clear button is small to look at (a 16px icon) but a full tap to touch: its box is the tap height
// wide and tall, and the field's 1px edge and the tap's reach are taken back so the field stays one control tall.
test('the shared Clear button is as wide and as tall as a tap', () => {
  const css = sheets.map(([, text]) => text).join('\n')
  const rule = css.split('\n').find(line => line.startsWith('.co-search-clear {')) || ''
  assert.match(rule, /(?:^|[;{\s])width:\s*var\(--co-tap-height\)/, 'Clear must be a tap wide')
  assert.match(rule, /(?:^|[;{\s])height:\s*var\(--co-tap-height\)/, 'Clear must be a tap tall')
  assert.match(rule, /margin:\s*calc\(-1px - var\(--co-tap-reach\)\) 0/, 'the field edge and the reach are taken back so the field stays one control tall')
})

const SHORTER_THAN_A_CONTROL = ['.co-source-group-label', '.co-agent-chat-link', '.co-prior-work-details > summary', '.co-plan-label', '.co-files-head',
  '.co-review-project > header', '.co-review-default', '.co-pr-select', '.co-pr-agent-state',
  '.co-pr-requested', '.co-split .co-split-main', '.co-rail-quiet > summary', '.co-desk-back',
  '.co-set-row .co-btn', '.co-prompt-choices button', '.co-alert']
test('no new rule gives a control a min-height under 44 px', () => {
  const found = []
  for (const [file, text] of sheets) {
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const px = /(?:^|[;\s])min-height:\s*(\d+)px/.exec(match[2])?.[1]
      if (px && Number(px) < 44 && !SHORTER_THAN_A_CONTROL.some(name => match[1].includes(name))) found.push(`${file}: ${match[1].trim().split('\n').pop().slice(0, 70)} => ${px}px`)
    }
  }
  assert.deepEqual(found, [])
})
