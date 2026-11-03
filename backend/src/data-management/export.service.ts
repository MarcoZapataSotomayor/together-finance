import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { financialTransaction } from '../finance/transactions.js';
import { CsvFile } from './csv.js';
import { exportPeriod } from './data-management.dto.js';
import type { Dataset, ExportQueryDto } from './data-management.dto.js';

const person = { id: true, name: true } as const;
export const expenseSelect = {
  id: true,
  amount: true,
  currency: true,
  purchasedOn: true,
  merchant: true,
  description: true,
  classification: true,
  deletedAt: true,
  category: { select: person },
  paymentMethod: { select: person },
  fundedBy: { select: person },
} satisfies Prisma.ExpenseSelect;
export const debtSelect = {
  id: true,
  origin: true,
  originalAmount: true,
  currency: true,
  incurredOn: true,
  dueOn: true,
  description: true,
  deletedAt: true,
  debtor: { select: person },
  creditor: { select: person },
  expenseAllocation: {
    select: {
      id: true,
      deletedAt: true,
      expense: { select: { id: true, deletedAt: true } },
    },
  },
} satisfies Prisma.DebtSelect;
export const repaymentSelect = {
  id: true,
  amount: true,
  paidOn: true,
  description: true,
  deletedAt: true,
  debt: { select: debtSelect },
} satisfies Prisma.RepaymentSelect;

type ExportDebt = Prisma.DebtGetPayload<{ select: typeof debtSelect }>;
export function debtActive(row: ExportDebt) {
  return (
    !row.deletedAt &&
    (row.origin === 'LOAN' ||
      (!!row.expenseAllocation &&
        !row.expenseAllocation.deletedAt &&
        !row.expenseAllocation.expense.deletedAt))
  );
}
const date = (value: Date) => value.toISOString().slice(0, 10);
const timestamp = (value: Date | null | undefined) =>
  value?.toISOString() ?? '';
const status = (active: boolean) => (active ? 'Activo' : 'Eliminado');
const classification = (value: string) =>
  value === 'SHARED' ? 'Compartido' : 'Personal';
const origin = (value: string) =>
  value === 'LOAN' ? 'Préstamo independiente' : 'Consumo';

const headers: Record<Dataset, string[]> = {
  expenses: [
    'Consumo ID',
    'Fecha de compra',
    'Lugar',
    'Descripción',
    'Importe',
    'Moneda',
    'Clasificación',
    'Categoría ID',
    'Categoría',
    'Medio de pago ID',
    'Medio de pago',
    'Financiador ID',
    'Financiador',
    'Estado',
    'Eliminado UTC',
  ],
  allocations: [
    'Asignación ID',
    'Consumo ID',
    'Fecha de compra',
    'Beneficiario ID',
    'Beneficiario',
    'Porcentaje',
    'Importe asignado',
    'Moneda',
    'Financiador ID',
    'Financiador',
    'Estado',
    'Asignación eliminada UTC',
    'Consumo eliminado UTC',
  ],
  debts: [
    'Deuda ID',
    'Origen',
    'Asignación ID',
    'Consumo ID',
    'Fecha de origen',
    'Vencimiento',
    'Descripción',
    'Principal original',
    'Moneda',
    'Deudor ID',
    'Deudor',
    'Acreedor ID',
    'Acreedor',
    'Estado',
    'Deuda eliminada UTC',
    'Asignación eliminada UTC',
    'Consumo eliminado UTC',
  ],
  loans: [
    'Deuda ID',
    'Origen',
    'Asignación ID',
    'Consumo ID',
    'Fecha de origen',
    'Vencimiento',
    'Descripción',
    'Principal original',
    'Moneda',
    'Deudor ID',
    'Deudor',
    'Acreedor ID',
    'Acreedor',
    'Estado',
    'Deuda eliminada UTC',
    'Asignación eliminada UTC',
    'Consumo eliminado UTC',
  ],
  repayments: [
    'Pago ID',
    'Deuda ID',
    'Origen de deuda',
    'Consumo ID',
    'Fecha de pago',
    'Descripción',
    'Importe pagado',
    'Moneda',
    'Deudor ID',
    'Deudor',
    'Acreedor ID',
    'Acreedor',
    'Estado',
    'Pago eliminado UTC',
    'Deuda eliminada UTC',
    'Asignación eliminada UTC',
    'Consumo eliminado UTC',
  ],
};
const datasetNames: Record<Dataset, string> = {
  expenses: 'consumos',
  allocations: 'asignaciones',
  debts: 'deudas',
  loans: 'prestamos',
  repayments: 'pagos',
};
const scopeNames = { active: 'activos', deleted: 'eliminados', all: 'todos' };
const activeDebtWhere = {
  deletedAt: null,
  OR: [
    { origin: 'LOAN' },
    { expenseAllocation: { deletedAt: null, expense: { deletedAt: null } } },
  ],
} satisfies Prisma.DebtWhereInput;

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(dataset: Dataset, query: ExportQueryDto) {
    const period = exportPeriod(query);
    const file = await CsvFile.create();
    try {
      await financialTransaction(this.prisma, async (tx) => {
        await file.reset(headers[dataset]);
        const scope = <T>(active: T) =>
          query.scope === 'all'
            ? {}
            : query.scope === 'deleted'
              ? { NOT: active }
              : active;
        const involved = query.personId
          ? {
              OR: [
                { debtorPersonId: query.personId },
                { creditorPersonId: query.personId },
              ],
            }
          : {};
        let cursor: string | undefined;
        // UUID keyset pages bound both relation hydration and application memory.
        for (;;) {
          const paging = {
            take: 100,
            orderBy: { id: 'asc' as const },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          };
          let lastId: string | undefined;
          let count = 0;
          if (dataset === 'expenses') {
            const rows = await tx.expense.findMany({
              ...paging,
              select: expenseSelect,
              where: {
                AND: [
                  scope({ deletedAt: null }),
                  { purchasedOn: period },
                  ...(query.personId
                    ? [
                        {
                          OR: [
                            { fundedByPersonId: query.personId },
                            {
                              allocations: {
                                some: {
                                  personId: query.personId,
                                  ...(query.scope === 'active'
                                    ? { deletedAt: null }
                                    : {}),
                                },
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                ],
              },
            });
            for (const row of rows)
              await file.row([
                row.id,
                date(row.purchasedOn),
                row.merchant,
                row.description,
                row.amount.toFixed(2),
                row.currency,
                classification(row.classification),
                row.category.id,
                row.category.name,
                row.paymentMethod.id,
                row.paymentMethod.name,
                row.fundedBy.id,
                row.fundedBy.name,
                status(!row.deletedAt),
                timestamp(row.deletedAt),
              ]);
            count = rows.length;
            lastId = rows.at(-1)?.id;
          } else if (dataset === 'allocations') {
            const rows = await tx.expenseAllocation.findMany({
              ...paging,
              select: {
                id: true,
                amount: true,
                percentage: true,
                deletedAt: true,
                person: { select: person },
                expense: { select: expenseSelect },
              },
              where: {
                AND: [
                  scope({ deletedAt: null, expense: { deletedAt: null } }),
                  { expense: { purchasedOn: period } },
                  ...(query.personId
                    ? [
                        {
                          OR: [
                            { personId: query.personId },
                            { expense: { fundedByPersonId: query.personId } },
                          ],
                        },
                      ]
                    : []),
                ],
              },
            });
            for (const row of rows)
              await file.row([
                row.id,
                row.expense.id,
                date(row.expense.purchasedOn),
                row.person.id,
                row.person.name,
                row.percentage.toFixed(4),
                row.amount.toFixed(2),
                row.expense.currency,
                row.expense.fundedBy.id,
                row.expense.fundedBy.name,
                status(!row.deletedAt && !row.expense.deletedAt),
                timestamp(row.deletedAt),
                timestamp(row.expense.deletedAt),
              ]);
            count = rows.length;
            lastId = rows.at(-1)?.id;
          } else if (dataset === 'debts' || dataset === 'loans') {
            const rows = await tx.debt.findMany({
              ...paging,
              select: debtSelect,
              where: {
                AND: [
                  scope(activeDebtWhere),
                  involved,
                  { incurredOn: period },
                  ...(dataset === 'loans' ? [{ origin: 'LOAN' as const }] : []),
                ],
              },
            });
            for (const row of rows)
              await file.row([
                row.id,
                origin(row.origin),
                row.expenseAllocation?.id,
                row.expenseAllocation?.expense.id,
                date(row.incurredOn),
                row.dueOn ? date(row.dueOn) : '',
                row.description,
                row.originalAmount.toFixed(2),
                row.currency,
                row.debtor.id,
                row.debtor.name,
                row.creditor.id,
                row.creditor.name,
                status(debtActive(row)),
                timestamp(row.deletedAt),
                timestamp(row.expenseAllocation?.deletedAt),
                timestamp(row.expenseAllocation?.expense.deletedAt),
              ]);
            count = rows.length;
            lastId = rows.at(-1)?.id;
          } else {
            const rows = await tx.repayment.findMany({
              ...paging,
              select: repaymentSelect,
              where: {
                AND: [
                  scope({ deletedAt: null, debt: activeDebtWhere }),
                  { paidOn: period },
                  { debt: involved },
                ],
              },
            });
            for (const row of rows)
              await file.row([
                row.id,
                row.debt.id,
                origin(row.debt.origin),
                row.debt.expenseAllocation?.expense.id,
                date(row.paidOn),
                row.description,
                row.amount.toFixed(2),
                row.debt.currency,
                row.debt.debtor.id,
                row.debt.debtor.name,
                row.debt.creditor.id,
                row.debt.creditor.name,
                status(!row.deletedAt && debtActive(row.debt)),
                timestamp(row.deletedAt),
                timestamp(row.debt.deletedAt),
                timestamp(row.debt.expenseAllocation?.deletedAt),
                timestamp(row.debt.expenseAllocation?.expense.deletedAt),
              ]);
            count = rows.length;
            lastId = rows.at(-1)?.id;
          }
          if (count < 100) break;
          cursor = lastId;
        }
      });
      return {
        ...(await file.download()),
        filename: `together-finance-${datasetNames[dataset]}-${scopeNames[query.scope]}-${query.from}-a-${query.to}.csv`,
      };
    } catch (error) {
      await file.dispose();
      throw error;
    }
  }
}
