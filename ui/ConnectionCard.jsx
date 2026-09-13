import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { disconnect } from '../api.js'
import {
  createGithubDeviceTransport,
  hasFullPrAccess,
  hasPrivateRepoAccess,
  runDeviceConnection,
} from '../github-connection.js'
import { Icon } from './Icons.jsx'

// One account surface, opened on demand. Closing it never cancels the
// server-owned sign-in attempt; reopening refreshes and resumes that attempt.
export function ConnectionSettings(props) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const accountLabel = props.conn?.state === 'disconnected' ? 'Connect GitHub' : 'GitHub'
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
    <summary aria-label={`${accountStatus} — Contribute settings`} title={`${accountStatus} · Settings`}>
      <Icon name="github" size={20} /><span>{accountLabel}</span>
    </summary>
    {open ? <div className="co-settings-panel">
      <header><h2>Settings</h2><button type="button" className="co-quiet-action" onClick={() => { ref.current.open = false; ref.current.querySelector('summary')?.focus() }}>Done</button></header>
      <ConnectionCard {...props} />
    </div> : null}
  </details>
}

async function copyDeviceCode(code) {
  // Clipboard access can be unavailable inside a sandboxed app frame. Keep
  // selection as a real fallback instead of making the primary action fail.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      return
    }
  } catch {
    // Fall through to the user-gesture-compatible selection path below.
  }

  const input = document.createElement('textarea')
  input.value = code
  input.readOnly = true
  input.setAttribute('aria-hidden', 'true')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand?.('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard copy was unavailable.')
}

// The GitHub connection card — the FULL connect flow, owned by this app (the
// platform's connect endpoints accept this app's github_connect token). Four
// top-level states off fetchGithubStatus:
//
//   checking     — the initial status probe is still in flight
//   unsupported  — /api/github/status 404s (platform predates GitHub support)
//   unknown      — the probe failed (offline / restarting); render a retryable
//                  status while the feed continues to show from cache
//   connected    — "Connected as <login>" + an inline-confirm Disconnect
//   disconnected — the GitHub device-flow connection UI
//
// The state machine consumes the platform's identified connection-attempt
// transport. Keeping that boundary explicit lets a future generic accounts
// service replace the GitHub routes without another UI rewrite.

function DeviceFlowControl({
  flow,
  issue,
  userCode,
  verificationUri,
  onStart,
  onCancel,
  startLabel,
  retryLabel,
  buttonClassName,
}) {
  const [copyState, setCopyState] = useState('idle')

  useEffect(() => {
    setCopyState('idle')
  }, [userCode])

  const handleCopy = useCallback(async () => {
    setCopyState('copying')
    try {
      await copyDeviceCode(userCode)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [userCode])

  if (flow === 'starting') {
    return (
      <div className="co-conn-wait" aria-busy="true">
        <p className="co-conn-waiting" role="status" aria-live="polite">
          Starting GitHub sign-in…
        </p>
        <button
          type="button"
          className="co-btn co-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    )
  }

  if (flow === 'pending' || flow === 'cancelling') {
    const cancelling = flow === 'cancelling'
    return (
      <>
        <ol className="co-conn-steps">
          <li className="co-conn-step">
            <div className="co-conn-step-head">
              <span className="co-conn-step-number" aria-hidden="true">1</span>
              <div>
                <strong>Copy the code</strong>
                <small>You’ll paste it into GitHub in the next step.</small>
              </div>
            </div>
            <div className="co-conn-code-row">
              <code className="co-conn-code" aria-label="GitHub device code">
                {userCode}
              </code>
              <button
                type="button"
                className="co-btn co-btn-sm co-conn-copy"
                onClick={handleCopy}
                disabled={copyState === 'copying' || cancelling}
              >
                {copyState === 'copied'
                  ? 'Copied'
                  : (copyState === 'copying' ? 'Copying…' : 'Copy code')}
              </button>
            </div>
            <p
              className={copyState === 'failed' ? 'co-conn-error' : 'co-conn-copy-status'}
              role="status"
              aria-live="polite"
            >
              {copyState === 'copied'
                ? 'Code copied to your clipboard.'
                : (copyState === 'failed'
                    ? 'Couldn’t copy automatically. Press and hold the code to copy it.'
                    : '')}
            </p>
          </li>
          <li className="co-conn-step">
            <div className="co-conn-step-head">
              <span className="co-conn-step-number" aria-hidden="true">2</span>
              <div>
                <strong>Open GitHub and log in</strong>
                <small>Paste the code when GitHub asks for it.</small>
              </div>
            </div>
            <a
              className="co-btn co-btn-primary co-btn-block"
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open GitHub
            </a>
          </li>
        </ol>
        <div className="co-conn-wait" aria-busy="true">
          <p className="co-conn-waiting" role="status" aria-live="polite">
            {cancelling ? 'Cancelling GitHub sign-in…' : 'Waiting for GitHub…'}
          </p>
          <button
            type="button"
            className="co-btn co-btn-sm"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
        {issue?.message ? (
          <p className="co-conn-note" role="status" aria-live="polite">
            {issue.message}
          </p>
        ) : null}
      </>
    )
  }

  if (flow === 'complete') {
    return (
      <p className="co-conn-waiting" role="status" aria-live="polite">
        GitHub connected. Refreshing account status…
      </p>
    )
  }

  const canRetry = flow === 'failed' || flow === 'cancelled'
  const busy = flow === 'cancelling'
  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={onStart}
        disabled={busy}
        aria-busy={busy}
      >
        {flow === 'cancelling'
            ? 'Cancelling…'
            : (canRetry ? retryLabel : startLabel)}
      </button>
      {issue?.message ? (
        <p
          className={flow === 'cancelled' ? 'co-conn-note' : 'co-conn-error'}
          role={flow === 'cancelled' ? 'status' : 'alert'}
          aria-live={flow === 'cancelled' ? 'polite' : 'assertive'}
        >
          {issue.message}
        </p>
      ) : null}
    </>
  )
}

export function ConnectionCard({
  conn,
  token,
  onChanged,
  onRetry,
  deviceTransport,
  autopilotDefault = true,
  onToggleAutopilotDefault,
  submissionMethod = 'mobius',
  onChooseSubmissionMethod,
  submissionError = '',
}) {
  // Device-flow machine: idle | starting | pending | failed | cancelled |
  // complete.
  const [flow, setFlow] = useState('idle')
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [deviceIssue, setDeviceIssue] = useState(null)
  const [connectedLogin, setConnectedLogin] = useState('')
  const [justConnected, setJustConnected] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const [autopilotHelpOpen, setAutopilotHelpOpen] = useState(false)
  // Opt-in on the connect screen: request the broader `repo` scope so pushes to
  // the owner's PRIVATE repos succeed. Default off keeps least privilege.
  const [includePrivate, setIncludePrivate] = useState(false)
  const [accessMigration, setAccessMigration] = useState('idle')
  const [accessMigrationError, setAccessMigrationError] = useState('')
  const [statusRetrying, setStatusRetrying] = useState(false)
  const flowControllerRef = useRef(null)
  const accessMigrationRef = useRef(false)
  const attemptIdRef = useRef('')
  const pollGenRef = useRef(0)
  const connectedTimerRef = useRef(null)
  const keepConnectedRef = useRef(null)
  const autopilotHelpRef = useRef(null)
  const autopilotInfoRef = useRef(null)
  const transport = useMemo(
    () => deviceTransport || createGithubDeviceTransport(token),
    [deviceTransport, token],
  )

  const stopDeviceFlow = useCallback(() => {
    pollGenRef.current += 1
    flowControllerRef.current?.abort()
    flowControllerRef.current = null
  }, [])

  useEffect(() => {
    if (disconnectConfirm) keepConnectedRef.current?.focus()
  }, [disconnectConfirm])

  // Abort both provider I/O and delayed UI work on unmount.
  useEffect(() => () => {
    stopDeviceFlow()
    if (connectedTimerRef.current) clearTimeout(connectedTimerRef.current)
  }, [stopDeviceFlow])

  const finishConnected = useCallback(async (login) => {
    setFlow('complete')
    setConnectedLogin(login || '')
    setUserCode('')
    setVerificationUri('')
    setIncludePrivate(false)
    attemptIdRef.current = ''
    setDeviceIssue(null)
    setJustConnected(true)
    if (connectedTimerRef.current) clearTimeout(connectedTimerRef.current)
    connectedTimerRef.current = setTimeout(() => {
      connectedTimerRef.current = null
      setJustConnected(false)
    }, 3000)
    // Activation conversion for the device-flow funnel.
    window.mobius?.signal?.('github_connected')
    // Tell the parent so it re-fetches status and re-runs the live refresh
    // now that GitHub is reachable.
    await onChanged?.()
    // The parent connection probe remains the single authority. If another tab disconnected during this
    // refresh, returning to idle makes the reconnect UI immediately available.
    setFlow('idle')
  }, [onChanged])

  const startDeviceFlow = useCallback(async (
    existingAttempt = null,
    { privateRepos = false } = {},
  ) => {
    stopDeviceFlow()
    attemptIdRef.current = ''
    const controller = new AbortController()
    flowControllerRef.current = controller
    const myGen = pollGenRef.current
    setDeviceIssue(null)
    setUserCode('')
    setVerificationUri('')
    setFlow('starting')
    window.mobius?.signal?.('github_connect_started', {
      method: 'device',
      private_repos: privateRepos,
    })

    const result = await runDeviceConnection({
      transport,
      existingAttempt,
      privateRepos,
      signal: controller.signal,
      onPending: (started) => {
        if (
          myGen !== pollGenRef.current ||
          controller.signal.aborted
        ) return
        attemptIdRef.current = started.attemptId
        setUserCode(started.userCode)
        setVerificationUri(started.verificationUri)
        setFlow('pending')
      },
      onProgress: (progress) => {
        if (
          myGen !== pollGenRef.current ||
          controller.signal.aborted
        ) return
        setDeviceIssue(progress.lastError ? {
          code: 'provider_retry',
          message: progress.lastError === 'github_unreachable'
            ? 'GitHub was unreachable during the last check. Retrying…'
            : `GitHub reported ${progress.lastError}. Retrying…`,
          reason: progress.lastError,
          retryable: true,
        } : null)
      },
    })
    if (
      myGen !== pollGenRef.current ||
      controller.signal.aborted
    ) return
    flowControllerRef.current = null
    if (result.status === 'complete') {
      await finishConnected(result.login)
      return
    }
    // Keep terminal and unreachable attempts persisted for diagnosis. The
    // platform retains terminal states, and a deliberate retry starts a new
    // identified attempt that supersedes an abandoned waiting attempt.
    setDeviceIssue(result.issue)
    setFlow(result.status)
  }, [transport, stopDeviceFlow, finishConnected])

  // A persisted server attempt carries enough public context to survive a
  // backend restart, app navigation, reload, or second tab. The one settings
  // surface owns the disconnected flow.
  useEffect(() => {
    if (
      conn?.state !== 'disconnected'
      || flow !== 'idle'
      || !conn?.activeAttempt?.attemptId
    ) return
    startDeviceFlow(conn.activeAttempt)
  }, [
    conn?.activeAttempt,
    conn?.state,
    flow,
    startDeviceFlow,
  ])

  const cancelPending = useCallback(async () => {
    const attemptId = attemptIdRef.current
    stopDeviceFlow()
    if (!attemptId) {
      setFlow('cancelled')
      setUserCode('')
      setVerificationUri('')
      setDeviceIssue({
        code: 'cancelled',
        message:
          'GitHub sign-in cancelled. You can try again when you are ready.',
        reason: 'cancelled',
        retryable: true,
      })
      return
    }

    const controller = new AbortController()
    flowControllerRef.current = controller
    const myGen = pollGenRef.current
    setFlow('cancelling')
    setDeviceIssue(null)
    try {
      const result = await transport.cancel({
        attemptId,
        signal: controller.signal,
      })
      if (
        myGen !== pollGenRef.current ||
        controller.signal.aborted
      ) return
      attemptIdRef.current = ''
      flowControllerRef.current = null
      setUserCode('')
      setVerificationUri('')
      if (result.status === 'complete') {
        finishConnected(result.login)
        return
      }
      if (result.status !== 'cancelled') {
        setFlow('failed')
        setDeviceIssue({
          code: 'cancel_failed',
          message: result.reason
            ? `GitHub could not cancel this sign-in (${result.reason}).`
            : 'GitHub could not confirm that sign-in was cancelled.',
          reason: result.reason || result.status || '',
          retryable: true,
        })
        return
      }
      setFlow('cancelled')
      setDeviceIssue({
        code: 'cancelled',
        message:
          'GitHub sign-in cancelled. You can try again when you are ready.',
        reason: result.reason || 'cancelled',
        retryable: true,
      })
    } catch (error) {
      if (
        myGen !== pollGenRef.current ||
        controller.signal.aborted
      ) return
      flowControllerRef.current = null
      setFlow('failed')
      setDeviceIssue({
        code: error?.code || 'cancel_failed',
        message: error?.message || 'Could not cancel GitHub sign-in.',
        reason: error?.reason || '',
        retryable: true,
      })
    }
  }, [transport, stopDeviceFlow, finishConnected])

  const doDisconnect = useCallback(async () => {
    // A workflow-upgrade attempt can coexist with the connected account menu.
    // Stop its local poll before clearing both credentials and attempts.
    stopDeviceFlow()
    setDisconnectError('')
    setDisconnecting(true)
    try {
      const res = await disconnect(token)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status >= 500) {
          const status = await Promise.resolve(onChanged?.()).catch(() => null)
          if (status?.state === 'disconnected') {
            setDisconnectConfirm(false)
            setFlow('idle')
            setConnectedLogin('')
            attemptIdRef.current = ''
            return
          }
        }
        setDisconnectError(data.detail || 'Could not disconnect.')
        return
      }
      setDisconnectConfirm(false)
      setFlow('idle')
      setConnectedLogin('')
      attemptIdRef.current = ''
      await onChanged?.()
    } catch (error) {
      // DELETE is idempotent, but a timeout can hide a successful server-side
      // disconnect. Reconcile status before presenting the action as failed.
      const status = await Promise.resolve(onChanged?.()).catch(() => null)
      if (status?.state === 'disconnected') {
        setDisconnectConfirm(false)
        setFlow('idle')
        setConnectedLogin('')
        attemptIdRef.current = ''
        return
      }
      setDisconnectError(
        error?.code === 'request_timeout'
          ? error.message
          : 'Could not reach the GitHub connection service.',
      )
    } finally {
      setDisconnecting(false)
    }
  }, [token, onChanged, stopDeviceFlow])

  const migrateLimitedConnection = useCallback(async () => {
    if (accessMigrationRef.current) return
    accessMigrationRef.current = true
    stopDeviceFlow()
    setAccessMigration('disconnecting')
    setAccessMigrationError('')
    try {
      const res = await disconnect(token)
      if (!res.ok) {
        const status = await Promise.resolve(onChanged?.()).catch(() => null)
        if (status?.state !== 'disconnected') {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || 'Could not reset GitHub access.')
        }
      } else {
        await onChanged?.()
      }
      setAccessMigration('required')
      window.mobius?.signal?.('github_access_reconnect_required')
    } catch (error) {
      setAccessMigration('failed')
      setAccessMigrationError(
        error?.message || 'Could not reset GitHub access.',
      )
      accessMigrationRef.current = false
    }
  }, [token, onChanged, stopDeviceFlow])

  // Full PR access is now the connection contract. Existing public_repo-only
  // credentials cannot be elevated silently by GitHub, so retire them once
  // when Contribute opens and let the owner authorize the complete scope set.
  // The one settings surface owns this migration.
  useEffect(() => {
    if (
      conn?.state !== 'connected'
      || hasFullPrAccess(conn?.scopes)
    ) return
    migrateLimitedConnection()
  }, [
    conn?.scopes,
    conn?.state,
    migrateLimitedConnection,
  ])

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
      if (!autopilotHelpRef.current?.contains(event.target)) {
        setAutopilotHelpOpen(false)
      }
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

  // The probe failed. Keep the feed usable, but do not hide the failed
  // connection check or leave a permanent "Checking…" spinner.
  if (state === 'unknown') {
    return (
      <div className="co-conn" role="status" aria-live="polite">
        <span className="co-conn-dot is-warn" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">GitHub status unavailable</p>
          <p className="co-conn-text">
            {conn?.message ||
              'Contribute could not reach the GitHub connection service.'}
            {' '}Your saved contribution feed is still available.
          </p>
          <div className="co-conn-actions">
            <button
              type="button"
              className="co-btn co-btn-sm"
              onClick={retryStatus}
              disabled={statusRetrying}
              aria-busy={statusRetrying}
            >
              {statusRetrying ? 'Checking…' : 'Check GitHub again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const statusConnected = state === 'connected'
  if (statusConnected && !hasFullPrAccess(conn?.scopes)) {
    return (
      <div className="co-conn" role="status" aria-live="polite">
        <span className="co-conn-dot is-warn" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">Updating GitHub access</p>
          <p className="co-conn-text">
            Contribute now connects with full PR access so workflow changes and
            stale forks do not interrupt reviewed sends. Your older connection
            is being signed out; reconnect once to approve the updated access.
          </p>
          {accessMigration === 'failed' ? (
            <div className="co-conn-actions">
              <button
                type="button"
                className="co-btn co-btn-sm"
                onClick={migrateLimitedConnection}
              >
                Try signing out again
              </button>
              <p className="co-conn-error" role="alert">
                {accessMigrationError}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (state === 'unsupported') {
    return (
      <div className="co-conn">
        <span className="co-conn-dot is-warn" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">Platform update needed</p>
          <p className="co-conn-text">
            This Möbius version predates GitHub support. Update Möbius, then
            return here to connect GitHub.
          </p>
        </div>
      </div>
    )
  }

  if (statusConnected) {
    const login = connectedLogin || conn?.login || 'your account'
    const workflowEnabled = hasFullPrAccess(conn?.scopes)
    const privateEnabled = hasPrivateRepoAccess(conn?.scopes)
    return (
      <div className="co-conn is-connected">
        <p className="co-account-login"><Icon name="github" size={18} /> {justConnected ? 'Connected' : login}</p>
        <div className="co-conn-settings" role="group" aria-label="Contribution settings">
            {submissionMethod === 'github' && conn?.autopilotAvailable &&
              typeof onToggleAutopilotDefault === 'function' && (
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
                    <p
                      id="co-follow-sent-prs-help"
                      className="co-setting-popover"
                      role="tooltip"
                    >
                      Follows sent PRs through checks and review, addresses comments automatically, and asks when it needs you.
                    </p>
                  ) : null}
                </div>
                <span className="co-setting-switch">
                  <input
                    id="co-follow-sent-prs"
                    type="checkbox"
                    checked={autopilotDefault}
                    onChange={(event) => (
                      onToggleAutopilotDefault(event.target.checked)
                    )}
                  />
                  <i aria-hidden="true" />
                </span>
              </div>
            )}
            {typeof onChooseSubmissionMethod === 'function' && (
              <div className="co-method-setting">
                <strong>Send Möbius contributions as</strong>
                <div
                  className="co-method-options"
                  role="group"
                  aria-label="Contribution path"
                >
                  <button
                    type="button"
                    className={submissionMethod === 'mobius' ? 'is-active' : ''}
                    aria-pressed={submissionMethod === 'mobius'}
                    onClick={() => onChooseSubmissionMethod('mobius')}
                  >
                    <Icon name="merge" size={14} />
                    <span>Möbius</span>
                  </button>
                  <button
                    type="button"
                    className={submissionMethod === 'github' ? 'is-active' : ''}
                    aria-pressed={submissionMethod === 'github'}
                    onClick={() => onChooseSubmissionMethod('github')}
                  >
                    <Icon name="github" size={14} />
                    <span>{login}</span>
                  </button>
                </div>
              </div>
            )}
            {submissionError ? <div role="alert"><p className="co-conn-error">{submissionError}</p><button type="button" className="co-btn co-btn-sm" onClick={() => onChooseSubmissionMethod(submissionMethod)}>Save choice again</button></div> : null}
            {submissionMethod === 'github' && workflowEnabled && (
              !privateEnabled ? (
                <div className="co-private-setting">
                  <strong>Private repositories</strong>
                  <DeviceFlowControl
                    flow={flow}
                    issue={deviceIssue}
                    userCode={userCode}
                    verificationUri={verificationUri}
                    onStart={() => startDeviceFlow(null, { privateRepos: true })}
                    onCancel={cancelPending}
                    startLabel="Add access"
                    retryLabel="Try GitHub again"
                    buttonClassName="co-btn co-btn-sm"
                  />
                </div>
              ) : null
            )}
            {disconnectError && (
              <p className="co-conn-error" role="status" aria-live="polite">{disconnectError}</p>
            )}
            <div className="co-conn-actions">
              {disconnectConfirm ? (
                <div className="co-disconnect-confirm" role="alertdialog" aria-label="Disconnect GitHub">
                  <p>Disconnect GitHub from Contribute? Your drafts and review history stay here.</p>
                  <div className="co-confirm-actions">
                    <button
                      type="button"
                      ref={keepConnectedRef}
                      className="co-btn co-btn-sm"
                      onClick={() => setDisconnectConfirm(false)}
                      disabled={disconnecting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="co-btn co-btn-sm co-btn-danger"
                      onClick={doDisconnect}
                      disabled={disconnecting}
                    >
                      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="co-btn co-btn-sm co-btn-danger"
                  onClick={() => { setDisconnectError(''); setDisconnectConfirm(true) }}
                >
                  Disconnect GitHub
                </button>
              )}
            </div>
        </div>
      </div>
    )
  }

  const deviceFlowAvailable = !!conn?.deviceFlowAvailable
  return (
    <div className="co-conn is-column">
      <div className="co-account-default"><Icon name="check" size={18} /><div><strong>Möbius</strong><small>For Möbius projects. No GitHub needed.</small></div></div>
      <div className="co-github-upgrade">
        <strong>Connect GitHub</strong>
        <p className="co-conn-note">Collaborate on community projects and send as yourself.</p>
      </div>
      {accessMigration === 'required' ? <p className="co-conn-note">Reconnect to approve the updated access.</p> : null}
      {deviceFlowAvailable ? (
        <div className="co-conn-device">
          <DeviceFlowControl
            flow={flow} issue={deviceIssue} userCode={userCode} verificationUri={verificationUri}
            onStart={() => startDeviceFlow(null, { privateRepos: includePrivate })}
            onCancel={cancelPending}
            startLabel={includePrivate ? 'Connect with private-repo access' : 'Connect with GitHub'}
            retryLabel="Try GitHub again" buttonClassName="co-btn co-btn-primary co-btn-block"
          />
          {(flow === 'idle' || flow === 'failed' || flow === 'cancelled') ? (
            <details className="co-account-advanced">
              <summary>Private repositories <Icon name="chevron" size={14} /></summary>
              <label className="co-autopilot-setting"><input type="checkbox" checked={includePrivate} onChange={event => setIncludePrivate(event.target.checked)} /><span>Include private repositories</span></label>
              <p className="co-conn-note">Grants access to private GitHub repositories. Leave off for public projects.</p>
            </details>
          ) : null}
        </div>
      ) : <p className="co-conn-note" role="status">GitHub sign-in is not configured for this Möbius instance.</p>}
    </div>
  )
}
