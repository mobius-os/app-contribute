import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PAGE_PICTURES, MAX_PICTURE_BYTES, PICTURE_DATA_URL, createImageReader, imageDataUrl, loadsInFrame, repoImageSource, sniffImageType } from '../image-source.js'
import { fetchRepoFile } from '../api.js'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const SIGNATURES = {
  'image/png': PNG,
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': [...Buffer.from('GIF89a')],
  'image/webp': [...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBPVP8 ')],
}
// What GitHub's contents API answers: base64 wrapped every 60 characters, and the byte size beside it.
const file = (bytes, extra = {}) => {
  const body = Buffer.from(bytes)
  return { type: 'file', encoding: 'base64', size: body.length, content: body.toString('base64').replace(/(.{60})/g, '$1\n') + '\n', ...extra }
}
const sized = (head, length) => [...head, ...new Array(Math.max(0, length - head.length)).fill(7)]

test('the frame loads only a data: image or a path on its own origin, never another host spelled to look like a path', () => {
  const origin = 'https://app.example'
  for (const src of ['data:image/png;base64,AAAA', '/api/storage/shot.png', 'https://app.example/x.png']) assert.equal(loadsInFrame(src, origin), true, src)
  for (const src of ['https://github.com/o/r/raw/main/a.png', '//evil.example/a.png', '/\\evil.example/a.png', '/\t/evil.example/a.png', '/\n/evil.example/a.png', 'images/a.png', 'http://app.example.evil/a.png', '']) {
    assert.equal(loadsInFrame(src, origin), false, JSON.stringify(src))
  }
})

test('a file in a repository maps to its repository, ref and path: raw, raw/ and blob/ addresses, Contribute\'s own screenshots included', () => {
  const sha = 'a'.repeat(40)
  // The address Contribute gives a Respond screenshot: a commit, then the screenshot branch's folders.
  assert.deepEqual(repoImageSource(`https://raw.githubusercontent.com/owner/repo/${sha}/screenshots/fix/feature-x/before-desktop.png`),
    { repo: 'owner/repo', ref: sha, path: 'screenshots/fix/feature-x/before-desktop.png' })
  assert.deepEqual(repoImageSource('https://github.com/owner/repo/blob/main/docs/img/a%20b.PNG?raw=true'), { repo: 'owner/repo', ref: 'main', path: 'docs/img/a b.PNG' })
  assert.deepEqual(repoImageSource('https://github.com/owner/repo/raw/v1.2/a.webp#frag'), { repo: 'owner/repo', ref: 'v1.2', path: 'a.webp' })
  assert.deepEqual(repoImageSource('https://raw.githubusercontent.com/owner/repo/refs/heads/main/a.jpeg'), { repo: 'owner/repo', ref: 'main', path: 'a.jpeg' })
  assert.deepEqual(repoImageSource('https://raw.githubusercontent.com/owner/repo/main/a.gif?token=ABC'), { repo: 'owner/repo', ref: 'main', path: 'a.gif' }, 'a private link\'s token is dropped; the read uses the owner\'s own sign-in')
})

test('anything that is not a picture file in a repository stays a link: other hosts, other file types, SVG, odd addresses', () => {
  const refused = [
    'https://github.com/user-attachments/assets/1f2e3d4c-aaaa-bbbb-cccc-1234567890ab',
    'https://github.com/owner/repo/assets/123/abc.png',
    'https://private-user-images.githubusercontent.com/1/abc.png?jwt=x',
    'https://camo.githubusercontent.com/abc/def',
    'https://img.shields.io/badge/ok-green.svg',
    'https://example.com/owner/repo/main/a.png',
    'https://raw.githubusercontent.com.evil.example/owner/repo/main/a.png',
    'https://github.com.evil.example/owner/repo/blob/main/a.png',
    'http://raw.githubusercontent.com/owner/repo/main/a.png',
    'https://user:pass@raw.githubusercontent.com/owner/repo/main/a.png',
    'https://raw.githubusercontent.com:8443/owner/repo/main/a.png',
    'https://raw.githubusercontent.com/owner/repo/main/logo.svg',
    'https://raw.githubusercontent.com/owner/repo/main/logo.png.svg',
    'https://raw.githubusercontent.com/owner/repo/main/notes.md',
    'https://raw.githubusercontent.com/owner/repo/main/noextension',
    'https://github.com/owner/repo/blob/main/',
    'https://github.com/owner/repo/tree/main/a.png',
    'https://github.com/owner/repo/raw/main',
    'https://raw.githubusercontent.com/owner/repo/main/%2e%2e/%2e%2e/other/a.png',
    'https://raw.githubusercontent.com/owner/repo/main/a%2F..%2Fb.png',
    'https://raw.githubusercontent.com/owner/repo/main//a.png',
    'https://raw.githubusercontent.com/own er/repo/main/a.png',
    'https://raw.githubusercontent.com/../repo/main/a.png',
    'https://raw.githubusercontent.com/owner/repo/refs/heads',
    'not a url', '', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
  ]
  for (const src of refused) assert.equal(repoImageSource(src), null, src)
})

test('a picture is known by its first bytes, never by its name: PNG, JPEG, GIF and WebP only', () => {
  for (const [type, bytes] of Object.entries(SIGNATURES)) assert.equal(sniffImageType(Uint8Array.from(bytes)), type)
  assert.equal(sniffImageType(Uint8Array.from([...Buffer.from('GIF87a')])), 'image/gif')
  for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<?xml version="1.0"?><svg/>', '<!doctype html><script>', '', 'RIFFxxxxWAVEfmt ', 'GIF90a']) {
    assert.equal(sniffImageType(Uint8Array.from(Buffer.from(text))), null, text)
  }
  assert.equal(sniffImageType(Uint8Array.from(PNG.slice(0, 5))), null, 'half a signature is not a picture')
})

test('GitHub\'s answer becomes a data: picture of its sniffed type, and every other answer is refused', () => {
  for (const [type, head] of Object.entries(SIGNATURES)) {
    const url = imageDataUrl(file(sized(head, 150)))
    assert.match(url, new RegExp(`^data:${type};base64,`))
    assert.match(url, PICTURE_DATA_URL, 'only an address the frame may load')
  }
  assert.equal(imageDataUrl(file(sized(PNG, MAX_PICTURE_BYTES))) !== null, true, 'exactly at the cap is allowed')
  const refused = {
    'an SVG, even under a .png name': file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')),
    'HTML': file(Buffer.from('<html><script>alert(1)</script></html>')),
    'a file over the size cap': file(sized(PNG, MAX_PICTURE_BYTES + 1)),
    'an empty file': file([]),
    'a size that does not match the bytes': file(sized(PNG, 100), { size: 99 }),
    'a directory': file(sized(PNG, 100), { type: 'dir' }),
    'a symlink': file(sized(PNG, 100), { type: 'symlink' }),
    'content GitHub did not inline (a large file)': file(sized(PNG, 100), { encoding: 'none', content: '' }),
    'text that is not base64': file(sized(PNG, 100), { content: 'iVBORw0KGgo=<script>' }),
    'a data: prefix smuggled into the content': file(sized(PNG, 100), { content: 'data:image/png;base64,AAAA' }),
    'no size': file(sized(PNG, 100), { size: undefined }),
    'a string size': file(sized(PNG, 100), { size: '100' }),
    'nothing': null,
  }
  for (const [name, answer] of Object.entries(refused)) assert.equal(imageDataUrl(answer), null, name)
})

test('a page reads each picture once, shares the answer with a repeat, and stops at its budget', async () => {
  const reads = []
  const answer = file(sized(PNG, 120))
  const read = createImageReader(async source => { reads.push(source.path); return answer }, 2)
  const a = { repo: 'o/r', ref: 'main', path: 'a.png' }
  const [first, again] = await Promise.all([read(a), read({ ...a })])
  assert.equal(first, again)
  assert.match(first, /^data:image\/png;base64,/)
  assert.ok(await read({ ...a, path: 'b.png' }))
  assert.equal(await read({ ...a, path: 'c.png' }), null, 'over the budget: the picture stays a link')
  assert.ok(await read(a), 'a picture already read is still answered')
  assert.deepEqual(reads, ['a.png', 'b.png'])
  assert.equal(MAX_PAGE_PICTURES, 12)
})

test('a picture that cannot be read, or is not a picture, answers null instead of failing the page', async () => {
  const read = createImageReader(async source => { if (source.path === 'throws.png') throw new Error('offline'); return source.path === 'null.png' ? null : file(Buffer.from('<svg/>')) })
  for (const path of ['throws.png', 'null.png', 'svg.png']) assert.equal(await read({ repo: 'o/r', ref: 'main', path }), null, path)
})

test('the read asks the read-only route for the contents of one file, encoded, and answers null when it cannot', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ type: 'file' }), { status: 200 }) })
  assert.deepEqual(await fetchRepoFile('tok', { repo: 'o/r', ref: 'feature-1', path: 'shots/a b/c#1.png' }), { type: 'file' })
  assert.equal(calls[0].url, '/api/github/api/repos/o/r/contents/shots/a%20b/c%231.png?ref=feature-1')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok')
  assert.ok(!calls[0].options.method, 'a read')
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }))
  assert.equal(await fetchRepoFile('tok', { repo: 'o/r', ref: 'main', path: 'a.png' }), null)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  assert.equal(await fetchRepoFile('tok', { repo: 'o/r', ref: 'main', path: 'a.png' }), null)
})
