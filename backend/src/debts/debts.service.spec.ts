import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { DebtsService } from './debts.service.js';
import { DebtFiltersDto, DebtQueryDto } from './debt.dto.js';
import { LoansService } from '../loans/loans.service.js';
import { RepaymentsService } from '../repayments/repayments.service.js';
import { RepaymentQueryDto } from '../repayments/repayment.dto.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import {
  databaseFailure,
  exampleExpense,
  FinanceStore,
  ids,
} from '../../test/finance-store.js';

const loanId = '00000000-0000-4000-8000-000000000040';
const loan = (overrides = {}) => ({
  id: loanId,
  debtorPersonId: ids.antonella,
  creditorPersonId: ids.marco,
  amount: '100.00',
  incurredOn: '2026-10-30',
  dueOn: '2026-11-30',
  ...overrides,
});
const payment = (amount = '30.00', overrides = {}) => ({
  id: randomUUID(),
  amount,
  paidOn: '2026-10-31',
  description: 'Synthetic repayment',
  ...overrides,
});

describe('debt, loan and repayment transactions (mocked database)', () => {
  let store: FinanceStore;
  let debts: DebtsService;
  let loans: LoansService;
  let repayments: RepaymentsService;
  let expenses: ExpensesService;
  beforeEach(() => {
    store = new FinanceStore();
    debts = new DebtsService(store.prisma());
    loans = new LoansService(store.prisma(), debts);
    repayments = new RepaymentsService(store.prisma(), debts);
    expenses = new ExpensesService(store.prisma());
  });

  it('creates one independent debt with due date and no spending records', async () => {
    const view = await loans.create(loan({ description: '  Example loan  ' }));
    expect(view).toMatchObject({
      origin: 'LOAN',
      originalAmount: '100.00',
      outstandingAmount: '100.00',
      repaidAmount: '0.00',
      status: 'OPEN',
      description: 'Example loan',
      dueOn: '2026-11-30',
      source: null,
    });
    expect(store.debts).toHaveLength(1);
    expect(store.expenses).toHaveLength(0);
    expect(store.allocations).toHaveLength(0);
  });

  it.each(['0', '-1', '0.001', '1000000000000', 'NaN'])(
    'rejects invalid loan principal %s without writing',
    async (amount) => {
      await expect(loans.create(loan({ amount }))).rejects.toThrow();
      expect(store.debts).toHaveLength(0);
    },
  );

  it('rejects self loans, unknown/inactive people, impossible dates and early due dates', async () => {
    for (const change of [
      { debtorPersonId: ids.marco },
      { creditorPersonId: randomUUID() },
      { incurredOn: '2026-02-30' },
      { dueOn: '2026-10-29' },
    ]) {
      await expect(loans.create(loan(change))).rejects.toThrow();
    }
    store.people[0].isActive = false;
    await expect(loans.create(loan())).rejects.toThrow('active');
    expect(store.debts).toHaveLength(0);
  });

  it('replays an equivalent loan UUID and refuses changed or deleted intent', async () => {
    const first = await loans.create(loan());
    expect(await loans.create(loan({ amount: '100' }))).toEqual(first);
    await expect(loans.create(loan({ amount: '101' }))).rejects.toThrow(
      'reserved',
    );
    await loans.remove(loanId);
    await expect(loans.create(loan())).rejects.toThrow('reserved');
    expect(store.debts).toHaveLength(1);
  });

  it('amends unpaid loan terms and clears optional metadata without creating new debt rows', async () => {
    await loans.create(loan());
    const view = await loans.update(loanId, {
      amount: '200',
      debtorPersonId: ids.thirdParty,
      incurredOn: '2026-10-29',
      description: 'Updated',
      dueOn: null,
    });
    expect(view).toMatchObject({
      originalAmount: '200.00',
      debtorPersonId: ids.thirdParty,
      incurredOn: '2026-10-29',
      dueOn: null,
      description: 'Updated',
    });
    expect(store.debts).toHaveLength(1);
    await expect(loans.update(loanId, {})).rejects.toThrow('At least');
  });

  it('supports exact partial and full repayments with derived balances and no spending', async () => {
    await loans.create(loan({ amount: '0.30' }));
    await repayments.create(loanId, payment('0.10'));
    expect(await debts.get(loanId)).toMatchObject({
      status: 'PARTIALLY_REPAID',
      repaidAmount: '0.10',
      outstandingAmount: '0.20',
    });
    await repayments.create(loanId, payment('0.20'));
    expect(await debts.get(loanId)).toMatchObject({
      status: 'PAID',
      repaidAmount: '0.30',
      outstandingAmount: '0.00',
    });
    expect(store.expenses).toHaveLength(0);
    expect(store.debts).toHaveLength(1);
  });

  it('rejects overpayments, settled-debt payments and dates before incurrence', async () => {
    await loans.create(loan());
    await expect(repayments.create(loanId, payment('100.01'))).rejects.toThrow(
      'exceeds',
    );
    await expect(
      repayments.create(loanId, payment('1', { paidOn: '2026-10-29' })),
    ).rejects.toThrow('precede');
    await repayments.create(loanId, payment('100'));
    await expect(repayments.create(loanId, payment('0.01'))).rejects.toThrow(
      'exceeds',
    );
    expect(store.repayments).toHaveLength(1);
  });

  it.each(['0', '-1', '0.001', '1000000000000', 'NaN'])(
    'rejects invalid repayment amount %s',
    async (amount) => {
      await loans.create(loan());
      await expect(
        repayments.create(loanId, payment(amount)),
      ).rejects.toThrow();
      expect(store.repayments).toHaveLength(0);
    },
  );

  it('reserves repayment UUIDs across debts and does not revive deleted retries', async () => {
    await loans.create(loan());
    const input = payment('100');
    const first = await repayments.create(loanId, input);
    expect(
      await repayments.create(loanId, { ...input, amount: '100.00' }),
    ).toEqual(first);
    await expect(
      repayments.create(loanId, { ...input, amount: '99' }),
    ).rejects.toThrow('reserved');
    const second = randomUUID();
    await loans.create(loan({ id: second }));
    await expect(repayments.create(second, input)).rejects.toThrow('reserved');
    await repayments.remove(input.id);
    await expect(repayments.create(loanId, input)).rejects.toThrow('reserved');
    expect(store.repayments).toHaveLength(1);
  });

  it('excludes deleted repayments, restores only when enough balance remains and supports repeat restoration', async () => {
    await loans.create(loan());
    const first = payment('60');
    await repayments.create(loanId, first);
    await repayments.remove(first.id);
    await repayments.remove(first.id);
    expect((await debts.get(loanId)).outstandingAmount).toBe('100.00');
    const second = payment('50');
    await repayments.create(loanId, second);
    await expect(repayments.restore(first.id)).rejects.toThrow('exceeds');
    expect((await repayments.get(first.id)).deletedAt).not.toBeNull();
    await repayments.remove(second.id);
    await repayments.restore(first.id);
    await repayments.restore(first.id);
    expect((await debts.get(loanId)).outstandingAmount).toBe('40.00');
    expect(
      (
        await repayments.list(
          loanId,
          Object.assign(new RepaymentQueryDto(), { deletionState: 'deleted' }),
        )
      ).total,
    ).toBe(1);
  });

  it('freezes financial terms even after repayments are deleted but permits metadata changes', async () => {
    await loans.create(loan());
    const input = payment();
    await repayments.create(loanId, input);
    for (const change of [
      { amount: '101' },
      { amount: '99' },
      { debtorPersonId: ids.thirdParty },
      { creditorPersonId: ids.thirdParty },
      { incurredOn: '2026-10-29' },
    ]) {
      await expect(loans.update(loanId, change)).rejects.toThrow('history');
    }
    expect(
      (
        await loans.update(loanId, {
          description: 'Metadata',
          dueOn: '2026-12-01',
        })
      ).description,
    ).toBe('Metadata');
    await repayments.remove(input.id);
    await expect(loans.update(loanId, { amount: '101' })).rejects.toThrow(
      'history',
    );
    expect(store.repayments).toHaveLength(1);
  });

  it('soft deletes/restores only the loan parent, retaining separately deleted repayments', async () => {
    await loans.create(loan());
    const first = payment('30'),
      second = payment('10');
    await repayments.create(loanId, first);
    await repayments.create(loanId, second);
    await repayments.remove(second.id);
    await loans.remove(loanId);
    await loans.remove(loanId);
    expect(await loans.get(loanId)).toMatchObject({
      status: 'INACTIVE',
      outstandingAmount: '0.00',
      repaidAmount: '0.00',
    });
    expect(
      store.repayments.find((row) => row.id === first.id)!.deletedAt,
    ).toBeNull();
    await expect(repayments.create(loanId, payment())).rejects.toThrow(
      'Restore',
    );
    await expect(repayments.restore(second.id)).rejects.toThrow('Restore');
    await expect(loans.update(loanId, { description: 'No' })).rejects.toThrow(
      'Restore',
    );
    store.people[0].isActive = false;
    expect(await loans.restore(loanId)).toMatchObject({
      repaidAmount: '30.00',
      outstandingAmount: '70.00',
    });
    await loans.restore(loanId);
    expect(
      store.repayments.find((row) => row.id === second.id)!.deletedAt,
    ).not.toBeNull();
    await repayments.create(loanId, payment('1'));
  });

  it('rejects inconsistent parent restoration without clearing deletion flags', async () => {
    await loans.create(loan());
    await loans.remove(loanId);
    store.addRepayment('101');
    await expect(loans.restore(loanId)).rejects.toThrow('inconsistent');
    expect(store.debts[0].deletedAt).not.toBeNull();
  });

  it('repays expense debts and follows the effective source deletion chain', async () => {
    const expense = await expenses.create(exampleExpense());
    const debtId = expense.allocations[0].debt!.id;
    const input = payment('10');
    await repayments.create(debtId, input);
    expect(
      (await expenses.get(ids.expense)).allocations[0].debt?.outstandingAmount,
    ).toBe('40.00');
    await expenses.remove(ids.expense);
    expect((await debts.list(new DebtQueryDto())).total).toBe(0);
    expect(
      (
        await debts.list(
          Object.assign(new DebtQueryDto(), { deletionState: 'deleted' }),
        )
      ).data[0].status,
    ).toBe('INACTIVE');
    await expect(repayments.create(debtId, payment())).rejects.toThrow(
      'Restore',
    );
    await expect(repayments.restore(input.id)).rejects.toThrow('Restore');
    await expenses.restore(ids.expense);
    expect((await debts.get(debtId)).outstandingAmount).toBe('40.00');
    store.allocations[0].deletedAt = new Date();
    await expect(repayments.create(debtId, payment())).rejects.toThrow(
      'Restore',
    );
  });

  it('does not allow loan routes to edit, delete or restore expense-origin debt', async () => {
    await expenses.create(exampleExpense());
    const id = store.debts[0].id;
    for (const operation of [
      loans.get(id),
      loans.update(id, { amount: '60' }),
      loans.remove(id),
      loans.restore(id),
    ]) {
      await expect(operation).rejects.toThrow('Loan not found');
    }
    await expect(loans.create(loan({ id }))).rejects.toThrow('reserved');
    expect(store.debts[0].deletedAt).toBeNull();
  });

  it('combines all filters, paginates after computed status and isolates loan lists', async () => {
    await loans.create(loan());
    await loans.create(
      loan({
        id: randomUUID(),
        incurredOn: '2026-10-29',
        debtorPersonId: ids.thirdParty,
      }),
    );
    await repayments.create(loanId, payment('100'));
    await expenses.create(exampleExpense());
    const result = await debts.list(
      Object.assign(new DebtQueryDto(), {
        origin: 'LOAN',
        debtorPersonId: ids.antonella,
        creditorPersonId: ids.marco,
        incurredFrom: '2026-10-30',
        incurredTo: '2026-10-30',
        status: 'settled',
        pageSize: 1,
      }),
    );
    expect(result.total).toBe(1);
    expect(result.data[0].id).toBe(loanId);
    expect(
      (
        await debts.list(
          Object.assign(new DebtQueryDto(), { status: 'pending' }),
        )
      ).total,
    ).toBe(2);
    expect((await loans.list(new DebtQueryDto())).total).toBe(2);
    await expect(
      loans.list(
        Object.assign(new DebtQueryDto(), { origin: 'EXPENSE' as const }),
      ),
    ).rejects.toThrow();
    expect(() =>
      debts.list(
        Object.assign(new DebtQueryDto(), {
          incurredFrom: '2026-11-01',
          incurredTo: '2026-10-01',
        }),
      ),
    ).toThrow('start date');
  });

  it('scans beyond one batch, preserves total and returns only the requested page', async () => {
    await loans.create(loan());
    for (let index = 0; index < 104; index++)
      store.debts.push({ ...store.debts[0], id: randomUUID() });
    const page = await debts.list(
      Object.assign(new DebtQueryDto(), { page: 6, pageSize: 20 }),
    );
    expect(page.total).toBe(105);
    expect(page.data).toHaveLength(5);
    expect(store.client.debt.findMany).toHaveBeenCalledTimes(2);
  });

  it('summarizes each obligation once, separates directions/origins, counts settled and excludes inactive balances', async () => {
    await loans.create(loan());
    await repayments.create(loanId, payment('40'));
    const reverse = randomUUID();
    await loans.create(
      loan({
        id: reverse,
        debtorPersonId: ids.marco,
        creditorPersonId: ids.antonella,
        amount: '30',
      }),
    );
    await repayments.create(reverse, payment('30'));
    await expenses.create(exampleExpense());
    const summary = await debts.summary(new DebtFiltersDto());
    expect(summary.totals).toMatchObject({
      originalAmount: '180.00',
      repaidAmount: '70.00',
      outstandingAmount: '110.00',
      activeCount: 3,
      settledCount: 1,
      pendingCount: 2,
    });
    expect(summary.byOrigin.EXPENSE.outstandingAmount).toBe('50.00');
    const antonella = summary.byPerson.find(
      (row) => row.person.id === ids.antonella,
    )!;
    expect(antonella.owed.outstandingAmount).toBe('110.00');
    expect(antonella.receivable).toMatchObject({
      repaidAmount: '30.00',
      outstandingAmount: '0.00',
    });
    await loans.remove(loanId);
    expect(
      (await debts.summary(new DebtFiltersDto())).totals.outstandingAmount,
    ).toBe('50.00');
    expect(
      (
        await debts.summary(
          Object.assign(new DebtFiltersDto(), { deletionState: 'deleted' }),
        )
      ).totals,
    ).toMatchObject({
      originalAmount: '0.00',
      repaidAmount: '0.00',
      outstandingAmount: '0.00',
      inactiveCount: 1,
    });
  });

  it('preserves opposite outstanding obligations without offsetting them', async () => {
    await loans.create(loan());
    await loans.create(
      loan({
        id: randomUUID(),
        debtorPersonId: ids.marco,
        creditorPersonId: ids.antonella,
        amount: '30',
      }),
    );
    const summary = await debts.summary(new DebtFiltersDto());
    expect(summary.totals.outstandingAmount).toBe('130.00');
    expect(
      summary.byPerson.find((row) => row.person.id === ids.antonella),
    ).toMatchObject({
      owed: { outstandingAmount: '100.00' },
      receivable: { outstandingAmount: '30.00' },
    });
  });

  it('rolls back repayment creation and bounds serialization retries', async () => {
    await loans.create(loan());
    const input = payment();
    store.conflictBeforeCommit = 1;
    await repayments.create(loanId, input);
    expect(store.repayments).toHaveLength(1);
    store.client.$transaction.mockClear();
    store.conflictBeforeCommit = 3;
    await expect(repayments.create(loanId, payment())).rejects.toThrow(
      'Concurrent',
    );
    expect(store.client.$transaction).toHaveBeenCalledTimes(3);
    expect(store.repayments).toHaveLength(1);
    expect(
      store.transactionOptions.every(
        (row) => (row as any).isolationLevel === 'Serializable',
      ),
    ).toBe(true);
  });

  it('rolls back repayment/loan deletion and restoration when commit aborts', async () => {
    await loans.create(loan());
    const input = payment();
    await repayments.create(loanId, input);
    store.conflictBeforeCommit = 3;
    await expect(repayments.remove(input.id)).rejects.toThrow('Concurrent');
    expect(store.repayments[0].deletedAt).toBeNull();
    await repayments.remove(input.id);
    store.conflictBeforeCommit = 3;
    await expect(repayments.restore(input.id)).rejects.toThrow('Concurrent');
    expect(store.repayments[0].deletedAt).not.toBeNull();
    store.conflictBeforeCommit = 3;
    await expect(loans.remove(loanId)).rejects.toThrow('Concurrent');
    expect(store.debts[0].deletedAt).toBeNull();
    await loans.remove(loanId);
    store.conflictBeforeCommit = 3;
    await expect(loans.restore(loanId)).rejects.toThrow('Concurrent');
    expect(store.debts[0].deletedAt).not.toBeNull();
  });

  it('rolls back loan creation/editing and retries unique repayment creation races', async () => {
    store.conflictBeforeCommit = 3;
    await expect(loans.create(loan())).rejects.toThrow('Concurrent');
    expect(store.debts).toHaveLength(0);
    await loans.create(loan());
    store.conflictBeforeCommit = 3;
    await expect(loans.update(loanId, { amount: '200' })).rejects.toThrow(
      'Concurrent',
    );
    expect(store.debts[0].originalAmount.toFixed(2)).toBe('100.00');
    const input = payment();
    await repayments.create(loanId, input);
    store.client.repayment.findUnique.mockRejectedValueOnce(
      databaseFailure('P2002'),
    );
    await repayments.create(loanId, input);
    expect(store.repayments).toHaveLength(1);
  });

  it('reloads a concurrent winner after a simulated serialization failure and prevents overpayment', async () => {
    await loans.create(loan());
    const original = store.client.$transaction.getMockImplementation()!;
    let winner: Promise<unknown> | undefined;
    let aborted = false;
    // Models PostgreSQL's expected abort/retry outcome, not its actual concurrency behavior.
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (!winner) {
        winner = original(work, options);
        return winner;
      }
      if (!aborted) {
        aborted = true;
        await winner;
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    const results = await Promise.allSettled([
      repayments.create(loanId, payment('60')),
      repayments.create(loanId, payment('60')),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(store.repayments).toHaveLength(1);
    expect(store.repayments[0].amount.toFixed(2)).toBe('60.00');
  });

  it('revalidates restoration against a fresh winning repayment after retry', async () => {
    await loans.create(loan());
    const input = payment('60');
    await repayments.create(loanId, input);
    await repayments.remove(input.id);
    const original = store.client.$transaction.getMockImplementation()!;
    let calls = 0;
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (calls++ === 0) {
        store.addRepayment('50');
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    await expect(repayments.restore(input.id)).rejects.toThrow('exceeds');
    expect(store.repayments[0].deletedAt).not.toBeNull();
  });

  it('does not retry arbitrary database failures or leave an orphaned repayment', async () => {
    await loans.create(loan());
    store.client.$transaction.mockClear();
    const insert = store.client.repayment.create.getMockImplementation()!;
    store.client.repayment.create.mockImplementationOnce(async (args) => {
      await insert(args);
      throw databaseFailure('P2004');
    });
    await expect(repayments.create(loanId, payment())).rejects.toThrow();
    expect(store.client.$transaction).toHaveBeenCalledTimes(1);
    expect(store.repayments).toHaveLength(0);
    expect(store.debts).toHaveLength(1);
  });

  it('rechecks parent deletion on a repayment retry and refuses the now inactive loan', async () => {
    await loans.create(loan());
    const original = store.client.$transaction.getMockImplementation()!;
    let calls = 0;
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (calls++ === 0) {
        store.debts[0].deletedAt = new Date();
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    await expect(repayments.create(loanId, payment())).rejects.toThrow(
      'Restore',
    );
    expect(store.repayments).toHaveLength(0);
  });

  it('rechecks winning repayment history before amending loan terms on retry', async () => {
    await loans.create(loan());
    const original = store.client.$transaction.getMockImplementation()!;
    let calls = 0;
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (calls++ === 0) {
        store.addRepayment('1');
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    await expect(loans.update(loanId, { amount: '101' })).rejects.toThrow(
      'history',
    );
    expect(store.debts[0].originalAmount.toFixed(2)).toBe('100.00');
  });

  it('includes a newly committed repayment when retrying loan restoration', async () => {
    await loans.create(loan());
    await loans.remove(loanId);
    const original = store.client.$transaction.getMockImplementation()!;
    let calls = 0;
    store.client.$transaction.mockImplementation(async (work, options) => {
      if (calls++ === 0) {
        store.addRepayment('101');
        throw databaseFailure('P2034');
      }
      return original(work, options);
    });
    await expect(loans.restore(loanId)).rejects.toThrow('inconsistent');
    expect(store.debts[0].deletedAt).not.toBeNull();
  });

  it('handles a loan UUID unique race without duplicating the obligation', async () => {
    await loans.create(loan());
    store.client.debt.findUnique.mockRejectedValueOnce(
      databaseFailure('P2002'),
    );
    expect((await loans.create(loan())).id).toBe(loanId);
    expect(store.debts).toHaveLength(1);
  });

  it('supports maximum principal and summary totals larger than one stored money column', async () => {
    await loans.create(loan({ amount: '999999999999.99' }));
    await loans.create(loan({ id: randomUUID(), amount: '999999999999.99' }));
    await repayments.create(loanId, payment('999999999999.98'));
    expect((await debts.get(loanId)).outstandingAmount).toBe('0.01');
    expect((await debts.summary(new DebtFiltersDto())).totals).toMatchObject({
      originalAmount: '1999999999999.98',
      repaidAmount: '999999999999.98',
      outstandingAmount: '1000000000000.00',
    });
  });

  it('rejects corrupt active source terms and repayment totals without mutating them', async () => {
    await expenses.create(exampleExpense());
    const id = store.debts[0].id;
    store.debts[0].originalAmount = new Prisma.Decimal('51');
    await expect(repayments.create(id, payment('1'))).rejects.toThrow(
      'inconsistent',
    );
    expect(store.repayments).toHaveLength(0);
  });
});
