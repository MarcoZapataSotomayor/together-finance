import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  checkStagingConfig,
  stagingApiDestination,
} from '../scripts/check-staging-config.mjs'

const template = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
)
const env = {
  STAGING_RENDER_ORIGIN: 'https://finance-api-staging.onrender.com',
  STAGING_FRONTEND_ORIGIN: 'https://finance-staging.vercel.app',
  VITE_API_URL: '/api',
}
function configured() {
  const config = structuredClone(template)
  config.rewrites[0].destination = `${env.STAGING_RENDER_ORIGIN}/api/:path*`
  return config
}

test('the committed staging template is syntactically valid but cannot build with an unconfigured target', () => {
  assert.match(template.rewrites[0].destination, /\.invalid\//)
  assert.throws(() => checkStagingConfig(template, env), /reviewed Render/)
  assert.equal(template.git.deploymentEnabled, false)
})
test('a reviewed staging origin supports the exact same-origin API build', () => {
  assert.deepEqual(checkStagingConfig(configured(), env), {
    frontend: env.STAGING_FRONTEND_ORIGIN,
    backend: env.STAGING_RENDER_ORIGIN,
  })
  assert.throws(() =>
    checkStagingConfig(configured(), {
      ...env,
      VITE_API_URL: 'https://production.example/api',
    }),
  )
  assert.throws(() =>
    checkStagingConfig(configured(), { ...env, VITE_API_URL: undefined }),
  )
})
test('rejects production-like, recursive, HTTP, ambiguous and credential-bearing origins', () => {
  for (const value of [
    'https://finance-api.onrender.com',
    env.STAGING_FRONTEND_ORIGIN,
    'http://finance-api-staging.onrender.com',
    `${env.STAGING_RENDER_ORIGIN}/`,
    `${env.STAGING_RENDER_ORIGIN}/api`,
    `${env.STAGING_RENDER_ORIGIN}?target=production`,
    'https://user:placeholder@finance-api-staging.onrender.com',
    'https://finance-api-staging.onrender.com.attacker.invalid',
  ])
    assert.throws(() =>
      checkStagingConfig(configured(), {
        ...env,
        STAGING_RENDER_ORIGIN: value,
      }),
    )
  assert.throws(() =>
    checkStagingConfig(configured(), {
      ...env,
      STAGING_FRONTEND_ORIGIN: 'https://finance.vercel.app',
    }),
  )
})
test('a rewrite edit cannot silently bypass the independently configured public origin pin', () => {
  for (const destination of [
    'https://finance-api.onrender.com/api/:path*',
    `${env.STAGING_RENDER_ORIGIN}/:path*`,
    `${env.STAGING_FRONTEND_ORIGIN}/api/:path*`,
  ]) {
    const config = configured()
    config.rewrites[0].destination = destination
    assert.throws(() => checkStagingConfig(config, env))
  }
})
test('rejects automatic deployments, fallback routes and API caching', () => {
  for (const change of [
    (c) => {
      c.git.deploymentEnabled = true
    },
    (c) => {
      c.rewrites.push({ source: '/(.*)', destination: '/index.html' })
    },
    (c) => {
      c.redirects = []
    },
    (c) => {
      c.routes = []
    },
    (c) => {
      c.headers[1].headers.pop()
    },
    (c) => {
      c.headers[1].headers.push({
        key: 'x-vercel-enable-rewrite-caching',
        value: '1',
      })
    },
    (c) => {
      c.headers[1].headers[0].value = 'public, max-age=60'
    },
  ]) {
    const config = configured()
    change(config)
    assert.throws(() => checkStagingConfig(config, env))
  }
})
test('pins the dedicated Vercel project when provider system metadata is available', () => {
  assert.doesNotThrow(() =>
    checkStagingConfig(configured(), {
      ...env,
      VERCEL: '1',
      VERCEL_PROJECT_PRODUCTION_URL: 'finance-staging.vercel.app',
    }),
  )
  assert.throws(() =>
    checkStagingConfig(configured(), {
      ...env,
      VERCEL: '1',
      VERCEL_PROJECT_PRODUCTION_URL: 'finance.vercel.app',
    }),
  )
})
test('offline rewrite model preserves API prefix, encoded paths and query parameters without recursion', () => {
  for (const path of [
    '/api',
    '/api/',
    '/api/health',
    '/api/auth/session',
    '/api/expenses?page=2&pageSize=20',
    '/api/exports/expenses.csv?from=2026-10-01&to=2026-10-31',
    '/api/people/a%20b',
  ])
    assert.equal(
      stagingApiDestination(path, configured(), env),
      `${env.STAGING_RENDER_ORIGIN}${path}`,
    )
  for (const path of [
    '/apiary',
    '/dashboard',
    '/api/../dashboard',
    '/api/health#fragment',
    'https://attacker.invalid/api/health',
  ])
    assert.throws(() => stagingApiDestination(path, configured(), env))
})
