// Pure interpreter for the contribution lifecycle tables: the JavaScript twin of
// lifecycle_engine.py. Nothing here reads a clock, storage or the network, and nothing mutates
// its arguments. Every function takes the tables, a vector and the time (whole seconds since
// the epoch) and returns what should be stored and done; the caller performs the effects and
// writes the vector with compare-and-swap. test/lifecycle.cases.json holds the cases both
// interpreters must answer identically.
//
// vector: { v, regions: { name: { state, since, deadline } }, attention?: { flags }, history }
// event:  { type, source, region?, data?, inferred? }
// result: { vector, effects, refusal, log }

const ATTENTION = 'attention'
const DELIVERY_LIMIT = 24 // a raised event raises nothing further in the tables; this only bounds a bad table
const TICK_LIMIT = 8 // the longest deadline chain in the tables is two

const clone = value => JSON.parse(JSON.stringify(value))
const valueOf = (data, field) => (data && data[field] !== undefined ? data[field] : null)
const dataOf = event => event.data || {}

// Every named field must equal the expected value, or one of a list. Missing reads as null.
function matches(when, data) {
  return Object.entries(when).every(([field, expected]) => {
    const options = Array.isArray(expected) ? expected : [expected]
    return options.some(option => option === valueOf(data, field))
  })
}

const statesOf = vector => Object.fromEntries(
  Object.entries(vector.regions).map(([name, slot]) => [name, slot.state]))

const regionNames = vector => Object.keys(vector.regions).sort()

function findTransition(region, state, event) {
  const data = dataOf(event)
  return region.transitions.find(row =>
    row.from === state && row.event === event.type && matches(row.when, data)) || null
}

function targetOf(tables, row, event) {
  const rule = tables.targets[row.to]
  if (!rule) return row.to
  return valueOf(dataOf(event), rule.field) === true ? rule.if_true : rule.otherwise
}

function deadlineOf(region, state, now) {
  const rule = region.states[state].deadline
  return rule ? now + rule.seconds : null
}

function entryOf(event, now, fields) {
  const entry = { at: now, type: event.type, source: event.source || 'unknown', ...fields }
  if (event.inferred) entry.inferred = true
  return entry
}

// Move one region along one row. Returns the events the row raises for the other regions.
function take(tables, work, name, row, event, now, run) {
  const region = tables.regions[name]
  const slot = work.regions[name]
  const target = targetOf(tables, row, event)
  run.log.push(entryOf(event, now, { region: name, to: target, from: slot.state }))
  if (target !== slot.state) slot.since = now
  slot.state = target
  slot.deadline = deadlineOf(region, target, now) // any move starts the state's clock again
  run.effects.push(...row.effects.map(effect => ({ region: name, effect, event: event.type })))
  return row.raises.map(type => (
    { type, source: 'engine', data: dataOf(event), inferred: Boolean(event.inferred) }))
}

function attentionFlags(rule, flags, priority) {
  if (rule.action === 'clear_all') return []
  const wanted = new Set(flags)
  if (rule.action === 'raise') rule.flags.forEach(flag => wanted.add(flag))
  if (rule.action === 'clear') rule.flags.forEach(flag => wanted.delete(flag))
  return priority.filter(flag => wanted.has(flag))
}

const sameList = (left, right) => left.length === right.length && left.every((item, at) => item === right[at])

function deliverAttention(tables, work, event, now, run) {
  const attention = work[ATTENTION]
  if (!attention || (event.region != null && event.region !== ATTENTION)) return
  const data = dataOf(event)
  const rule = tables.attention.rules.find(row => row.event === event.type && matches(row.when, data))
  if (!rule) return
  run.matched = true
  const flags = attentionFlags(rule, attention.flags, tables.attention.priority)
  if (!sameList(flags, attention.flags) || rule.logged) {
    run.log.push(entryOf(event, now, { region: ATTENTION, action: rule.action, flags }))
  }
  attention.flags = flags
}

// Offer one event to every region of the vector, then to attention. Returns raised events.
function deliver(tables, work, event, now, run) {
  const raised = []
  for (const name of regionNames(work)) {
    if (event.region != null && event.region !== name) continue
    const row = findTransition(tables.regions[name], work.regions[name].state, event)
    if (!row) continue
    run.matched = true
    raised.push(...take(tables, work, name, row, event, now, run))
  }
  deliverAttention(tables, work, event, now, run)
  return raised
}

function knownEvent(tables, type) {
  const inRegions = Object.values(tables.regions).some(region => region.transitions.some(row => row.event === type))
  return inRegions || tables.attention.rules.some(row => row.event === type)
}

function refusalOf(tables, vector, event) {
  const reason = knownEvent(tables, event.type) ? 'no_transition' : 'unknown_event'
  return { reason, type: event.type, states: statesOf(vector) }
}

function storeLog(tables, work, log) {
  work.history = [...(work.history || []), ...log].slice(-tables.history_limit)
}

// An event no table accepts changes nothing. It is logged once, not once per repeat.
function refused(tables, vector, event, now) {
  const refusal = refusalOf(tables, vector, event)
  const entry = entryOf(event, now, { refused: refusal.reason })
  const history = vector.history || []
  const last = history[history.length - 1] || {}
  const repeat = last.refused === entry.refused && last.type === entry.type
  const work = clone(vector)
  if (!repeat) storeLog(tables, work, [entry])
  return { vector: work, effects: [], refusal, log: [entry] }
}

// A fresh vector with the named regions in the given states (null means the initial one).
export function newVector(tables, states, now, attention = true) {
  const regions = Object.fromEntries(Object.entries(states).map(([name, state]) => {
    const region = tables.regions[name]
    const chosen = state || region.initial
    return [name, { state: chosen, since: now, deadline: deadlineOf(region, chosen, now) }]
  }))
  const vector = { v: tables.version, regions, history: [] }
  if (attention) vector[ATTENTION] = { flags: [] }
  return vector
}

// Deliver one event. A refused event leaves the states as they were.
export function apply(tables, vector, event, now) {
  const work = clone(vector)
  const run = { effects: [], log: [], matched: false }
  const queue = [event]
  for (let delivered = 0; queue.length && delivered < DELIVERY_LIMIT; delivered += 1) {
    queue.push(...deliver(tables, work, queue.shift(), now, run))
  }
  if (!run.matched) return refused(tables, vector, event, now)
  storeLog(tables, work, run.log)
  return { vector: work, effects: run.effects, refusal: null, log: run.log }
}

const merge = (total, step) => ({
  vector: step.vector, effects: [...total.effects, ...step.effects],
  refusal: total.refusal, log: [...total.log, ...step.log],
})

const unchanged = vector => ({ vector, effects: [], refusal: null, log: [] })

function dueEvent(tables, vector, now) {
  for (const name of regionNames(vector)) {
    const slot = vector.regions[name]
    const rule = tables.regions[name].states[slot.state].deadline
    // A stored deadline on a state that has no deadline rule (a vector from other tables) is not due.
    if (!rule || slot.deadline == null || now < slot.deadline) continue
    return { type: rule.event, region: name, source: 'clock' }
  }
  return null
}

// Raise the deadline event of every state whose time has passed.
export function tick(tables, vector, now) {
  let total = unchanged(vector)
  for (let round = 0; round < TICK_LIMIT; round += 1) {
    const event = dueEvent(tables, total.vector, now)
    if (!event) break
    const step = apply(tables, total.vector, event, now)
    if (step.refusal) break
    total = merge(total, step)
  }
  return total
}

// Try each derived event in turn. One that does not fit is a wrong guess and is dropped.
function applyInferred(tables, vector, events, now) {
  return events.reduce((total, event) => {
    const step = apply(tables, total.vector, { ...event, inferred: true }, now)
    return step.refusal ? total : merge(total, step)
  }, unchanged(vector))
}

// Turn what a GitHub read shows (a level) into the edges that explain it.
export function observe(tables, vector, level, now) {
  const state = vector.regions.publication.state
  const row = tables.level_edges.find(candidate => candidate.where.includes(state) && matches(candidate.level, level))
  if (!row) return unchanged(vector)
  const events = row.events.map(type => ({ type, source: 'github', data: level }))
  return applyInferred(tables, vector, events, now)
}

const whereMatches = (where, vector) => matches(where, statesOf(vector))

// The `status` word for these regions. The stored word is kept when the row accepts it.
export function statusOf(tables, vector, stored = null) {
  const row = tables.status.find(candidate => whereMatches(candidate.where, vector))
  if (!row) return null
  return row.also.includes(stored) ? stored : row.status
}

const seedRow = (tables, facts) => tables.seed.find(candidate => matches(candidate.facts, facts)) || null

function reseed(tables, vector, facts, now) {
  const row = seedRow(tables, facts)
  if (!row) return null
  const following = tables.seed_followup[valueOf(facts, 'following') || 'off'] || 'OFF'
  const fresh = newVector(tables, { publication: null, update: null, followup: following, ...row.states }, now)
  const event = { type: vector ? 'RESEEDED' : 'SEEDED', source: 'status', inferred: true }
  const entry = entryOf(event, now, { to: statesOf(fresh), from: vector ? statesOf(vector) : null })
  if (vector) {
    fresh[ATTENTION] = clone(vector[ATTENTION] || { flags: [] })
    fresh.history = clone(vector.history || [])
  }
  storeLog(tables, fresh, [entry])
  const seeded = { vector: fresh, effects: [], refusal: null, log: [entry] }
  return merge(seeded, applyInferred(tables, fresh, row.events.map(type => ({ type, source: 'status' })), now))
}

// Keep the follow-up region in step with the grant the record mirrors. The grant is the
// platform's row and its writers do not know the vector, so the mirror is the truth. A finished
// PR stays closed out whatever the mirror says.
function follow(tables, result, facts, now) {
  const slot = result.vector.regions.followup
  const wanted = tables.seed_followup[valueOf(facts, 'following')] || null
  if (!slot || !wanted || slot.state === wanted || slot.state === 'CLOSED_OUT') return result
  const work = clone(result.vector)
  const event = { type: 'RESEEDED', source: 'status', inferred: true }
  const entry = entryOf(event, now, { region: 'followup', to: wanted, from: slot.state })
  work.regions.followup = { state: wanted, since: now, deadline: deadlineOf(tables.regions.followup, wanted, now) }
  storeLog(tables, work, [entry])
  return { ...result, vector: work, log: [...result.log, entry] }
}

function adoptStatus(tables, vector, facts, now) {
  const status = valueOf(facts, 'status')
  const row = tables.status_edges.find(candidate =>
    whereMatches(candidate.where, vector) && matches(candidate.facts, facts))
  if (row) {
    const events = row.events.map(({ type, region, data }) => ({ type, region, data, source: 'status' }))
    const result = applyInferred(tables, vector, events, now)
    const explained = result.log.length > 0 && statusOf(tables, result.vector, status) === status
    // A correcting row overrules the stored word: with events it moves the regions, with none it
    // says the regions already stand right, so the same word is not explained again on every read.
    if (explained || (row.corrects && (result.log.length > 0 || events.length === 0))) return result
  }
  if (statusOf(tables, vector, status) === status) return unchanged(vector)
  return reseed(tables, vector, facts, now)
}

// Bring a record's vector in line with the status word another writer stored. Returns null
// when the facts describe nothing this machine tracks (the caller stores no vector).
export function adopt(tables, vector, facts, now) {
  const result = vector ? adoptStatus(tables, vector, facts, now) : reseed(tables, null, facts, now)
  return result ? follow(tables, result, facts, now) : null
}

// Every region that owes a move, with who it waits on and since when.
export function waitingOn(tables, vector) {
  return regionNames(vector).flatMap(name => {
    const slot = vector.regions[name]
    const waits = tables.regions[name].states[slot.state].waits
    if (waits === 'none') return []
    return [{ region: name, state: slot.state, waits, since: slot.since, deadline: slot.deadline ?? null }]
  })
}

// The one flag shown; the others wait behind it. Flags are stored in priority order.
export function shownAttention(vector) {
  const flags = (vector[ATTENTION] && vector[ATTENTION].flags) || []
  return flags.length ? flags[0] : null
}

// Whether the tables accept this event now: the rule a button is offered by.
export function allowed(tables, vector, type, data = {}) {
  const event = { type, data }
  return Object.entries(vector.regions).some(([name, slot]) =>
    findTransition(tables.regions[name], slot.state, event) !== null)
}

function checkState(name, region, state, meta, exits, reachable) {
  const problems = []
  const rule = meta.deadline
  if (['github', 'platform', 'agent'].includes(meta.waits) && !rule) {
    problems.push(`${name}.${state}: waits on ${meta.waits} but has no deadline`)
  }
  const hasExit = rule && region.transitions.some(row =>
    row.from === state && row.event === rule.event && row.to === rule.to)
  if (rule && !hasExit) problems.push(`${name}.${state}: deadline ${rule.event} to ${rule.to} has no transition`)
  if (!meta.final && exits === 0) problems.push(`${name}.${state}: not final and no way out`)
  if (!reachable) problems.push(`${name}.${state}: unreachable`)
  return problems
}

function checkRegion(tables, name, region) {
  const problems = []
  const targets = new Set([region.initial])
  const leaves = Object.fromEntries(Object.keys(region.states).map(state => [state, 0]))
  for (const row of region.transitions) {
    const rule = tables.targets[row.to]
    const reached = rule ? [rule.if_true, rule.otherwise] : [row.to]
    reached.forEach(state => targets.add(state))
    const undeclared = [row.from, ...reached].filter(state => !(state in region.states))
    problems.push(...undeclared.map(state => `${name}: transition ${row.from} ${row.event} names undeclared ${state}`))
    if (row.from in leaves) leaves[row.from] += 1
  }
  const states = Object.entries(region.states).flatMap(([state, meta]) =>
    checkState(name, region, state, meta, leaves[state], targets.has(state)))
  return [...problems, ...states]
}

// The rows that tie the regions to the stored record must name real states, events and flags.
function checkBridge(tables) {
  const { regions } = tables
  const priority = tables.attention.priority
  const unknownEvents = (label, types) => types.filter(type => !knownEvent(tables, type)).map(type => `${label}: unknown event ${type}`)
  const noStatus = Object.keys(regions.publication.states)
    .filter(state => statusOf(tables, { regions: { publication: { state }, update: { state: 'NONE' } } }) === null)
    .map(state => `status: publication ${state} has no status word`)
  const flags = tables.attention.rules.flatMap(row => row.flags.filter(flag => !priority.includes(flag)))
    .map(flag => `attention: unknown flag ${flag}`)
  const statusEdges = tables.status_edges.flatMap(row => unknownEvents('status_edges', row.events.map(event => event.type)))
  const levelEdges = tables.level_edges.flatMap(row => unknownEvents('level_edges', row.events))
  const seeds = tables.seed.flatMap(row => [
    ...Object.entries(row.states).filter(([name, state]) => !(state in regions[name].states))
      .map(([name, state]) => `seed: unknown state ${name}.${state}`),
    ...unknownEvents('seed', row.events)])
  return [...noStatus, ...flags, ...statusEdges, ...levelEdges, ...seeds]
}

// The rules the tables must obey. An empty list means they hold.
export function checkTables(tables) {
  const regions = Object.entries(tables.regions).flatMap(([name, region]) => checkRegion(tables, name, region))
  return [...regions, ...checkBridge(tables)]
}
