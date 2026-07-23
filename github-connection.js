import { connectCancel, connectPoll, connectStart } from './api.js'

const DEFAULT_INTERVAL_SECONDS = 5
const DEFAULT_EXPIRES_IN_SECONDS = 900
// A start/cancel can wait behind one in-flight provider poll (up to 30s) and
// then perform its own 15s provider request. Leave real scheduling/network
// headroom above that server-side ceiling so the client does not abort exactly
// as the serialized operation completes.
const DEFAULT_REQUEST_TIMEOUT_MS = 60000
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3

export class ConnectionAttemptError extends Error {
  constructor(message, {
    code = 'connection_error',
    reason = '',
    retryable = false,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ConnectionAttemptError'
    this.code = code
    this.reason = reason
    this.retryable = retryable
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('The GitHub sign-in attempt was cancelled.')
  error.name = 'AbortError'
  return error
}

export function waitForPoll(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, ms))
    function done() {
      signal?.removeEventListener('abort', cancelled)
      resolve()
    }
    function cancelled() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancelled)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', cancelled, { once: true })
  })
}

function detailFromBody(body, fallback) {
  if (typeof body?.detail === 'string' && body.detail.trim()) {
    return body.detail.trim()
  }
  if (typeof body?.detail?.message === 'string' && body.detail.message.trim()) {
    return body.detail.message.trim()
  }
  if (typeof body?.message === 'string' && body.message.trim()) {
    return body.message.trim()
  }
  return fallback
}

async function responseError(response, fallback) {
  const body = await response.json().catch(() => ({}))
  const message = detailFromBody(body, fallback)
  const status = Number(response.status) || 0
  return new ConnectionAttemptError(message, {
    code: 'backend_error',
    reason: typeof body?.reason === 'string' ? body.reason : '',
    retryable: status === 0 || status === 408 || status === 429 || status >= 500,
  })
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Adapts the platform's identified /api/github/connect/* attempts to the small
// transport contract consumed by runDeviceConnection. A future generic
// window.mobius.accounts service can replace this adapter without changing the
// connection state machine or its UI.
export function createGithubDeviceTransport(
  token,
  { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  return {
    async start({ workflow = false, signal } = {}) {
      const response = await connectStart(token, {
        workflow,
        signal,
        timeoutMs: requestTimeoutMs,
      })
      if (!response.ok) {
        throw await responseError(response, 'Could not start GitHub sign-in.')
      }
      const body = await response.json().catch(() => ({}))
      if (!body.attempt_id || !body.user_code || !body.verification_uri) {
        throw new ConnectionAttemptError(
          'GitHub sign-in started without complete attempt details. Please try again.',
          { code: 'invalid_start_response' },
        )
      }
      return {
        attemptId: String(body.attempt_id),
        userCode: String(body.user_code),
        verificationUri: String(body.verification_uri),
        intervalMs:
          positiveNumber(body.interval, DEFAULT_INTERVAL_SECONDS) * 1000,
        expiresInMs:
          positiveNumber(body.expires_in, DEFAULT_EXPIRES_IN_SECONDS) * 1000,
        expiresAtMs:
          positiveNumber(body.expires_at, 0) * 1000,
      }
    },

    async poll({ attemptId, signal } = {}) {
      const response = await connectPoll(token, attemptId, {
        signal,
        timeoutMs: requestTimeoutMs,
      })
      if (!response.ok) {
        throw await responseError(response, 'Could not check GitHub sign-in.')
      }
      const body = await response.json().catch(() => ({}))
      if (body.attempt_id && body.attempt_id !== attemptId) {
        throw new ConnectionAttemptError(
          'GitHub returned a different connection attempt.',
          { code: 'attempt_mismatch' },
        )
      }
      return {
        status: typeof body.status === 'string' ? body.status : '',
        login: typeof body.login === 'string' ? body.login : '',
        reason: typeof body.reason === 'string' ? body.reason : '',
        message: detailFromBody(body, ''),
        retryAfterMs:
          positiveNumber(body.retry_after, 0) * 1000,
        lastError:
          typeof body.last_error === 'string' ? body.last_error : '',
      }
    },

    async cancel({ attemptId, signal } = {}) {
      const response = await connectCancel(token, attemptId, {
        signal,
        timeoutMs: requestTimeoutMs,
      })
      if (!response.ok) {
        throw await responseError(
          response,
          'Could not cancel GitHub sign-in.',
        )
      }
      const body = await response.json().catch(() => ({}))
      if (body.attempt_id && body.attempt_id !== attemptId) {
        throw new ConnectionAttemptError(
          'GitHub cancelled a different connection attempt.',
          { code: 'attempt_mismatch' },
        )
      }
      return {
        status: typeof body.status === 'string' ? body.status : '',
        reason: typeof body.reason === 'string' ? body.reason : '',
        login: typeof body.login === 'string' ? body.login : '',
      }
    },
  }
}

function providerFailure(poll) {
  if (poll.message) return poll.message
  if (poll.reason === 'access_denied') return 'GitHub sign-in was denied.'
  if (poll.reason === 'expired_token') {
    return 'GitHub sign-in expired. Please try again.'
  }
  if (poll.reason) return `GitHub sign-in failed (${poll.reason}).`
  return 'GitHub sign-in failed. Please try again.'
}

function issueFromError(error, fallback) {
  if (error instanceof ConnectionAttemptError) {
    return {
      code: error.code,
      message: error.message,
      reason: error.reason,
      retryable: error.retryable,
    }
  }
  if (error?.code === 'request_timeout') {
    return {
      code: 'request_timeout',
      message: error.message || 'The GitHub sign-in request timed out.',
      reason: '',
      retryable: true,
    }
  }
  return {
    code: 'network_error',
    message: error?.message || fallback,
    reason: '',
    retryable: true,
  }
}

// Runs exactly one provider request at a time. Both the wall-clock expiry and
// an attempt cap bound the loop even when every request fails. The transport
// owns request deadlines; the caller owns cancellation via AbortSignal.
export async function runDeviceConnection({
  transport,
  existingAttempt = null,
  workflow = false,
  signal,
  onPending = () => {},
  onProgress = () => {},
  wait = waitForPoll,
  now = Date.now,
  maxConsecutiveErrors = DEFAULT_MAX_CONSECUTIVE_ERRORS,
}) {
  try {
    const started = existingAttempt
      || await transport.start({ workflow, signal })
    if (signal?.aborted) {
      return { status: 'cancelled', issue: null }
    }
    onPending(started)

    const intervalMs = positiveNumber(
      started.intervalMs,
      DEFAULT_INTERVAL_SECONDS * 1000,
    )
    const expiresInMs = positiveNumber(
      started.expiresInMs,
      DEFAULT_EXPIRES_IN_SECONDS * 1000,
    )
    // Measure the browser-side safety deadline from the server-provided
    // duration. Comparing a server epoch to Date.now() makes a skewed device
    // clock expire a healthy attempt immediately.
    const expiresAt = now() + expiresInMs
    const remainingMs = Math.max(0, expiresAt - now())
    const maxAttempts = Math.ceil(remainingMs / intervalMs) + 2
    let nextPollMs = intervalMs
    let attempts = 0
    let consecutiveErrors = 0
    let lastIssue = null

    while (attempts < maxAttempts && now() < expiresAt) {
      await wait(Math.min(nextPollMs, Math.max(0, expiresAt - now())), signal)
      if (signal?.aborted) {
        return { status: 'cancelled', issue: null }
      }
      if (now() >= expiresAt) break

      attempts += 1
      let poll
      try {
        // Sequential by construction: the next wait is scheduled only after
        // this request and its response parsing have settled.
        poll = await transport.poll({
          attemptId: started.attemptId,
          signal,
        })
        consecutiveErrors = 0
        lastIssue = null
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          return { status: 'cancelled', issue: null }
        }
        lastIssue = issueFromError(
          error,
          'A network error interrupted GitHub sign-in.',
        )
        if (!lastIssue.retryable) {
          return { status: 'failed', issue: lastIssue }
        }
        consecutiveErrors += 1
        if (consecutiveErrors >= maxConsecutiveErrors) {
          return { status: 'failed', issue: lastIssue }
        }
        continue
      }

      if (poll.status === 'pending') {
        nextPollMs = positiveNumber(poll.retryAfterMs, intervalMs)
        onProgress(poll)
        continue
      }
      if (poll.status === 'complete') {
        return { status: 'complete', login: poll.login || '' }
      }
      if (poll.status === 'failed') {
        return {
          status: 'failed',
          issue: {
            code: 'provider_failed',
            message: providerFailure(poll),
            reason: poll.reason || '',
            retryable: true,
          },
        }
      }
      if (poll.status === 'expired') {
        return {
          status: 'failed',
          issue: {
            code: 'expired',
            message: poll.message || 'GitHub sign-in expired. Please try again.',
            reason: poll.reason || 'expired_token',
            retryable: true,
          },
        }
      }
      if (poll.status === 'cancelled') {
        return {
          status: 'cancelled',
          issue: {
            code: 'cancelled',
            message: poll.message || 'GitHub sign-in was cancelled.',
            reason: poll.reason || 'cancelled',
            retryable: true,
          },
        }
      }
      if (poll.status === 'none') {
        return {
          status: 'failed',
          issue: {
            code: 'session_lost',
            message:
              poll.message ||
              'The GitHub sign-in session was lost. Please try again.',
            reason: poll.reason || 'none',
            retryable: true,
          },
        }
      }
      return {
        status: 'failed',
        issue: {
          code: 'unknown_status',
          message: poll.status
            ? `GitHub returned an unknown sign-in state (${poll.status}).`
            : 'GitHub returned an invalid sign-in response.',
          reason: poll.status || '',
          retryable: true,
        },
      }
    }

    return {
      status: 'failed',
      issue: lastIssue || {
        code: 'expired',
        message: 'GitHub sign-in timed out. Please try again.',
        reason: 'expired',
        retryable: true,
      },
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return { status: 'cancelled', issue: null }
    }
    return {
      status: 'failed',
      issue: issueFromError(error, 'Could not start GitHub sign-in.'),
    }
  }
}
