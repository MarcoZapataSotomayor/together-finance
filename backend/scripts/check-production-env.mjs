import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { assertProductionDatabase } from './database-safety.mjs';

export function checkProductionEnvironment(env) {
  assertProductionDatabase(env.DATABASE_URL, env, true);
  let frontend;
  try {
    frontend = new URL(env.PRODUCTION_FRONTEND_ORIGIN);
  } catch {
    /* Refuse below. */
  }
  if (
    !frontend ||
    frontend.origin !== env.PRODUCTION_FRONTEND_ORIGIN ||
    frontend.protocol !== 'https:' ||
    frontend.port ||
    isIP(frontend.hostname) ||
    !frontend.hostname.includes('.') ||
    frontend.hostname
      .split('.')
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /\.(invalid|test|localhost|example)$/.test(frontend.hostname) ||
    env.CORS_ORIGINS !== frontend.origin ||
    env.NODE_ENV !== 'production' ||
    env.SESSION_COOKIE_SAME_SITE !== 'lax' ||
    env.DIRECT_URL ||
    env.DATABASE_URL_POOLED
  )
    throw new Error(
      'Production requires its reviewed HTTPS frontend origin, secure same-origin policy and canonical runtime connection; values omitted.',
    );
  // The unchanged Nest bootstrap still validates passwords, secrets, port, TTL and proxy trust.
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    checkProductionEnvironment(process.env);
    console.log(
      'Production runtime target checks passed without database access.',
    );
  } catch {
    console.error(
      'Production runtime configuration is incomplete or mismatched; values omitted.',
    );
    process.exitCode = 1;
  }
}
