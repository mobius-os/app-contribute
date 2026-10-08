import assert from 'node:assert/strict'
import test from 'node:test'
import * as collaboration from '../collaboration.js'

test('execution labels outrank aggregate progress without discarding unknown saved states', () => {
  const label = collaboration.reviewRunStateLabel
  assert.equal(typeof label, 'function')
  for (const [execution_state, expected] of [['stopped','Stopped'],['failed','Failed'],['interrupted','Interrupted'],['awaiting_owner','Waiting for your answer']]) {
    assert.equal(label({execution_state,state:'reviewing'}),expected)
  }
  assert.equal(label({execution_state:'running',state:'all_clear'}),'Review clear')
  assert.equal(label({state:'future_state'}),'future_state')
})

test('halted unfinished items are not active; saved settled and queued evidence survives', () => {
  const progress = collaboration.reviewItemProgress
  assert.equal(typeof progress, 'function')
  const facts = {all_clear:'Review clear',merged:'Merged',queued:'In merge queue',complete:'Complete'}
  for (const execution_state of ['stopped','failed','interrupted','awaiting_owner']) {
    for (const state of ['reviewing','repairing','merging','pending']) {
      const value = progress({execution_state},{state})
      assert.equal(value.halted, execution_state !== 'awaiting_owner')
      assert.equal(value.waiting, execution_state === 'awaiting_owner')
      assert.equal(value.label, execution_state === 'awaiting_owner' ? collaboration.REVIEW_STATE_NAMES[state] : 'Not finished')
    }
    for (const [state,label] of Object.entries(facts)) {
      assert.deepEqual(progress({execution_state},{state}), {label,halted:false,waiting:false})
    }
  }
  assert.deepEqual(progress({state:'reviewing'},{state:'future_state'}),{label:'future_state',halted:false,waiting:false})
})
