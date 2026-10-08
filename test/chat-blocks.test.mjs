import test from 'node:test'
import assert from 'node:assert/strict'
import { contributeBlockTarget, pullConversations, recordsForPull } from '../chat-blocks.js'
const pr = { repository:{nameWithOwner:'owner/repo'},number:7 }
test('PR transcript targets are read-only identities, not workflow starts', () => {
  assert.deepEqual(contributeBlockTarget('chat-pull:owner/repo#7'),{kind:'pull',repo:'owner/repo',number:7,embedded:true})
  assert.deepEqual(contributeBlockTarget('pull-request:owner/repo#7'),{kind:'pull',repo:'owner/repo',number:7,embedded:false})
  assert.equal(contributeBlockTarget('chat-pull:../repo#7'),null)
  assert.equal(contributeBlockTarget('chat-pull:owner/repo#0'),null)
  assert.equal(contributeBlockTarget('review_fix_merge:owner/repo#7'),null)
})
test('source, fix and review provenance belongs to the same repo and PR', () => {
  const records = [{repo:'owner/repo',number:7,chat_id:'source-1',chat_ids:['source-1','source-2'],quality_review:{chat_id:'review-1'},autopilot:{chat_id:'fix-1'}}, {repo:'other/repo',number:7,chat_id:'wrong'}]
  assert.equal(recordsForPull(records,pr).length,1)
  const links=pullConversations(records,[{chat_id:'run-1',items:[{repo:'owner/repo',number:7}]}],pr)
  assert.deepEqual(links.map(x=>x.chat_id),['source-1','source-2','review-1','fix-1','run-1'])
  assert.equal(links[0].role,'source')
})
test('a prepared transcript block names one ledger record and nothing else', () => {
  assert.equal(contributeBlockTarget('chat-prepared:00000000-0000-4000-8000-000000000001'), null)
  assert.equal(contributeBlockTarget('chat-prepared:../escape'),null)
  assert.equal(contributeBlockTarget('chat-prepared:'),null)
  assert.deepEqual(contributeBlockTarget('chat-send:rec-1'),{kind:'prepared',id:'rec-1',embedded:true,confirm:true})
  assert.equal(contributeBlockTarget('chat-send:../x'),null)
  assert.equal(contributeBlockTarget('chat-prepared:a b'),null)
})
test('a batch names 1 to 12 safe record ids, deduplicated, and nothing else', () => {
  assert.deepEqual(contributeBlockTarget('chat-send-batch:a-1,b.2,a-1'),{kind:'batch',ids:['a-1','b.2'],embedded:true})
  assert.equal(contributeBlockTarget('chat-send-batch:'),null)
  assert.equal(contributeBlockTarget('chat-send-batch:a,../b'),null)
  assert.equal(contributeBlockTarget('chat-send-batch:'+Array.from({length:13},(_, i)=>`r${i}`).join(',')),null)
})
test('prepared and batch targets share bounded dotted record ID grammar', () => {
  for (const id of ['a', 'release.1', `a${'.'.repeat(127)}`]) {
    assert.equal(contributeBlockTarget(`chat-send:${id}`)?.id, id)
    assert.deepEqual(contributeBlockTarget(`chat-send-batch:${id},b`)?.ids, [id, 'b'])
  }
  for (const id of ['.hidden', 'a/b', '../a', `a${'.'.repeat(128)}`, 'a b']) {
    assert.equal(contributeBlockTarget(`chat-send:${id}`), null, id)
    assert.equal(contributeBlockTarget(`chat-send-batch:${id},b`), null, id)
  }
})
