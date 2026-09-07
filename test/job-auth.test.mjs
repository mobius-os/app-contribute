import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const job = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
const preparedReconcile = readFileSync(
  new URL('../prepared_reconcile.py', import.meta.url),
  'utf8',
)

test('the scheduled job uses only its supervised app credential', () => {
  assert.match(job, /APP_TOKEN="\$\{APP_TOKEN:-\}"/)
  assert.match(job, /TOKEN = os\.environ\["APP_TOKEN"\]/)
  assert.match(job, /\/connect-app/)
  assert.match(preparedReconcile, /os\.environ\.get\("APP_TOKEN", ""\)/)
  assert.doesNotMatch(job, /service-token\.txt|SERVICE_TOKEN/)
  assert.doesNotMatch(preparedReconcile, /SERVICE_TOKEN/)
})
