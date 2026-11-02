import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedPrismaCommand,
  assertDisposableDatabase,
  disposableAdminUrl,
} from './database-safety.mjs';
import { backup, restoreIsolated } from './backup-restore.mjs';

const runId = 'a'.repeat(32);
const local = 'postgresql://together_test:synthetic-only@127.0.0.1:5432';
test('rejects cloud hosts, query overrides, non-generated databases and missing isolation confirmation', () => {
  for (const url of [
    'postgresql://together_test:placeholder@project.neon.tech/postgres',
    `${local}/development`,
    `${local}/production`,
    `${local}/postgres?host=project.neon.tech`,
    `${local}/postgres#fragment`,
  ])
    assert.throws(() => disposableAdminUrl(url, '1'));
  assert.throws(() => disposableAdminUrl(`${local}/postgres`, undefined));
  assert.equal(
    disposableAdminUrl(`${local}/postgres`, '1').hostname,
    '127.0.0.1',
  );
  assert.throws(() => assertDisposableDatabase(`${local}/development`, runId));
  assert.throws(() =>
    assertDisposableDatabase(
      `${local}/together_finance_test_${runId}`,
      'wrong',
    ),
  );
  assert.equal(
    assertDisposableDatabase(`${local}/together_finance_test_${runId}`, runId)
      .hostname,
    '127.0.0.1',
  );
});
test('Prisma wrapper rejects destructive commands, arbitrary flags and unapproved migrations', () => {
  for (const args of [
    ['migrate', 'reset'],
    ['db', 'push'],
    ['db', 'execute'],
    ['generate', '--schema', 'other.prisma'],
    ['migrate', 'deploy', '--url', 'hidden'],
    ['studio'],
  ])
    assert.throws(() => allowedPrismaCommand(args, {}));
  for (const args of [
    ['generate'],
    ['validate'],
    ['format'],
    ['migrate', 'status'],
  ])
    assert.doesNotThrow(() => allowedPrismaCommand(args, {}));
  assert.throws(() => allowedPrismaCommand(['migrate', 'deploy'], {}));
  const env = {
    DIRECT_URL:
      'postgresql://placeholder:placeholder@direct.example/database?sslmode=verify-full',
    MIGRATION_TARGET: 'production',
    MIGRATION_EXPECTED_HOST: 'direct.example',
    MIGRATION_EXPECTED_DATABASE: 'database',
    MIGRATION_APPROVED: 'yes',
  };
  assert.doesNotThrow(() => allowedPrismaCommand(['migrate', 'deploy'], env));
  assert.throws(() =>
    allowedPrismaCommand(['migrate', 'deploy'], {
      ...env,
      MIGRATION_EXPECTED_HOST: 'other.example',
    }),
  );
  assert.throws(() =>
    allowedPrismaCommand(['migrate', 'deploy'], {
      ...env,
      MIGRATION_APPROVED: 'no',
    }),
  );
  assert.doesNotThrow(() =>
    allowedPrismaCommand(['migrate', 'deploy'], {
      DIRECT_URL: `${local}/together_finance_test_${runId}`,
      MIGRATION_TARGET: 'disposable-test',
      TF_DISPOSABLE_POSTGRES: '1',
      TF_TEST_RUN_ID: runId,
    }),
  );
});
test('backup refuses implicit runtime credentials, mismatched source pins and unconfirmed storage before connecting', async () => {
  await assert.rejects(
    backup({ DATABASE_URL: `${local}/production` }),
    /PostgreSQL URL/,
  );
  await assert.rejects(
    backup({ BACKUP_DATABASE_URL: `${local}/production` }),
    /Confirm/,
  );
  await assert.rejects(
    backup({
      BACKUP_DATABASE_URL: `${local}/production`,
      BACKUP_EXPECTED_HOST: '127.0.0.1',
      BACKUP_EXPECTED_DATABASE: 'production',
    }),
    /encrypted/,
  );
  await assert.rejects(
    backup({
      BACKUP_DATABASE_URL: `${local}/production`,
      BACKUP_EXPECTED_HOST: '127.0.0.1',
      BACKUP_EXPECTED_DATABASE: 'production',
      BACKUP_STORAGE_CONFIRMED: 'disposable-fixture',
      TF_TEST_RUN_ID: runId,
    }),
    /namespace/,
  );
  await assert.rejects(restoreIsolated('missing-backup.dump', {}));
});
