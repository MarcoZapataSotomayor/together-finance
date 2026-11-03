import assert from 'node:assert/strict';
import { config } from 'dotenv';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import {
  directDatabaseUrl,
  runtimeDatabaseUrl,
} from '../dist/config/database-urls.js';

config({ quiet: true });
let direct;
let prisma;
try {
  direct = new pg.Client({
    connectionString: directDatabaseUrl(process.env),
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  direct.on('error', () => {});
  await direct.connect();
  await direct.query('BEGIN READ ONLY');
  const history = await direct.query(
    'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY started_at',
  );
  assert.equal(history.rows.length, 1);
  assert.equal(
    history.rows[0].migration_name,
    '20261031170000_initial_financial_schema',
  );
  assert.equal(history.rows[0].finished, true);
  assert.equal(history.rows[0].rolled_back, false);
  const foreignKeys = await direct.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE confdeltype = 'r' AND confupdtype = 'r')::int AS restricted FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
  );
  assert.equal(foreignKeys.rows[0].total, 10);
  assert.equal(foreignKeys.rows[0].restricted, 10);
  const checks = await direct.query(
    `SELECT count(*)::int AS total FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
  );
  assert.equal(checks.rows[0].total, 12);
  const unindexed = await direct.query(
    `SELECT count(*)::int AS total FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`,
  );
  assert.equal(unindexed.rows[0].total, 0);
  const categoryIndex = await direct.query(
    `SELECT count(*)::int AS total FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'categories_normalized_name_key'`,
  );
  assert.equal(categoryIndex.rows[0].total, 1);
  await direct.query('ROLLBACK');

  prisma = new PrismaService(
    new ConfigService({ DATABASE_URL: runtimeDatabaseUrl(process.env) }),
  );
  await prisma.onModuleInit();
  const counts = await prisma.$transaction([
    prisma.person.count(),
    prisma.category.count(),
    prisma.paymentMethod.count(),
    prisma.expense.count(),
    prisma.expenseAllocation.count(),
    prisma.debt.count(),
    prisma.repayment.count(),
  ]);
  if (process.argv.includes('--expect-empty'))
    assert.equal(
      counts.every((count) => count === 0),
      true,
    );
  console.log(
    JSON.stringify(
      {
        migration: history.rows[0].migration_name,
        status: 'applied',
        restrictedForeignKeys: 10,
        checkConstraints: 12,
        unindexedForeignKeys: 0,
        normalizedCategoryIndex: 'present',
        pooledPrismaClient: 'query successful',
        rowCounts: Object.fromEntries(
          [
            'people',
            'categories',
            'payment_methods',
            'expenses',
            'expense_allocations',
            'debts',
            'repayments',
          ].map((name, index) => [name, counts[index]]),
        ),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'Database verification failed. No connection details or row contents were logged.',
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([direct?.end(), prisma?.$disconnect()]);
}
