import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { debtBalance, money } from '../finance/financial-model.js';

export const debtInclude = {
  debtor: { select: { id: true, name: true } },
  creditor: { select: { id: true, name: true } },
  expenseAllocation: {
    include: {
      expense: {
        select: {
          id: true,
          merchant: true,
          purchasedOn: true,
          fundedByPersonId: true,
          currency: true,
          deletedAt: true,
        },
      },
    },
  },
  repayments: { orderBy: [{ paidOn: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DebtInclude;

export type StoredDebt = Prisma.DebtGetPayload<{ include: typeof debtInclude }>;
export type StoredRepayment = StoredDebt['repayments'][number];

export function isStoredDebtActive(debt: StoredDebt): boolean {
  return (
    !debt.deletedAt &&
    (debt.origin === 'LOAN' ||
      (!!debt.expenseAllocation &&
        !debt.expenseAllocation.deletedAt &&
        !debt.expenseAllocation.expense.deletedAt))
  );
}

export function storedDebtBalance(debt: StoredDebt) {
  try {
    money(debt.originalAmount);
    if (
      debt.debtorPersonId === debt.creditorPersonId ||
      !debt.debtor ||
      !debt.creditor ||
      (debt.dueOn && debt.dueOn < debt.incurredOn) ||
      (debt.origin === 'LOAN' &&
        (debt.expenseAllocationId || debt.expenseAllocation)) ||
      (debt.origin === 'EXPENSE' &&
        (!debt.expenseAllocation ||
          debt.expenseAllocation.id !== debt.expenseAllocationId))
    )
      throw new Error();
    for (const payment of debt.repayments) {
      money(payment.amount);
      if (payment.debtId !== debt.id || payment.paidOn < debt.incurredOn)
        throw new Error();
    }
    // Archived expense terms can differ from their superseded allocation. They stay historical.
    if (!isStoredDebtActive(debt))
      return {
        status: 'INACTIVE' as const,
        originalAmount: debt.originalAmount,
        repaidAmount: new Prisma.Decimal(0),
        outstandingAmount: new Prisma.Decimal(0),
      };
    if (
      debt.origin === 'EXPENSE' &&
      debt.incurredOn.getTime() !==
        debt.expenseAllocation!.expense.purchasedOn.getTime()
    )
      throw new Error();
    return debtBalance(
      { ...debt, sourceAllocation: debt.expenseAllocation },
      debt.repayments,
    );
  } catch {
    throw new ConflictException(
      'Stored financial records are inconsistent. Review the debt and repayment history before continuing.',
    );
  }
}

export function presentRepayment(payment: StoredRepayment, debt: StoredDebt) {
  return {
    id: payment.id,
    debtId: payment.debtId,
    amount: payment.amount.toFixed(2),
    currency: debt.currency,
    paidOn: payment.paidOn.toISOString().slice(0, 10),
    description: payment.description,
    active: isStoredDebtActive(debt) && !payment.deletedAt,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    deletedAt: payment.deletedAt?.toISOString() ?? null,
  };
}

export function presentDebt(debt: StoredDebt) {
  const balance = storedDebtBalance(debt);
  const allocation = debt.expenseAllocation;
  return {
    id: debt.id,
    origin: debt.origin,
    currency: debt.currency,
    debtorPersonId: debt.debtorPersonId,
    creditorPersonId: debt.creditorPersonId,
    debtor: debt.debtor,
    creditor: debt.creditor,
    originalAmount: balance.originalAmount.toFixed(2),
    repaidAmount: balance.repaidAmount.toFixed(2),
    outstandingAmount: balance.outstandingAmount.toFixed(2),
    status: balance.status,
    active: balance.status !== 'INACTIVE',
    incurredOn: debt.incurredOn.toISOString().slice(0, 10),
    dueOn: debt.dueOn?.toISOString().slice(0, 10) ?? null,
    description: debt.description,
    expenseAllocationId: debt.expenseAllocationId,
    source: allocation
      ? {
          allocationId: allocation.id,
          expenseId: allocation.expenseId,
          merchant: allocation.expense.merchant,
          purchasedOn: allocation.expense.purchasedOn
            .toISOString()
            .slice(0, 10),
          allocationDeletedAt: allocation.deletedAt?.toISOString() ?? null,
          expenseDeletedAt: allocation.expense.deletedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: debt.createdAt.toISOString(),
    updatedAt: debt.updatedAt.toISOString(),
    deletedAt: debt.deletedAt?.toISOString() ?? null,
    repayments: debt.repayments.map((payment) =>
      presentRepayment(payment, debt),
    ),
  };
}

export type DebtView = ReturnType<typeof presentDebt>;

function newTotals() {
  return {
    originalAmount: new Prisma.Decimal(0),
    repaidAmount: new Prisma.Decimal(0),
    outstandingAmount: new Prisma.Decimal(0),
    activeCount: 0,
    pendingCount: 0,
    settledCount: 0,
    inactiveCount: 0,
  };
}
type Totals = ReturnType<typeof newTotals>;
function add(totals: Totals, view: DebtView) {
  if (!view.active) {
    totals.inactiveCount++;
    return;
  }
  totals.activeCount++;
  if (view.status === 'PAID') totals.settledCount++;
  else totals.pendingCount++;
  totals.originalAmount = totals.originalAmount.plus(view.originalAmount);
  totals.repaidAmount = totals.repaidAmount.plus(view.repaidAmount);
  totals.outstandingAmount = totals.outstandingAmount.plus(
    view.outstandingAmount,
  );
}
function amounts(totals: Totals) {
  return {
    ...totals,
    originalAmount: totals.originalAmount.toFixed(2),
    repaidAmount: totals.repaidAmount.toFixed(2),
    outstandingAmount: totals.outstandingAmount.toFixed(2),
  };
}

// Directional obligations remain separate. No netting or allocation double counting.
export function debtSummaryAccumulator() {
  const totals = newTotals();
  const byOrigin = { EXPENSE: newTotals(), LOAN: newTotals() };
  const people = new Map<
    string,
    { person: DebtView['debtor']; owed: Totals; receivable: Totals }
  >();
  const person = (value: DebtView['debtor']) => {
    if (!people.has(value.id))
      people.set(value.id, {
        person: value,
        owed: newTotals(),
        receivable: newTotals(),
      });
    return people.get(value.id)!;
  };
  return {
    add(view: DebtView) {
      add(totals, view);
      add(byOrigin[view.origin], view);
      add(person(view.debtor).owed, view);
      add(person(view.creditor).receivable, view);
    },
    result() {
      const byPerson = [...people.values()]
        .sort((a, b) => a.person.id.localeCompare(b.person.id))
        .map((row) => ({
          person: row.person,
          owed: amounts(row.owed),
          receivable: amounts(row.receivable),
        }));
      return {
        currency: 'PEN' as const,
        totals: amounts(totals),
        byOrigin: {
          EXPENSE: amounts(byOrigin.EXPENSE),
          LOAN: amounts(byOrigin.LOAN),
        },
        byPerson,
        byDebtor: byPerson
          .filter((row) => row.owed.activeCount || row.owed.inactiveCount)
          .map((row) => ({ person: row.person, ...row.owed })),
        byCreditor: byPerson
          .filter(
            (row) => row.receivable.activeCount || row.receivable.inactiveCount,
          )
          .map((row) => ({ person: row.person, ...row.receivable })),
      };
    },
  };
}
