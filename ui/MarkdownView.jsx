import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

function renderMarkdown(markdown) {
  const raw = marked.parse(String(markdown || ''), {
    breaks: false,
    gfm: true,
  })
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}

export function MarkdownView({ markdown }) {
  const html = useMemo(() => {
    if (typeof DOMPurify.sanitize !== 'function') return null
    try {
      return renderMarkdown(markdown)
    } catch {
      return DOMPurify.sanitize(String(markdown || ''))
    }
  }, [markdown])

  function handleClick(event) {
    const anchor = event.target?.closest?.('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    let url = null
    try {
      url = new URL(href, window.location.origin)
    } catch {
      event.preventDefault()
      return
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      event.preventDefault()
      window.open(url.href, '_blank', 'noopener,noreferrer')
      return
    }
    event.preventDefault()
  }

  if (html === null) return <div className="co-markdown">{String(markdown || '')}</div>

  return (
    <div
      className="co-markdown"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
