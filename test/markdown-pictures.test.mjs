import assert from 'node:assert/strict'
import test from 'node:test'
import { renderModule } from './render-harness.mjs'

const DATA = 'data:image/png;base64,iVBORw0KGgo='
const SOURCE = 'https://raw.githubusercontent.com/owner/project/' + 'a'.repeat(40) + '/shots/before.png'

// The parts of a picture button that pictureOf reads, without a DOM.
const element = (tagName, { src, alt = 'before', source } = {}) => ({
  tagName,
  getAttribute: name => (name === 'data-source' ? source ?? null : null),
  querySelector: () => (src === undefined ? null : { getAttribute: name => ({ src, alt })[name] ?? null }),
})
const pictureOf = async () => (await renderModule(`export { pictureOf } from './ui/MarkdownPictures.jsx'`)).pictureOf

test('a picture button made by the app opens larger, with its checked picture and source', async () => {
  const picture = (await pictureOf())(element('BUTTON', { src: DATA, source: SOURCE }))
  assert.deepEqual(picture, { src: DATA, alt: 'before', source: SOURCE })
})

test('markup from the text that only borrows the picture class opens nothing', async () => {
  const open = await pictureOf()
  assert.equal(open(element('A', { src: DATA, source: SOURCE })), null, 'a link is not a picture button')
  assert.equal(open(element('BUTTON', { src: DATA, source: 'javascript:alert(1)' })), null, 'a script address is never offered as a link')
  assert.equal(open(element('BUTTON', { src: DATA })), null, 'no source, no link')
  assert.equal(open(element('BUTTON', { src: 'https://evil.example/pixel.png', source: SOURCE })), null, 'an outside picture is not shown')
  assert.equal(open(element('BUTTON', { src: 'data:image/svg+xml;base64,PHN2Zy8+', source: SOURCE })), null, 'only a checked data: picture is shown')
})

test('a picture class with no <img> inside is refused, not thrown at', async () => {
  assert.equal((await pictureOf())(element('BUTTON', { source: SOURCE })), null)
})
