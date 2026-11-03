import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowedPrismaCommand } from './database-safety.mjs';
import { checkProductionEnvironment } from './check-production-env.mjs';
import { verifyProductionMigrationBackup } from './production-migration-backup.mjs';

const host = 'ep-production.region.aws.neon.tech';
const direct = `postgresql://placeholder:placeholder@${host}/finance?sslmode=require`;
const pins = {
  PRODUCTION_EXPECTED_DATABASE_HOST: host,
  PRODUCTION_EXPECTED_DATABASE_NAME: 'finance',
  PRODUCTION_DATABASE_CONFIRMED: 'production',
};
const runtime = {
  ...pins,
  DATABASE_URL: direct.replace(host, host.replace('.', '-pooler.')),
  NODE_ENV: 'production',
  SESSION_COOKIE_SAME_SITE: 'lax',
  PRODUCTION_FRONTEND_ORIGIN: 'https://finance.vercel.app',
  CORS_ORIGINS: 'https://finance.vercel.app',
};
const migration = {
  ...pins,
  DIRECT_URL: direct,
  MIGRATION_TARGET: 'production',
  MIGRATION_EXPECTED_HOST: host,
  MIGRATION_EXPECTED_DATABASE: 'finance',
  MIGRATION_APPROVED: 'yes',
  MIGRATION_BACKUP_CONFIRMED: 'restored-and-verified',
  MIGRATION_RESTORE_SHA256: 'a'.repeat(64),
  BACKUP_STORAGE_CONFIRMED: 'encrypted',
  MIGRATION_BACKUP_MANIFEST: '/protected/current.dump.json',
};

test('production startup requires independent identity pins, secure policy and canonical pooled runtime credentials', () => {
  assert.doesNotThrow(() => checkProductionEnvironment(runtime));
  for (const change of [
    { PRODUCTION_DATABASE_CONFIRMED: undefined },
    { PRODUCTION_EXPECTED_DATABASE_HOST: 'ep-other.region.aws.neon.tech' },
    { PRODUCTION_EXPECTED_DATABASE_NAME: 'other' },
    { DATABASE_URL: direct },
    { DIRECT_URL: direct },
    { DATABASE_URL_POOLED: runtime.DATABASE_URL },
    { NODE_ENV: 'development' },
    { SESSION_COOKIE_SAME_SITE: 'none' },
    { CORS_ORIGINS: '*' },
    {
      PRODUCTION_FRONTEND_ORIGIN: 'https://*.example.com',
      CORS_ORIGINS: 'https://*.example.com',
    },
    { PRODUCTION_FRONTEND_ORIGIN: 'http://localhost:5173' },
  ])
    assert.throws(() => checkProductionEnvironment({ ...runtime, ...change }));
});
test('production deploy retains existing approval/direct-TLS gates and adds identity and recovery approval', () => {
  assert.doesNotThrow(() =>
    allowedPrismaCommand(['migrate', 'deploy'], migration),
  );
  for (const key of [
    'MIGRATION_APPROVED',
    'MIGRATION_EXPECTED_HOST',
    'MIGRATION_EXPECTED_DATABASE',
    'PRODUCTION_DATABASE_CONFIRMED',
    'PRODUCTION_EXPECTED_DATABASE_HOST',
    'PRODUCTION_EXPECTED_DATABASE_NAME',
    'MIGRATION_BACKUP_MANIFEST',
    'MIGRATION_BACKUP_CONFIRMED',
    'MIGRATION_RESTORE_SHA256',
    'BACKUP_STORAGE_CONFIRMED',
  ])
    assert.throws(() =>
      allowedPrismaCommand(['migrate', 'deploy'], {
        ...migration,
        [key]: undefined,
      }),
    );
  for (const url of [
    runtime.DATABASE_URL,
    direct.replace('sslmode=require', 'sslmode=disable'),
  ])
    assert.throws(() =>
      allowedPrismaCommand(['migrate', 'deploy'], {
        ...migration,
        DIRECT_URL: url,
      }),
    );
  assert.throws(() => allowedPrismaCommand(['migrate', 'reset'], migration));
});
test('production backup gate verifies archive bytes/hash, freshness and explicit restoration acknowledgement offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-backup-gate-'));
  try {
    // This is only a file-check fixture, not a PostgreSQL archive or a successful restore claim.
    const path = join(directory, 'reviewed.dump'),
      manifest = `${path}.json`;
    const bytes = Buffer.from('PGDMPsynthetic-file-integrity-fixture');
    const now = Date.parse('2026-11-02T12:00:00Z');
    const metadata = {
      format: 1,
      serverMajor: 17,
      toolMajor: 17,
      createdAt: new Date(now).toISOString(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    await writeFile(path, bytes);
    await writeFile(manifest, JSON.stringify(metadata));
    const env = {
      ...migration,
      MIGRATION_BACKUP_MANIFEST: manifest,
      MIGRATION_RESTORE_SHA256: metadata.sha256,
    };
    await assert.doesNotReject(verifyProductionMigrationBackup(env, now));
    for (const change of [
      { MIGRATION_BACKUP_MANIFEST: 'relative.dump.json' },
      { MIGRATION_BACKUP_MANIFEST: join(directory, 'missing.dump.json') },
      { MIGRATION_BACKUP_CONFIRMED: undefined },
      { MIGRATION_RESTORE_SHA256: 'b'.repeat(64) },
      { BACKUP_STORAGE_CONFIRMED: undefined },
    ])
      await assert.rejects(
        verifyProductionMigrationBackup({ ...env, ...change }, now),
      );
    for (const createdAt of [
      undefined,
      'invalid',
      new Date(now - 86400001).toISOString(),
      new Date(now + 1).toISOString(),
    ]) {
      await writeFile(manifest, JSON.stringify({ ...metadata, createdAt }));
      await assert.rejects(verifyProductionMigrationBackup(env, now));
    }
    await writeFile(manifest, JSON.stringify(metadata));
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    await writeFile(path, changed);
    await assert.rejects(verifyProductionMigrationBackup(env, now));
    await writeFile(path, 'PGDMPchanged');
    await assert.rejects(verifyProductionMigrationBackup(env, now));
    // A clean temporary cwd has no .env or Prisma CLI: refusal must happen before CLI execution.
    const refused = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./safe-prisma.mjs', import.meta.url)),
        'migrate',
        'deploy',
      ],
      {
        cwd: directory,
        env: { ...env, SystemRoot: process.env.SystemRoot ?? '' },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(refused.status, 1);
    assert.equal(
      refused.stderr.includes('Production backup verification failed'),
      true,
    );
    assert.equal(`${refused.stdout}${refused.stderr}`.includes(direct), false);
    assert.equal(JSON.parse(await readFile(manifest)).sha256, metadata.sha256);
    await assert.doesNotReject(
      verifyProductionMigrationBackup({ MIGRATION_TARGET: 'development' }),
    );
  } finally {
    await unlink(join(directory, 'reviewed.dump'));
    await unlink(join(directory, 'reviewed.dump.json'));
    await rmdir(directory);
  }
});
