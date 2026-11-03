import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { assertDisposableDatabase } from '../../scripts/database-safety.mjs';
import {
  backup,
  restoreIsolated,
  validateArchive,
  verifyFinancialDatabase,
} from '../../scripts/backup-restore.mjs';
import { ExpensesService } from '../../src/expenses/expenses.service.js';
import { DebtsService } from '../../src/debts/debts.service.js';
import { LoansService } from '../../src/loans/loans.service.js';
import { RepaymentsService } from '../../src/repayments/repayments.service.js';

async function fingerprint(db: PrismaService) {
  const records = await Promise.all([
    db.person.findMany({ orderBy: { id: 'asc' } }),
    db.category.findMany({ orderBy: { id: 'asc' } }),
    db.paymentMethod.findMany({ orderBy: { id: 'asc' } }),
    db.expense.findMany({ orderBy: { id: 'asc' } }),
    db.expenseAllocation.findMany({ orderBy: { id: 'asc' } }),
    db.debt.findMany({ orderBy: { id: 'asc' } }),
    db.repayment.findMany({ orderBy: { id: 'asc' } }),
    db.$queryRaw`SELECT id,checksum,migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY id`,
    db.$queryRaw`SELECT conname,contype::text AS contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname`,
    db.$queryRaw`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`,
  ]);
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}
describe('real pg_dump / pg_restore drill on a new isolated target', () => {
  let db: PrismaService,
    restored: PrismaService,
    directory: string,
    path: string,
    env: NodeJS.ProcessEnv;
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.TF_DISPOSABLE_POSTGRES !== '1'
    )
      throw new Error('Disposable fixture required.');
    const url = assertDisposableDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TF_TEST_RUN_ID,
    );
    db = new PrismaService(new ConfigService({ DATABASE_URL: url.toString() }));
    await db.onModuleInit();
    directory = await mkdtemp(join(tmpdir(), 'together-finance-backup-drill-'));
    env = {
      ...process.env,
      BACKUP_DATABASE_URL: url.toString(),
      BACKUP_EXPECTED_HOST: url.hostname,
      BACKUP_EXPECTED_DATABASE: url.pathname.slice(1),
      BACKUP_STORAGE_CONFIRMED: 'disposable-fixture',
      BACKUP_DIRECTORY: directory,
    };
    const [a, b] = await Promise.all(
      ['A', 'B'].map((name) =>
        db.person.create({ data: { name: `Backup ${name} ${randomUUID()}` } }),
      ),
    );
    const category = await db.category.create({
        data: { name: `Backup ${randomUUID()}` },
      }),
      method = await db.paymentMethod.create({
        data: { name: 'Backup cash', type: 'CASH' },
      });
    const expenses = new ExpensesService(db),
      debts = new DebtsService(db),
      loans = new LoansService(db, debts),
      payments = new RepaymentsService(db, debts);
    const expense = await expenses.create({
      id: randomUUID(),
      amount: '83.17',
      purchasedOn: '2026-11-01',
      merchant: 'Backup fixture',
      categoryId: category.id,
      paymentMethodId: method.id,
      fundedByPersonId: b.id,
      classification: 'SHARED',
      allocations: [
        { personId: a.id, percentage: '50' },
        { personId: b.id, percentage: '50' },
      ],
    });
    const debt = expense.allocations.find((row) => row.debt)!.debt!;
    await payments.create(debt.id, {
      id: randomUUID(),
      amount: '10.00',
      paidOn: '2026-11-02',
    });
    const loan = await loans.create({
      id: randomUUID(),
      amount: '100.00',
      incurredOn: '2026-11-01',
      debtorPersonId: a.id,
      creditorPersonId: b.id,
    });
    const deleted = await payments.create(loan.id, {
      id: randomUUID(),
      amount: '5.00',
      paidOn: '2026-11-02',
    });
    await payments.remove(deleted.id);
    await expenses.remove(expense.id);
  });
  afterAll(async () => {
    await restored?.onModuleDestroy();
    await db?.onModuleDestroy();
    if (path) {
      await unlink(path).catch(() => undefined);
      await unlink(`${path}.json`).catch(() => undefined);
    }
    if (directory) await rmdir(directory);
  });
  it('round-trips every table, migration, FK, CHECK, index, exact amount and deletion flag', async () => {
    const before = await fingerprint(db);
    const result = await backup(env);
    path = result.path;
    expect(result.metadata.serverMajor).toBe(17);
    expect(result.metadata.bytes).toBeGreaterThan(0);
    const restoredResult = await restoreIsolated(path, env);
    expect(restoredResult.verified).toBe(true);
    restored = new PrismaService(
      new ConfigService({ DATABASE_URL: restoredResult.url }),
    );
    await restored.onModuleInit();
    expect(await fingerprint(restored)).toBe(before);
    expect(await verifyFinancialDatabase(restoredResult.url)).toEqual({
      valid: true,
    });
    expect(await fingerprint(db)).toBe(before);
    await expect(restoreIsolated(path, env)).rejects.toThrow();
    expect(await fingerprint(restored)).toBe(before);
  });
  it('rejects a corrupted archive before connecting to any restore target', async () => {
    const bytes = await readFile(path);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(path, bytes);
    await expect(validateArchive(path)).rejects.toThrow('checksum');
    await expect(
      restoreIsolated(path, {
        ...env,
        TEST_POSTGRES_ADMIN_URL:
          'postgresql://blocked:blocked@production.example/db',
      }),
    ).rejects.toThrow();
  });
});
