// A query-aware in-memory fixture. It does not execute SQL or simulate PostgreSQL isolation.
import { vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { FinanceStore } from './finance-store.js';

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((entry: any) => matches(row, entry));
    if (key === 'OR') return value.some((entry: any) => matches(row, entry));
    if (key === 'NOT') return !matches(row, value);
    const actual = row?.[key];
    if (value && typeof value === 'object' && 'in' in value)
      return value.in.includes(actual);
    if (value === null || typeof value !== 'object') return actual === value;
    if ('some' in value)
      return actual.some((entry: any) => matches(entry, value.some));
    if ('gte' in value || 'lte' in value)
      return (
        (!value.gte || actual >= value.gte) &&
        (!value.lte || actual <= value.lte)
      );
    return !!actual && matches(actual, value);
  });
}
export class DataManagementStore extends FinanceStore {
  constructor() {
    super();
    const people = this.client.person.findMany.getMockImplementation()!;
    this.client.person.findMany.mockImplementation(async (args: any) => {
      const rows = await people(args);
      return args.select
        ? rows.map(({ id, name, isActive }: any) => ({ id, name, isActive }))
        : rows;
    });
    const allocation = (row: any) => ({
      ...row,
      person: this.people.find((p) => p.id === row.personId),
      expense: expense(this.expenses.find((e) => e.id === row.expenseId)),
    });
    const expense = (row: any) => ({
      ...row,
      category: this.categories.find((p) => p.id === row.categoryId),
      paymentMethod: this.methods.find((p) => p.id === row.paymentMethodId),
      fundedBy: this.people.find((p) => p.id === row.fundedByPersonId),
    });
    const debt = (row: any) => ({
      ...row,
      debtor: this.people.find((p) => p.id === row.debtorPersonId),
      creditor: this.people.find((p) => p.id === row.creditorPersonId),
      expenseAllocation: this.allocations.find(
        (a) => a.id === row.expenseAllocationId,
      )
        ? allocation(
            this.allocations.find((a) => a.id === row.expenseAllocationId),
          )
        : null,
    });
    const list = (rows: () => any[]) =>
      vi.fn(async ({ where, cursor, skip = 0, take, select }: any) => {
        const found = rows()
          .filter((row) => matches(row, where))
          .sort((a, b) => a.id.localeCompare(b.id));
        const start = cursor
          ? found.findIndex((row) => row.id === cursor.id) + skip
          : skip;
        const page = found.slice(
          start,
          take === undefined ? undefined : start + take,
        );
        return select?.allocations
          ? page.map((row) => ({
              ...row,
              allocations: row.allocations
                .filter((a: any) => !a.deletedAt)
                .slice(0, 20),
            }))
          : page;
      });
    // Hydrate only the relations needed by these read APIs; existing mutations keep the original fixture methods.
    this.client.expense.findMany = list(() =>
      this.expenses.map((e) => ({
        ...expense(e),
        allocations: this.allocations
          .filter((a) => a.expenseId === e.id)
          .map((a) => ({
            ...a,
            person: this.people.find((p) => p.id === a.personId),
          })),
        _count: {
          allocations: this.allocations.filter(
            (a) => a.expenseId === e.id && !a.deletedAt,
          ).length,
        },
      })),
    );
    this.client.debt.findMany = list(() => this.debts.map(debt));
    Object.assign(this.client.expenseAllocation, {
      findMany: list(() => this.allocations.map(allocation)),
    });
    Object.assign(this.client.repayment, {
      findMany: list(() =>
        this.repayments.map((p) => ({
          ...p,
          debt: debt(this.debts.find((d) => d.id === p.debtId)),
        })),
      ),
    });
    Object.assign(this.client, {
      $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
        const values = sql.values;
        const type = values.find((v) =>
          ['expense', 'loan', 'repayment'].includes(String(v)),
        );
        const dates = values.filter((v) => v instanceof Date) as Date[];
        const from = sql.sql.includes('deleted_at >=')
          ? dates.shift()
          : undefined;
        const to = sql.sql.includes('deleted_at <') ? dates.shift() : undefined;
        const rows = [
          ...this.expenses.map((e) => ({ kind: 'expense', ...e })),
          ...this.debts
            .filter((d) => d.origin === 'LOAN')
            .map((d) => ({ kind: 'loan', ...d })),
          ...this.repayments.map((p) => ({ kind: 'repayment', ...p })),
        ]
          .filter(
            (r) =>
              r.deletedAt &&
              (!type || r.kind === type) &&
              (!from || r.deletedAt >= from) &&
              (!to || r.deletedAt < to),
          )
          .sort(
            (a, b) =>
              b.deletedAt!.getTime() - a.deletedAt!.getTime() ||
              b.id.localeCompare(a.id) ||
              a.kind.localeCompare(b.kind),
          );
        if (sql.sql.startsWith('SELECT COUNT'))
          return [{ total: BigInt(rows.length) }];
        const [take, skip] = values.filter(
          (v) => typeof v === 'number',
        ) as number[];
        return rows
          .slice(skip, skip + take)
          .map(({ kind, id }) => ({ kind, id }));
      }),
    });
  }
}
