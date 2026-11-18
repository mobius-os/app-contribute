// The lazy tick for a screen: every deadline that has passed takes effect, each at the moment
// it passed rather than at the moment the screen looked. engine.tick(vector, now) would stamp
// the new state with `now`, so "waiting on you since" would be the time of the last load and
// move on every read. Nothing here holds a timer; a deadline only takes effect when a vector
// is loaded.
import { tick } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'

const ROUNDS = 8 // the longest chain in the tables is two; a state that renews itself (RUNNING) stops here

const deadlinesOf = vector => Object.values(vector.regions).map(slot => slot.deadline).filter(at => at != null)

// -> { vector, effects }: the effects are for the caller to perform (the engine never does).
export function catchUp(vector, now) {
  let total = { vector, effects: [] }
  for (let round = 0; round < ROUNDS; round += 1) {
    const due = Math.min(...deadlinesOf(total.vector))
    if (due > now) break
    const step = tick(TABLES, total.vector, due)
    if (step.vector === total.vector) break
    total = { vector: step.vector, effects: [...total.effects, ...step.effects] }
  }
  return total
}
