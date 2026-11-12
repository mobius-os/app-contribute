import { reviewSteps, STEPS_LABEL } from '../review-steps.js'

// The strip says what it is: your own next steps, apart from the state line at the top of the page.
export function ReviewSteps({ standing, itemState }) {
  const steps = reviewSteps(standing, { itemState })
  if (!steps.length) return null
  return <div className="co-review-steps-row">
    <span className="co-review-steps-label" aria-hidden="true">{STEPS_LABEL}</span>
    <ol className="co-review-steps" aria-label={STEPS_LABEL}>
      {steps.map(step => <li key={step.label} className={'is-' + step.at} aria-current={step.at === 'current' ? 'step' : undefined}>{step.label}</li>)}
    </ol>
  </div>
}
