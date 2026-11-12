import { useState } from 'react'
import { setAutopilot } from '../api.js'
import { needsHuman } from '../autopilot.js'
import { Icon } from './Icons.jsx'
import { Shine } from './Shine.jsx'

// A saved escalation (the follow-up agent stopped and handed the PR back) belongs on the PR page, not
// only on the saved card: its reason, and Resume, the one existing way on (api.js setAutopilot, which
// also clears the flag). The reason may quote a reviewer, so it is shown as plain text, never markdown.
export function PullEscalation({ record, appId, token, readOnly = false }) {
  const [state, setState] = useState({ busy: false, resumed: false, error: '' })
  if (readOnly || !needsHuman(record)) return null
  async function resume() {
    setState({ busy: true, resumed: false, error: '' })
    const outcome = await setAutopilot({ appId, token, recordId: record.id, enabled: true })
    setState({ busy: false, resumed: !!outcome.ok, error: outcome.error || '' })
  }
  if (state.resumed) return <p className="co-pr-feedback-flag is-news" role="status"><Icon name="check" size={16} /><span className="co-flag-text"><b>Resumed</b><span>The agent will pick this PR up again.</span></span></p>
  return <section className="co-pr-feedback-flag co-escalation is-blocker" aria-label="The agent needs your decision">
    <Icon name="feedback" size={16} />
    <span className="co-flag-text"><b>The agent needs your decision</b><span>The follow-up agent stopped and handed this PR back to you.</span></span>
    <p className="co-escalation-reason">{record.attention?.message || 'It did not say why.'}</p>
    <button type="button" className="co-btn" onClick={resume} disabled={state.busy}>{state.busy ? <Shine>Resuming…</Shine> : 'Resume'}</button>
    {state.error ? <p className="co-escalation-error" role="alert">{state.error}</p> : null}
  </section>
}
