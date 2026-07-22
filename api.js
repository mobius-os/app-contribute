// Same-origin fetch helpers for the platform's GitHub surface. The GitHub
// token never reaches this app: /api/github/* holds it server-side, and the
// manifest's github_access permission is what lets this app's token through —
// including the connect endpoints, which the platform gates to accept an app
// token that declares github_access. Read helpers degrade to a quiet fallback
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

// Resolves the connection card's state and carries the fields the connect
// flow needs (device_flow_available, login). 404 means the platform predates
// the GitHub surface entirely — a distinct, actionable message.
export async function fetchGithubStatus(token) {
  try {
    const r = await fetchRead('/api/github/status', { headers: authHeaders(token) })
    if (r.status === 404) return { state: 'unsupported' }
    if (!r.ok) return { state: 'unknown' }
    const s = await r.json()
    return {
      state: s.connected ? 'connected' : 'disconnected',
      login: s.login || '',
      scopes: Array.isArray(s.scopes) ? s.scopes : [],
      deviceFlowAvailable: !!s.device_flow_available,
      classicTokenUrl: s.classic_token_url || '',
      classicWorkflowTokenUrl: s.classic_workflow_token_url || '',
    }
  } catch {
    // Network failure (offline, backend restarting) — not a platform verdict.
    return { state: 'unknown' }
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

// Device flow: start it (returns {user_code, verification_uri, interval,
// expires_in}) and poll it (returns {status: none|pending|complete|failed,
// login?, reason?}). The server paces polling — it answers "pending" without
// an upstream call when a poll arrives before GitHub's interval allows one —
// so the caller just ticks at the announced interval and never handles
// slow_down itself.
export function connectStart(token, { workflow = false } = {}) {
  return fetch('/api/github/connect/start', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow }),
  })
}

export function connectPoll(token) {
  return fetch('/api/github/connect/poll', {
    method: 'POST',
    headers: authHeaders(token),
  })
}

// PAT fallback: exchange a classic personal access token for the stored
// credential. On rejection the server's detail (fine-grained token,
// missing scope) is human-readable — surface it verbatim.
export function connectToken(token, pat) {
  return fetch('/api/github/connect/token', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pat }),
  })
}

export function disconnect(token) {
  return fetch('/api/github/connect', {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

// Send button path: the platform claims the prepared PR record, recomputes the
// actual branch diff, adapts it to a strictly-behind reusable fork without
// changing that fork's default branch, pushes the topic branch, opens the PR on
// GitHub, and writes the URL back to the record. The token stays server-side;
// this app receives only the updated ledger record or an actionable error plus
// the rolled-back record when available.
export async function submitContribution({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/submit',
      {
        method: 'POST',
        headers: authHeaders(token),
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
