import { beforeEach, describe, expect, it } from 'vitest';
import { ExpensesService } from './expenses.service.js';
import { ExpenseQueryDto } from './expense.dto.js';
import {
  databaseFailure,
  exampleExpense,
  FinanceStore,
  ids,
} from '../../test/finance-store.js';

describe('expense transactions and financial rules', () => {
  let store: FinanceStore;
  let service: ExpensesService;
  beforeEach(() => {
    store = new FinanceStore();
    service = new ExpensesService(store.prisma());
  });

  it('creates a self-funded personal expense without a debt', async () => {
    const result = await service.create(
      exampleExpense({
        amount: '80',
        classification: 'PERSONAL',
        fundedByPersonId: ids.antonella,
        allocations: [{ personId: ids.antonella, percentage: '100' }],
      }),
    );
    expect(result.amount).toBe('80.00');
    expect(result.allocations[0].amount).toBe('80.00');
    expect(store.debts).toHaveLength(0);
  });

  it('creates a personal card debt on the purchase date, independently of card ownership', async () => {
    const result = await service.create(
      exampleExpense({
        amount: '150',
        classification: 'PERSONAL',
        fundedByPersonId: ids.thirdParty,
        allocations: [{ personId: ids.antonella, percentage: '100' }],
      }),
    );
    expect(result.allocations[0].debt).toMatchObject({
      debtorPersonId: ids.antonella,
      creditorPersonId: ids.thirdParty,
      originalAmount: '150.00',
      incurredOn: '2026-10-30',
    });
  });

  it('creates 50/50 and 70/30 shared responsibilities without a self-debt', async () => {
    const halves = await service.create(exampleExpense());
    expect(halves.allocations.map((row) => row.amount)).toEqual([
      '50.00',
      '50.00',
    ]);
    expect(store.debts).toHaveLength(1);
    const custom = await service.update(ids.expense, {
      allocations: [
        { personId: ids.antonella, percentage: '70' },
        { personId: ids.marco, percentage: '30' },
      ],
    });
    expect(custom.allocations.map((row) => row.amount)).toEqual([
      '70.00',
      '30.00',
    ]);
    expect(store.debts).toHaveLength(1);
  });

  it('funds both beneficiaries from a third party with two distinct debts', async () => {
    await service.create(exampleExpense({ fundedByPersonId: ids.thirdParty }));
    expect(store.debts).toHaveLength(2);
    expect(
      store.debts.every(
        (row) =>
          row.creditorPersonId === ids.thirdParty &&
          row.debtorPersonId !== row.creditorPersonId,
      ),
    ).toBe(true);
  });

  it('apportions exact odd cents by stable person ID and avoids zero-principal debts', async () => {
    const result = await service.create(
      exampleExpense({
        amount: '0.01',
        fundedByPersonId: ids.thirdParty,
        allocations: [...exampleExpense().allocations].reverse(),
      }),
    );
    expect(result.allocations.map((row) => row.amount)).toEqual([
      '0.01',
      '0.00',
    ]);
    expect(store.debts).toHaveLength(1);
  });

  it.each(['0', '-1', '0.001', '1000000000000', 'NaN'])(
    'rejects invalid money %s before writing',
    async (amount) => {
      await expect(
        service.create(exampleExpense({ amount })),
      ).rejects.toThrow();
      expect(store.expenses).toHaveLength(0);
    },
  );

  it('rejects bad totals, duplicate beneficiaries, and impossible classifications', async () => {
    for (const allocations of [
      [{ personId: ids.antonella, percentage: '50' }],
      [
        { personId: ids.antonella, percentage: '50' },
        { personId: ids.antonella, percentage: '50' },
      ],
      [
        { personId: ids.antonella, percentage: '0' },
        { personId: ids.marco, percentage: '100' },
      ],
    ]) {
      await expect(
        service.create(exampleExpense({ allocations })),
      ).rejects.toThrow();
    }
    await expect(
      service.create(exampleExpense({ classification: 'PERSONAL' })),
    ).rejects.toThrow();
    expect(store.expenses).toHaveLength(0);
  });

  it('rejects invalid calendar dates and unknown/inactive financial references', async () => {
    await expect(
      service.create(exampleExpense({ purchasedOn: '2026-02-30' })),
    ).rejects.toThrow('calendar');
    await expect(
      service.create(
        exampleExpense({
          fundedByPersonId: '00000000-0000-4000-8000-000000000999',
        }),
      ),
    ).rejects.toThrow('active');
    store.methods[0].isActive = false;
    await expect(service.create(exampleExpense())).rejects.toThrow('active');
    expect(store.expenses).toHaveLength(0);
  });

  it('replays the same creation ID without duplicate allocations/debts and rejects a changed payload', async () => {
    const first = await service.create(exampleExpense());
    const replay = await service.create(
      exampleExpense({
        amount: '100',
        allocations: [...exampleExpense().allocations].reverse(),
      }),
    );
    expect(replay).toEqual(first);
    expect(store.expenses).toHaveLength(1);
    expect(store.allocations).toHaveLength(2);
    expect(store.debts).toHaveLength(1);
    await expect(
      service.create(exampleExpense({ amount: '101' })),
    ).rejects.toThrow('reserved');
    await service.remove(ids.expense);
    await expect(service.create(exampleExpense())).rejects.toThrow('reserved');
  });

  it('reuses reserved allocation/debt links when changing participants and funding', async () => {
    await service.create(exampleExpense());
    const debtId = store.debts[0].id;
    await service.update(ids.expense, {
      classification: 'PERSONAL',
      fundedByPersonId: ids.antonella,
      allocations: [{ personId: ids.marco, percentage: '100' }],
    });
    expect(store.allocations).toHaveLength(2);
    expect(store.debts).toHaveLength(2);
    const restored = await service.update(ids.expense, {
      classification: 'SHARED',
      fundedByPersonId: ids.marco,
      allocations: exampleExpense().allocations,
    });
    expect(restored.allocations[0].debt?.id).toBe(debtId);
    expect(restored.allocations[0].debt?.status).toBe('OPEN');
    expect(store.debts).toHaveLength(2);
  });

  it('preserves repayments and permits metadata edits while rejecting repaid financial corrections', async () => {
    await service.create(exampleExpense());
    store.addRepayment('30');
    const before = [...store.repayments];
    const changed = await service.update(ids.expense, {
      merchant: 'Corrected merchant',
      description: 'Example correction',
    });
    expect(changed.allocations[0].debt?.outstandingAmount).toBe('20.00');
    expect(store.repayments).toEqual(before);
    await expect(service.update(ids.expense, { amount: '20' })).rejects.toThrow(
      'below',
    );
    await expect(
      service.update(ids.expense, { amount: '120' }),
    ).rejects.toThrow('history');
    await expect(
      service.update(ids.expense, { fundedByPersonId: ids.thirdParty }),
    ).rejects.toThrow('history');
    await expect(
      service.update(ids.expense, { purchasedOn: '2026-10-29' }),
    ).rejects.toThrow('history');
    await expect(
      service.update(ids.expense, {
        classification: 'PERSONAL',
        allocations: [{ personId: ids.marco, percentage: '100' }],
      }),
    ).rejects.toThrow('remove');
    expect(store.expenses[0].amount.toFixed(2)).toBe('100.00');
    expect(store.repayments).toEqual(before);
  });

  it('protects even soft-deleted repayment history from source reassignment', async () => {
    await service.create(exampleExpense());
    store.addRepayment('10', new Date());
    await expect(
      service.update(ids.expense, { fundedByPersonId: ids.thirdParty }),
    ).rejects.toThrow('history');
  });

  it('soft deletes only the parent and restores eligible debts with unchanged repayment history', async () => {
    await service.create(exampleExpense());
    store.addRepayment('30');
    await service.remove(ids.expense);
    await service.remove(ids.expense);
    const deleted = await service.get(ids.expense);
    expect(deleted.allocations[0].debt?.status).toBe('INACTIVE');
    expect(deleted.allocations[0].debt?.outstandingAmount).toBe('0.00');
    expect(store.allocations.every((row) => !row.deletedAt)).toBe(true);
    expect(store.debts[0].deletedAt).toBeNull();
    expect(store.repayments).toHaveLength(1);
    await expect(
      service.update(ids.expense, { merchant: 'Example' }),
    ).rejects.toThrow('Restore');
    const restored = await service.restore(ids.expense);
    expect(restored.allocations[0].debt?.outstandingAmount).toBe('20.00');
    expect((await service.restore(ids.expense)).deletedAt).toBeNull();
  });

  it('preserves independent debt/repayment deletion and rejects an inconsistent restoration', async () => {
    await service.create(exampleExpense());
    store.debts[0].deletedAt = new Date();
    store.addRepayment('10', new Date());
    await service.remove(ids.expense);
    expect(
      (await service.restore(ids.expense)).allocations[0].debt?.status,
    ).toBe('INACTIVE');
    store.debts[0].deletedAt = null;
    await service.remove(ids.expense);
    store.addRepayment('60');
    await expect(service.restore(ids.expense)).rejects.toThrow('inconsistent');
    expect(store.expenses[0].deletedAt).not.toBeNull();
  });

  it('restores historical references even if selection has since been deactivated', async () => {
    await service.create(exampleExpense());
    await service.remove(ids.expense);
    store.people[0].isActive = false;
    expect((await service.restore(ids.expense)).deletedAt).toBeNull();
  });

  it('rolls back expense and allocation writes when a linked debt write fails', async () => {
    store.failDebtWrite = true;
    await expect(service.create(exampleExpense())).rejects.toThrow();
    expect(store.expenses).toHaveLength(0);
    expect(store.allocations).toHaveLength(0);
    expect(store.debts).toHaveLength(0);
  });

  it('rolls back an amendment if debt synchronization fails after parent and share writes', async () => {
    await service.create(exampleExpense());
    store.failDebtWrite = true;
    await expect(
      service.update(ids.expense, { amount: '120' }),
    ).rejects.toThrow();
    expect(store.expenses[0].amount.toFixed(2)).toBe('100.00');
    expect(store.allocations.map((row) => row.amount.toFixed(2))).toEqual([
      '50.00',
      '50.00',
    ]);
    expect(store.debts[0].originalAmount.toFixed(2)).toBe('50.00');
  });

  it('retries an aborted serializable transaction from the beginning without duplicates', async () => {
    store.conflictBeforeCommit = 1;
    await service.create(exampleExpense());
    expect(store.client.$transaction).toHaveBeenCalledTimes(2);
    expect(store.expenses).toHaveLength(1);
    expect(store.debts).toHaveLength(1);
    expect(
      store.transactionOptions.every(
        (option) => (option as any).isolationLevel === 'Serializable',
      ),
    ).toBe(true);
  });

  it('bounds conflict retries and rolls back every unsuccessful attempt', async () => {
    store.conflictBeforeCommit = 3;
    await expect(service.create(exampleExpense())).rejects.toThrow(
      'Concurrent',
    );
    expect(store.client.$transaction).toHaveBeenCalledTimes(3);
    expect(store.expenses).toHaveLength(0);
  });

  it('retries a unique-key race and rechecks a newly committed creation ID', async () => {
    await service.create(exampleExpense());
    store.client.expense.findUnique.mockRejectedValueOnce(
      databaseFailure('P2002'),
    );
    expect((await service.create(exampleExpense())).id).toBe(ids.expense);
    expect(store.debts).toHaveLength(1);
  });

  it('rechecks repayments on a transaction retry instead of using an obsolete balance', async () => {
    await service.create(exampleExpense());
    const original = store.client.$transaction.getMockImplementation()!;
    let calls = 0;
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (calls++ === 0) {
        store.addRepayment('40');
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    await expect(service.update(ids.expense, { amount: '20' })).rejects.toThrow(
      'below',
    );
    expect(store.expenses[0].amount.toFixed(2)).toBe('100.00');
    expect(store.repayments).toHaveLength(1);
  });

  it('paginates and combines date/category/beneficiary/funder/classification filters', async () => {
    await service.create(exampleExpense());
    await service.create(
      exampleExpense({
        id: '00000000-0000-4000-8000-000000000031',
        purchasedOn: '2026-10-29',
      }),
    );
    const query = Object.assign(new ExpenseQueryDto(), {
      purchasedFrom: '2026-10-29',
      purchasedTo: '2026-10-30',
      categoryId: ids.category,
      beneficiaryPersonId: ids.antonella,
      fundedByPersonId: ids.marco,
      classification: 'SHARED',
      page: 2,
      pageSize: 1,
    });
    const result = await service.list(query);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].purchasedOn).toBe('2026-10-29');
    await service.remove(ids.expense);
    expect((await service.list(new ExpenseQueryDto())).total).toBe(1);
    expect(
      (
        await service.list(
          Object.assign(new ExpenseQueryDto(), {
            beneficiaryPersonId: ids.thirdParty,
          }),
        )
      ).total,
    ).toBe(0);
    expect(() =>
      service.list(
        Object.assign(new ExpenseQueryDto(), {
          purchasedFrom: '2026-11-01',
          purchasedTo: '2026-10-01',
        }),
      ),
    ).toThrow('start date');
  });
});
