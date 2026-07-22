import { ContributionCard } from './ContributionCard.jsx'
import { ContributionStack } from './ContributionStack.jsx'
import { preparedContributionUnits, publicContributionUnits } from '../stack.js'
import { reviewStateFor } from '../review.js'

// The grouped feed. domain.groupRecords partitions the ledger into three
// buckets; each renders as a section only when it has rows, so the layout
// tightens around whatever the ledger actually holds:
//
//   Ready for review — status=prepared, waiting on the owner's go-ahead. These
//                      cards carry the review flow (expand the staged plan,
//                      Send/Feedback/Drop), so only this group gets the
//                      submit + drop handlers.
//   Open             — status submitting/draft/open: live on GitHub, or in
//                      flight to it (refreshed on mount + daily). Cards may
//                      still return to the source chat when GitHub activity
//                      needs agent follow-up.
//   History          — merged/closed/commented/abandoned and any unknown
//                      future status. A dropped (abandoned) card gets an Undrop
//                      button (onRestore) to send it back to Ready for review.
export function Feed({
  groups,
  records,
  reviewStatus,
  onSend,
  onSendStack,
  onLandStack,
  onFeedback,
  onDismiss,
  onRestore,
  loadDiff,
}) {
  const { ready, open, history } = groups
  const readyUnits = preparedContributionUnits(ready, records)
  const openUnits = publicContributionUnits(open, records)
  const needsAttention = readyUnits.filter((unit) => (
    unit.records || [unit.record]
  ).some((rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh'))
  const readyToSend = readyUnits.filter((unit) => !needsAttention.includes(unit))

  function renderUnit(unit) {
    return unit.type === 'stack' ? (
      <ContributionStack
        key={'stack:' + unit.id}
        unit={unit}
        reviewStatus={reviewStatus}
        onSendStack={onSendStack}
        onFeedback={onFeedback}
        loadDiff={loadDiff}
      />
    ) : (
      <ContributionCard
        key={unit.record.id}
        rec={unit.record}
        reviewState={reviewStateFor(unit.record, reviewStatus)}
        onSend={onSend}
        onFeedback={onFeedback}
        onDismiss={onDismiss}
        loadDiff={loadDiff}
      />
    )
  }
  return (
    <>
      {needsAttention.length > 0 && (
        <section className="co-section is-attention">
          <div>
            <div className="co-section-headline">
              <h2 className="co-section-title">Needs attention</h2>
              <span>{needsAttention.length}</span>
            </div>
            <p className="co-section-hint">
              These need an update before they can be sent.
            </p>
          </div>
          {needsAttention.map(renderUnit)}
        </section>
      )}

      {readyToSend.length > 0 && (
        <section className="co-section">
          <div>
            <div className="co-section-headline">
              <h2 className="co-section-title">Ready to send</h2>
              <span>{readyToSend.length}</span>
            </div>
            <p className="co-section-hint">Reviewed and waiting for your OK.</p>
          </div>
          {readyToSend.map(renderUnit)}
        </section>
      )}

      {open.length > 0 && (
        <section className="co-section">
          <div className="co-section-headline">
            <h2 className="co-section-title">Open</h2>
            <span>{open.length}</span>
          </div>
          {openUnits.map((unit) => unit.type === 'stack' ? (
            <ContributionStack
              key={'open-stack:' + unit.id}
              unit={unit}
              action="land"
              onLandStack={onLandStack}
              onFeedback={onFeedback}
              loadDiff={loadDiff}
            />
          ) : (
            <ContributionCard
              key={unit.record.id}
              rec={unit.record}
              onFeedback={onFeedback}
            />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <details className="co-section co-history">
          <summary>
            <span>History</span>
            <small>{history.length} completed contributions</small>
          </summary>
          <div className="co-history-feed">
            {history.map((rec) => (
              <ContributionCard key={rec.id} rec={rec} onRestore={onRestore} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}
