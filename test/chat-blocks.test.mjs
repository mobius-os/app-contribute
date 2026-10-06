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
