import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate, PaginationDto } from '../finance/api-validation.js';
import { financialTransaction } from '../finance/transactions.js';
import type { RecordKind, RecycleBinQueryDto } from './data-management.dto.js';
import {
  debtActive,
  debtSelect,
  expenseSelect,
  repaymentSelect,
} from './export.service.js';

interface DeletedReference {
  kind: RecordKind;
  id: string;
}

const binExpenseSelect = {
  ...expenseSelect,
  allocations: {
    where: { deletedAt: null },
    select: { person: { select: { id: true, name: true } } },
    orderBy: { personId: 'asc' },
    take: 20,
  },
  _count: { select: { allocations: { where: { deletedAt: null } } } },
} satisfies Prisma.ExpenseSelect;

@Injectable()
export class RecycleBinService {
  constructor(private readonly prisma: PrismaService) {}

  people(query: PaginationDto) {
    return financialTransaction(this.prisma, async (tx) => ({
      data: await tx.person.findMany({
        select: { id: true, name: true, isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      total: await tx.person.count({ where: {} }),
      page: query.page,
      pageSize: query.pageSize,
    }));
  }

  list(query: RecycleBinQueryDto) {
    const from = query.deletedFrom ? calendarDate(query.deletedFrom) : null;
    const to = query.deletedTo ? calendarDate(query.deletedTo) : null;
    if (from && to && from > to)
      throw new BadRequestException('Deletion dates must be ordered.');
    // Filter timestamps by UTC calendar day; financial transaction dates remain date-only.
    const end = to ? new Date(to.getTime() + 86400000) : null;
    const conditions = Prisma.sql`deleted_at IS NOT NULL
      ${query.type ? Prisma.sql`AND kind = ${query.type}` : Prisma.empty}
      ${from ? Prisma.sql`AND deleted_at >= ${from}` : Prisma.empty}
      ${end ? Prisma.sql`AND deleted_at < ${end}` : Prisma.empty}`;
    // Paginate the union in PostgreSQL, not three independently truncated collections.
    const source = Prisma.sql`(
      SELECT 'expense' AS kind, id, deleted_at FROM expenses WHERE deleted_at IS NOT NULL
      UNION ALL SELECT 'loan' AS kind, id, deleted_at FROM debts WHERE origin = 'LOAN' AND deleted_at IS NOT NULL
      UNION ALL SELECT 'repayment' AS kind, id, deleted_at FROM repayments WHERE deleted_at IS NOT NULL
    ) AS deleted_records`;
    return financialTransaction(this.prisma, async (tx) => {
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) AS total FROM ${source} WHERE ${conditions}`,
      );
      const refs = await tx.$queryRaw<
        DeletedReference[]
      >(Prisma.sql`SELECT kind, id FROM ${source} WHERE ${conditions}
        ORDER BY deleted_at DESC, id DESC, kind ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const idsFor = (kind: RecordKind) =>
        refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
      // At most three bounded hydration queries, independent of page size.
      const expenseIds = idsFor('expense'),
        loanIds = idsFor('loan'),
        repaymentIds = idsFor('repayment');
      const expenses = expenseIds.length
        ? await tx.expense.findMany({
            where: { id: { in: expenseIds } },
            select: binExpenseSelect,
          })
        : [];
      const loans = loanIds.length
        ? await tx.debt.findMany({
            where: { id: { in: loanIds } },
            select: debtSelect,
          })
        : [];
      const repayments = repaymentIds.length
        ? await tx.repayment.findMany({
            where: { id: { in: repaymentIds } },
            select: repaymentSelect,
          })
        : [];
      const data = [];
      for (const ref of refs) {
        if (ref.kind === 'expense') {
          const row = expenses.find((row) => row.id === ref.id)!;
          data.push({
            kind: ref.kind,
            id: row.id,
            description: row.description || row.merchant,
            amount: row.amount.toFixed(2),
            currency: row.currency,
            transactionDate: row.purchasedOn.toISOString().slice(0, 10),
            deletedAt: row.deletedAt!.toISOString(),
            people: [
              { ...row.fundedBy, role: 'Financiador' },
              ...row.allocations.map((a) => ({
                ...a.person,
                role: 'Beneficiario',
              })),
            ],
            morePeople: Math.max(
              0,
              row._count.allocations - row.allocations.length,
            ),
            parent: null,
            canRestore: true,
          });
        } else if (ref.kind === 'loan') {
          const row = loans.find((row) => row.id === ref.id)!;
          data.push({
            kind: ref.kind,
            id: row.id,
            description: row.description,
            amount: row.originalAmount.toFixed(2),
            currency: row.currency,
            transactionDate: row.incurredOn.toISOString().slice(0, 10),
            deletedAt: row.deletedAt!.toISOString(),
            people: [
              { ...row.debtor, role: 'Deudor' },
              { ...row.creditor, role: 'Acreedor' },
            ],
            morePeople: 0,
            parent: null,
            canRestore: true,
          });
        } else {
          const row = repayments.find((row) => row.id === ref.id)!;
          const active = debtActive(row.debt);
          const source = row.debt.expenseAllocation?.expense;
          data.push({
            kind: ref.kind,
            id: row.id,
            description: row.description,
            amount: row.amount.toFixed(2),
            currency: row.debt.currency,
            transactionDate: row.paidOn.toISOString().slice(0, 10),
            deletedAt: row.deletedAt!.toISOString(),
            people: [
              { ...row.debt.debtor, role: 'Deudor' },
              { ...row.debt.creditor, role: 'Acreedor' },
            ],
            morePeople: 0,
            parent: {
              kind: source ? 'expense' : 'loan',
              id: source?.id ?? row.debt.id,
              active,
            },
            canRestore: active,
          });
        }
      }
      return {
        data,
        total: Number(count.total),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
}
