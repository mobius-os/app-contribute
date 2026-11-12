// Pictures in GitHub markdown, and the one rule that decides how each is shown: the app frame never asks
// another host for an image (an outside image is also a tracking beacon). A picture is shown only as a
// data: address the app made itself. A file in a GitHub repository is read through the read-only GitHub
// route (the contents API) and made into one; any other picture stays a link out.

export const MAX_PICTURE_BYTES = 1024 * 1024 // GitHub's contents API gives no body for a larger file
export const MAX_PAGE_PICTURES = 12

// Whether an <img> address loads in the frame without a request to another host: a data: image, or a path
// on the app's own origin. "//host/x" and "/\host/x" start with a slash but name another host, and a browser
// drops tabs and line breaks inside an address, so "/<tab>/host/x" does too.
export function loadsInFrame(src, origin) {
  const address = String(src).replace(/[\t\n\r]/g, '')
  if (address.startsWith('data:')) return true
  if (address.startsWith('/')) return !/^\/[/\\]/.test(address)
  return address.startsWith(origin + '/')
}

const NAME = /^[\w.-]+$/
const PICTURE_FILE = /\.(png|jpe?g|gif|webp)$/i
const word = value => NAME.test(value || '') && value !== '.' && value !== '..'

// A picture that is a file in a GitHub repository: raw.githubusercontent.com/OWNER/REPO/REF/PATH, or
// github.com/OWNER/REPO/raw/REF/PATH and /blob/REF/PATH. REF is one path segment (a commit, branch or tag;
// refs/heads/NAME is read as NAME): a branch name with a slash cannot be told from the start of the path, so
// the read finds nothing and the picture stays a link. Anything that is not a PNG, JPEG, GIF or WebP file
// by its name, SVG included, is not read at all.
export function repoImageSource(src) {
  let url
  try { url = new URL(src) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const parts = url.pathname.split('/').slice(1)
  let owner, repo, ref, path
  if (url.hostname === 'raw.githubusercontent.com') [owner, repo, ref, ...path] = parts
  else if (url.hostname === 'github.com' && (parts[2] === 'raw' || parts[2] === 'blob')) [owner, repo, , ref, ...path] = parts
  else return null
  if (ref === 'refs' && (path[0] === 'heads' || path[0] === 'tags')) { ref = path[1]; path = path.slice(2) }
  try { path = path.map(decodeURIComponent); ref = decodeURIComponent(ref || '') } catch { return null }
  // A decoded segment may not hold a slash or a dot-segment: the path stays inside the repository.
  if (!word(owner) || !word(repo) || !word(ref) || !path.length || path.some(part => !part || part === '.' || part === '..' || part.includes('/'))) return null
  if (!PICTURE_FILE.test(path[path.length - 1])) return null
  return { repo: `${owner}/${repo}`, ref, path: path.join('/') }
}

// The type a file's first bytes say it is, never what its name or the server says. SVG has no signature
// here on purpose: it is a document that can carry script and outside links, not a picture to inline.
export function sniffImageType(bytes) {
  const starts = (...signature) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
export const PICTURE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

// GitHub's contents answer for a file, as a data: picture; null when it is not one this page may show. The
// answer's own size must match what it carries, and only the first bytes are decoded, to read the type.
export function imageDataUrl(file) {
  if (file?.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') return null
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_PICTURE_BYTES) return null
  const base64 = file.content.replace(/\s/g, '')
  if (!BASE64.test(base64) || base64.length % 4 !== 0) return null
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if (base64.length / 4 * 3 - padding !== file.size) return null
  const type = sniffImageType(Uint8Array.from(atob(base64.slice(0, 16)), char => char.charCodeAt(0)))
  return type ? `data:${type};base64,${base64}` : null
}

// One reader per page version. Each picture is read once (a repeat shares the answer), and after
// `limit` different pictures it answers null, so one long thread cannot spend the route's rate limit.
// `fetchFile(source)` resolves to GitHub's contents answer or null; this resolves to a data: URL or null.
export function createImageReader(fetchFile, limit = MAX_PAGE_PICTURES) {
  const answers = new Map()
  return source => {
    const key = `${source.repo}@${source.ref}:${source.path}`
    if (!answers.has(key)) {
      if (answers.size >= limit) return Promise.resolve(null)
      answers.set(key, Promise.resolve().then(() => fetchFile(source)).then(imageDataUrl, () => null))
    }
    return answers.get(key)
  }
}
