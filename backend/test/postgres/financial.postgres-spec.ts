import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { ExpensesService } from '../../src/expenses/expenses.service.js';
import { DebtsService } from '../../src/debts/debts.service.js';
import { LoansService } from '../../src/loans/loans.service.js';
import { RepaymentsService } from '../../src/repayments/repayments.service.js';
import { DebtQueryDto } from '../../src/debts/debt.dto.js';
import { SpendingQueryDto } from '../../src/analytics/analytics.dto.js';
import { AnalyticsService } from '../../src/analytics/analytics.service.js';
import { RecycleBinService } from '../../src/data-management/recycle-bin.service.js';
import { RecycleBinQueryDto } from '../../src/data-management/data-management.dto.js';
import { assertDisposableDatabase } from '../../scripts/database-safety.mjs';

type TransactionOptions = NonNullable<
  Parameters<PrismaService['$transaction']>[1]
>;

// These adapters only coordinate real transaction reads. All queries, commits,
// serialization failures, constraint checks and retries execute in PostgreSQL.
function synchronizedReads(db: PrismaService, model: 'debt' | 'expense') {
  let arrivals = 0,
    attempts = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(release, 5000);
  const prisma = new Proxy(db, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return <T>(
        work: (tx: Prisma.TransactionClient) => Promise<T>,
        options: TransactionOptions,
      ) => {
        attempts++;
        return db.$transaction(async (tx) => {
          const wrapped = new Proxy(tx, {
            get(transaction, property) {
              if (property !== model) return Reflect.get(transaction, property);
              return new Proxy(transaction[model], {
                get(delegate, method) {
                  if (method !== 'findUnique')
                    return Reflect.get(delegate, method);
                  return async (args: never) => {
                    const row = await (
                      delegate.findUnique as (args: never) => Promise<unknown>
                    )(args);
                    if (arrivals < 2) {
                      arrivals++;
                      if (arrivals === 2) {
                        clearTimeout(timer);
                        release();
                      }
                      await ready;
                    }
                    return row;
                  };
                },
              });
            },
          });
          return work(wrapped);
        }, options);
      };
    },
  });
  return {
    prisma,
    arrivals: () => arrivals,
    attempts: () => attempts,
    close: () => clearTimeout(timer),
  };
}

describe('real PostgreSQL financial invariants', () => {
  let db: PrismaService;
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.TF_DISPOSABLE_POSTGRES !== '1'
    )
      throw new Error('Disposable test configuration required.');
    const url = assertDisposableDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TF_TEST_RUN_ID,
    );
    db = new PrismaService(new ConfigService({ DATABASE_URL: url.toString() }));
    await db.onModuleInit();
    const [identity] = await db.$queryRaw<
      { database: string; role: string }[]
    >`SELECT current_database() AS database, current_user AS role`;
    expect(identity).toEqual({
      database: url.pathname.slice(1),
      role: 'together_test',
    });
  });
  afterAll(async () => {
    await db?.onModuleDestroy();
  });
  function services(prisma = db) {
    const debts = new DebtsService(prisma);
    return {
      expenses: new ExpensesService(prisma),
      debts,
      loans: new LoansService(prisma, debts),
      payments: new RepaymentsService(prisma, debts),
    };
  }
  async function fixture() {
    const [antonella, marco] = await Promise.all(
      ['Antonella', 'Marco'].map((name) =>
        db.person.create({ data: { name: `${name} ${randomUUID()}` } }),
      ),
    );
    const category = await db.category.create({
      data: { name: `Category ${randomUUID()}` },
    });
    const method = await db.paymentMethod.create({
      data: { name: 'Test cash', type: 'CASH' },
    });
    const input = {
      id: randomUUID(),
      amount: '100.01',
      purchasedOn: '2026-10-30',
      merchant: 'Isolated fixture',
      categoryId: category.id,
      paymentMethodId: method.id,
      fundedByPersonId: marco.id,
      classification: 'SHARED' as const,
      allocations: [
        { personId: antonella.id, percentage: '50' },
        { personId: marco.id, percentage: '50' },
      ],
    };
    const loanInput = {
      id: randomUUID(),
      amount: '100.00',
      incurredOn: '2026-10-30',
      debtorPersonId: antonella.id,
      creditorPersonId: marco.id,
    };
    return { antonella, marco, input, loanInput };
  }
  const payment = (amount: string) => ({
    id: randomUUID(),
    amount,
    paidOn: '2026-10-31',
  });

  it('serializes simultaneous overpaying repayments and commits only an affordable payment', async () => {
    const { loanInput } = await fixture();
    const loan = await services().loans.create(loanInput);
    const gate = synchronizedReads(db, 'debt');
    try {
      const { payments } = services(gate.prisma);
      const outcomes = await Promise.allSettled([
        payments.create(loan.id, payment('60.00')),
        payments.create(loan.id, payment('60.00')),
      ]);
      expect(gate.arrivals()).toBe(2);
      expect(gate.attempts()).toBeGreaterThan(2);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        outcomes
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason.getStatus()),
      ).toEqual([409]);
      expect(await services().debts.get(loan.id)).toMatchObject({
        repaidAmount: '60.00',
        outstandingAmount: '40.00',
      });
      expect(await db.repayment.count({ where: { debtId: loan.id } })).toBe(1);
    } finally {
      gate.close();
    }
  });
  it('commits two affordable simultaneous payments without losing either', async () => {
    const { loanInput } = await fixture();
    const loan = await services().loans.create(loanInput);
    const gate = synchronizedReads(db, 'debt');
    try {
      const api = services(gate.prisma).payments;
      await Promise.all([
        api.create(loan.id, payment('60.00')),
        api.create(loan.id, payment('40.00')),
      ]);
      expect(gate.arrivals()).toBe(2);
      expect(gate.attempts()).toBeGreaterThan(2);
      expect(await services().debts.get(loan.id)).toMatchObject({
        repaidAmount: '100.00',
        outstandingAmount: '0.00',
        status: 'PAID',
      });
      expect(await db.repayment.count({ where: { debtId: loan.id } })).toBe(2);
    } finally {
      gate.close();
    }
  });
  it('retries competing expense edits and keeps allocations/source debt consistent', async () => {
    const { input } = await fixture();
    await services().expenses.create(input);
    const gate = synchronizedReads(db, 'expense');
    try {
      const api = services(gate.prisma).expenses;
      await Promise.all([
        api.update(input.id, { amount: '80.01', merchant: 'Changed merchant' }),
        api.update(input.id, {
          amount: '120.01',
          description: 'Changed description',
        }),
      ]);
      expect(gate.arrivals()).toBe(2);
      expect(gate.attempts()).toBeGreaterThan(2);
      const expense = await services().expenses.get(input.id);
      expect(['80.01', '120.01']).toContain(expense.amount);
      expect(expense.merchant).toBe('Changed merchant');
      expect(expense.description).toBe('Changed description');
      expect(
        expense.allocations
          .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
          .toFixed(2),
      ).toBe(expense.amount);
      expect(expense.allocations.filter((a) => a.debt)).toHaveLength(1);
      for (const allocation of expense.allocations)
        if (allocation.debt)
          expect(allocation.debt.originalAmount).toBe(allocation.amount);
      expect(
        await db.debt.count({
          where: { expenseAllocation: { expenseId: input.id } },
        }),
      ).toBe(1);
    } finally {
      gate.close();
    }
  });
  it('rolls back all service writes when a later genuine CHECK constraint fails', async () => {
    const { input } = await fixture();
    const broken = new Proxy(db, {
      get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key);
        return <T>(
          work: (tx: Prisma.TransactionClient) => Promise<T>,
          options: TransactionOptions,
        ) =>
          db.$transaction(async (tx) => {
            const result = await work(tx);
            const debt = await tx.debt.findFirstOrThrow({
              where: { expenseAllocation: { expenseId: input.id } },
            });
            await tx.debt.update({
              where: { id: debt.id },
              data: { originalAmount: new Prisma.Decimal('-1.00') },
            });
            return result;
          }, options);
      },
    });
    await expect(services(broken).expenses.create(input)).rejects.toThrow();
    expect(await db.expense.count({ where: { id: input.id } })).toBe(0);
    expect(
      await db.expenseAllocation.count({ where: { expenseId: input.id } }),
    ).toBe(0);
    expect(
      await db.debt.count({
        where: { debtorPersonId: input.allocations[0].personId },
      }),
    ).toBe(0);
  });
  it('keeps concurrent expense/debt creation idempotent at actual unique constraints', async () => {
    const { input } = await fixture();
    const gate = synchronizedReads(db, 'expense');
    try {
      const api = services(gate.prisma).expenses;
      const [first, second] = await Promise.all([
        api.create(input),
        api.create(input),
      ]);
      expect(first.id).toBe(second.id);
      expect(gate.arrivals()).toBe(2);
      expect(await db.expense.count({ where: { id: input.id } })).toBe(1);
      expect(
        await db.expenseAllocation.count({ where: { expenseId: input.id } }),
      ).toBe(2);
      expect(
        await db.debt.count({
          where: { expenseAllocation: { expenseId: input.id } },
        }),
      ).toBe(1);
    } finally {
      gate.close();
    }
  });
  it('keeps independent loan creation idempotent across simultaneous requests', async () => {
    const { loanInput } = await fixture();
    const gate = synchronizedReads(db, 'debt');
    try {
      const api = services(gate.prisma).loans;
      const result = await Promise.all([
        api.create(loanInput),
        api.create(loanInput),
      ]);
      expect(result[0].id).toBe(result[1].id);
      expect(gate.arrivals()).toBe(2);
      expect(await db.debt.count({ where: { id: loanInput.id } })).toBe(1);
    } finally {
      gate.close();
    }
  });
  it('preserves repayment history and revalidates parent and child restorations', async () => {
    const { input, antonella } = await fixture();
    const api = services();
    const expense = await api.expenses.create(input);
    const debt = expense.allocations.find((a) => a.debt)!.debt!;
    const paid = await api.payments.create(debt.id, payment('20.00'));
    await api.payments.remove(paid.id);
    await expect(
      api.expenses.update(input.id, { amount: '200.00' }),
    ).rejects.toMatchObject({ status: 409 });
    await api.expenses.remove(input.id);
    await expect(api.payments.restore(paid.id)).rejects.toMatchObject({
      status: 409,
    });
    const summary = await api.debts.summary(
      Object.assign(new DebtQueryDto(), { debtorPersonId: antonella.id }),
    );
    expect(summary.totals.outstandingAmount).toBe('0.00');
    const spending = await new AnalyticsService(db).spending(
      Object.assign(new SpendingQueryDto(), {
        from: '2026-10-01',
        to: '2026-10-31',
        personId: antonella.id,
      }),
    );
    expect(spending.totals.amount).toBe('0.00');
    const bin = await new RecycleBinService(db).list(new RecycleBinQueryDto());
    expect(bin.data.find((r) => r.id === paid.id)).toMatchObject({
      kind: 'repayment',
      canRestore: false,
    });
    await api.expenses.restore(input.id);
    expect(
      (await db.repayment.findUniqueOrThrow({ where: { id: paid.id } }))
        .deletedAt,
    ).not.toBeNull();
    await api.payments.restore(paid.id);
    expect(await api.debts.get(debt.id)).toMatchObject({
      repaidAmount: '20.00',
    });
    expect(await db.repayment.count({ where: { debtId: debt.id } })).toBe(1);
  });
  it('rejects an overpaying restore and keeps loan history excluded while the parent is deleted', async () => {
    const { loanInput, antonella } = await fixture();
    const api = services();
    const loan = await api.loans.create(loanInput);
    const first = await api.payments.create(loan.id, payment('100.00'));
    await api.payments.remove(first.id);
    await api.payments.create(loan.id, payment('100.00'));
    await expect(api.payments.restore(first.id)).rejects.toMatchObject({
      status: 409,
    });
    await api.loans.remove(loan.id);
    expect(
      (
        await api.debts.summary(
          Object.assign(new DebtQueryDto(), { debtorPersonId: antonella.id }),
        )
      ).totals.originalAmount,
    ).toBe('0.00');
    await api.loans.restore(loan.id);
    expect(await api.debts.get(loan.id)).toMatchObject({
      repaidAmount: '100.00',
      outstandingAmount: '0.00',
    });
    expect(await db.repayment.count({ where: { debtId: loan.id } })).toBe(2);
  });
});
