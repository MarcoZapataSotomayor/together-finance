import { Prisma } from '../generated/prisma/client.js';

export type DecimalInput = string | Prisma.Decimal;
export type Classification = 'PERSONAL' | 'SHARED';
export interface Share {
  personId: string;
  percentage: DecimalInput;
}
export interface Allocation extends Share {
  amount: DecimalInput;
}

function decimal(value: DecimalInput): Prisma.Decimal {
  if (typeof value !== 'string' && !Prisma.Decimal.isDecimal(value))
    throw new Error(
      'Use decimal strings or Decimal values, never floating-point numbers.',
    );
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new Error('Invalid decimal value.');
  }
}

export function money(value: DecimalInput, allowZero = false): Prisma.Decimal {
  const result = decimal(value);
  if (
    result.decimalPlaces() > 2 ||
    result.gt('999999999999.99') ||
    (allowZero ? result.lt(0) : result.lte(0))
  ) {
    throw new Error(
      'Money must fit Decimal(14,2) and be positive (or zero for an allocation).',
    );
  }
  return result;
}

export function allocateByPercentage(
  total: DecimalInput,
  shares: Share[],
): { personId: string; percentage: Prisma.Decimal; amount: Prisma.Decimal }[] {
  const cents = money(total).mul(100);
  if (!shares.length) throw new Error('At least one allocation is required.');
  const seen = new Set<string>();
  const rows = shares.map((share) => {
    if (!share.personId.trim() || seen.has(share.personId))
      throw new Error('Allocation people must be explicit and unique.');
    seen.add(share.personId);
    const percentage = decimal(share.percentage);
    if (
      percentage.lte(0) ||
      percentage.gt(100) ||
      percentage.decimalPlaces() > 4
    )
      throw new Error(
        'Percentages must be positive, at most 100, and have at most four decimals.',
      );
    const exactCents = cents.mul(percentage).div(100);
    return {
      personId: share.personId,
      percentage,
      cents: exactCents.floor(),
      remainder: exactCents.minus(exactCents.floor()),
    };
  });
  const sumPercentages = rows.reduce(
    (sum, row) => sum.plus(row.percentage),
    new Prisma.Decimal(0),
  );
  if (!sumPercentages.eq(100))
    throw new Error('Allocation percentages must total 100.');
  const remaining = cents
    .minus(
      rows.reduce((sum, row) => sum.plus(row.cents), new Prisma.Decimal(0)),
    )
    .toNumber();
  // Largest remainder; stable person IDs resolve ties independently of input order/POV.
  const ranked = [...rows].sort(
    (a, b) =>
      b.remainder.comparedTo(a.remainder) || (a.personId < b.personId ? -1 : 1),
  );
  for (let index = 0; index < remaining; index++)
    ranked[index].cents = ranked[index].cents.plus(1);
  return rows.map((row) => ({
    personId: row.personId,
    percentage: row.percentage,
    amount: row.cents.div(100),
  }));
}

export function validateExpenseAllocations(
  total: DecimalInput,
  classification: Classification,
  allocations: Allocation[],
): void {
  if (!['PERSONAL', 'SHARED'].includes(classification))
    throw new Error('Invalid expense classification.');
  if (classification === 'PERSONAL' && allocations.length !== 1)
    throw new Error('A personal expense has exactly one beneficiary.');
  if (classification === 'SHARED' && allocations.length < 2)
    throw new Error('A shared expense has at least two beneficiaries.');
  const expected = allocateByPercentage(total, allocations);
  const actualTotal = allocations.reduce(
    (sum, allocation) => sum.plus(money(allocation.amount, true)),
    new Prisma.Decimal(0),
  );
  if (!actualTotal.eq(money(total)))
    throw new Error('Allocation amounts must equal the expense amount.');
  for (let index = 0; index < allocations.length; index++) {
    if (!money(allocations[index].amount, true).eq(expected[index].amount))
      throw new Error(
        'Allocation amounts must match the declared percentages and rounding policy.',
      );
  }
}

export interface ExpenseDebtSource {
  personId: string;
  amount: DecimalInput;
  deletedAt?: Date | null;
  expense: {
    fundedByPersonId: string;
    currency: 'PEN';
    deletedAt?: Date | null;
  };
}

export interface FinancialDebt {
  id: string;
  origin: 'EXPENSE' | 'LOAN';
  debtorPersonId: string;
  creditorPersonId: string;
  originalAmount: DecimalInput;
  currency: 'PEN';
  deletedAt?: Date | null;
  sourceAllocation?: ExpenseDebtSource | null;
}

export interface FinancialRepayment {
  id: string;
  debtId: string;
  amount: DecimalInput;
  deletedAt?: Date | null;
}

export function validateDebtOrigin(debt: FinancialDebt): void {
  money(debt.originalAmount);
  if (
    !debt.debtorPersonId ||
    !debt.creditorPersonId ||
    debt.debtorPersonId === debt.creditorPersonId
  )
    throw new Error(
      'A debt requires distinct explicit debtor and creditor IDs.',
    );
  if (debt.origin === 'LOAN') {
    if (debt.sourceAllocation)
      throw new Error('An independent loan cannot have an expense source.');
  } else if (debt.origin === 'EXPENSE') {
    const source = debt.sourceAllocation;
    if (
      !source ||
      source.personId !== debt.debtorPersonId ||
      source.expense.fundedByPersonId !== debt.creditorPersonId ||
      source.expense.currency !== debt.currency ||
      !money(source.amount, true).eq(debt.originalAmount)
    ) {
      throw new Error(
        'An expense debt must match its allocation, funder, amount, and currency.',
      );
    }
  } else {
    throw new Error('Invalid debt origin.');
  }
}

export function isDebtActive(debt: FinancialDebt): boolean {
  return (
    !debt.deletedAt &&
    !(
      debt.origin === 'EXPENSE' &&
      (debt.sourceAllocation?.deletedAt ||
        debt.sourceAllocation?.expense.deletedAt)
    )
  );
}

export function debtBalance(
  debt: FinancialDebt,
  repayments: FinancialRepayment[],
) {
  validateDebtOrigin(debt);
  if (repayments.some((repayment) => repayment.debtId !== debt.id))
    throw new Error('Repayments must belong to the requested debt.');
  const originalAmount = money(debt.originalAmount);
  if (!isDebtActive(debt))
    return {
      status: 'INACTIVE' as const,
      originalAmount,
      repaidAmount: new Prisma.Decimal(0),
      outstandingAmount: new Prisma.Decimal(0),
    };
  const repaidAmount = repayments
    .filter((repayment) => !repayment.deletedAt)
    .reduce(
      (sum, repayment) => sum.plus(money(repayment.amount)),
      new Prisma.Decimal(0),
    );
  if (repaidAmount.gt(originalAmount))
    throw new Error('Repayments exceed the original debt.');
  const outstandingAmount = originalAmount.minus(repaidAmount);
  const status = outstandingAmount.isZero()
    ? 'PAID'
    : repaidAmount.isZero()
      ? 'OPEN'
      : 'PARTIALLY_REPAID';
  return { status, originalAmount, repaidAmount, outstandingAmount };
}

export function validateRepayment(
  debt: FinancialDebt,
  repayments: FinancialRepayment[],
  proposed: DecimalInput,
  replacingId?: string,
): void {
  const balance = debtBalance(
    debt,
    repayments.filter((repayment) => repayment.id !== replacingId),
  );
  if (balance.status === 'INACTIVE')
    throw new Error('Cannot repay an inactive debt or source.');
  if (money(proposed).gt(balance.outstandingAmount))
    throw new Error('Repayment exceeds the outstanding balance.');
}
