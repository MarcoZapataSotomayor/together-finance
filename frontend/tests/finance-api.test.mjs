import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiRead } from '../src/api/client.ts'
import { createFinanceApi, financeError } from '../src/api/finance.ts'
import {
  examplePayload,
  exampleRecord,
  ids,
  references,
} from './finance-fixtures.mjs'

test('loads saved expenses using every backend filter and bounded pagination', async () => {
  let requested
  const api = createFinanceApi(
    '/api',
    'test-csrf',
    () => {},
    async (url, options) => {
      requested = { url, options }
      return Response.json({
        data: [exampleRecord()],
        total: 1,
        page: 2,
        pageSize: 10,
      })
    },
  )
  const result = await api.list(
    {
      categoryId: ids.category,
      beneficiaryPersonId: ids.first,
      fundedByPersonId: ids.third,
      classification: 'SHARED',
      purchasedFrom: '2026-10-01',
      purchasedTo: '2026-10-31',
    },
    2,
    10,
  )
  assert.equal(result.data[0].id, ids.expense)
  const query = new URL(requested.url, 'http://example.invalid').searchParams
  for (const [key, value] of Object.entries({
    page: '2',
    pageSize: '10',
    categoryId: ids.category,
    beneficiaryPersonId: ids.first,
    fundedByPersonId: ids.third,
    classification: 'SHARED',
  }))
    assert.equal(query.get(key), value)
  assert.equal(requested.options.credentials, 'include')
  assert.equal(requested.options.cache, 'no-store')
})

test('creates explicit personal/shared payloads and never infers funder from card ownership', async () => {
  const requests = []
  const api = createFinanceApi(
    '/api',
    'test-csrf',
    () => {},
    async (url, options) => {
      requests.push({ url, options })
      return Response.json(exampleRecord())
    },
  )
  await api.create(
    ids.expense,
    examplePayload({
      classification: 'PERSONAL',
      allocations: [{ personId: ids.second, percentage: '100' }],
    }),
  )
  await api.create(ids.expense, examplePayload())
  for (const request of requests) {
    const body = JSON.parse(request.options.body)
    assert.equal(body.fundedByPersonId, ids.third)
    assert.equal(body.paymentMethodId, ids.method)
    assert.equal(body.categoryId, ids.category)
    assert.equal(request.options.headers['X-CSRF-Token'], 'test-csrf')
    assert.equal(request.options.credentials, 'include')
    assert.equal(Object.hasOwn(body, 'pov'), false)
    assert.equal(Object.hasOwn(body.allocations[0], 'amount'), false)
  }
  assert.equal(
    JSON.parse(requests[0].options.body).allocations[0].percentage,
    '100',
  )
  assert.equal(JSON.parse(requests[1].options.body).allocations.length, 2)
})

test('updates, soft-deletes, restores and retrieves using actual API methods and shapes', async () => {
  const requests = []
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async (url, options) => {
      requests.push({ url, options })
      return options.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json(exampleRecord())
    },
  )
  await api.update(ids.expense, { merchant: 'Cambio explícito' })
  await api.remove(ids.expense)
  await api.restore(ids.expense)
  await api.get(ids.expense)
  assert.deepEqual(
    requests.map((row) => row.options.method),
    ['PATCH', 'DELETE', 'POST', 'GET'],
  )
  assert.ok(requests[2].url.endsWith('/restore'))
  assert.equal(requests[2].options.body, '{}')
})

test('loads all reference pages and persists new options through the API', async () => {
  const calls = []
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async (url, options) => {
      calls.push({ url, options })
      const path = new URL(url, 'http://example.invalid').pathname
      if (options.method === 'POST')
        return Response.json({
          id: ids.method,
          ...JSON.parse(options.body),
          isActive: true,
        })
      const data = path.endsWith('people')
        ? references.people
        : path.endsWith('categories')
          ? references.categories
          : references.methods
      return Response.json({ data, total: data.length, page: 1, pageSize: 100 })
    },
  )
  assert.deepEqual(await api.references(), references)
  await api.createPerson('Persona nueva')
  await api.createCategory('Categoría nueva')
  await api.createMethod('Medio nuevo', 'DEBIT_CARD', ids.second)
  const mutation = calls.filter((row) => row.options.method === 'POST')
  assert.deepEqual(
    mutation.map((row) => new URL(row.url, 'http://example.invalid').pathname),
    ['/api/people', '/api/categories', '/api/payment-methods'],
  )
  assert.equal(JSON.parse(mutation[2].options.body).ownerPersonId, ids.second)
})

test('401 invalidates the shared session; 403 and 409 preserve caller control without retrying writes', async () => {
  for (const status of [401, 403, 409]) {
    let invalidated = 0
    let attempts = 0
    const api = createFinanceApi(
      '/api',
      'csrf',
      () => invalidated++,
      async () => {
        attempts++
        return Response.json(
          { message: 'Internal content is not displayed' },
          { status },
        )
      },
    )
    await assert.rejects(
      api.create(ids.expense, examplePayload()),
      (error) => error instanceof ApiError && error.status === status,
    )
    assert.equal(attempts, 1)
    assert.equal(invalidated, status === 401 ? 1 : 0)
    assert.equal(
      financeError(new ApiError(status), 'edit').includes('Internal'),
      false,
    )
  }
})

test('network errors never automatically repeat a financial mutation', async () => {
  let attempts = 0
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async () => {
      attempts++
      throw new TypeError('Failed to fetch')
    },
  )
  await assert.rejects(
    api.update(ids.expense, { amount: '90.00' }),
    (error) => error.status === 0,
  )
  assert.equal(attempts, 1)
})

test('safe reads recover once from cold starts and stop on cancellation or repeated failure', async () => {
  let attempts = 0
  const fetcher = async () => {
    attempts++
    return attempts === 1
      ? new Response(null, { status: 503 })
      : Response.json({ confirmed: true })
  }
  assert.deepEqual(
    await apiRead('/api', 'expenses', undefined, fetcher, { retryDelayMs: 1 }),
    { confirmed: true },
  )
  assert.equal(attempts, 2)
  attempts = 0
  await assert.rejects(
    apiRead(
      '/api',
      'expenses',
      undefined,
      async () => {
        attempts++
        return new Response(null, { status: 503 })
      },
      { retryDelayMs: 1 },
    ),
  )
  assert.equal(attempts, 2)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    apiRead(
      '/api',
      'expenses',
      controller.signal,
      async () => {
        throw new TypeError()
      },
      { retryDelayMs: 1 },
    ),
  )
})

test('malformed financial responses fail explicitly instead of appearing as empty records', async () => {
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async () => Response.json({ data: [{}], total: 1, page: 1, pageSize: 20 }),
  )
  await assert.rejects(api.list({}), (error) => error.status === 502)
})

test('loads the authenticated deleted-record view using the backend deletion-state filter', async () => {
  let requested
  const deleted = exampleRecord({ deletedAt: '2026-10-31T12:00:00Z' })
  deleted.allocations = deleted.allocations.map((row) => ({
    ...row,
    active: false,
  }))
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async (url) => {
      requested = url
      return Response.json({ data: [deleted], total: 1, page: 1, pageSize: 20 })
    },
  )
  assert.equal(
    (await api.list({ deletionState: 'deleted' })).data[0].deletedAt,
    deleted.deletedAt,
  )
  assert.equal(
    new URL(requested, 'http://example.invalid').searchParams.get(
      'deletionState',
    ),
    'deleted',
  )
})

test('reference loading follows every page rather than silently truncating to the first page', async () => {
  const pages = []
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async (url) => {
      const parsed = new URL(url, 'http://example.invalid'),
        number = Number(parsed.searchParams.get('page'))
      const people = parsed.pathname.endsWith('/people')
      if (people) pages.push(number)
      return Response.json({
        data: people
          ? number === 1
            ? Array.from({ length: 100 }, () => references.people[0])
            : [references.people[1]]
          : [],
        total: people ? 101 : 0,
        page: number,
        pageSize: 100,
      })
    },
  )
  assert.equal((await api.references()).people.length, 101)
  assert.deepEqual(pages, [1, 2])
})

test('validation failures retain only known field names and never expose backend error bodies', async () => {
  const api = createFinanceApi(
    '/api',
    'csrf',
    () => {},
    async () =>
      Response.json(
        {
          message: [
            'amount is invalid',
            'allocations.0.percentage must be a string',
            'Private driver content',
          ],
        },
        { status: 400 },
      ),
  )
  await assert.rejects(api.create(ids.expense, examplePayload()), (error) => {
    assert.deepEqual(error.fields, ['amount', 'allocations'])
    assert.equal(error.message, 'API request failed')
    return true
  })
})
