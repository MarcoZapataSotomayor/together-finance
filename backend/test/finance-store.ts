// A transaction-aware test double, not a PostgreSQL isolation/concurrency simulator.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import type {
  Category,
  Debt,
  Expense,
  ExpenseAllocation,
  PaymentMethod,
  Person,
  Repayment,
} from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { CreateExpenseDto } from '../src/expenses/expense.dto.js';

export const ids = {
  antonella: '00000000-0000-4000-8000-000000000001',
  marco: '00000000-0000-4000-8000-000000000002',
  thirdParty: '00000000-0000-4000-8000-000000000003',
  category: '00000000-0000-4000-8000-000000000010',
  method: '00000000-0000-4000-8000-000000000020',
  expense: '00000000-0000-4000-8000-000000000030',
};
const timestamp = new Date('2026-10-31T12:00:00Z');
const audit = () => ({ createdAt: timestamp, updatedAt: timestamp });
export function exampleExpense(
  overrides: Partial<CreateExpenseDto> = {},
): CreateExpenseDto {
  return {
    id: ids.expense,
    amount: '100.00',
    purchasedOn: '2026-10-30',
    merchant: 'Example shop',
    categoryId: ids.category,
    paymentMethodId: ids.method,
    fundedByPersonId: ids.marco,
    classification: 'SHARED',
    allocations: [
      { personId: ids.antonella, percentage: '50' },
      { personId: ids.marco, percentage: '50' },
    ],
    ...overrides,
  };
}
export function databaseFailure(code: string) {
  return new Prisma.PrismaClientKnownRequestError(
    'Private database details must not appear in responses.',
    { code, clientVersion: '7.10.1' },
  );
}

export class FinanceStore {
  people: Person[] = [ids.antonella, ids.marco, ids.thirdParty].map(
    (id, index) => ({
      id,
      name: ['Antonella', 'Marco', 'Example funder'][index],
      notes: null,
      isActive: true,
      ...audit(),
    }),
  );
  categories: Category[] = [
    {
      id: ids.category,
      name: 'Example category',
      description: null,
      isActive: true,
      ...audit(),
    },
  ];
  methods: PaymentMethod[] = [
    {
      id: ids.method,
      name: 'Example card',
      type: 'CREDIT_CARD',
      ownerPersonId: ids.marco,
      description: null,
      isActive: true,
      ...audit(),
    },
  ];
  expenses: Expense[] = [];
  allocations: ExpenseAllocation[] = [];
  debts: Debt[] = [];
  repayments: Repayment[] = [];
  conflictBeforeCommit = 0;
  failDebtWrite = false;
  transactionOptions: unknown[] = [];

  private matchingReference(row: any, where: any = {}) {
    return (
      (where.isActive === undefined || row.isActive === where.isActive) &&
      (!where.name ||
        row.name.toLowerCase() === where.name.equals.toLowerCase()) &&
      (!where.id ||
        (typeof where.id === 'string'
          ? row.id === where.id
          : where.id.in.includes(row.id)))
    );
  }
  private references(kind: 'people' | 'categories' | 'methods') {
    return {
      findFirst: vi.fn(
        async ({ where }: any) =>
          this[kind].find((row) => this.matchingReference(row, where)) ?? null,
      ),
      count: vi.fn(
        async ({ where }: any) =>
          this[kind].filter((row) => this.matchingReference(row, where)).length,
      ),
      findMany: vi.fn(async ({ where, skip = 0, take = 20 }: any) =>
        this[kind]
          .filter((row) => this.matchingReference(row, where))
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          )
          .slice(skip, skip + take),
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: randomUUID(),
          notes: null,
          description: null,
          ownerPersonId: null,
          ...data,
          isActive: true,
          ...audit(),
        };
        this[kind].push(row);
        return row;
      }),
    };
  }
  private detailed(id: string) {
    const expense = this.expenses.find((row) => row.id === id);
    if (!expense) return null;
    return {
      ...expense,
      category: this.categories.find((row) => row.id === expense.categoryId),
      paymentMethod: this.methods.find(
        (row) => row.id === expense.paymentMethodId,
      ),
      fundedBy: this.people.find((row) => row.id === expense.fundedByPersonId),
      allocations: this.allocations
        .filter((row) => row.expenseId === id)
        .sort((a, b) => a.personId.localeCompare(b.personId))
        .map((row) => {
          const debt = this.debts.find(
            (record) => record.expenseAllocationId === row.id,
          );
          return {
            ...row,
            person: this.people.find((person) => person.id === row.personId),
            debt: debt
              ? {
                  ...debt,
                  repayments: this.repayments
                    .filter((record) => record.debtId === debt.id)
                    .map((record) => ({ ...record })),
                }
              : null,
          };
        }),
    };
  }
  private matchesExpense(row: Expense, where: any) {
    return (
      (where.deletedAt === null
        ? row.deletedAt === null
        : row.deletedAt !== null) &&
      (!where.categoryId || row.categoryId === where.categoryId) &&
      (!where.fundedByPersonId ||
        row.fundedByPersonId === where.fundedByPersonId) &&
      (!where.classification || row.classification === where.classification) &&
      (!where.purchasedOn?.gte || row.purchasedOn >= where.purchasedOn.gte) &&
      (!where.purchasedOn?.lte || row.purchasedOn <= where.purchasedOn.lte) &&
      (!where.allocations ||
        this.allocations.some(
          (share) =>
            share.expenseId === row.id &&
            !share.deletedAt &&
            share.personId === where.allocations.some.personId,
        ))
    );
  }
  readonly client = {
    person: this.references('people'),
    category: this.references('categories'),
    paymentMethod: this.references('methods'),
    expense: {
      findUnique: vi.fn(async ({ where }: any) => this.detailed(where.id)),
      findMany: vi.fn(async ({ where, skip, take }: any) =>
        this.expenses
          .filter((row) => this.matchesExpense(row, where))
          .sort(
            (a, b) =>
              b.purchasedOn.getTime() - a.purchasedOn.getTime() ||
              b.id.localeCompare(a.id),
          )
          .slice(skip, skip + take)
          .map((row) => this.detailed(row.id)),
      ),
      count: vi.fn(
        async ({ where }: any) =>
          this.expenses.filter((row) => this.matchesExpense(row, where)).length,
      ),
      create: vi.fn(async ({ data }: any) => {
        if (this.expenses.some((row) => row.id === data.id))
          throw databaseFailure('P2002');
        const row = { ...data, deletedAt: null, ...audit() };
        this.expenses.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = this.expenses.find((record) => record.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    expenseAllocation: {
      update: vi.fn(async ({ where, data }: any) => {
        const row = this.allocations.find((record) => record.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.expenseId_personId;
        let row = this.allocations.find(
          (record) =>
            record.expenseId === key.expenseId &&
            record.personId === key.personId,
        );
        if (row) Object.assign(row, update);
        else {
          row = { id: randomUUID(), ...create, deletedAt: null, ...audit() };
          this.allocations.push(row!);
        }
        return row!;
      }),
    },
    debt: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (this.failDebtWrite) throw databaseFailure('P2004');
        let row = this.debts.find(
          (record) => record.expenseAllocationId === where.expenseAllocationId,
        );
        if (row) Object.assign(row, update);
        else {
          row = {
            id: randomUUID(),
            ...create,
            dueOn: null,
            description: null,
            ...audit(),
          };
          this.debts.push(row!);
        }
        return row!;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = this.debts.find((record) => record.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi.fn(
      async <T>(
        work: (tx: Prisma.TransactionClient) => Promise<T>,
        options: unknown,
      ) => {
        this.transactionOptions.push(options);
        const collections = [
          'people',
          'categories',
          'methods',
          'expenses',
          'allocations',
          'debts',
          'repayments',
        ] as const;
        // Decimal instances must retain their prototypes, so copy records rather than structuredClone.
        const snapshots = collections.map((key) =>
          this[key].map((row) => ({ ...row })),
        );
        try {
          const result = await work(
            this.client as unknown as Prisma.TransactionClient,
          );
          if (this.conflictBeforeCommit > 0) {
            this.conflictBeforeCommit--;
            throw databaseFailure('P2034');
          }
          return result;
        } catch (error) {
          collections.forEach((key, index) => {
            (this[key] as unknown[]) = snapshots[index];
          });
          throw error;
        }
      },
    ),
  };

  prisma(): PrismaService {
    return this.client as unknown as PrismaService;
  }
  addRepayment(amount: string, deletedAt: Date | null = null) {
    const debt = this.debts[0];
    const row: Repayment = {
      id: randomUUID(),
      debtId: debt.id,
      amount: new Prisma.Decimal(amount),
      paidOn: new Date('2026-10-31T00:00:00Z'),
      description: 'Synthetic repayment',
      deletedAt,
      ...audit(),
    };
    this.repayments.push(row);
    return row;
  }
}
