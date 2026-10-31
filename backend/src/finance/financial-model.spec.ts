import { describe, expect, it } from 'vitest';
import {
  allocateByPercentage,
  debtBalance,
  money,
  validateDebtOrigin,
  validateExpenseAllocations,
  validateRepayment,
} from './financial-model.js';
import type { FinancialDebt, FinancialRepayment } from './financial-model.js';

const antonella = '00000000-0000-4000-8000-000000000001';
const marco = '00000000-0000-4000-8000-000000000002';
const father = '00000000-0000-4000-8000-000000000003';
const equal = [
  { personId: antonella, percentage: '50' },
  { personId: marco, percentage: '50' },
];
const loan = (overrides: Partial<FinancialDebt> = {}): FinancialDebt => ({
  id: 'debt-1',
  origin: 'LOAN',
  debtorPersonId: antonella,
  creditorPersonId: father,
  originalAmount: '150.00',
  currency: 'PEN',
  ...overrides,
});
const expenseDebt = (): FinancialDebt =>
  loan({
    origin: 'EXPENSE',
    creditorPersonId: marco,
    sourceAllocation: {
      personId: antonella,
      amount: '150.00',
      expense: { fundedByPersonId: marco, currency: 'PEN' },
    },
  });
const repayment = (
  amount: string,
  overrides: Partial<FinancialRepayment> = {},
): FinancialRepayment => ({
  id: 'repayment-1',
  debtId: 'debt-1',
  amount,
  ...overrides,
});

describe('exact money and expense allocations', () => {
  it('supports personal expenses funded by somebody else', () => {
    validateExpenseAllocations('150.00', 'PERSONAL', [
      { personId: antonella, percentage: '100', amount: '150.00' },
    ]);
    validateDebtOrigin(expenseDebt());
    expect(debtBalance(expenseDebt(), []).outstandingAmount.toFixed(2)).toBe(
      '150.00',
    );
  });

  it('allocates shared 50/50 and 70/30 amounts exactly', () => {
    const halves = allocateByPercentage('100.00', equal);
    validateExpenseAllocations('100.00', 'SHARED', halves);
    expect(halves.map((row) => row.amount.toFixed(2))).toEqual([
      '50.00',
      '50.00',
    ]);
    const custom = allocateByPercentage('200.00', [
      { personId: antonella, percentage: '70' },
      { personId: marco, percentage: '30' },
    ]);
    expect(custom.map((row) => row.amount.toFixed(2))).toEqual([
      '140.00',
      '60.00',
    ]);
  });

  it('apportions odd cents deterministically by stable ID, never input order or POV', () => {
    const result = allocateByPercentage('100.01', [...equal].reverse());
    expect(
      result.find((row) => row.personId === antonella)?.amount.toFixed(2),
    ).toBe('50.01');
    expect(
      result.find((row) => row.personId === marco)?.amount.toFixed(2),
    ).toBe('50.00');
    const smallest = allocateByPercentage('0.01', equal);
    expect(smallest.map((row) => row.amount.toFixed(2))).toEqual([
      '0.01',
      '0.00',
    ]);
    validateExpenseAllocations('0.01', 'SHARED', smallest);
  });

  it('keeps the maximum supported amount exact with four-decimal percentages', () => {
    const allocations = allocateByPercentage('999999999999.99', [
      { personId: antonella, percentage: '33.3333' },
      { personId: marco, percentage: '66.6667' },
    ]);
    validateExpenseAllocations('999999999999.99', 'SHARED', allocations);
    expect(allocations[0].amount.plus(allocations[1].amount).toFixed(2)).toBe(
      '999999999999.99',
    );
  });

  it.each(['0', '-1', '0.001', '1000000000000', 'NaN', 'Infinity'])(
    'rejects invalid money %s',
    (value) => {
      expect(() => money(value)).toThrow();
    },
  );

  it('rejects floating-point inputs instead of silently converting them', () => {
    expect(() => money(0.1 as never)).toThrow('never floating-point');
  });

  it('rejects incorrect totals, percentages, duplicates, and classifications', () => {
    expect(() =>
      validateExpenseAllocations(
        '100',
        'SHARED',
        equal.map((share) => ({ ...share, amount: '40' })),
      ),
    ).toThrow('equal the expense');
    expect(() =>
      validateExpenseAllocations('100', 'SHARED', [
        { ...equal[0], amount: '40' },
        { ...equal[1], amount: '60' },
      ]),
    ).toThrow('rounding policy');
    expect(() =>
      allocateByPercentage('100', [
        { ...equal[0], percentage: '40' },
        equal[1],
      ]),
    ).toThrow('total 100');
    expect(() => allocateByPercentage('100', [equal[0], equal[0]])).toThrow(
      'unique',
    );
    expect(() =>
      validateExpenseAllocations(
        '100',
        'PERSONAL',
        allocateByPercentage('100', equal),
      ),
    ).toThrow('exactly one');
    expect(() =>
      validateExpenseAllocations('100', 'SHARED', [
        { personId: antonella, percentage: '100', amount: '100' },
      ]),
    ).toThrow('at least two');
  });

  it.each(['0', '-1', '100.0001', '50.00001'])(
    'rejects unsupported percentage %s',
    (percentage) => {
      expect(() =>
        allocateByPercentage('100', [{ personId: antonella, percentage }]),
      ).toThrow();
    },
  );
});

describe('debts, independent loans, and repayments', () => {
  it('represents an independent loan as one obligation without an expense', () => {
    const debt = loan({ originalAmount: '300' });
    validateDebtOrigin(debt);
    expect(debtBalance(debt, []).outstandingAmount.toFixed(2)).toBe('300.00');
  });

  it('calculates partial and full repayments without adding expenses', () => {
    const partial = debtBalance(loan(), [repayment('60')]);
    expect(partial.status).toBe('PARTIALLY_REPAID');
    expect(partial.outstandingAmount.toFixed(2)).toBe('90.00');
    validateRepayment(loan(), [repayment('60')], '90');
    expect(debtBalance(loan(), [repayment('150')]).status).toBe('PAID');
  });

  it('rejects overpayments, incorrect debt links, and corrupt stored totals', () => {
    expect(() => validateRepayment(loan(), [repayment('60')], '90.01')).toThrow(
      'outstanding',
    );
    expect(() => validateRepayment(loan(), [repayment('150')], '0.01')).toThrow(
      'outstanding',
    );
    expect(() => validateRepayment(loan(), [], '0')).toThrow();
    expect(() => debtBalance(loan(), [repayment('151')])).toThrow('exceed');
    expect(() =>
      debtBalance(loan(), [repayment('10', { debtId: 'another-debt' })]),
    ).toThrow('requested debt');
  });

  it('requires an unambiguous, consistent origin and distinct counterparties', () => {
    expect(() =>
      validateDebtOrigin(
        loan({ sourceAllocation: expenseDebt().sourceAllocation }),
      ),
    ).toThrow('cannot have an expense');
    expect(() => validateDebtOrigin(loan({ origin: 'EXPENSE' }))).toThrow(
      'must match',
    );
    expect(() =>
      validateDebtOrigin({ ...expenseDebt(), originalAmount: '100' }),
    ).toThrow('must match');
    expect(() =>
      validateDebtOrigin({ ...expenseDebt(), debtorPersonId: father }),
    ).toThrow('must match');
    expect(() =>
      validateDebtOrigin({ ...expenseDebt(), creditorPersonId: father }),
    ).toThrow('must match');
    expect(() =>
      validateDebtOrigin(loan({ creditorPersonId: antonella })),
    ).toThrow('distinct');
  });

  it('does not net opposite-direction debts', () => {
    const first = loan({ creditorPersonId: marco, originalAmount: '100' });
    const opposite = loan({
      id: 'debt-2',
      debtorPersonId: marco,
      creditorPersonId: antonella,
      originalAmount: '30',
    });
    expect(debtBalance(first, []).outstandingAmount.toFixed(2)).toBe('100.00');
    expect(debtBalance(opposite, []).outstandingAmount.toFixed(2)).toBe(
      '30.00',
    );
  });
});

describe('effective soft deletion and restoration', () => {
  const deletedAt = new Date('2026-10-31T12:00:00Z');

  it('excludes soft-deleted repayments and recalculates the outstanding amount', () => {
    expect(
      debtBalance(loan(), [
        repayment('60', { deletedAt }),
      ]).outstandingAmount.toFixed(2),
    ).toBe('150.00');
    expect(
      debtBalance(loan(), [
        repayment('60', { deletedAt: null }),
      ]).outstandingAmount.toFixed(2),
    ).toBe('90.00');
  });

  it('excludes deleted loans/debts and rejects their repayments', () => {
    const deleted = loan({ deletedAt });
    expect(
      debtBalance(deleted, [repayment('60')]).outstandingAmount.toFixed(2),
    ).toBe('0.00');
    expect(debtBalance(deleted, []).status).toBe('INACTIVE');
    expect(() => validateRepayment(deleted, [], '1')).toThrow('inactive');
  });

  it('excludes a debt when its source allocation or expense is deleted', () => {
    const allocationDeleted = expenseDebt();
    allocationDeleted.sourceAllocation!.deletedAt = deletedAt;
    expect(debtBalance(allocationDeleted, [repayment('60')]).status).toBe(
      'INACTIVE',
    );
    const expenseDeleted = expenseDebt();
    expenseDeleted.sourceAllocation!.expense.deletedAt = deletedAt;
    expect(
      debtBalance(expenseDeleted, [repayment('60')]).outstandingAmount.toFixed(
        2,
      ),
    ).toBe('0.00');
    expenseDeleted.sourceAllocation!.expense.deletedAt = null;
    expect(
      debtBalance(expenseDeleted, [repayment('60')]).outstandingAmount.toFixed(
        2,
      ),
    ).toBe('90.00');
  });

  it('preserves independent child deletion and rejects overpaying restorations', () => {
    const source = expenseDebt();
    source.sourceAllocation!.deletedAt = deletedAt;
    source.sourceAllocation!.expense.deletedAt = null;
    expect(debtBalance(source, []).status).toBe('INACTIVE');
    const rows = [
      repayment('150'),
      repayment('60', { id: 'deleted-repayment', deletedAt }),
    ];
    expect(() =>
      validateRepayment(loan(), rows, '60', 'deleted-repayment'),
    ).toThrow('outstanding');
    validateRepayment(loan(), [repayment('60')], '90', 'repayment-1');
  });
});
