import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectToken, disconnect } from '../api.js'
import {
  createGithubDeviceTransport,
  runDeviceConnection,
} from '../github-connection.js'
import { Icon } from './Icons.jsx'

// The GitHub connection card — the FULL connect flow, owned by this app (the
// platform's connect endpoints accept this app's github_connect token). Four
// top-level states off fetchGithubStatus:
//
//   checking     — the initial status probe is still in flight
//   unsupported  — /api/github/status 404s (platform predates GitHub support)
//   unknown      — the probe failed (offline / restarting); render a retryable
//                  status while the feed continues to show from cache
//   connected    — "Connected as <login>" + an inline-confirm Disconnect
//   disconnected — the connect UI: device flow (when device_flow_available) and
//                  a classic-PAT fallback (always)
//
// The state machine consumes the platform's identified connection-attempt
// transport. Keeping that boundary explicit lets a future generic accounts
// service replace the GitHub routes without another UI rewrite.

const TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=public_repo&description=Mobius'

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
        <p className="co-conn-hint">
          Open{' '}
          <a href={verificationUri} target="_blank" rel="noopener noreferrer">
            {verificationUri || 'github.com/login/device'}
          </a>
          {' '}and enter this code:
        </p>
        <div className="co-conn-code" aria-label="GitHub device code">
          {userCode}
        </div>
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
  placement = 'content',
  deviceTransport,
}) {
  // Device-flow machine: idle | starting | pending | failed | cancelled |
  // complete. PAT submission is independent state so the token form works
  // while a device flow is pending.
  const [flow, setFlow] = useState('idle')
  const [flowPurpose, setFlowPurpose] = useState('standard')
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [deviceIssue, setDeviceIssue] = useState(null)
  const [pat, setPat] = useState('')
  const [patSubmitting, setPatSubmitting] = useState(false)
  const [patError, setPatError] = useState('')
  const [connectedLogin, setConnectedLogin] = useState('')
  const [justConnected, setJustConnected] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The classic-PAT form is collapsed behind a disclosure when the device flow
  // is available, so the default connect view is just the one-tap button.
  const [patOpen, setPatOpen] = useState(false)
  const [statusRetrying, setStatusRetrying] = useState(false)
  const patInputRef = useRef(null)
  const flowControllerRef = useRef(null)
  const attemptIdRef = useRef('')
  const pollGenRef = useRef(0)
  const connectedTimerRef = useRef(null)
  const transport = useMemo(
    () => deviceTransport || createGithubDeviceTransport(token),
    [deviceTransport, token],
  )

  const stopDeviceFlow = useCallback(() => {
    pollGenRef.current += 1
    flowControllerRef.current?.abort()
    flowControllerRef.current = null
  }, [])

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
    attemptIdRef.current = ''
    setPat('')
    setDeviceIssue(null)
    setJustConnected(true)
    if (connectedTimerRef.current) clearTimeout(connectedTimerRef.current)
    connectedTimerRef.current = setTimeout(() => {
      connectedTimerRef.current = null
      setJustConnected(false)
    }, 3000)
    // Activation conversion — both the device flow and the PAT path funnel
    // through here, so one signal covers the bottom of the connect funnel.
    window.mobius?.signal?.('github_connected')
    // Tell the parent so it re-fetches status and re-runs the live refresh
    // now that GitHub is reachable.
    await onChanged?.()
    // The parent connection probe is the single authority shared by the
    // toolbar and content placements. If another tab disconnected during this
    // refresh, returning to idle makes the reconnect UI immediately available.
    setFlow('idle')
  }, [onChanged])

  const startDeviceFlow = useCallback(async (
    workflow = false,
    existingAttempt = null,
  ) => {
    stopDeviceFlow()
    attemptIdRef.current = ''
    const controller = new AbortController()
    flowControllerRef.current = controller
    const myGen = pollGenRef.current
    setDeviceIssue(null)
    setUserCode('')
    setVerificationUri('')
    setFlowPurpose(workflow ? 'workflow' : 'standard')
    setFlow('starting')
    window.mobius?.signal?.('github_connect_started', {
      method: 'device',
      workflow,
    })

    const result = await runDeviceConnection({
      transport,
      existingAttempt,
      workflow,
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
  // backend restart, app navigation, reload, or second tab. Only the content
  // placement owns the disconnected flow, so two mounted views never start
  // competing poll loops.
  useEffect(() => {
    if (
      placement === 'toolbar'
      || conn?.state !== 'disconnected'
      || flow !== 'idle'
      || !conn?.activeAttempt?.attemptId
    ) return
    startDeviceFlow(false, conn.activeAttempt)
  }, [
    conn?.activeAttempt,
    conn?.state,
    flow,
    placement,
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

  const submitPat = useCallback(async (e) => {
    e.preventDefault()
    const value = pat.trim()
    if (!value) {
      setPatError('Enter a GitHub personal access token.')
      patInputRef.current?.focus()
      return
    }
    setPatError('')
    setPatSubmitting(true)
    window.mobius?.signal?.('github_connect_started', { method: 'pat' })
    try {
      const res = await connectToken(token, value)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status >= 500) {
          const status = await Promise.resolve(onChanged?.()).catch(() => null)
          if (status?.state === 'connected') {
            stopDeviceFlow()
            setPat('')
            window.mobius?.signal?.('github_connected')
            return
          }
        }
        setPatError(data.detail || 'Could not connect with that token.')
        return
      }
      const data = await res.json()
      // A PAT can land while a device poll is mid-flight — bump the generation
      // so a late poll resolution can't overwrite this success.
      stopDeviceFlow()
      await finishConnected(data.login)
    } catch (error) {
      // The server may have committed the credential before the response was
      // lost. Re-read the account authority before inviting a duplicate retry.
      const status = await Promise.resolve(onChanged?.()).catch(() => null)
      if (status?.state === 'connected') {
        stopDeviceFlow()
        setPat('')
        setPatError('')
        window.mobius?.signal?.('github_connected')
        return
      }
      setPatError(
        error?.code === 'request_timeout'
          ? error.message
          : 'Could not reach the GitHub connection service.',
      )
    } finally {
      setPatSubmitting(false)
    }
  }, [pat, token, stopDeviceFlow, finishConnected])

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

  const retryStatus = useCallback(async () => {
    if (statusRetrying) return
    setStatusRetrying(true)
    try {
      await (onRetry || onChanged)?.()
    } finally {
      setStatusRetrying(false)
    }
  }, [statusRetrying, onRetry, onChanged])

  const state = conn?.state

  if (state === 'checking') return null

  // The probe failed. Keep the feed usable, but do not hide the failed
  // connection check or leave a permanent "Checking…" spinner.
  if (state === 'unknown') {
    if (placement === 'toolbar') return null
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

  // Connected account controls belong in the top toolbar; setup and platform
  // warnings remain in the contribution content where their copy has room.
  const statusConnected = state === 'connected'
  if (placement === 'toolbar' && !statusConnected) return null
  if (placement !== 'toolbar' && statusConnected) return null

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
    const workflowEnabled = conn?.scopes?.includes('workflow')
    const workflowFlow = flowPurpose === 'workflow'
    return (
      <div className={'co-conn is-connected is-toolbar' + (settingsOpen ? ' is-open' : '')}>
        <button
          type="button"
          className="co-github-menu"
          aria-expanded={settingsOpen}
          aria-label={`${settingsOpen ? 'Close' : 'Open'} GitHub settings for ${login}`}
          title={settingsOpen ? 'Close GitHub settings' : 'GitHub account and settings'}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Icon name="github" size={17} />
          <span>{justConnected ? 'Connected' : login}</span>
          <Icon name="settings" size={15} />
        </button>

        {settingsOpen && (
          <div className="co-conn-settings">
            <p className="co-conn-hint">
              Reviewed PRs publish through <strong>{login}</strong>. Public actions
              still require your explicit approval.
            </p>
            {workflowEnabled ? (
              <p className="co-conn-hint">
                Workflow access is enabled for reviewed workflow changes and
                safe fast-forwards of stale forks.
              </p>
            ) : (
              <div className="co-conn-device">
                <p className="co-conn-hint">
                  Workflow access is optional. It is only needed for reviewed
                  workflow changes or to safely update a stale fork.
                </p>
                <DeviceFlowControl
                  flow={workflowFlow ? flow : 'idle'}
                  issue={workflowFlow ? deviceIssue : null}
                  userCode={userCode}
                  verificationUri={verificationUri}
                  onStart={() => startDeviceFlow(true)}
                  onCancel={cancelPending}
                  startLabel="Enable workflow access"
                  retryLabel="Try enabling workflow access again"
                  buttonClassName="co-btn co-btn-sm"
                />
              </div>
            )}
            {disconnectError && (
              <p className="co-conn-error" role="status" aria-live="polite">{disconnectError}</p>
            )}
            <div className="co-conn-actions">
              {disconnectConfirm ? (
                <>
                  <button
                    type="button"
                    className="co-btn co-btn-sm"
                    onClick={() => setDisconnectConfirm(false)}
                    disabled={disconnecting}
                  >
                    Keep connected
                  </button>
                  <button
                    type="button"
                    className="co-btn co-btn-sm co-btn-danger"
                    onClick={doDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
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
        )}
      </div>
    )
  }

  // Disconnected — the connect flow. Device flow when the server offers it,
  // classic-PAT fallback always. When the device flow IS available the PAT form
  // is collapsed behind an "Advanced" disclosure so the default view is one tap;
  // when it is the only path, the form stays open as before.
  const deviceFlowAvailable = !!conn?.deviceFlowAvailable
  const patForm = (
    <form className="co-conn-pat" onSubmit={submitPat}>
      <p className="co-conn-hint">
        Paste a <strong>classic</strong> personal access token with the{' '}
        <code>public_repo</code> scope (
        <a href={TOKEN_CREATE_URL} target="_blank" rel="noopener noreferrer">
          create one
        </a>
        ).
      </p>
      <div className="co-conn-form">
        <input
          ref={patInputRef}
          className="co-conn-input"
          type="password"
          name="github-token"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!patError}
          aria-describedby={patError ? 'co-github-token-error' : undefined}
          aria-label="GitHub personal access token"
        />
        <button
          className="co-btn co-btn-primary co-btn-block"
          type="submit"
          disabled={patSubmitting}
        >
          {patSubmitting ? 'Connecting…' : 'Connect with token'}
        </button>
      </div>
      {patError && (
        <p id="co-github-token-error" className="co-conn-error" role="status" aria-live="polite">
          {patError}
        </p>
      )}
    </form>
  )
  return (
    <div className="co-conn is-column">
      <div className="co-conn-row">
        <span className="co-conn-dot is-accent" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">Connect GitHub to contribute</p>
          <p className="co-conn-text">
            When your agent improves a Möbius app or the platform, it can share
            that fix upstream so it ships to everyone. Connect your GitHub
            account to turn that on — your agent still asks before every public
            action.
          </p>
        </div>
      </div>

      {deviceFlowAvailable && (
        <div className="co-conn-device">
          <DeviceFlowControl
            flow={flow}
            issue={deviceIssue}
            userCode={userCode}
            verificationUri={verificationUri}
            onStart={() => startDeviceFlow(false)}
            onCancel={cancelPending}
            startLabel="Connect with GitHub"
            retryLabel="Try GitHub again"
            buttonClassName="co-btn co-btn-primary co-btn-block"
          />
        </div>
      )}

      {deviceFlowAvailable ? (
        <div className="co-conn-advanced">
          <button
            type="button"
            className="co-conn-advanced-toggle"
            aria-expanded={patOpen}
            onClick={() => setPatOpen((open) => !open)}
          >
            Advanced: use a token instead
          </button>
          {patOpen ? patForm : null}
        </div>
      ) : (
        patForm
      )}
    </div>
  )
}
