import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/client.ts'
import { CreationSubmission } from '../src/features/debts/creationSubmission.ts'
import { loanInput, paymentInput } from './debt-fixtures.mjs'

test('blocks simultaneous submissions and confirmed duplicate clicks for loans and repayments', async () => {
  for (const payload of [loanInput(), paymentInput()]) {
    const controller = new CreationSubmission()
    let release,
      calls = 0
    const send = async () => {
      calls++
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const first = controller.submit(payload, send, () => 'test-id')
    assert.equal(await controller.submit(payload, send), null)
    release({ id: 'test-id' })
    await first
    assert.equal(await controller.submit(payload, send), null)
    assert.equal(calls, 1)
  }
})

test('freezes an unknown outcome and reuses its UUID/payload after network failure or 409', async () => {
  for (const status of [0, 409, 503]) {
    const controller = new CreationSubmission(),
      payload = paymentInput(),
      requests = []
    const send = async (id, data) => {
      requests.push({ id, data })
      if (requests.length === 1) throw new ApiError(status)
      return { id }
    }
    await assert.rejects(controller.submit(payload, send, () => 'stable-id'))
    assert.equal(controller.uncertain, true)
    await assert.rejects(
      controller.submit({ ...payload, amount: '31.00' }, send),
    )
    await controller.submit(payload, send, () => 'must-not-be-used')
    assert.deepEqual(requests, [
      { id: 'stable-id', data: payload },
      { id: 'stable-id', data: payload },
    ])
  }
})

test('allows corrections after definite validation/CSRF/authentication failures without losing entered fields', async () => {
  for (const status of [400, 401, 403]) {
    const controller = new CreationSubmission()
    await assert.rejects(
      controller.submit(
        loanInput(),
        async () => {
          throw new ApiError(status)
        },
        () => 'stable-id',
      ),
    )
    assert.equal(controller.uncertain, false)
    const corrected = loanInput({ description: 'Corregido' })
    await controller.submit(corrected, async (id, payload) => {
      assert.equal(id, 'stable-id')
      assert.equal(payload.description, 'Corregido')
      return { id }
    })
  }
})

test('checks a pending UUID with GET and confirms only matching records without another POST', async () => {
  const controller = new CreationSubmission()
  let posts = 0
  await assert.rejects(
    controller.submit(
      paymentInput(),
      async () => {
        posts++
        throw new ApiError(0)
      },
      () => 'stable-id',
    ),
  )
  await assert.rejects(
    controller.inspect(
      async (id) => ({ id, amount: '99.00' }),
      (row, payload) => row.amount === payload.amount,
    ),
    (error) => error.status === 409,
  )
  await controller.inspect(
    async (id) => ({ id, ...paymentInput() }),
    (row, payload) => row.amount === payload.amount,
  )
  assert.equal(controller.confirmed, true)
  assert.equal(posts, 1)
  assert.equal(controller.uncertain, false)
})

test('retains a pending creation through not-found inspection and gives a new intent its own UUID', async () => {
  const pending = new CreationSubmission()
  await assert.rejects(
    pending.submit(
      loanInput(),
      async () => {
        throw new ApiError(0)
      },
      () => 'first',
    ),
  )
  await assert.rejects(
    pending.inspect(
      async () => {
        throw new ApiError(404)
      },
      () => true,
    ),
  )
  assert.equal(pending.pendingId, 'first')
  assert.equal(pending.uncertain, true)
  const fresh = new CreationSubmission()
  await fresh.submit(
    loanInput(),
    async (id) => ({ id }),
    () => 'second',
  )
  assert.equal(fresh.pendingId, 'second')
})

test('explicit correction changes fields while retaining the reserved UUID across further failures', async () => {
  const controller = new CreationSubmission(),
    seen = []
  await assert.rejects(
    controller.submit(
      paymentInput(),
      async (id, payload) => {
        seen.push({ id, payload })
        throw new ApiError(0)
      },
      () => 'reserved',
    ),
  )
  controller.allowCorrection()
  await assert.rejects(
    controller.submit(
      paymentInput({ amount: '20.00' }),
      async (id, payload) => {
        seen.push({ id, payload })
        throw new ApiError(400)
      },
    ),
  )
  assert.equal(controller.uncertain, true)
  controller.allowCorrection()
  await controller.submit(
    paymentInput({ amount: '25.00' }),
    async (id, payload) => {
      seen.push({ id, payload })
      return { id }
    },
  )
  assert.deepEqual(
    seen.map((row) => row.id),
    ['reserved', 'reserved', 'reserved'],
  )
  assert.equal(controller.confirmed, true)
})

test('inspection cannot confirm a different UUID even when its financial fields match', async () => {
  const controller = new CreationSubmission()
  await assert.rejects(
    controller.submit(
      loanInput(),
      async () => {
        throw new ApiError(0)
      },
      () => 'reserved',
    ),
  )
  await assert.rejects(
    controller.inspect(
      async () => ({ id: 'different' }),
      () => true,
    ),
    (error) => error.status === 409,
  )
  assert.equal(controller.confirmed, false)
})
