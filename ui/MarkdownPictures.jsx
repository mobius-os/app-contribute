import { createContext, useContext, useEffect, useRef } from 'react'
import { PICTURE_DATA_URL, repoImageSource } from '../image-source.js'
import { safeDetailLink } from '../pull-details.js'

// The page's picture reader (image-source.js createImageReader). Without one, a picture that is a
// repository file stays the labelled link it starts as.
export const RepoImageContext = createContext(null)

// The tile becomes the picture, small, inside a button that opens it larger. `url` is only ever a data:
// address the reader made, checked again here, so no outside address can reach an <img>.
function showPicture(tile, url) {
  if (!PICTURE_DATA_URL.test(url)) return
  const alt = tile.getAttribute('data-alt') || ''
  const photo = document.createElement('button')
  photo.type = 'button'
  photo.className = 'co-md-photo'
  photo.setAttribute('data-source', tile.getAttribute('href'))
  photo.setAttribute('aria-label', `Open larger: ${alt || 'picture'}`)
  const image = document.createElement('img')
  image.src = url
  image.alt = alt
  photo.append(image)
  tile.replaceWith(photo)
}

// What a tap on a `.co-md-photo` may open: the button showPicture made, holding a checked data: picture and a
// source a browser may open. The class alone proves nothing, as the text of a description can carry it too.
export function pictureOf(photo) {
  const image = photo.querySelector('img')
  const src = image?.getAttribute('src') || ''
  const source = safeDetailLink(photo.getAttribute('data-source'))
  if (photo.tagName !== 'BUTTON' || !PICTURE_DATA_URL.test(src) || !source) return null
  return { src, alt: image.getAttribute('alt') || '', source }
}

// Turns the tiles under `box` that are repository files into pictures, each only once it scrolls into view.
// The page's reader caps how many it reads; a tile it refuses or cannot read stays a link.
export function useRepoPictures(box, html) {
  const read = useContext(RepoImageContext)
  useEffect(() => {
    const tiles = read && box.current ? [...box.current.querySelectorAll('a.co-md-image')].filter(tile => repoImageSource(tile.getAttribute('href'))) : []
    if (!tiles.length) return undefined
    let live = true
    const load = tile => read(repoImageSource(tile.getAttribute('href'))).then(url => { if (live && url && tile.isConnected) showPicture(tile, url) })
    const watch = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { watch.unobserve(entry.target); load(entry.target) } }))
      : null
    tiles.forEach(tile => (watch ? watch.observe(tile) : load(tile)))
    return () => { live = false; watch?.disconnect() }
  }, [html, read])
}

// One picture at the size of the screen. A native modal dialog keeps focus inside, closes on Escape, and
// gives focus back to the picture that opened it.
export function PictureViewer({ picture, onClose }) {
  const dialog = useRef(null)
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} className="co-picture-viewer" aria-label={picture.alt || 'Picture'} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) dialog.current.close() }}>
    <img src={picture.src} alt={picture.alt} />
    <div className="co-picture-tools">
      <a className="co-btn co-btn-quiet" href={picture.source} target="_blank" rel="noopener noreferrer">Open on GitHub</a>
      <button type="button" className="co-btn" onClick={() => dialog.current.close()}>Close</button>
    </div>
  </dialog>
}
