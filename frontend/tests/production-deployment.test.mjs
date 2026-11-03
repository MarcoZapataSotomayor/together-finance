import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkProductionConfig,
  configureProduction,
  productionApiDestination,
} from '../scripts/check-production-config.mjs'
import { writeProductionConfig } from '../scripts/configure-production.mjs'

const base = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
)
// Synthetic origins are used only as string fixtures; these tests never access a provider.
const env = {
  PRODUCTION_RENDER_ORIGIN: 'https://finance-api.onrender.com',
  PRODUCTION_FRONTEND_ORIGIN: 'https://finance.vercel.app',
  PRODUCTION_HOSTS_APPROVED: 'yes',
  VITE_API_URL: '/api',
}
const configured = () => configureProduction(base, env)
test('production configuration contains no guessed hostname and remains blocked until configured', () => {
  const unconfigured = structuredClone(base)
  unconfigured.rewrites = []
  assert.ok(base.rewrites.length <= 1)
  assert.equal(base.buildCommand.includes('check-staging'), false)
  assert.equal(JSON.stringify(base).includes('.invalid'), false)
  assert.throws(() => checkProductionConfig(unconfigured, env))
  assert.throws(() => configureProduction(base, {}))
  assert.throws(() =>
    configureProduction(base, { ...env, PRODUCTION_HOSTS_APPROVED: undefined }),
  )
  assert.throws(() =>
    configureProduction(base, {
      ...env,
      PRODUCTION_FRONTEND_ORIGIN: 'https://*.example.com',
    }),
  )
})
test('only the reviewed exact production Render origin can receive the API rewrite', () => {
  assert.doesNotThrow(() => checkProductionConfig(configured(), env))
  for (const value of [
    'http://finance-api.onrender.com',
    `${env.PRODUCTION_RENDER_ORIGIN}/`,
    `${env.PRODUCTION_RENDER_ORIGIN}/api`,
    'https://unconfigured.invalid',
    'https://user:placeholder@finance-api.onrender.com',
    'https://finance-api.onrender.com.attacker.invalid',
    env.PRODUCTION_FRONTEND_ORIGIN,
  ])
    assert.throws(() =>
      configureProduction(base, { ...env, PRODUCTION_RENDER_ORIGIN: value }),
    )
  const changed = configured()
  changed.rewrites[0].destination = 'https://another.onrender.com/api/:path*'
  assert.throws(() => checkProductionConfig(changed, env))
})
test('stable production deployment checks project metadata and exact API base', () => {
  const cloud = {
    ...env,
    VERCEL: '1',
    VERCEL_ENV: 'production',
    VERCEL_PROJECT_PRODUCTION_URL: 'finance.vercel.app',
  }
  assert.doesNotThrow(() => checkProductionConfig(configured(), cloud))
  for (const change of [
    { VERCEL_ENV: 'preview' },
    { VERCEL_PROJECT_PRODUCTION_URL: 'other.vercel.app' },
    { VITE_API_URL: 'https://finance-api.onrender.com/api' },
  ])
    assert.throws(() =>
      checkProductionConfig(configured(), { ...cloud, ...change }),
    )
})
test('production policy rejects automatic delivery, redirects, fallback routes and caching', () => {
  for (const change of [
    (c) => {
      c.git.deploymentEnabled = true
    },
    (c) => {
      c.routes = []
    },
    (c) => {
      c.redirects = []
    },
    (c) => {
      c.rewrites.push({ source: '/(.*)', destination: '/index.html' })
    },
    (c) => {
      c.headers[1].headers.pop()
    },
    (c) => {
      c.headers[1].headers[0].value = 'public, max-age=60'
    },
    (c) => {
      c.headers[1].headers.push({
        key: 'x-vercel-enable-rewrite-caching',
        value: '1',
      })
    },
  ]) {
    const config = configured()
    change(config)
    assert.throws(() => checkProductionConfig(config, env))
  }
})
test('API mapping preserves prefix, encoding, queries and CSV paths without recursive routing', () => {
  for (const path of [
    '/api',
    '/api/auth/session',
    '/api/expenses?page=2',
    '/api/exports/expenses.csv?from=2026-10-01&to=2026-10-31',
    '/api/people/a%20b',
  ])
    assert.equal(
      productionApiDestination(path, configured(), env),
      `${env.PRODUCTION_RENDER_ORIGIN}${path}`,
    )
  for (const path of [
    '/apiary',
    '/api/../dashboard',
    '/dashboard',
    '/api/health#fragment',
    'https://attacker.invalid/api/health',
  ])
    assert.throws(() => productionApiDestination(path, configured(), env))
})
test('configuration writer changes only a local public config after approval and retains policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-production-config-'))
  try {
    const path = join(directory, 'vercel.json'),
      original = JSON.stringify(base)
    await writeFile(path, original)
    await assert.rejects(writeProductionConfig(path, {}))
    assert.equal(await readFile(path, 'utf8'), original)
    await writeProductionConfig(path, env)
    const result = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(result.headers, base.headers)
    assert.deepEqual(result, configured())
  } finally {
    await unlink(join(directory, 'vercel.json'))
    await rmdir(directory)
  }
})
