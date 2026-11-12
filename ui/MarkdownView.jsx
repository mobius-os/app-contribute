import React, { useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { loadsInFrame } from '../image-source.js'
import { PictureViewer, pictureOf, useRepoPictures } from './MarkdownPictures.jsx'

const SCREENSHOT_SCHEME = 'screenshot:'
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
export const isPngDataUrl = value => typeof value === 'string' && PNG_DATA_URL.test(value)

// Like marked's own attribute escape: an entity the text already carries is
// kept, so marked's escaped alt text is not escaped twice.
function escapeHtml(value) {
  return String(value).replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)|[<>"']/gi, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

// The picture code finds its own elements by their co-md-* class and data-source, so the text
// of a description must not carry them: it could pass itself off as a picture button. Dropped
// before the app adds its own (the "i" matches how a quirks-mode document compares classes).
function dropPictureHooks(root) {
  for (const node of root.querySelectorAll('[class*="co-md-" i]')) node.removeAttribute('class')
  for (const node of root.querySelectorAll('[data-source], [data-alt]')) {
    node.removeAttribute('data-source')
    node.removeAttribute('data-alt')
  }
}

// The app frame's sandbox lets only same-origin and data: images load, by
// design (an external image is also a tracking beacon). A GitHub screenshot
// or badge therefore becomes a labelled picture tile that opens on GitHub; the
// tile of a repository file is turned into the picture itself by useRepoPictures,
// from a data: address the app reads through the read-only GitHub route.
// The markup is parsed in a <template>, which fetches nothing, so no outside
// address is requested even for a moment while it is being rewritten.
function linkExternalImages(html) {
  if (typeof document === 'undefined') return html
  const box = document.createElement('template')
  box.innerHTML = html
  dropPictureHooks(box.content)
  for (const input of box.content.querySelectorAll('input[src]')) input.removeAttribute('src')
  for (const img of [...box.content.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || ''
    if (loadsInFrame(src, window.location.origin)) continue
    const link = document.createElement('a')
    link.setAttribute('href', src)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
    link.setAttribute('data-alt', img.getAttribute('alt') || '')
    link.className = 'co-md-image'
    link.textContent = `Image: ${img.getAttribute('alt') || 'open on GitHub'}`
    img.replaceWith(link)
  }
  return box.innerHTML
}

// A prepared PR description names staged screenshots with a screenshot:NAME
// pseudo-URL that only Send turns into a public link. Such an image renders
// from the caller's resolved data: URL, or as a neutral placeholder; it never
// becomes an <img> pointing at screenshot:, so nothing is fetched or broken.
function screenshotImage(token, alt, images) {
  const href = String(token.href || '').trim()
  if (!href.toLowerCase().startsWith(SCREENSHOT_SCHEME)) return false
  const name = href.slice(SCREENSHOT_SCHEME.length)
  const src = Object.hasOwn(images || {}, name) ? images[name] : null
  if (isPngDataUrl(src)) {
    return `<img class="co-markdown-shot" src="${src}" alt="${escapeHtml(alt || 'Screenshot')}">`
  }
  return `<span class="co-markdown-shot-pending">${escapeHtml(alt ? `Screenshot: ${alt}` : 'Screenshot')}</span>`
}

// Marked's HTML before sanitizing; exported for tests, which run without a DOM.
export function markdownHtml(markdown, images = null) {
  const parser = new Marked({
    breaks: false,
    gfm: true,
    renderer: {
      // Alt text as marked's own image renderer derives it (entities and
      // escapes resolved), then escaped once for the attribute.
      image(token) {
        const alt = this.parser.parseInline(token.tokens || [], this.parser.textRenderer).trim()
        return screenshotImage(token, alt, images)
      },
    },
  })
  return parser.parse(String(markdown || ''))
}

// The frame's own image policy (the platform's img-src: self, data and blob only) is what stops an
// outside picture from loading; this keeps the markup in line with it. Besides <img src>, an author can
// name a picture with <picture><source srcset>, srcset, poster, background, a style attribute or a <style>
// element (which would also restyle the whole frame): GitHub does not show those either, so they are
// dropped, an <input type=image src> loses its address, and an <img> of another host becomes a link below.
const SANITIZE = { USE_PROFILES: { html: true }, FORBID_TAGS: ['source', 'style'], FORBID_ATTR: ['srcset', 'poster', 'background', 'style'] }
const cleanHtml = html => linkExternalImages(DOMPurify.sanitize(html, SANITIZE))

function renderMarkdown(markdown, images) {
  return cleanHtml(markdownHtml(markdown, images))
}

// `images` optionally maps a screenshot name to its data:image/png URL.
export function MarkdownView({ markdown, images = null }) {
  const box = useRef(null)
  const [viewing, setViewing] = useState(null)
  const html = useMemo(() => {
    if (typeof DOMPurify.sanitize !== 'function') return null
    try {
      return renderMarkdown(markdown, images)
    } catch {
      return cleanHtml(String(markdown || ''))
    }
  }, [markdown, images])

  useRepoPictures(box, html)

  function handleClick(event) {
    const photo = event.target?.closest?.('.co-md-photo')
    if (photo) {
      // Never navigate the frame, whatever the element is; only a picture this app made opens larger.
      event.preventDefault()
      setViewing(pictureOf(photo))
      return
    }
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
    <>
      <div
        ref={box}
        className="co-markdown"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewing ? <PictureViewer picture={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  )
}
