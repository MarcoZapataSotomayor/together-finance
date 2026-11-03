import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthRequestError, authRequest, fetchSession, isSessionResponse } from '../src/auth/api-client.ts'

const session = () => ({ authenticated: false, csrfToken: 'a'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() })
const options = { timeoutMs: 100, retryDelayMs: 1 }

test('session bootstrap retries one temporary cold-start failure', async () => {
  let count = 0
  const fetcher = async () => ++count === 1 ? new Response(null, { status: 503 }) : Response.json(session())
  assert.equal((await fetchSession('/api', undefined, fetcher, options)).authenticated, false)
  assert.equal(count, 2)
})

test('retries are bounded when the server stays unavailable', async () => {
  let count = 0
  const fetcher = async () => { count++; return new Response(null, { status: 502 }) }
  await assert.rejects(fetchSession('/api', undefined, fetcher, options), AuthRequestError)
  assert.equal(count, 2)
})

test('authentication failures do not trigger automatic password retries', async () => {
  let count = 0
  const fetcher = async () => { count++; return new Response(null, { status: 401 }) }
  await assert.rejects(authRequest('/api', 'login', { method: 'POST', body: { password: 'synthetic-test-value' } }, fetcher), AuthRequestError)
  assert.equal(count, 1)
})

test('requests use cookies and a separate CSRF header, never bearer tokens', async () => {
  const fetcher = async (url, init) => {
    assert.equal(url, '/api/auth/logout')
    assert.equal(init.credentials, 'include')
    assert.equal(init.headers['X-CSRF-Token'], 'synthetic-csrf-value')
    assert.equal(init.headers.Authorization, undefined)
    assert.equal(init.redirect, 'error')
    return new Response(null, { status: 204 })
  }
  await authRequest('/api', 'logout', { method: 'POST', csrfToken: 'synthetic-csrf-value', body: {} }, fetcher)
})

test('cancelled bootstraps stop without retrying', async () => {
  const controller = new AbortController()
  controller.abort()
  let count = 0
  const fetcher = async () => { count++; throw new Error('cancelled') }
  await assert.rejects(fetchSession('/api', controller.signal, fetcher, options))
  assert.equal(count, 1)
})

test('expired or malformed responses cannot cause an automatic refresh loop', () => {
  assert.equal(isSessionResponse(session()), true)
  assert.equal(isSessionResponse({ ...session(), expiresAt: 'invalid' }), false)
  assert.equal(isSessionResponse({ ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() }), false)
  assert.equal(isSessionResponse({ ...session(), csrfToken: '' }), false)
})
