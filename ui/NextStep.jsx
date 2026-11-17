import { nextStepModel } from '../next-step.js'
import { NAMES } from '../names.js'

// What is true (a pill), the machine's own sentence, and the one filled button for the
// next step (a question's pointer is a link that opens the Review tab, so it is reachable from any tab), together under the facts line. The Actions menu and the Review tab keep
// their own copies of the sentence, each worded for its place.
// `bar`: the same button on its own, for the sticky bar at the foot of a phone's PR page. Only one of the two
// buttons is ever on screen (CSS), so there is one next step, never a pair.
// `onOpenChat` opens the conversation of the PR's agent job. While it works, the panel offers it as a link; when it
// asks you something, opening it is the filled button (reading and answering changes nothing on the PR, so a stale
// or read-only page does not disable it). Without a known conversation the question points to the Review tab.
export function NextStep({ decision, record, capabilities, disabled = false, bar = false, onChoose, onReviewTab, onSync, onOpenChat = null }) {
  const model = nextStepModel(decision, { record, capabilities })
  if (!model) return null
  const run = { menu: () => onChoose?.(model.primary.intent), review: () => onReviewTab?.(), sync: () => onSync?.() }
  const step = model.answer && onOpenChat ? <button type="button" className="co-btn co-btn-primary" onClick={onOpenChat}>{NAMES.answerInChat}</button>
    : model.primary ? <button type="button" className="co-btn co-btn-primary" disabled={disabled} onClick={run[model.primary.route]}>{model.primary.title}</button> : null
  if (bar) return step ? <div className="co-decision-bar" role="group" aria-label="Next step">{step}</div> : null
  const pointer = model.pointer && !(model.answer && onOpenChat)
  return <section className="co-next-step" data-turn={decision.turn} aria-label="Next step">
    <span className={'co-desk-chip is-' + model.pill.tone}>{model.pill.label}</span>
    <p className="co-next-hint">{model.hint}{pointer ? <button type="button" className="co-next-pointer" onClick={() => onReviewTab?.()}>{model.pointer}</button> : null}</p>
    {model.chat && onOpenChat ? <button type="button" className="co-next-chat" onClick={onOpenChat}>{NAMES.openChat}</button> : null}
    {step}
  </section>
}
