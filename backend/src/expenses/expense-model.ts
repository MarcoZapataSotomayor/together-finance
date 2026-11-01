import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { calendarDate } from '../finance/api-validation.js';
import {
  allocateByPercentage,
  debtBalance,
  money,
  validateExpenseAllocations,
} from '../finance/financial-model.js';
import type { Classification, Share } from '../finance/financial-model.js';

export const expenseInclude = {
  category: { select: { id: true, name: true } },
  paymentMethod: {
    select: { id: true, name: true, type: true, ownerPersonId: true },
  },
  fundedBy: { select: { id: true, name: true } },
  allocations: {
    orderBy: { personId: 'asc' },
    include: {
      person: { select: { id: true, name: true } },
      debt: {
        include: {
          repayments: { orderBy: [{ paidOn: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  },
} satisfies Prisma.ExpenseInclude;

export type StoredExpense = Prisma.ExpenseGetPayload<{
  include: typeof expenseInclude;
}>;
export interface ExpenseInput {
  amount: string;
  purchasedOn: string;
  merchant: string;
  description?: string | null;
  categoryId: string;
  paymentMethodId: string;
  fundedByPersonId: string;
  classification: Classification;
  allocations: Share[];
}

export function planExpense(input: ExpenseInput) {
  const purchasedOn = calendarDate(input.purchasedOn);
  try {
    const amount = money(input.amount);
    const allocations = allocateByPercentage(input.amount, input.allocations);
    validateExpenseAllocations(input.amount, input.classification, allocations);
    return {
      ...input,
      merchant: input.merchant.trim().normalize('NFKC'),
      description: input.description?.trim().normalize('NFKC') || null,
      purchasedOn,
      amount,
      allocations,
      currency: 'PEN' as const,
    };
  } catch {
    throw new BadRequestException(
      'Use positive PEN amounts with at most two decimals, unique beneficiaries, and positive percentages totaling exactly 100. Personal expenses require one beneficiary; shared expenses require at least two.',
    );
  }
}

export type ExpensePlan = ReturnType<typeof planExpense>;

export function expenseInput(expense: StoredExpense): ExpenseInput {
  return {
    amount: expense.amount.toFixed(2),
    purchasedOn: expense.purchasedOn.toISOString().slice(0, 10),
    merchant: expense.merchant,
    description: expense.description,
    categoryId: expense.categoryId,
    paymentMethodId: expense.paymentMethodId,
    fundedByPersonId: expense.fundedByPersonId,
    classification: expense.classification,
    allocations: expense.allocations
      .filter((row) => !row.deletedAt)
      .map((row) => ({ personId: row.personId, percentage: row.percentage })),
  };
}

export function expenseData(plan: ExpensePlan) {
  return {
    amount: plan.amount,
    currency: plan.currency,
    purchasedOn: plan.purchasedOn,
    merchant: plan.merchant,
    description: plan.description,
    categoryId: plan.categoryId,
    paymentMethodId: plan.paymentMethodId,
    fundedByPersonId: plan.fundedByPersonId,
    classification: plan.classification,
  };
}

export function matchesExpense(
  expense: StoredExpense,
  plan: ExpensePlan,
): boolean {
  const active = expense.allocations.filter((row) => !row.deletedAt);
  return (
    !expense.deletedAt &&
    expense.amount.eq(plan.amount) &&
    expense.currency === plan.currency &&
    expense.purchasedOn.getTime() === plan.purchasedOn.getTime() &&
    expense.merchant === plan.merchant &&
    expense.description === plan.description &&
    expense.categoryId === plan.categoryId &&
    expense.paymentMethodId === plan.paymentMethodId &&
    expense.fundedByPersonId === plan.fundedByPersonId &&
    expense.classification === plan.classification &&
    active.length === plan.allocations.length &&
    plan.allocations.every((row) =>
      active.some(
        (old) =>
          old.personId === row.personId &&
          old.percentage.eq(row.percentage) &&
          old.amount.eq(row.amount),
      ),
    )
  );
}

function allocationBalance(
  expense: StoredExpense,
  allocation: StoredExpense['allocations'][number],
) {
  const debt = allocation.debt!;
  const active = !expense.deletedAt && !allocation.deletedAt && !debt.deletedAt;
  if (!active)
    return {
      status: 'INACTIVE' as const,
      originalAmount: debt.originalAmount,
      repaidAmount: new Prisma.Decimal(0),
      outstandingAmount: new Prisma.Decimal(0),
    };
  if (
    debt.incurredOn.getTime() !== expense.purchasedOn.getTime() ||
    (debt.dueOn && debt.dueOn < debt.incurredOn)
  )
    throw new Error('Invalid debt dates.');
  return debtBalance(
    {
      ...debt,
      sourceAllocation: {
        personId: allocation.personId,
        amount: allocation.amount,
        deletedAt: allocation.deletedAt,
        expense,
      },
    },
    debt.repayments,
  );
}

export function validateStoredExpense(expense: StoredExpense): void {
  try {
    validateExpenseAllocations(
      expense.amount,
      expense.classification,
      expense.allocations.filter((row) => !row.deletedAt),
    );
    for (const row of expense.allocations) {
      const needed =
        row.personId !== expense.fundedByPersonId && row.amount.gt(0);
      if (!row.deletedAt && needed && !row.debt)
        throw new Error('Missing debt.');
      if (row.debt) {
        if (
          row.debt.origin !== 'EXPENSE' ||
          row.debt.expenseAllocationId !== row.id
        )
          throw new Error('Invalid source.');
        money(row.debt.originalAmount);
        for (const repayment of row.debt.repayments) {
          if (repayment.debtId !== row.debt.id)
            throw new Error('Invalid repayment source.');
          money(repayment.amount);
        }
        // Independently deleted children remain inactive; do not revive or rewrite them.
        allocationBalance(expense, row);
      }
    }
  } catch {
    throw new ConflictException(
      'Stored financial records are inconsistent. Review the expense and repayment history before continuing.',
    );
  }
}

export function presentExpense(expense: StoredExpense) {
  validateStoredExpense(expense);
  return {
    id: expense.id,
    amount: expense.amount.toFixed(2),
    currency: expense.currency,
    purchasedOn: expense.purchasedOn.toISOString().slice(0, 10),
    merchant: expense.merchant,
    description: expense.description,
    classification: expense.classification,
    categoryId: expense.categoryId,
    paymentMethodId: expense.paymentMethodId,
    fundedByPersonId: expense.fundedByPersonId,
    category: expense.category,
    paymentMethod: expense.paymentMethod,
    fundedBy: expense.fundedBy,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    deletedAt: expense.deletedAt?.toISOString() ?? null,
    allocations: expense.allocations.map((row) => {
      const balance = row.debt ? allocationBalance(expense, row) : null;
      return {
        id: row.id,
        personId: row.personId,
        person: row.person,
        percentage: row.percentage.toFixed(4),
        amount: row.amount.toFixed(2),
        active: !expense.deletedAt && !row.deletedAt,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        debt:
          row.debt && balance
            ? {
                id: row.debt.id,
                origin: row.debt.origin,
                debtorPersonId: row.debt.debtorPersonId,
                creditorPersonId: row.debt.creditorPersonId,
                currency: row.debt.currency,
                incurredOn: row.debt.incurredOn.toISOString().slice(0, 10),
                originalAmount: balance.originalAmount.toFixed(2),
                repaidAmount: balance.repaidAmount.toFixed(2),
                outstandingAmount: balance.outstandingAmount.toFixed(2),
                status: balance.status,
                deletedAt: row.debt.deletedAt?.toISOString() ?? null,
                repayments: row.debt.repayments.map((payment) => ({
                  id: payment.id,
                  amount: payment.amount.toFixed(2),
                  paidOn: payment.paidOn.toISOString().slice(0, 10),
                  description: payment.description,
                  active: balance.status !== 'INACTIVE' && !payment.deletedAt,
                  deletedAt: payment.deletedAt?.toISOString() ?? null,
                })),
              }
            : null,
      };
    }),
  };
}
