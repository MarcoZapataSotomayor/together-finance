import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiRequest } from '../src/api/client.ts'
import {
  createDataManagementApi,
  csvBlob,
  deletedRecord,
} from '../src/api/dataManagement.ts'

const id = '00000000-0000-4000-8000-000000000001'
const filters = {
  from: '2026-10-01',
  to: '2026-10-31',
  scope: 'active',
  personId: id,
}
const csv =
  '\ufeff"Consumo ID","Importe","Lugar"\r\n"id","999999999999.99","\t=1+2"\r\n'
const binRow = {
  kind: 'repayment',
  id,
  description: 'Pago de ejemplo',
  amount: '0.01',
  currency: 'PEN',
  transactionDate: '2026-10-31',
  deletedAt: '2026-11-01T00:00:00Z',
  people: [{ id, name: 'Antonella', role: 'Deudor' }],
  morePeople: 0,
  parent: { kind: 'expense', id, active: false },
  canRestore: false,
}
test('downloads exact protected CSV bytes with credentials, explicit filters and no tokens', async () => {
  let request
  const api = createDataManagementApi(
    '/api',
    () => assert.fail(),
    async (url, options) => {
      request = { url, options }
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="together-finance-consumos.csv"',
        },
      })
    },
  )
  const file = await api.export('expenses', filters)
  const bytes = new Uint8Array(await file.blob.arrayBuffer())
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191])
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), csv)
  assert.equal(file.filename, 'together-finance-consumos.csv')
  assert.equal(request.options.credentials, 'include')
  assert.equal(request.options.cache, 'no-store')
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.body, undefined)
  assert.deepEqual(request.options.headers, {})
  const url = new URL(request.url, 'https://app.example')
  assert.equal(url.searchParams.get('personId'), id)
  assert.equal(url.searchParams.get('scope'), 'active')
  assert.equal(url.searchParams.get('from'), filters.from)
})
test('retains default JSON behavior while explicitly supporting a raw response', async () => {
  const result = await apiRequest('/api', 'example', {}, async () =>
    Response.json({ safe: true }),
  )
  assert.deepEqual(result, { safe: true })
  const response = await apiRequest(
    '/api',
    'example',
    { responseType: 'response' },
    async () => new Response('CSV'),
  )
  assert.equal(await response.text(), 'CSV')
})
test('rejects untrusted filenames and uses a safe deterministic fallback', async () => {
  for (const name of [
    '../../secret.csv',
    'evil.html',
    'together-finance-x.csv.exe',
  ]) {
    const api = createDataManagementApi(
      '/api',
      () => {},
      async () =>
        new Response(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="${name}"`,
          },
        }),
    )
    assert.equal(
      (await api.export('expenses', filters)).filename,
      'together-finance-consumos-activos-2026-10-01-a-2026-10-31.csv',
    )
  }
})
test('bounds received bytes even without a Content-Length and cancels oversized streams', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(
    csvBlob(new Response(body, { headers: { 'Content-Type': 'text/csv' } })),
    (e) => e instanceof ApiError && e.status === 413,
  )
  assert.equal(cancelled, true)
  await assert.rejects(
    csvBlob(
      new Response('x', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Length': String(9 * 1024 * 1024),
        },
      }),
    ),
    (e) => e.status === 413,
  )
  await assert.rejects(
    csvBlob(Response.json({ private: true })),
    (e) => e.status === 502,
  )
})
test('cancellation stops a pending body read and never returns a partial download', async () => {
  const controller = new AbortController()
  let cancelled = false
  const work = csvBlob(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      { headers: { 'Content-Type': 'text/csv' } },
    ),
    controller.signal,
  )
  controller.abort(new Error('Cancelled'))
  await assert.rejects(work, /Cancelled/)
  assert.equal(cancelled, true)
})
test('handles interrupted streams as network failures', async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1]))
      c.error(new Error('Internal connection details'))
    },
  })
  await assert.rejects(
    csvBlob(new Response(body, { headers: { 'Content-Type': 'text/csv' } })),
    (e) =>
      e instanceof ApiError &&
      e.status === 0 &&
      !e.message.includes('Internal'),
  )
})
test('expires the session on 401 without retrying the download', async () => {
  let expired = 0,
    calls = 0
  const api = createDataManagementApi(
    '/api',
    () => expired++,
    async () => {
      calls++
      return new Response(null, { status: 401 })
    },
  )
  await assert.rejects(api.export('loans', filters), (e) => e.status === 401)
  assert.equal(expired, 1)
  assert.equal(calls, 1)
})
test('preserves 403, 409 and 413 and does not auto-repeat exports on network errors', async () => {
  for (const status of [403, 409, 413, 503, 0]) {
    let calls = 0
    const api = createDataManagementApi(
      '/api',
      () => assert.fail(),
      async () => {
        calls++
        if (!status) throw new Error('Private network details')
        return new Response(null, { status })
      },
    )
    await assert.rejects(
      api.export('debts', filters),
      (e) => e instanceof ApiError && e.status === status,
    )
    assert.equal(calls, 1)
  }
})
test('loads a paginated unified bin with deletion filters and explicit parent restoration state', async () => {
  const api = createDataManagementApi(
    '/api',
    () => assert.fail(),
    async (url, options) => {
      assert.match(url, /type=repayment/)
      assert.match(url, /deletedFrom=2026-11-01/)
      assert.match(url, /page=2/)
      assert.equal(options.credentials, 'include')
      return Response.json({ data: [binRow], total: 21, page: 2, pageSize: 20 })
    },
  )
  assert.deepEqual(
    (await api.list({ type: 'repayment', deletedFrom: '2026-11-01' }, 2)).data,
    [binRow],
  )
  assert.equal(
    deletedRecord({
      ...binRow,
      parent: { kind: 'expense', id: 'javascript:bad', active: false },
    }),
    false,
  )
  assert.equal(deletedRecord({ ...binRow, amount: 0.01 }), false)
})
test('supports empty datasets and rejects malformed bin responses', async () => {
  const api = createDataManagementApi(
    '/api',
    () => {},
    async () => Response.json({ data: [], total: 0, page: 1, pageSize: 20 }),
  )
  assert.deepEqual((await api.list({})).data, [])
  const broken = createDataManagementApi(
    '/api',
    () => {},
    async () =>
      Response.json({
        data: [{ ...binRow, currency: 'USD' }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
  )
  await assert.rejects(broken.list({}), (e) => e.status === 502)
})
test('loads active and inactive historical people without guessing POV identities', async () => {
  const people = [{ id, name: 'Antonella', isActive: false }]
  const api = createDataManagementApi(
    '/api',
    () => {},
    async (url) => {
      assert.match(url, /data-management\/people\?page=1&pageSize=100/)
      return Response.json({ data: people, total: 1, page: 1, pageSize: 100 })
    },
  )
  assert.deepEqual(await api.people(), people)
})
