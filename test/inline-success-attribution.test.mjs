import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession } from '../inline-session.js'
import { targetDrifts, targetCaseRecords } from './inline-target-cases.mjs'

const open = (record, number = record.number || 83) => ({ ...record, status: 'open', number,
  url: `https://github.com/${record.plan.repo}/pull/${number}`, updated_at: '2026-10-08T22:03:00Z' })
const reviews = records => ({ state: 'ready', byId: Object.fromEntries(records.map(rec => [rec.id, { state: 'ready' }])) })
const cases = [...targetDrifts, ...[['repo','elsewhere/repo'],['head_sha','f'.repeat(40)]]
  .map(([key,value]) => ({ name: key + ' drift', mutate: records => { records[0].plan[key] = value } }))]
function fixture(original, checkpoint = null, loadExact) {
  let current = original, state, calls = 0
  const key = `chat-send:${original.at(-1).id}`, batch = `chat-send-batch:${original.map(rec => rec.id).join(',')}`
  const session = createInlineSession({ actions: [{ key }, { key: batch }], checkpoint, retain: !!checkpoint,
    loadExact: loadExact || (async id => current.find(rec => rec.id === id)),
    send: async () => { calls++; return { pending: true } }, sendStack: async () => { calls++; return { pending: true } },
    publish: next => { state = next } })
  const ledger = next => { current = next; session.updateLedger(next, true, reviews(next)) }
  ledger(original)
  return { session, key, ledger, get state() { return state }, get calls() { return calls },
    get action() { return state.actions[0] }, async start() { await session.hydrate(); session.activate(key); await session.confirm(key) } }
}
function locked(f, foreign) {
  assert.equal(f.state.retain, true); assert.ok(f.state.checkpoint)
  assert.equal(f.action.disabled, true)
  assert.equal(f.action.status, 'Checking result')
  assert.deepEqual(f.action.links, [])
  assert.deepEqual(f.state.actions[1].links, [])
  assert.doesNotMatch(f.state.summary, /sent/)
  assert.equal(JSON.stringify(f.state).includes(foreign?.url || 'View PR #83'), false)
}
for (const item of cases) for (const cold of [false,true]) test(`${cold?'cold':'live'} foreign successful receipt cannot release or attach links: ${item.name}`, async () => {
  const original = targetCaseRecords(item), first = fixture(original); await first.start()
  const checkpoint = first.state.checkpoint
  const changed = structuredClone(original); item.mutate(changed)
  const next = changed.map(rec => ({...open(rec), ...(item.name === 'PR update url drift' ? {url:rec.url} : {})}))
  const f = cold ? fixture(next,checkpoint) : first
  f.ledger(next); await f.session.hydrate(); locked(f,next.at(-1))
  f.session.activate(f.key); await f.session.confirm(f.key); assert.equal(f.calls,cold?0:1)
  const valid = original.map(rec => open(rec,rec.number||7)); f.ledger(valid); await f.session.hydrate()
  assert.equal(f.state.retain,false); assert.equal(f.state.checkpoint,null)
  assert.equal(f.action.status,'Open'); assert.equal(f.action.links[0].url,valid.at(-1).url)
  assert.match(f.state.summary,/sent/)
})

test('valid newer same-target ledger receipt can settle without borrowing old status', async () => {
  const original = targetCaseRecords({}), f = fixture(original); await f.start()
  f.ledger(original.map(rec=>open(rec,7)))
  assert.equal(f.state.retain,false); assert.equal(f.action.links[0].url,'https://github.com/team/repo/pull/7')
})

test('legacy ID-only checkpoints retain unknown ownership and expose no public receipt', async () => {
  const original = targetCaseRecords({}), checkpoint={id:'legacy',data:JSON.stringify({version:1,phases:[{
    unitKey:'record:phase.1',phaseIds:['phase.1'],state:'pending',note:'Checking result'}]})}
  const f=fixture(original.map(open),checkpoint); await f.session.hydrate(); locked(f)
})

for(const kind of ['missing','wrong-id','error','pending','malformed']) test(`latest ${kind} evidence cannot settle ownership`,async()=>{
  const original=targetCaseRecords({}), first=fixture(original); await first.start()
  const next=original.map(open)
  const f=fixture(next,first.state.checkpoint,async id=>{
    if(kind==='error') throw Error('unavailable')
    if(kind==='missing') return null
    if(kind==='wrong-id') return {...next[0],id:'elsewhere.2'}
    if(kind==='pending') return {...next[0],status:'submitting',url:null,number:null}
    return {...next[0],url:'https://evil.invalid/pull/83'}
  })
  await f.session.hydrate()
  assert.equal(f.state.retain,true); assert.ok(f.state.checkpoint); assert.deepEqual(f.action.links,[])
})

test('public parent context stays bound when only the linked suffix was attempted',async()=>{
  const original=targetCaseRecords({stack:true}); original[0]=open(original[0],11)
  const f=fixture(original); await f.start()
  assert.deepEqual(JSON.parse(f.state.checkpoint.data).phases[0].phaseIds,['child.2'])
  const changed=structuredClone(original); changed[0].plan.head_sha='e'.repeat(40)
  const next=changed.map((rec,index)=>index?open(rec,12):rec); f.ledger(next); await f.session.hydrate(); locked(f,next[1])
  const cold=fixture(next,f.state.checkpoint); await cold.session.hydrate(); locked(cold,next[1])
  cold.ledger(original.map((rec,index)=>index?open(rec,12):rec)); await cold.session.hydrate()
  assert.equal(cold.state.retain,false); assert.equal(cold.action.links[0].url,'https://github.com/team/repo/pull/12')
})

test('newer foreign success context defeats held stale exact generation; later exact target succeeds',async()=>{
  const original=targetCaseRecords({}); let next=original,hold=false,release
  const f=fixture(original,null,id=>hold?new Promise(resolve=>{release=resolve}):Promise.resolve(next.find(rec=>rec.id===id)))
  await f.start(); hold=true; const stale=f.session.hydrate(); hold=false
  next=original.map(rec=>open({...rec,plan:{...rec.plan,branch:'fix/foreign'}})); f.ledger(next)
  await f.session.hydrate(); release(open(original[0],7)); await stale; locked(f,next[0])
  next=original.map(rec=>open(rec,7)); f.ledger(next); await f.session.hydrate()
  assert.equal(f.state.retain,false); assert.equal(f.action.links[0].url,'https://github.com/team/repo/pull/7')
})


test('missing historical linked parent hash cannot be reconstructed from today’s plan', async()=>{
  const original=targetCaseRecords({stack:true}); original[0]=open(original[0],11)
  const first=fixture(original); await first.start()
  const value=JSON.parse(first.state.checkpoint.data); value.phases[0].observations=value.phases[0].observations.filter(before=>before.id==='child.2')
  const next=original.map((rec,index)=>index?open(rec,12):rec)
  const f=fixture(next,{id:'missing-parent',data:JSON.stringify(value)}); await f.session.hydrate(); locked(f,next[1])
})

test('independent batch settles only valid target, preserves foreign remainder and truthful header', async()=>{
  const original=[...targetCaseRecords({}),{...targetCaseRecords({})[0],id:'other.2'}]
  const f=fixture(original), batch=f.state.actions[1].key
  await f.session.hydrate(); f.session.activate(batch); await f.session.confirm(batch)
  const next=[open(original[0],7),open({...original[1],plan:{...original[1].plan,base_branch:'release'}},83)]
  f.ledger(next); await f.session.hydrate()
  assert.equal(f.state.retain,true); assert.equal(JSON.parse(f.state.checkpoint.data).phases.length,1)
  assert.deepEqual(f.state.actions[1].links,[{label:'View PR #7',url:next[0].url}])
  assert.equal(f.state.summary,'1 sent · 1 checking'); assert.equal(f.calls,2)
  const cold=fixture(next,f.state.checkpoint); await cold.session.hydrate()
  assert.equal(cold.state.summary,'1 sent · 1 checking'); assert.equal(cold.calls,0)
  cold.ledger(original.map((rec,index)=>open(rec,index+7))); await cold.session.hydrate()
  assert.equal(cold.state.retain,false); assert.equal(cold.state.summary,'2 sent')
})

test('held success hash cannot adopt new intent and a held callback cannot release busy ownership',async()=>{
  const original=targetCaseRecords({}); let current=original,state,calls=0,releaseHandler
  const key='chat-send:phase.1'
  const session=createInlineSession({actions:[{key}],loadExact:async()=>current[0],publish:next=>{state=next},
    send:()=>{calls++;return new Promise(resolve=>{releaseHandler=resolve})}})
  session.updateLedger(original,true,reviews(original)); await session.hydrate(); session.activate(key)
  const digest=crypto.subtle.digest.bind(crypto.subtle); let releaseHash,sending
  try {
    crypto.subtle.digest=(algorithm,bytes)=>new Promise(resolve=>{releaseHash=()=>digest(algorithm,bytes).then(resolve)})
    sending=session.confirm(key)
    current=original.map(rec=>open({...rec,plan:{...rec.plan,branch:'foreign'}})); session.updateLedger(current,true,reviews(current))
    assert.equal(state.retain,true); assert.deepEqual(state.actions[0].links,[]); assert.equal(calls,0)
    crypto.subtle.digest=digest; await releaseHash()
    const end=Date.now()+4000; while(!calls){assert.ok(Date.now()<end);await new Promise(resolve=>setImmediate(resolve))}
    await session.hydrate(); assert.equal(state.retain,true); assert.deepEqual(state.actions[0].links,[])
    current=original.map(rec=>open(rec,7)); session.updateLedger(current,true,reviews(current)); await session.hydrate()
    assert.equal(state.retain,true); assert.ok(state.checkpoint); assert.equal(state.actions[0].busy,true)
    releaseHandler({pending:true}); await sending
    assert.equal(state.retain,false); assert.equal(state.actions[0].links[0].url,current[0].url); assert.equal(calls,1)
  } finally {crypto.subtle.digest=digest;session.dispose()}
})

for(const status of ['draft','open','landing','merged','closed']) test(`same-target ${status} receipt settles full-hash cold ownership`,async()=>{
  const original=targetCaseRecords({}), first=fixture(original); await first.start()
  const next=original.map(rec=>({...open(rec,7),status})), cold=fixture(next,first.state.checkpoint)
  await cold.session.hydrate()
  assert.equal(cold.state.retain,false); assert.equal(cold.state.checkpoint,null)
  assert.deepEqual(cold.action.links,[{label:'View PR #7',url:next[0].url}]); assert.equal(cold.calls,0)
})
