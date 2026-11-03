import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/client.ts'
import { ExpenseSubmission } from '../src/features/expenses/expenseSubmission.ts'
import { examplePayload, exampleRecord, ids } from './finance-fixtures.mjs'

test('blocks simultaneous submissions synchronously and accepts only one confirmed save', async () => {
  const submission = new ExpenseSubmission()
  let calls = 0
  let release
  const send = async () => {
    calls++
    return await new Promise((resolve) => {
      release = resolve
    })
  }
  const first = submission.submit(examplePayload(), send, () => ids.expense)
  assert.equal(await submission.submit(examplePayload(), send), null)
  assert.equal(calls, 1)
  release(exampleRecord())
  assert.equal((await first).id, ids.expense)
  assert.equal(submission.confirmed, true)
  assert.equal(await submission.submit(examplePayload(), send), null)
})

test('reuses the same UUID and immutable payload after an uncertain network result', async () => {
  const submission = new ExpenseSubmission()
  let generated = 0
  const requests = []
  const send = async (id, payload) => {
    requests.push({ id, payload })
    if (requests.length === 1) throw new ApiError(0)
    return exampleRecord()
  }
  const makeId = () => {
    generated++
    return ids.expense
  }
  await assert.rejects(submission.submit(examplePayload(), send, makeId))
  assert.equal(submission.uncertain, true)
  await assert.rejects(
    submission.submit(examplePayload({ amount: '200.00' }), send, makeId),
  )
  await submission.submit(examplePayload(), send, makeId)
  assert.equal(generated, 1)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0], requests[1])
})

test('permits a corrected payload after definite validation rejection, using the reserved ID', async () => {
  const submission = new ExpenseSubmission()
  const requests = []
  const send = async (id, payload) => {
    requests.push({ id, payload })
    if (requests.length === 1) throw new ApiError(400)
    return exampleRecord()
  }
  await assert.rejects(
    submission.submit(examplePayload(), send, () => ids.expense),
  )
  assert.equal(submission.uncertain, false)
  await submission.submit(examplePayload({ merchant: 'Corrección' }), send)
  assert.equal(requests[0].id, requests[1].id)
})

test('checking persistence does not issue a second POST; a new intended expense gets a new UUID', async () => {
  const submission = new ExpenseSubmission()
  await assert.rejects(
    submission.submit(
      examplePayload(),
      async () => {
        throw new ApiError(0)
      },
      () => ids.expense,
    ),
  )
  assert.equal(
    (
      await submission.inspect(async (id) => {
        assert.equal(id, ids.expense)
        return exampleRecord()
      })
    ).id,
    ids.expense,
  )
  const next = new ExpenseSubmission()
  let requested
  await next.submit(
    examplePayload(),
    async (id) => {
      requested = id
      return exampleRecord({ id })
    },
    () => '00000000-0000-4000-8000-000000000099',
  )
  assert.notEqual(requested, ids.expense)
})

test('a conflicting or deleted recovered record is not falsely confirmed as the submitted draft', async () => {
  const submission = new ExpenseSubmission()
  await assert.rejects(
    submission.submit(
      examplePayload(),
      async () => {
        throw new ApiError(0)
      },
      () => ids.expense,
    ),
  )
  for (const record of [
    exampleRecord({ amount: '200.00' }),
    exampleRecord({ deletedAt: '2026-10-31T12:00:00Z' }),
  ]) {
    await assert.rejects(
      submission.inspect(async () => record),
      (error) => error.status === 409,
    )
    assert.equal(submission.confirmed, false)
    assert.equal(submission.uncertain, true)
  }
  assert.equal(submission.pendingId, ids.expense)
})

test('a UUID-generation failure cannot lock a draft as an ambiguous network submission', async () => {
  const submission = new ExpenseSubmission()
  let sent = false
  await assert.rejects(
    submission.submit(
      examplePayload(),
      async () => {
        sent = true
        return exampleRecord()
      },
      () => {
        throw new Error('Secure UUID generation unavailable')
      },
    ),
  )
  assert.equal(sent, false)
  assert.equal(submission.uncertain, false)
  assert.equal(submission.pendingId, null)
})
