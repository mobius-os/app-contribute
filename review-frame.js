// The comet frame around a PR under review: pure geometry and state mapping,
// so it is testable without a DOM. ui/ReviewFrame.jsx draws it.
import { reviewReading, reviewRunHalted, reviewsOfPr } from './collaboration.js'

export const COMET_SPEED = 160 // pixels per second: a slow, steady lap
export const COMET_LAYERS = 36

// Item states where an agent is still working on the PR.
const WORKING_ITEMS = new Set(['pending', 'starting', 'reviewing', 'repairing', 'pushing', 'marking_ready', 'merging', 'verdict_posting'])

// Length of a rounded rectangle's outline: the four straight sides plus four
// quarter-circle corners.
export function roundedRectPerimeter(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return 2 * (width + height) - 8 * r + 2 * Math.PI * r
}

// One comet is a stack of dash layers that share a head. The k-th longest layer
// has opacity 1/(N-k+1), so where m layers overlap the combined opacity is
// exactly m/N: a linear fade from a bright head to a clear tail.
export function cometLayers(perimeter, count = COMET_LAYERS) {
  const tail = Math.max(40, perimeter * 0.14)
  return Array.from({ length: count }, (_, index) => {
    const remaining = count - index
    const length = tail * remaining / count
    return { length, gap: perimeter - length, opacity: 1 / remaining }
  })
}

export const cometSeconds = perimeter => perimeter / COMET_SPEED

// A row under review shows a wave of light instead of a ring. It starts at the row's status icon and must grow
// until it has crossed the farthest corner, so its size is measured per row, never a fixed number.
export const RIPPLE_FALLBACK_X = 28 // where the wave starts when a row has no status icon to start from

// `frame` and `icon` are bounding boxes (left, top, width, height) in the same coordinates; icon may be absent.
export function rippleWave(frame, icon) {
  const x = icon ? icon.left - frame.left + icon.width / 2 : RIPPLE_FALLBACK_X
  const y = icon ? icon.top - frame.top + icon.height / 2 : frame.height / 2
  const reach = Math.hypot(Math.max(x, frame.width - x), Math.max(y, frame.height - y))
  return { x: Math.round(x), y: Math.round(y), diameter: Math.ceil(2 * reach) }
}

// What the frame shows around a saved record's review (a PR row uses its PR
// machine decision instead, see pr-standing.js frameOf): it travels while an
// agent works, holds amber while the review waits on the owner, else absent.
// Finished reviews stay as the chip alone: nothing records which results the
// owner has already seen, and a ring on every old review would never go away.
// `own` is whether the owner wrote the PR (see reviewReading). The same reading gives the PR page its
// frame: a review that stalled (nothing will wake it) is the owner's move on both, and one that did not
// finish is no move at all, the PR is simply still to review.
export function frameState(status, ctx) {
  if (!status) return 'idle'
  const { run, item } = status
  const reading = reviewReading(run, item, ctx)
  if (reading.state === 'STALLED') return 'verdict'
  if (reading.halted || reading.settled || reading.state === 'NOT_FINISHED') return 'idle'
  // A comment on its way to GitHub is something sent, not the owner's decision: the PR page says "Sending" and travels the frame too.
  if (item.public_review?.state === 'posting') return 'reviewing'
  if (reading.turn === 'owner' && (item.state !== 'failed' || reading.waiting)) return 'verdict'
  return WORKING_ITEMS.has(item.state) ? 'reviewing' : 'idle'
}

// The repositories (lower case) whose PRs a review is still working on.
export const reviewRepositoriesAtWork = runs => new Set((runs || []).filter(run => !reviewRunHalted(run))
  .flatMap(run => (run.items || []).filter(item => WORKING_ITEMS.has(item.state)).map(item => String(item.repo).toLowerCase())))

// Whether any review is still being worked on, so the desk polls only then.
export const hasActiveReview = runs => reviewRepositoriesAtWork(runs).size > 0

// A saved record names its PR by repository and number; the newest review of
// that PR (at any version) is what its desk row should reflect while it runs.
// A record does not know the PR's current code, so this is the PR lookup's newest review (collaboration.js reviewsOfPr).
export function reviewForRecord(runs, record) {
  const repo = String(record?.plan?.repo || record?.repo || '').toLowerCase()
  const number = Number(record?.number)
  if (!repo || !number) return null
  return reviewsOfPr(runs, repo, number)[0] || null
}
