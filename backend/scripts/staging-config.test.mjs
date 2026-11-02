import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedPrismaCommand,
  assertStagingDatabase,
} from './database-safety.mjs';
import { checkStagingEnvironment } from './check-staging-env.mjs';

const host = 'ep-fictional-staging.us-east-2.aws.neon.tech';
const direct = `postgresql://placeholder:placeholder@${host}/finance_staging?sslmode=require`;
const pooled = direct.replace(host, host.replace('.', '-pooler.'));
const pins = {
  STAGING_EXPECTED_DATABASE_HOST: host,
  STAGING_EXPECTED_DATABASE_NAME: 'finance_staging',
  STAGING_DATABASE_CONFIRMED: 'fictional-only',
};
const runtime = {
  ...pins,
  DATABASE_URL: pooled,
  NODE_ENV: 'production',
  SESSION_COOKIE_SAME_SITE: 'lax',
  STAGING_FRONTEND_ORIGIN: 'https://finance-staging.vercel.app',
  CORS_ORIGINS: 'https://finance-staging.vercel.app',
};
const migration = {
  ...pins,
  DIRECT_URL: direct,
  MIGRATION_TARGET: 'staging',
  MIGRATION_APPROVED: 'yes',
  MIGRATION_EXPECTED_HOST: host,
  MIGRATION_EXPECTED_DATABASE: 'finance_staging',
};
test('staging runtime accepts independently pinned fictional data and rejects wrong targets before connecting', () => {
  assert.doesNotThrow(() => checkStagingEnvironment(runtime));
  for (const change of [
    { DATABASE_URL: direct },
    {
      DATABASE_URL: pooled.replace(host.split('.')[0], 'ep-production-pooler'),
    },
    { DATABASE_URL: pooled.replace('finance_staging', 'development') },
    { DATABASE_URL: pooled.replace('?sslmode=require', '') },
    { STAGING_EXPECTED_DATABASE_HOST: 'other.neon.tech' },
    { STAGING_EXPECTED_DATABASE_NAME: 'production' },
    { STAGING_DATABASE_CONFIRMED: undefined },
    { STAGING_DATABASE_CONFIRMED: 'production-data' },
    { DIRECT_URL: direct },
    { DATABASE_URL_POOLED: pooled },
    { NODE_ENV: 'development' },
    { SESSION_COOKIE_SAME_SITE: 'none' },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: `${runtime.CORS_ORIGINS},https://production.example` },
    {
      STAGING_FRONTEND_ORIGIN: 'https://finance.vercel.app',
      CORS_ORIGINS: 'https://finance.vercel.app',
    },
  ])
    assert.throws(() => checkStagingEnvironment({ ...runtime, ...change }));
});
test('staging migration is an explicit supported target with all existing and additional isolation gates', () => {
  assert.doesNotThrow(() =>
    allowedPrismaCommand(['migrate', 'deploy'], migration),
  );
  for (const change of [
    { DIRECT_URL: pooled },
    { MIGRATION_APPROVED: undefined },
    { MIGRATION_EXPECTED_HOST: 'wrong.example' },
    { MIGRATION_EXPECTED_DATABASE: 'production' },
    { STAGING_EXPECTED_DATABASE_HOST: undefined },
    { STAGING_DATABASE_CONFIRMED: undefined },
    { DIRECT_URL: direct.replace('sslmode=require', 'sslmode=disable') },
  ])
    assert.throws(() =>
      allowedPrismaCommand(['migrate', 'deploy'], { ...migration, ...change }),
    );
  assert.throws(() => allowedPrismaCommand(['migrate', 'reset'], migration));
  assert.throws(() => allowedPrismaCommand(['db', 'push'], migration));
});
test('staging refuses URL option overrides, fragments and a pooled host pin', () => {
  for (const url of [
    `${direct}&host=production.example`,
    `${direct}#secret`,
    direct.replace(host, 'localhost'),
  ])
    assert.throws(() => assertStagingDatabase(url, pins));
  assert.throws(() =>
    assertStagingDatabase(direct, {
      ...pins,
      STAGING_EXPECTED_DATABASE_HOST: host.replace('.', '-pooler.'),
    }),
  );
});
