import React, { useCallback, useEffect, useRef, useState } from 'react'
import { openGithubSettings } from '../github-connection.js'
import { Icon } from './Icons.jsx'
import { ReviewPromptSettings } from './ReviewPromptSettings.jsx'
// Component-local settings layout. The app shell keeps its existing theme tokens.
export const SETTINGS_CSS = `
.co-settings-workspace { box-sizing:border-box; width:min(820px,calc(100vw - 32px)); max-height:calc(100dvh - 110px); padding:24px; }
.co-settings-workspace > header { padding-bottom:14px; border-bottom:1px solid var(--border); }
.co-settings-layout { display:block; }
.co-settings-content { min-width:0; padding-top:15px; }
.co-settings-content h3 { margin:0 0 12px; font-size:18px; line-height:1.4; font-weight:650; }
.co-settings-content .co-prompt-settings { margin:0; padding:0; border:0; }
.co-settings-content .co-prompt-settings textarea { min-height:270px; font-size:16px; line-height:1.6; }
.co-settings-skeleton { min-height:420px; padding:24px 0; color:var(--muted); }
.co-prompt-editor-group { padding:8px 0 16px; border-bottom:1px solid var(--border); }
.co-prompt-editor-group .co-quiet-action { margin-top:4px; }
.co-prompt-settings > label { font-weight:650; }
.co-settings-account { padding-bottom:24px; margin-bottom:24px; border-bottom:1px solid var(--border); }
.co-settings-workspace > header .co-quiet-action { min-height:44px; padding:8px 12px; border:0; border-radius:8px; background:none; color:var(--muted); font:inherit; cursor:pointer; }
.co-settings-workspace > header .co-quiet-action:hover { background:var(--surface-2); color:var(--text); }
.co-settings-account .co-conn-settings { display:block; }
.co-settings-account .co-conn-actions { margin-top:10px; }
@media(max-width:650px) { .co-settings-workspace { position:fixed; inset:68px 16px auto; width:auto; max-height:calc(100dvh - 84px); padding:18px; } .co-settings-content { padding-top:16px; } }
`


// One settings surface, opened on demand. It shows which GitHub account
// Contribute uses; connecting or changing that account happens in Möbius
// Settings, which owns the instance-wide GitHub connection.
export function ConnectionSettings(props) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const accountLabel = props.conn?.state === 'connected' && props.conn?.login
    ? props.conn.login
    : props.conn?.state === 'disconnected' ? 'Connect GitHub' : 'GitHub'
  const accountStatus = props.conn?.state === 'connected' ? 'GitHub connected' : accountLabel
  useEffect(() => {
    if (!open) return
    const outside = event => { if (ref.current && !ref.current.contains(event.target)) ref.current.open = false }
    const escape = event => { if (event.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <details className="co-settings" ref={ref} onToggle={event => {
    const next = event.currentTarget.open
    setOpen(next)
    if (next) void props.onChanged?.()
  }}>
    <summary aria-label={`${accountStatus}${props.conn?.state === 'connected' && props.conn?.login ? ` as ${props.conn.login}` : ''} — Contribute settings`} title={`${accountStatus} · Settings`}>
      <Icon name="settings" size={20} /><span>Settings</span>
    </summary>
    {open ? <div className="co-settings-panel co-settings-workspace"><style>{SETTINGS_CSS}</style>
      <header><h2>Settings</h2><button type="button" className="co-quiet-action" onClick={() => { ref.current.open = false; ref.current.querySelector('summary')?.focus() }}>Done</button></header>
      <div className="co-settings-layout">
        <div className="co-settings-content">
          <section className="co-settings-account" aria-label="GitHub account"><h3>GitHub account</h3><ConnectionCard {...props} /></section>
          <h3>Agent prompts</h3>
          <ReviewPromptSettings token={props.token} appId={props.appId} />
        </div>
      </div>
    </div> : null}
  </details>
}

const settingsButton = (label, primary = false) => (
  <button
    type="button"
    className={primary ? 'co-btn co-btn-primary co-btn-block' : 'co-btn co-btn-sm'}
    onClick={openGithubSettings}
  >
    {label}
  </button>
)

// Read-only view of the instance GitHub account, which Möbius Settings owns:
//   checking     — the initial status probe is still in flight
//   unknown      — the probe failed; retryable, the feed still shows from cache
//   connected    — the account in use, plus Contribute's own settings
//   disconnected — a pointer to Settings, where the owner connects GitHub
export function ConnectionCard({
  conn,
  onChanged,
  onRetry,
  autopilotDefault = true,
  onToggleAutopilotDefault,
}) {
  const [autopilotHelpOpen, setAutopilotHelpOpen] = useState(false)
  const [statusRetrying, setStatusRetrying] = useState(false)
  const autopilotHelpRef = useRef(null)
  const autopilotInfoRef = useRef(null)

  const retryStatus = useCallback(async () => {
    if (statusRetrying) return
    setStatusRetrying(true)
    try {
      await (onRetry || onChanged)?.()
    } finally {
      setStatusRetrying(false)
    }
  }, [statusRetrying, onRetry, onChanged])

  useEffect(() => {
    if (!autopilotHelpOpen) return undefined
    const dismissOutside = (event) => {
      if (!autopilotHelpRef.current?.contains(event.target)) setAutopilotHelpOpen(false)
    }
    const dismissWithEscape = (event) => {
      if (event.key !== 'Escape') return
      setAutopilotHelpOpen(false)
      autopilotInfoRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [autopilotHelpOpen])

  const state = conn?.state

  if (state === 'checking') return <p className="co-conn-note" role="status">Checking account…</p>

  if (state === 'unknown') {
    return (
      <div className="co-conn" role="status" aria-live="polite">
        <span className="co-conn-dot is-warn" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">GitHub status unavailable</p>
          <p className="co-conn-text">
            {conn?.message || 'Contribute could not reach the GitHub connection service.'}
            {' '}Your saved contribution feed is still available.
          </p>
          <div className="co-conn-actions">
            <button type="button" className="co-btn co-btn-sm" onClick={retryStatus} disabled={statusRetrying} aria-busy={statusRetrying}>
              {statusRetrying ? 'Checking…' : 'Check GitHub again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'connected') {
    return (
      <div className="co-conn is-connected">
        <p className="co-account-login"><Icon name="github" size={18} /> {conn.login}</p>
        <p className="co-conn-note">This account is shared across Möbius apps.</p>
        <div className="co-conn-settings" role="group" aria-label="Contribution settings">
          {conn.autopilotAvailable && typeof onToggleAutopilotDefault === 'function' && (
            <div className="co-autopilot-setting">
              <label htmlFor="co-follow-sent-prs">Follow sent PRs</label>
              <div className="co-setting-help" ref={autopilotHelpRef}>
                <button
                  ref={autopilotInfoRef}
                  type="button"
                  className="co-setting-info"
                  aria-label="What Follow sent PRs does"
                  aria-expanded={autopilotHelpOpen}
                  aria-controls="co-follow-sent-prs-help"
                  aria-describedby={autopilotHelpOpen ? 'co-follow-sent-prs-help' : undefined}
                  title="What Follow sent PRs does"
                  onClick={() => setAutopilotHelpOpen((open) => !open)}
                >
                  <Icon name="info" size={15} />
                </button>
                {autopilotHelpOpen ? (
                  <p id="co-follow-sent-prs-help" className="co-setting-popover" role="tooltip">
                    Follows sent PRs through checks and review, addresses comments automatically, and asks when it needs you.
                  </p>
                ) : null}
              </div>
              <span className="co-setting-switch">
                <input
                  id="co-follow-sent-prs"
                  type="checkbox"
                  checked={autopilotDefault}
                  onChange={(event) => onToggleAutopilotDefault(event.target.checked)}
                />
                <i aria-hidden="true" />
              </span>
            </div>
          )}
          <div className="co-conn-actions">{settingsButton('GitHub account settings')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="co-conn is-column">
      <div className="co-account-default"><Icon name="check" size={18} /><div><strong>Möbius</strong><small>Legacy Möbius drafts only. New contributions use GitHub.</small></div></div>
      <div className="co-github-upgrade">
        <strong>GitHub is connected in Settings</strong>
        <p className="co-conn-note">To contribute as yourself, go to <b>Möbius Settings → Accounts → GitHub</b> and connect your account there. Contribute picks it up automatically when you come back.</p>
      </div>
      {settingsButton('Go to Settings to connect', true)}
    </div>
  )
}
