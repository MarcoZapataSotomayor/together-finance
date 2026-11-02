import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function stagingOrigin(value, suffix) {
  try {
    const url = new URL(value)
    const name = url.hostname.slice(0, -suffix.length)
    if (
      url.protocol !== 'https:' ||
      url.origin !== value ||
      url.port ||
      !url.hostname.endsWith(suffix) ||
      !/^[a-z0-9-]+$/.test(name) ||
      !/(^|-)staging(-|$)/.test(name)
    )
      throw new Error()
    return url.origin
  } catch {
    throw new Error(
      'Use an exact HTTPS staging origin on the approved hosting provider; value omitted.',
    )
  }
}

export function checkStagingConfig(config, env) {
  const backend = stagingOrigin(env.STAGING_RENDER_ORIGIN, '.onrender.com')
  const frontend = stagingOrigin(env.STAGING_FRONTEND_ORIGIN, '.vercel.app')
  if (env.VITE_API_URL !== '/api')
    throw new Error('Staging requires VITE_API_URL=/api.')
  if (
    env.VERCEL === '1' &&
    env.VERCEL_PROJECT_PRODUCTION_URL !== new URL(frontend).host
  )
    throw new Error(
      'The Vercel project hostname must match the reviewed staging frontend origin.',
    )
  if (
    config.git?.deploymentEnabled !== false ||
    config.framework !== 'vite' ||
    config.installCommand !== 'npm ci --include=dev' ||
    config.buildCommand !==
      'node scripts/check-staging-config.mjs && npm run build' ||
    config.outputDirectory !== 'dist'
  )
    throw new Error(
      'The reviewed staging build and manual-deployment settings are required.',
    )
  if (
    config.routes ||
    config.redirects ||
    config.rewrites?.length !== 1 ||
    config.rewrites[0].source !== '/api/:path*' ||
    config.rewrites[0].destination !== `${backend}/api/:path*`
  )
    throw new Error(
      'Configure exactly one /api rewrite to the reviewed Render staging origin; no fallback or redirects.',
    )
  const rules = config.headers ?? []
  for (const rule of rules) {
    for (const header of rule.headers ?? []) {
      if (
        header.key.toLowerCase() === 'x-vercel-enable-rewrite-caching' ||
        (/^(cache-control|cdn-cache-control|vercel-cdn-cache-control)$/i.test(
          header.key,
        ) &&
          header.value !== 'no-store')
      )
        throw new Error('Staging API caching must remain disabled.')
    }
  }
  const api = rules.find((rule) => rule.source === '/api/:path*')?.headers ?? []
  for (const key of [
    'Cache-Control',
    'CDN-Cache-Control',
    'Vercel-CDN-Cache-Control',
  ]) {
    if (
      !api.some((header) => header.key === key && header.value === 'no-store')
    )
      throw new Error(
        'All staging API cache layers must explicitly use no-store.',
      )
  }
  return { frontend, backend }
}

// Offline routing model only: provider forwarding/HTTPS must also pass hosted verification.
export function stagingApiDestination(path, config, env) {
  const { frontend, backend } = checkStagingConfig(config, env)
  const url = new URL(path, frontend)
  if (
    url.origin !== frontend ||
    !/^\/api(?:\/|$)/.test(url.pathname) ||
    url.hash
  )
    throw new Error(
      'Only same-origin API requests can use the staging rewrite.',
    )
  return `${backend}${url.pathname}${url.search}`
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const config = JSON.parse(
      await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    )
    checkStagingConfig(config, process.env)
    console.log(
      'Staging frontend configuration verified without network access.',
    )
  } catch (error) {
    console.error(
      error instanceof SyntaxError
        ? 'Invalid staging configuration JSON.'
        : error.message,
    )
    process.exitCode = 1
  }
}
