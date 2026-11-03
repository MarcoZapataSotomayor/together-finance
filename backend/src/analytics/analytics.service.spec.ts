import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  FinanceStore,
  exampleExpense,
  ids,
  databaseFailure,
} from '../../test/finance-store.js';

describe('exact spending analytics (mocked database)', () => {
  let store: FinanceStore,
    analytics: AnalyticsService,
    expenses: ExpensesService;
  const range = { from: '2026-10-01', to: '2026-10-31' };
  beforeEach(() => {
    store = new FinanceStore();
    analytics = new AnalyticsService(store.prisma());
    expenses = new ExpensesService(store.prisma());
  });

  it('counts a shared expense once and separates attributed and funded amounts', async () => {
    await expenses.create(exampleExpense());
    const all = await analytics.spending(range);
    expect(all.totals).toMatchObject({
      amount: '100.00',
      sharedAmount: '100.00',
      personalAmount: '0.00',
      fundedAmount: '100.00',
      expenseCount: 1,
    });
    expect(all.byPerson).toEqual([
      {
        person: { id: ids.antonella, name: 'Antonella' },
        allocatedAmount: '50.00',
        fundedAmount: '0.00',
      },
      {
        person: { id: ids.marco, name: 'Marco' },
        allocatedAmount: '50.00',
        fundedAmount: '100.00',
      },
    ]);
    expect(
      (await analytics.spending({ ...range, personId: ids.antonella })).totals,
    ).toMatchObject({ amount: '50.00', fundedAmount: '0.00' });
    expect(
      (await analytics.spending({ ...range, personId: ids.marco })).totals,
    ).toMatchObject({ amount: '50.00', fundedAmount: '100.00' });
  });

  it('includes funding for somebody else without misattributing their expense', async () => {
    await expenses.create(
      exampleExpense({
        classification: 'PERSONAL',
        allocations: [{ personId: ids.antonella, percentage: '100' }],
      }),
    );
    const marco = await analytics.spending({ ...range, personId: ids.marco });
    expect(marco.totals).toMatchObject({
      amount: '0.00',
      fundedAmount: '100.00',
      expenseCount: 0,
      fundedExpenseCount: 1,
    });
    expect(marco.categories).toEqual([]);
    expect(marco.recentExpenses).toEqual([]);
    expect(marco.byPerson[0]).toMatchObject({
      allocatedAmount: '0.00',
      fundedAmount: '100.00',
    });
  });

  it('groups categories and classifications with exact stored odd-cent rounding', async () => {
    await expenses.create(exampleExpense({ amount: '0.01' }));
    await expenses.create(
      exampleExpense({
        id: randomUUID(),
        amount: '0.02',
        classification: 'PERSONAL',
        allocations: [{ personId: ids.antonella, percentage: '100' }],
      }),
    );
    const report = await analytics.spending({
      ...range,
      personId: ids.antonella,
    });
    expect(report.totals).toMatchObject({
      amount: '0.03',
      personalAmount: '0.02',
      sharedAmount: '0.01',
    });
    expect(report.categories[0]).toMatchObject({
      amount: '0.03',
      expenseCount: 2,
    });
    expect(report.monthly[0].amount).toBe('0.03');
  });

  it('aggregates distinct categories by economic shares while funding stays independent', async () => {
    const travel = randomUUID();
    store.categories.push({
      ...store.categories[0],
      id: travel,
      name: 'Example travel',
    });
    await expenses.create(exampleExpense());
    await expenses.create(
      exampleExpense({
        id: randomUUID(),
        amount: '20',
        categoryId: travel,
        classification: 'PERSONAL',
        allocations: [{ personId: ids.antonella, percentage: '100' }],
      }),
    );
    await expenses.create(
      exampleExpense({
        id: randomUUID(),
        amount: '40',
        fundedByPersonId: ids.antonella,
        classification: 'PERSONAL',
        allocations: [{ personId: ids.marco, percentage: '100' }],
      }),
    );
    const all = await analytics.spending(range);
    expect(all.categories.map((row) => [row.category.id, row.amount])).toEqual([
      [ids.category, '140.00'],
      [travel, '20.00'],
    ]);
    const selected = await analytics.spending({
      ...range,
      personId: ids.antonella,
    });
    expect(selected.categories.map((row) => row.amount)).toEqual([
      '50.00',
      '20.00',
    ]);
    expect(selected.totals).toMatchObject({
      amount: '70.00',
      fundedAmount: '40.00',
      personalAmount: '20.00',
      sharedAmount: '50.00',
    });
  });

  it('retains zero months between populated and empty calendar boundaries', async () => {
    await expenses.create(exampleExpense());
    const report = await analytics.spending({
      from: '2026-09-01',
      to: '2026-12-31',
    });
    expect(report.monthly.map((row) => [row.month, row.amount])).toEqual([
      ['2026-09', '0.00'],
      ['2026-10', '100.00'],
      ['2026-11', '0.00'],
      ['2026-12', '0.00'],
    ]);
  });

  it('groups Gregorian date-only months, includes boundaries and fills empty months', async () => {
    for (const purchasedOn of [
      '2024-02-29',
      '2024-03-01',
      '2024-03-31',
      '2024-04-01',
    ])
      await expenses.create(
        exampleExpense({ id: randomUUID(), amount: '0.10', purchasedOn }),
      );
    const report = await analytics.spending({
      from: '2024-02-29',
      to: '2024-03-31',
    });
    expect(report.monthly.map((row) => [row.month, row.amount])).toEqual([
      ['2024-02', '0.10'],
      ['2024-03', '0.20'],
    ]);
    expect(report.totals.amount).toBe('0.30');
    expect(
      (
        await analytics.spending({ from: '0001-01-01', to: '0001-02-28' })
      ).monthly.map((row) => row.month),
    ).toEqual(['0001-01', '0001-02']);
  });

  it('excludes deleted parents and archived allocations without losing active replacement shares', async () => {
    await expenses.create(exampleExpense());
    await expenses.update(ids.expense, {
      classification: 'PERSONAL',
      allocations: [{ personId: ids.thirdParty, percentage: '100' }],
    });
    const current = await analytics.spending(range);
    expect(
      current.byPerson.find((row) => row.person.id === ids.antonella),
    ).toBeUndefined();
    expect(
      current.byPerson.find((row) => row.person.id === ids.thirdParty)
        ?.allocatedAmount,
    ).toBe('100.00');
    await expenses.remove(ids.expense);
    const deleted = await analytics.spending(range);
    expect(deleted.totals.amount).toBe('0.00');
    expect(deleted.monthly[0].amount).toBe('0.00');
    expect(deleted.categories).toEqual([]);
  });

  it('rejects inconsistent active allocations instead of inventing unassigned financial totals', async () => {
    await expenses.create(exampleExpense());
    store.allocations[0].deletedAt = new Date();
    await expect(analytics.spending(range)).rejects.toThrow('inconsistent');
  });

  it('does not count independent loans, repayments or deleted repayments as spending', async () => {
    await expenses.create(exampleExpense());
    store.addRepayment('20');
    store.addRepayment('10', new Date());
    store.debts.push({
      ...store.debts[0],
      id: randomUUID(),
      origin: 'LOAN',
      expenseAllocationId: null,
      originalAmount: new Prisma.Decimal('500'),
    });
    expect((await analytics.spending(range)).totals.amount).toBe('100.00');
    expect(store.client.debt.findMany).not.toHaveBeenCalled();
    expect(store.client.repayment.findUnique).not.toHaveBeenCalled();
  });

  it('retains inactive historical people/categories and does not infer ownership from a name', async () => {
    await expenses.create(exampleExpense());
    store.people[0].isActive = false;
    store.categories[0].isActive = false;
    const report = await analytics.spending({
      ...range,
      personId: ids.antonella,
    });
    expect(report.totals.amount).toBe('50.00');
    expect(
      report.people.find((row) => row.id === ids.antonella)?.isActive,
    ).toBe(false);
    await expect(
      analytics.spending({ ...range, personId: randomUUID() }),
    ).rejects.toThrow('does not exist');
  });

  it('returns a genuine zero/empty report and rejects invalid or excessive date ranges', async () => {
    const report = await analytics.spending(range);
    expect(report.totals.amount).toBe('0.00');
    expect(report.recentExpenses).toEqual([]);
    for (const dates of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-31', to: '2026-10-01' },
      { from: '2024-01-01', to: '2026-01-01' },
    ])
      expect(() => analytics.spending(dates)).toThrow();
  });

  it('returns at most five most-recent scoped expenses, stable at equal dates, across scan batches', async () => {
    await expenses.create(exampleExpense());
    for (let index = 0; index < 104; index++)
      store.expenses.push({ ...store.expenses[0], id: randomUUID() });
    // Each fixture expense needs its own valid source allocations, even in a read-only test.
    for (const row of store.expenses.slice(1))
      store.allocations.push(
        ...store.allocations
          .filter((share) => share.expenseId === ids.expense)
          .map((share) => ({ ...share, id: randomUUID(), expenseId: row.id })),
      );
    const result = await analytics.spending(range);
    expect(result.totals.amount).toBe('10500.00');
    expect(result.recentExpenses).toHaveLength(5);
    expect(store.client.expense.findMany).toHaveBeenCalledTimes(2);
    expect(result.recentExpenses.map((row) => row.id)).toEqual(
      [...store.expenses]
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, 5)
        .map((row) => row.id),
    );
  });

  it('aggregates beyond one stored money column without floating point or lost cents', async () => {
    await expenses.create(exampleExpense({ amount: '999999999999.99' }));
    await expenses.create(
      exampleExpense({ id: randomUUID(), amount: '999999999999.99' }),
    );
    expect((await analytics.spending(range)).totals.amount).toBe(
      '1999999999999.98',
    );
  });

  it('uses one serializable snapshot, retries bounded conflicts and never writes financial records', async () => {
    store.conflictBeforeCommit = 1;
    await analytics.spending(range);
    expect(store.client.$transaction).toHaveBeenCalledTimes(2);
    expect(store.client.expense.create).not.toHaveBeenCalled();
    expect(
      store.transactionOptions.every(
        (row) => (row as any).isolationLevel === 'Serializable',
      ),
    ).toBe(true);
    store.client.expense.findMany.mockRejectedValueOnce(
      databaseFailure('P1001'),
    );
    await expect(analytics.spending(range)).rejects.toThrow();
  });
});
