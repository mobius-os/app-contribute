import { nextStepModel } from '../next-step.js'

// What is true (a pill), the machine's own sentence, and the one filled button for the
// next step (a question's pointer is a link that opens the Review tab, so it is reachable from any tab), together under the facts line. The Actions menu and the Review tab keep
// their own copies of the sentence, each worded for its place.
// `bar`: the same button on its own, for the sticky bar at the foot of a phone's PR page. Only one of the two
// buttons is ever on screen (CSS), so there is one next step, never a pair.
export function NextStep({ decision, record, capabilities, disabled = false, bar = false, onChoose, onReviewTab, onSync }) {
  const model = nextStepModel(decision, { record, capabilities })
  if (!model) return null
  const run = { menu: () => onChoose?.(model.primary.intent), review: () => onReviewTab?.(), sync: () => onSync?.() }
  if (bar) return model.primary ? <div className="co-decision-bar" role="group" aria-label="Next step"><button type="button" className="co-btn co-btn-primary" disabled={disabled} onClick={run[model.primary.route]}>{model.primary.title}</button></div> : null
  return <section className="co-next-step" data-turn={decision.turn} aria-label="Next step">
    <span className={'co-desk-chip is-' + model.pill.tone}>{model.pill.label}</span>
    <p className="co-next-hint">{model.hint}{model.pointer ? <button type="button" className="co-next-pointer" onClick={() => onReviewTab?.()}>{model.pointer}</button> : null}</p>
    {model.primary ? <button type="button" className="co-btn co-btn-primary" disabled={disabled} onClick={run[model.primary.route]}>{model.primary.title}</button> : null}
  </section>
}
