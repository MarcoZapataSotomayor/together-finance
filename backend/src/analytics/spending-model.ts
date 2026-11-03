import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  money,
  validateExpenseAllocations,
} from '../finance/financial-model.js';

export const spendingSelect = {
  id: true,
  amount: true,
  currency: true,
  purchasedOn: true,
  merchant: true,
  classification: true,
  deletedAt: true,
  fundedByPersonId: true,
  category: { select: { id: true, name: true } },
  fundedBy: { select: { id: true, name: true } },
  allocations: {
    select: {
      personId: true,
      percentage: true,
      amount: true,
      deletedAt: true,
      person: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ExpenseSelect;

export type SpendingExpense = Prisma.ExpenseGetPayload<{
  select: typeof spendingSelect;
}>;
type Named = { id: string; name: string };
const named = ({ id, name }: Named): Named => ({ id, name });
export function monthKeys(from: string, to: string): string[] {
  const start = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index;
    return `${Math.floor(value / 12)
      .toString()
      .padStart(4, '0')}-${String((value % 12) + 1).padStart(2, '0')}`;
  });
}
const cents = (value: Prisma.Decimal) =>
  BigInt(money(value, true).mul(100).toFixed(0));
const fixed = (value: bigint) =>
  `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const metric = () => ({
  amount: 0n,
  personalAmount: 0n,
  sharedAmount: 0n,
  expenseCount: 0,
  fundedAmount: 0n,
  fundedExpenseCount: 0,
});
const present = (value: ReturnType<typeof metric>) => ({
  ...value,
  amount: fixed(value.amount),
  personalAmount: fixed(value.personalAmount),
  sharedAmount: fixed(value.sharedAmount),
  fundedAmount: fixed(value.fundedAmount),
});

export function spendingAccumulator(
  from: string,
  to: string,
  personId?: string,
) {
  const totals = metric();
  const months = new Map(monthKeys(from, to).map((month) => [month, metric()]));
  const categories = new Map<
    string,
    { category: Named; amount: bigint; expenseCount: number }
  >();
  const people = new Map<
    string,
    { person: Named; allocatedAmount: bigint; fundedAmount: bigint }
  >();
  const recent: {
    id: string;
    merchant: string;
    purchasedOn: string;
    classification: 'PERSONAL' | 'SHARED';
    category: Named;
    fundedBy: Named;
    expenseAmount: string;
    attributedAmount: string;
  }[] = [];
  const person = (entry: Named) => {
    if (!people.has(entry.id))
      people.set(entry.id, {
        person: named(entry),
        allocatedAmount: 0n,
        fundedAmount: 0n,
      });
    return people.get(entry.id)!;
  };
  return {
    add(expense: SpendingExpense) {
      const purchasedOn = expense.purchasedOn.toISOString().slice(0, 10);
      if (expense.deletedAt || purchasedOn < from || purchasedOn > to) return;
      const active = expense.allocations.filter((row) => !row.deletedAt);
      try {
        validateExpenseAllocations(
          expense.amount,
          expense.classification,
          active,
        );
      } catch {
        throw new ConflictException(
          'Active expense allocations are inconsistent. Review the source expense before using its analytics.',
        );
      }
      const original = cents(expense.amount);
      const month = months.get(purchasedOn.slice(0, 7))!;
      if (!personId || personId === expense.fundedByPersonId) {
        totals.fundedAmount += original;
        totals.fundedExpenseCount++;
        month.fundedAmount += original;
        month.fundedExpenseCount++;
        person(expense.fundedBy).fundedAmount += original;
      }
      for (const row of active)
        if (!personId || row.personId === personId)
          person(row.person).allocatedAmount += cents(row.amount);
      const allocation = personId
        ? active.find((row) => row.personId === personId)
        : undefined;
      if (personId && !allocation) return;
      const amount = allocation ? cents(allocation.amount) : original;
      for (const value of [totals, month]) {
        value.amount += amount;
        value.expenseCount++;
        if (expense.classification === 'PERSONAL')
          value.personalAmount += amount;
        else value.sharedAmount += amount;
      }
      if (!categories.has(expense.category.id))
        categories.set(expense.category.id, {
          category: named(expense.category),
          amount: 0n,
          expenseCount: 0,
        });
      const category = categories.get(expense.category.id)!;
      category.amount += amount;
      category.expenseCount++;
      recent.push({
        id: expense.id,
        merchant: expense.merchant,
        purchasedOn,
        classification: expense.classification,
        category: named(expense.category),
        fundedBy: named(expense.fundedBy),
        expenseAmount: fixed(original),
        attributedAmount: fixed(amount),
      });
      recent.sort(
        (a, b) =>
          b.purchasedOn.localeCompare(a.purchasedOn) ||
          b.id.localeCompare(a.id),
      );
      if (recent.length > 5) recent.pop();
    },
    result() {
      return {
        totals: present(totals),
        monthly: [...months].map(([month, value]) => ({
          month,
          ...present(value),
        })),
        categories: [...categories.values()]
          .sort((a, b) =>
            a.amount === b.amount
              ? a.category.id.localeCompare(b.category.id)
              : a.amount > b.amount
                ? -1
                : 1,
          )
          .map((row) => ({ ...row, amount: fixed(row.amount) })),
        byPerson: [...people.values()]
          .sort((a, b) => a.person.id.localeCompare(b.person.id))
          .map((row) => ({
            ...row,
            allocatedAmount: fixed(row.allocatedAmount),
            fundedAmount: fixed(row.fundedAmount),
          })),
        recentExpenses: recent,
      };
    },
  };
}
