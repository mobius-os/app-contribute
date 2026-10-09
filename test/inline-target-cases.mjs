// Publication identity drift shared by production-session and mounted probes.
export const targetRecord = (id = 'phase.1') => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo',
  plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40), branch: 'fix/original', base_branch: 'main', base_sha: 'b'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) }, updated_at: '2026-10-08T22:00:00Z' })
const field = (object, key, value) => { if (value === undefined) delete object[key]; else object[key] = value }
export const targetDrifts = [
  ...[['branch', 'fix/different'], ['branch', undefined], ['base_branch', 'release'], ['base_branch', undefined], ['base_sha', 'c'.repeat(40)], ['base_sha', undefined], ['head_ref', 'refs/heads/other']]
    .map(([key, value]) => ({ name: `flat ${key} ${value === undefined ? 'missing' : 'drift'}`, mutate: records => field(records[0].plan, key, value) })),
  ...[['id','other-chain'], ['position',1], ['total',3], ['base_branch','stack/s/other'], ['base_branch',undefined], ['parent_record_id','other.3'], ['parent_record_id',undefined]]
    .map(([key,value]) => ({ name: `nested stack ${key} ${value === undefined ? 'missing' : 'drift'}`, stack: true, mutate: records => field(records[1].plan.stack,key,value) })),
  { name: 'stack parent version drift', stack: true, mutate: records => { records[0].plan.head_sha = 'e'.repeat(40) } },
  { name: 'stack member missing', stack: true, mutate: records => { records.splice(0,1) } },
  ...[['number',8],['url','https://github.com/team/repo/pull/8'],['head_repository','other/fork']]
    .map(([key,value])=>({name:`PR update ${key} drift`,update:true,mutate:records=>field(records[0],key,value)})),
  { name:'PR update target URL drift',update:true,mutate:records=>{records[0].plan.target_url='https://github.com/team/repo/pull/8'} },
  { name:'nested successor base drift',mutate:records=>{records[0].plan.successor={base_branch:'release',head_sha:'a'.repeat(40)}} },
]
export function targetCaseRecords(item) {
  const a = targetRecord()
  if(item.update) Object.assign(a,{number:7,url:'https://github.com/team/repo/pull/7',head_repository:'team/fork',plan:{...a.plan,action:'pr_update',target_url:'https://github.com/team/repo/pull/7'}})
  if(!item.stack) return [a]
  const b = targetRecord('child.2')
  for(const [index,rec] of [a,b].entries()) Object.assign(rec.plan,{branch:`stack/s/${rec.id}`,base_sha:index?'a'.repeat(40):'b'.repeat(40),stack:{id:'s',position:index+1,total:2,parent_record_id:index?a.id:'',base_branch:index?`stack/s/${a.id}`:'main'}})
  return [a,b]
}
