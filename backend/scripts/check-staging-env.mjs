import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStagingDatabase } from './database-safety.mjs';

export function checkStagingEnvironment(env) {
  assertStagingDatabase(env.DATABASE_URL, env, true);
  let frontend;
  try {
    frontend = new URL(env.STAGING_FRONTEND_ORIGIN);
  } catch {
    /* Refuse below without printing input. */
  }
  if (
    !frontend ||
    frontend.origin !== env.STAGING_FRONTEND_ORIGIN ||
    frontend.protocol !== 'https:' ||
    !/^[a-z0-9-]*\bstaging\b[a-z0-9-]*\.vercel\.app$/.test(frontend.hostname) ||
    frontend.port ||
    env.CORS_ORIGINS !== frontend.origin ||
    env.NODE_ENV !== 'production' ||
    env.SESSION_COOKIE_SAME_SITE !== 'lax' ||
    env.DIRECT_URL ||
    env.DATABASE_URL_POOLED
  )
    throw new Error(
      'Use the exact staging frontend origin, production HTTPS/Lax settings and canonical pooled runtime URL only; values omitted.',
    );
  // Full password/secret/port validation remains in the unchanged application bootstrap.
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    checkStagingEnvironment(process.env);
    console.log(
      'Staging runtime isolation checks passed without connecting to a database.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
