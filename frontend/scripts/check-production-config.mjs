import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function productionOrigin(value, render = false) {
  try {
    const url = new URL(value)
    if (
      url.origin !== value ||
      url.protocol !== 'https:' ||
      url.port ||
      isIP(url.hostname) ||
      !url.hostname.includes('.') ||
      url.hostname
        .split('.')
        .some(
          (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      /\.(invalid|test|localhost|example)$/.test(url.hostname) ||
      (render && !/^[a-z0-9-]+\.onrender\.com$/.test(url.hostname))
    )
      throw new Error()
    return url.origin
  } catch {
    throw new Error(
      'An exact reviewed public HTTPS production origin is required; value omitted.',
    )
  }
}

export function checkProductionConfig(config, env, configured = true) {
  const backend = productionOrigin(env.PRODUCTION_RENDER_ORIGIN, true)
  const frontend = productionOrigin(env.PRODUCTION_FRONTEND_ORIGIN)
  if (
    env.PRODUCTION_HOSTS_APPROVED !== 'yes' ||
    env.VITE_API_URL !== '/api' ||
    frontend === backend
  )
    throw new Error(
      'Approve the independently reviewed production hosts and use same-origin /api.',
    )
  if (
    env.VERCEL === '1' &&
    (env.VERCEL_ENV !== 'production' ||
      env.VERCEL_PROJECT_PRODUCTION_URL !== new URL(frontend).host)
  )
    throw new Error(
      'Only the reviewed stable production project can use this configuration.',
    )
  if (
    config.framework !== 'vite' ||
    config.installCommand !== 'npm ci --include=dev' ||
    config.buildCommand !==
      'node scripts/check-production-config.mjs && npm run build' ||
    config.outputDirectory !== 'dist' ||
    config.git?.deploymentEnabled !== false ||
    config.routes ||
    config.redirects
  )
    throw new Error(
      'Preserve the reviewed production build, paths and manual-deployment controls.',
    )
  if (
    !Array.isArray(config.rewrites) ||
    (configured
      ? config.rewrites.length !== 1 ||
        config.rewrites[0].source !== '/api/:path*' ||
        config.rewrites[0].destination !== `${backend}/api/:path*`
      : config.rewrites.length > 1)
  )
    throw new Error(
      'Configure exactly one API rewrite to the reviewed production Render origin.',
    )
  for (const rule of config.headers ?? [])
    for (const header of rule.headers ?? []) {
      if (
        header.key.toLowerCase() === 'x-vercel-enable-rewrite-caching' ||
        (/^(cache-control|cdn-cache-control|vercel-cdn-cache-control)$/i.test(
          header.key,
        ) &&
          header.value !== 'no-store')
      )
        throw new Error('Authenticated API caching must remain disabled.')
    }
  const headers =
    config.headers?.find((rule) => rule.source === '/api/:path*')?.headers ?? []
  for (const key of [
    'Cache-Control',
    'CDN-Cache-Control',
    'Vercel-CDN-Cache-Control',
  ])
    if (
      !headers.some(
        (header) => header.key === key && header.value === 'no-store',
      )
    )
      throw new Error('Preserve no-store at every API cache layer.')
  return { frontend, backend }
}

export function configureProduction(config, env) {
  checkProductionConfig(config, env, false)
  const result = structuredClone(config)
  result.rewrites = [
    {
      source: '/api/:path*',
      destination: `${productionOrigin(env.PRODUCTION_RENDER_ORIGIN, true)}/api/:path*`,
    },
  ]
  checkProductionConfig(result, env)
  return result
}

export function productionApiDestination(path, config, env) {
  const { frontend, backend } = checkProductionConfig(config, env)
  const url = new URL(path, frontend)
  if (
    url.origin !== frontend ||
    !/^\/api(?:\/|$)/.test(url.pathname) ||
    url.hash
  )
    throw new Error('Only same-origin API paths can use the production proxy.')
  return `${backend}${url.pathname}${url.search}`
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    checkProductionConfig(
      JSON.parse(
        await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
      ),
      process.env,
    )
    console.log(
      'Production frontend configuration verified without network access.',
    )
  } catch {
    console.error(
      'Production frontend configuration is incomplete or does not match the reviewed deployment policy; values omitted.',
    )
    process.exitCode = 1
  }
}
