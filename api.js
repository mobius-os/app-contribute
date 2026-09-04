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

// Fetch-free local Git metadata for the Projects view. The endpoint returns
// refs, ancestry/diff magnitudes, working-tree counts, and bounded path names.
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

// Source contents remain behind an explicit, project-bound read. The caller
// supplies only the opaque project key + endpoint commits it already inspected;
// the platform chooses the repository/ref and caps the returned unified patch.
export async function fetchSourceDiff(token, project) {
  if (!project?.key || !project?.head_sha) {
    return { ok: false, status: 422 }
  }
  const query = new URLSearchParams({
    project: project.key,
    head: project.head_sha,
  })
  const comparison = project.comparison_sha || project.base_sha
  if (comparison) query.set('comparison', comparison)
  try {
    const response = await fetchRead('/api/github/source-diff?' + query, {
      headers: authHeaders(token),
    })
    if (!response.ok) {
      return {
        ok: false,
        stale: response.status === 409,
        unsupported: response.status === 404,
        status: response.status,
      }
    }
    return { ok: true, data: await response.json() }
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

export async function fetchIncomingReviews(token) {
  const query = `query ContributeIncomingReviews {
    search(query: "is:pr is:open review-requested:@me -assignee:@me", type: ISSUE, first: 20) {
      nodes { ... on PullRequest { number title url headRefOid author { login } repository { nameWithOwner } } }
    }
  }`
  const data = await fetchLiveStates(token, query)
  const nodes = Array.isArray(data?.search?.nodes) ? data.search.nodes : []
  return nodes.filter((item) => item?.repository?.nameWithOwner && item?.number && item?.url)
}

export async function assignIncomingReview({ appId, token, repo, number }) {
  try {
    const response = await fetch(
      `/api/github/contributions/${encodeURIComponent(appId)}/assign-review`,
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, number }),
      },
    )
    if (!response.ok) {
      return { ok: false, error: await responseDetail(response, 'Could not assign this review.') }
    }
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, error: 'Could not confirm the assignment. Refresh before trying again.' }
  }
}

// Identified device attempt: start returns attempt_id + expiry, every poll and
// cancellation names that exact attempt, and pending responses carry the next
// server-approved retry delay.
export function connectStart(
  token,
  { workflow = true, privateRepos = false, signal, timeoutMs = 45000 } = {},
) {
  return fetchWithDeadline('/api/github/connect/start', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, private_repos: privateRepos }),
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
export async function submitContribution({
  appId,
  token,
  rec,
  autopilot = true,
  publicationStage = 'ready',
}) {
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
        body: JSON.stringify({
          autopilot: !!autopilot,
          publication_stage: publicationStage === 'draft' ? 'draft' : 'ready',
        }),
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
          failure: { owner: 'automatic' },
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
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not submit this PR.',
      failure: { status: r.status, code: '' },
    }
  } catch (err) {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

// Owner-approved fast-forward of an already-open pull request. A prepared
// `pr_update` record carries the exact new head and complete reviewed diff; the
// platform verifies the live PR identity before it pushes anything.
export async function updateContribution({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/update-existing',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) {
      return { ok: body.record, url: body?.url || '' }
    }
    const detail = body?.detail
    if (
      r.status === 409 &&
      detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true }
    }
    if (r.status === 404) {
      return {
        unsupported: true,
        error: 'Restart Möbius to load the reviewed PR update action.',
        failure: { owner: 'owner', status: r.status },
      }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not update this PR.',
        record: detail.record || null,
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not update this PR.',
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

// Launcher path: the scoped app token reaches only the platform BFF. The BFF
// rechecks the reviewed record, asks the root-owned identity broker for one
// body-bound contribution capability, and sends an always-draft request to the
// configured GitHub App target. No personal GitHub token enters this frame.
export async function submitContributionViaMobius({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/submit',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm_publication: true,
          public_identity: 'anonymous',
          submitter: 'contribute-button',
        }),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) {
      if (body.record.url) {
        return { ok: body.record, url: body.record.url, viaMobius: true }
      }
      return { pending: body.record, viaMobius: true }
    }
    const detail = body?.detail
    if (
      r.status === 409 &&
      detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true, viaMobius: true }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not submit this draft through Möbius.',
        record: detail.record || null,
        viaMobius: true,
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string'
        ? detail
        : 'Could not submit this draft through Möbius.',
      viaMobius: true,
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      viaMobius: true,
      failure: { owner: 'automatic' },
    }
  }
}

export async function fetchMobiusContributionStatus({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/status',
      { headers: authHeaders(token) },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) return { ok: body.record }
    const detail = body?.detail
    return {
      error: detail && typeof detail === 'object'
        ? detail.message
        : (typeof detail === 'string' ? detail : 'Could not check the Möbius draft.'),
    }
  } catch {
    return { error: 'Could not reach the Möbius contribution service.' }
  }
}

export async function withdrawMobiusContribution({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/withdraw',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_withdrawal: true }),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) return { ok: body.record }
    const detail = body?.detail
    return {
      error: detail && typeof detail === 'object'
        ? detail.message
        : (typeof detail === 'string'
            ? detail
            : 'Could not withdraw this contribution.'),
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Refresh Contribute before trying again.',
    }
  }
}

// Batch approval paths for one immutable PR stack. recordIds carries the full
// ordered chain so the server can revalidate topology, while operation binds
// the confirmation to only its current action phase. Deferred records remain
// prepared and receive no claim. Publishing new PRs and updating existing PRs
// stay distinct guarded writes even though their partial-result handling is
// identical here.
async function writeContributionStack({
  appId,
  token,
  recordIds,
  operation,
  publicationStage = 'ready',
}) {
  const updating = operation === 'update'
  try {
    const r = await fetch(
      '/api/github/contributions/' + encodeURIComponent(appId) +
        (updating ? '/update-stack' : '/submit-stack'),
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record_ids: recordIds,
          ...(updating ? {} : {
            publication_stage: publicationStage === 'draft' ? 'draft' : 'ready',
          }),
        }),
      }
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok) {
      if (!Array.isArray(body?.records) || body.records.length === 0) {
        return {
          uncertain: true,
          error: 'We could not confirm the result. Checking the saved contributions now…',
          failure: { owner: 'automatic' },
        }
      }
      return {
        ok: body.records,
        submitted: Array.isArray(updating ? body?.updated : body?.submitted)
          ? (updating ? body.updated : body.submitted)
          : [],
      }
    }
    const detail = body?.detail
    if (
      r.status === 409
      && detail === (updating
        ? 'Every PR in this stack already has the reviewed update.'
        : 'Every PR in this stack has already been submitted.')
    ) {
      return { alreadyHandled: true }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || (updating
          ? 'Could not update this PR stack.'
          : 'Could not submit this PR stack.'),
        records: Array.isArray(detail.records) ? detail.records : [],
        submitted: Array.isArray(updating ? detail.updated : detail.submitted)
          ? (updating ? detail.updated : detail.submitted)
          : [],
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : (updating
        ? 'Could not update this PR stack.'
        : 'Could not submit this PR stack.'),
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contributions before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

export function submitContributionStack(args) {
  return writeContributionStack({ ...args, operation: 'submit' })
}

export function updateContributionStack(args) {
  return writeContributionStack({ ...args, operation: 'update' })
}

// Move one exact personal-GitHub draft into review. The platform journals the
// approved repo/PR/head before the mutation and turns a repeated call after a
// lost response into read-only reconciliation, so the client may safely call
// this once more only when the first response is explicitly uncertain.
export async function markContributionReady({ appId, token, rec }) {
  try {
    const response = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) + '/ready',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_head_sha: rec.last_submit_push_sha || '',
        }),
      },
    )
    const body = await response.json().catch(() => null)
    if (response.ok) {
      if (body?.record) {
        return { ok: body.record, url: body.url || body.record.url || '' }
      }
      return {
        uncertain: true,
        error: 'GitHub may have accepted the review request. Checking the saved action before offering another try…',
        failure: { owner: 'automatic', status: response.status, code: 'ready_response_missing' },
      }
    }
    const detail = body?.detail
    if (detail && typeof detail === 'object') {
      return {
        uncertain: response.status === 503 && detail.code === 'ready_unconfirmed',
        error: detail.message || 'Could not request review for this pull request.',
        record: detail.record || null,
        failure: { status: response.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string'
        ? detail
        : 'Could not request review for this pull request.',
      failure: { status: response.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved public action before offering another try…',
      failure: { owner: 'automatic' },
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
