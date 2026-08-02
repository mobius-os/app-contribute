// Same-origin fetch helpers for the platform's GitHub surface. The GitHub
// token never reaches this app: /api/github/* holds it server-side, and the
// manifest's github_access permission gates data/reviewed-submit calls, while
// github_connect separately gates credential status and mutation. Read helpers
// degrade to a quiet fallback
// so the feed still renders from the ledger when GitHub is unreachable; the
// connect helpers return the raw Response so the connection card can branch
// on res.ok and surface the server's error detail verbatim.

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token }
}

// Background reads must never hold the interface in "checking" forever when
// the platform restarts mid-request. Public mutation calls deliberately do NOT
// use this helper: aborting a Send client-side could hide a successful upstream
// action and invite an unsafe retry.
async function fetchRead(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Device authorization is safe to retry, but a request that never settles
// must not pin the connection UI forever. Compose the caller's cancellation
// signal with a local deadline without relying on AbortSignal.any(), which is
// not available in every WebView supported by the app frame.
async function fetchWithDeadline(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController()
  const callerSignal = options.signal
  let timedOut = false
  const cancelFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) cancelFromCaller()
  else callerSignal?.addEventListener('abort', cancelFromCaller, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(
        'The GitHub sign-in request timed out. Please try again.',
      )
      timeoutError.name = 'TimeoutError'
      timeoutError.code = 'request_timeout'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', cancelFromCaller)
  }
}

async function responseDetail(response, fallback) {
  const body = await response.json().catch(() => ({}))
  if (typeof body?.detail === 'string' && body.detail.trim()) {
    return body.detail.trim()
  }
  if (typeof body?.detail?.message === 'string' && body.detail.message.trim()) {
    return body.detail.message.trim()
  }
  return fallback
}

// Resolves the connection card's state and carries the fields the connect
// flow needs (device_flow_available, login). 404 means the platform predates
// the GitHub surface entirely — a distinct, actionable message.
export async function fetchGithubStatus(token) {
  try {
    const r = await fetchRead('/api/github/status', { headers: authHeaders(token) })
    if (r.status === 404) return { state: 'unsupported' }
    if (!r.ok) {
      return {
        state: 'unknown',
        status: r.status,
        message: await responseDetail(
          r,
          `Could not check GitHub connection (HTTP ${r.status}).`,
        ),
      }
    }
    const s = await r.json()
    const active = s?.active_attempt
    const activeAttempt = active?.attempt_id
      && active?.user_code
      && active?.verification_uri
      ? {
          attemptId: String(active.attempt_id),
          userCode: String(active.user_code),
          verificationUri: String(active.verification_uri),
          intervalMs: Math.max(1, Number(active.interval) || 5) * 1000,
          expiresAtMs: Math.max(0, Number(active.expires_at) || 0) * 1000,
          expiresInMs: Math.max(0, Number(active.expires_in) || 0) * 1000,
        }
      : null
    return {
      state: s.connected ? 'connected' : 'disconnected',
      login: s.login || '',
      scopes: Array.isArray(s.scopes) ? s.scopes : [],
      deviceFlowAvailable: !!s.device_flow_available,
      activeAttempt,
      autopilotAvailable: s.autopilot_available === true,
    }
  } catch (error) {
    // Network failure (offline, backend restarting) — not a platform verdict.
    return {
      state: 'unknown',
      status: 0,
      message: error?.name === 'AbortError'
        ? 'The GitHub connection check timed out.'
        : 'Could not reach the GitHub connection service.',
    }
  }
}

// Fetch-free local Git metadata for the Sources view. The endpoint is narrow:
// refs, ancestry/diff magnitudes, working-tree counts, and bounded path names —
// never source contents or absolute paths. A failure leaves the contribution
// feed usable and lets the Sources view offer an explicit retry.
export async function fetchSourceStatus(token) {
  try {
    const r = await fetchRead('/api/github/source-status', {
      headers: authHeaders(token),
    })
    if (!r.ok) {
      return {
        ok: false,
        unsupported: r.status === 404,
        status: r.status,
      }
    }
    const body = await r.json()
    return { ok: true, data: body }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

// Read-only local validation for every prepared review. This catches branch,
// worktree, and stored-diff drift before the owner reaches the public Send
// action. A failed check keeps the feed usable and preserves any stronger
// submit error already persisted on the record.
export async function fetchReviewStatus(token, appId) {
  try {
    const r = await fetchRead(
      '/api/github/contributions/' + encodeURIComponent(appId) + '/review-status',
      { headers: authHeaders(token) },
    )
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
      }
    }
    const body = await r.json()
    return { ok: true, data: body }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

// POSTs one read-only GraphQL document; returns response.data or null.
// Callers leave records stale on null — the refresh is best-effort polish,
// and GitHub returns null nodes (not errors) for anything inaccessible.
export async function fetchLiveStates(token, query) {
  try {
    const r = await fetchRead('/api/github/graphql', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!r.ok) return null
    const body = await r.json()
    return body && typeof body === 'object' ? body.data || null : null
  } catch {
    return null
  }
}

// Identified device attempt: start returns attempt_id + expiry, every poll and
// cancellation names that exact attempt, and pending responses carry the next
// server-approved retry delay.
export function connectStart(
  token,
  { workflow = true, signal, timeoutMs = 45000 } = {},
) {
  return fetchWithDeadline('/api/github/connect/start', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow }),
    signal,
  }, timeoutMs)
}

export function connectPoll(
  token,
  attemptId,
  { signal, timeoutMs = 45000 } = {},
) {
  return fetchWithDeadline('/api/github/connect/poll', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attemptId }),
    signal,
  }, timeoutMs)
}

export function connectCancel(
  token,
  attemptId,
  { signal, timeoutMs = 45000 } = {},
) {
  return fetchWithDeadline('/api/github/connect/cancel', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attemptId }),
    signal,
  }, timeoutMs)
}

export function disconnect(token, { signal, timeoutMs = 60000 } = {}) {
  return fetchWithDeadline('/api/github/connect', {
    method: 'DELETE',
    headers: authHeaders(token),
    signal,
  }, timeoutMs)
}

// Send button path: the platform claims the prepared PR record, recomputes the
// actual branch diff, adapts it to a strictly-behind reusable fork without
// changing that fork's default branch, pushes the topic branch, opens the PR on
// GitHub, and writes the URL back to the record. The token stays server-side;
// this app receives only the updated ledger record or an actionable error plus
// the rolled-back record when available.
export async function submitContribution({ appId, token, rec, autopilot = true }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/submit',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        // The one-click grant: a successful submit authorizes the background
        // review-response loop for this PR (see review-followup.md). The owner
        // can flip the global default off in the app's Autopilot setting.
        body: JSON.stringify({ autopilot: !!autopilot }),
      }
    )
    let body = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    if (r.ok) {
      if (!body?.record) {
        return {
          uncertain: true,
          error: 'We could not confirm the result. Checking the saved contribution now…',
        }
      }
      return {
        ok: body.record,
        url: body?.url || '',
      }
    }
    const detail = body?.detail
    if (
      r.status === 409
      && detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not submit this PR.',
        record: detail.record || null,
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not submit this PR.',
    }
  } catch (err) {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
    }
  }
}

// Explicit pre-PR test action. The backend rechecks the reviewed diff, pushes
// only that branch to the owner's fork, and dispatches the allowlisted Tests
// workflow without opening a pull request. Like Send, a lost response is
// ambiguous because the public push/dispatch may already have completed; the
// caller must reconcile from the ledger before offering another try.
export async function runPreparedChecks({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/run-checks',
      {
        method: 'POST',
        headers: authHeaders(token),
      },
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok && body?.record) {
      return { ok: body.record, checks: body.checks || null }
    }
    const detail = body?.detail
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not start GitHub checks.',
        record: detail.record || null,
      }
    }
    return {
      unsupported: r.status === 404,
      error: typeof detail === 'string'
        ? detail
        : 'Could not start GitHub checks.',
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved run before offering another try…',
    }
  }
}

// Read-only GitHub status refresh plus a local ledger write. The endpoint
// returns full updated records so the app can repaint without a second storage
// scan. It is safe to repeat while a run is queued or in progress.
export async function refreshPreparedChecks(token, appId) {
  try {
    const r = await fetchRead(
      '/api/github/contributions/' +
        encodeURIComponent(appId) +
        '/prepared-checks/refresh',
      {
        method: 'POST',
        headers: authHeaders(token),
      },
      20000,
    )
    if (!r.ok) {
      return { ok: false, unsupported: r.status === 404, status: r.status }
    }
    const body = await r.json()
    return {
      ok: true,
      records: Array.isArray(body?.refreshed) ? body.refreshed : [],
    }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

// Complete the reviewed publication handoff after GitHub merges an app PR.
// The platform re-verifies the PR and immutable merged source/permissions before it
// attaches that public identity to the original local app row. The endpoint is
// idempotent: a lost response can be retried without duplicating or reinstalling
// the app.
export async function connectPublishedApp({ appId, token, recordId }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(recordId) + '/connect-app',
      {
        method: 'POST',
        headers: authHeaders(token),
      },
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok && body?.record && body?.connection) {
      return {
        ok: body.record,
        connection: body.connection,
      }
    }
    return {
      error: typeof body?.detail === 'string'
        ? body.detail
        : 'Could not connect this published app.',
    }
  } catch {
    return {
      error: 'The response was lost. It is safe to try Connect again.',
    }
  }
}

// Batch approval path for one immutable PR stack. recordIds is the exact
// ordered list rendered in the confirmation, so the server cannot silently
// include a layer the partner did not review. The response always carries the
// latest known records, including partial success after a durable retry.
export async function submitContributionStack({ appId, token, recordIds }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' + encodeURIComponent(appId) + '/submit-stack',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_ids: recordIds }),
      }
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok) {
      if (!Array.isArray(body?.records) || body.records.length === 0) {
        return {
          uncertain: true,
          error: 'We could not confirm the result. Checking the saved contributions now…',
        }
      }
      return {
        ok: body.records,
        submitted: Array.isArray(body?.submitted) ? body.submitted : [],
      }
    }
    const detail = body?.detail
    if (
      r.status === 409
      && detail === 'Every PR in this stack has already been submitted.'
    ) {
      return { alreadyHandled: true }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not submit this PR stack.',
        records: Array.isArray(detail.records) ? detail.records : [],
        submitted: Array.isArray(detail.submitted) ? detail.submitted : [],
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not submit this PR stack.',
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contributions before offering a retry…',
    }
  }
}

// Pause / resume autopilot for one shipped PR. This is a platform endpoint, NOT
// a ledger write — the grant lives in a platform DB row the app can't edit, so
// flipping the (display-only) ledger `autopilot` block could never actually stop
// the loop. Resume also clears any human_required flag and resets the five-round
// count. Returns { ok } or { error }.
export async function setAutopilot({ appId, token, recordId, enabled }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(recordId) + '/autopilot',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      }
    )
    if (r.ok) return { ok: true }
    let body = null
    try { body = await r.json() } catch { body = null }
    return { error: body?.detail || 'Could not update autopilot.' }
  } catch {
    return { error: 'The response was lost. Try again in a moment.' }
  }
}

// One explicit landing confirmation advances an unchanged app repository from
// the stack's reviewed base to its green top commit. The server owns every
// invariant and returns all durable records so a partial/lost response can be
// reconciled without guessing or blindly retrying a public action.
export async function landContributionStack({ appId, token, recordIds }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' + encodeURIComponent(appId) + '/land-stack',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_ids: recordIds }),
      }
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok) {
      if (!Array.isArray(body?.records) || body.records.length === 0) {
        return {
          uncertain: true,
          error: 'We could not confirm the landing. Checking the saved contributions now…',
        }
      }
      return {
        ok: body.records,
        targetBranch: body.target_branch || '',
        landedSha: body.landed_sha || '',
      }
    }
    const detail = body?.detail
    if (detail && typeof detail === 'object') {
      return {
        uncertain: detail.code === 'landing_unconfirmed',
        error: detail.message || 'Could not land this PR stack.',
        records: Array.isArray(detail.records) ? detail.records : [],
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not land this PR stack.',
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved stack before offering a retry…',
    }
  }
}
