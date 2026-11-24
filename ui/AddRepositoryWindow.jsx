import { useEffect, useId, useRef, useState } from 'react'
import { discoverRepository, repositoryName, searchRepositories } from '../collaboration.js'
import { followRepository } from '../repositories.js'
import { NAMES } from '../names.js'
import { ReviewDialog } from './ReviewDialog.jsx'
import { WindowHead } from './WindowHead.jsx'
import { Shine } from './Shine.jsx'

const TYPING_PAUSE_MS = 350
const WORDS_ONLY = /^[\w.\- ]+$/

// What the field holds, as one answer the window draws: a repository to add (`found`), several to choose from (`choices`), or
// words to say instead (`message`). A link or owner/name is read from GitHub; a name alone is searched on GitHub, since a name does
// not say whose repository it is. Throws GitHub's own reason (not found, unreachable).
async function readField(token, text) {
  const exact = repositoryName(text)
  if (exact) return { found: await discoverRepository(token, exact) }
  if (!WORDS_ONLY.test(text)) return { message: 'That does not look like a repository. Type a name, owner/project, or paste a GitHub link.' }
  const choices = await searchRepositories(token, text)
  return choices.length ? { choices } : { message: `Nothing on GitHub matches “${text}” that your account can see. Try owner/project, or paste the link.` }
}

// The Add repository window (DESIGN.md, The Window Rule): one field for a name or a link, the answer under it
// before anything is added. Adding is only a choice of this workspace (followRepository): nothing is installed and nothing changes
// on GitHub. `onAdded(repo, followed)` hears the repository GitHub described and the saved list.
export function AddRepositoryWindow({ token, connected, initialText = '', onAdded, onClose }) {
  const [text, setText] = useState(initialText)
  const [answer, setAnswer] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const titleId = useId()
  useEffect(() => { inputRef.current?.focus() }, [])
  // Each pause in typing reads the field once; an answer that arrives after the text moved on is dropped.
  useEffect(() => {
    const words = text.trim()
    setAnswer(null); setChosen(null); setError('')
    if (!words || !connected) { setReading(false); return undefined }
    setReading(true)
    let current = true
    const timer = setTimeout(async () => {
      try {
        const next = await readField(token, words)
        if (!current) return
        setAnswer(next); setChosen(next.found || null)
      } catch (failure) {
        if (current) setAnswer({ message: failure.message || 'Could not reach GitHub. Try again.', failed: true })
      } finally { if (current) setReading(false) }
    }, TYPING_PAUSE_MS)
    return () => { current = false; clearTimeout(timer) }
  }, [text, token, connected])
  async function add() {
    if (!chosen || busy) return
    setBusy(true); setError('')
    try {
      const followed = await followRepository(chosen.nameWithOwner)
      onAdded?.(chosen, followed)
      onClose()
    } catch (failure) { setError(failure.message || 'Could not add this repository. Try again.') }
    finally { setBusy(false) }
  }
  const enter = event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void add() } }
  return <ReviewDialog label={NAMES.addRepository} onClose={onClose}>
    <section className="co-review-window" aria-labelledby={titleId}>
      <WindowHead eyebrow={NAMES.repositories} title={NAMES.addRepositoryTitle} titleId={titleId} />
      <div className="co-rw-body co-add-body">
        <p className="co-rw-lede">Follow its pull requests here without installing it.</p>
        {connected ? <>
          <label className="co-add-label" htmlFor="co-repository-name">Repository name or GitHub link</label>
          <input id="co-repository-name" ref={inputRef} type="text" value={text} onChange={event => setText(event.target.value)} onKeyDown={enter}
            placeholder="mobius, owner/project, or a GitHub link" disabled={busy} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" data-1p-ignore data-lpignore="true" />
          <div className="co-add-answer" aria-live="polite">
            {reading ? <p className="co-add-line"><Shine>Looking on GitHub…</Shine></p> : null}
            {!reading && !text.trim() ? <p className="co-add-line">Part of a name searches GitHub. A link to the repository, or to one of its pull requests, works too.</p> : null}
            {!reading && answer?.message ? <p className={'co-add-line' + (answer.failed ? ' co-run-error' : '')} role={answer.failed ? 'alert' : undefined}>{answer.message}</p> : null}
            {!reading && answer?.found ? <p className="co-add-line is-found"><strong>{answer.found.nameWithOwner}</strong> is on GitHub. Nothing is installed, and nothing changes there.</p> : null}
            {!reading && answer?.choices ? <ul className="co-add-choices" aria-label="Repositories on GitHub">
              {answer.choices.map(repo => <li key={repo.nameWithOwner}><button type="button" aria-pressed={chosen?.nameWithOwner === repo.nameWithOwner} onClick={() => setChosen(repo)}>
                <strong>{repo.nameWithOwner}</strong>{repo.description ? <span>{repo.description}</span> : null}
              </button></li>)}
            </ul> : null}
          </div>
          {error ? <p className="co-run-error" role="alert">{error}</p> : null}
        </> : <p className="co-add-line">To add a repository, go to Möbius Settings → Accounts and connect GitHub.</p>}
      </div>
      <footer className="co-rw-foot"><div className="co-rw-actions">
        <button type="button" className="co-btn" onClick={onClose}>{NAMES.cancel}</button>
        {connected ? <button type="button" className="co-btn co-btn-primary" disabled={!chosen || busy} onClick={add}>{busy ? <Shine>Adding…</Shine> : chosen ? `Add ${chosen.nameWithOwner}` : NAMES.addRepository}</button> : null}
      </div></footer>
    </section>
  </ReviewDialog>
}
