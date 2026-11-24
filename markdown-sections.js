// A description read in sections (owner's choice, 2026-11-23): each heading opens one, and a bullet list whose every
// item starts with a bold term reads as term | text rows. Built from marked's tokens, not from its HTML, so it needs no
// DOM, and whatever markup the author wrote stays as inert as it was.

const SECTION_DEPTH = 2 // # and ## open a section; ### and below stay inside it
const TERM_LIMIT = 40 // a longer bold lead-in is a sentence, not a term

// The bold term an item starts with, when the item is nothing but that term and its text (no nested list or code block).
function termOf(item) {
  const [block, ...rest] = item.tokens || []
  const lead = block?.tokens?.[0]
  const plain = block && !rest.length && (block.type === 'text' || block.type === 'paragraph')
  return plain && lead?.type === 'strong' && lead.text.length <= TERM_LIMIT ? { block, lead } : null
}

// "(`file.py`, route `POST …`): text" puts the file or route on a quiet line under the term; any other text follows as is.
function splitReference(html) {
  const found = /^\s*\(([\s\S]*?)\):\s*([\s\S]*)$/.exec(html)
  return found?.[1].includes('<code>') ? { reference: found[1], text: found[2] } : { reference: '', text: html.replace(/^[\s:.]+/, '') }
}

// The instance's own parseInline reads markdown text; the Parser class reads tokens, with the same renderer.
const inlineHtml = (parser, tokens) => parser.Parser.parseInline(tokens, parser.defaults)

function termRows(parser, items) {
  const rows = items.map(item => {
    const { block, lead } = termOf(item)
    const term = inlineHtml(parser, lead.tokens).replace(/[.:]\s*$/, '')
    const { reference, text } = splitReference(inlineHtml(parser, block.tokens.slice(1)))
    const quiet = reference ? `<span class="co-doc-reference">${reference}</span>` : ''
    return `<div class="co-doc-term-row"><dt>${term}${quiet}</dt><dd>${text}</dd></div>`
  })
  return `<dl class="co-doc-terms">${rows.join('')}</dl>`
}

const isTermList = token => token.type === 'list' && !token.ordered && token.items.length > 0 && token.items.every(termOf)

export function sectionedHtml(parser, tokens) {
  const sections = []
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= SECTION_DEPTH) sections.push({ heading: token, body: [] })
    else {
      if (!sections.length) sections.push({ heading: null, body: [] })
      sections.at(-1).body.push(token)
    }
  }
  const body = tokens => tokens.map(token => (isTermList(token) ? termRows(parser, token.items) : parser.parser([token]))).join('')
  return sections
    .map(({ heading, body: rest }) => `<section class="co-doc-section">${heading ? parser.parser([heading]) : ''}${body(rest)}</section>`)
    .join('')
}
