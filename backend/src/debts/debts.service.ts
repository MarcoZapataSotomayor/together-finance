import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate } from '../finance/api-validation.js';
import { financialTransaction } from '../finance/transactions.js';
import {
  debtInclude,
  debtSummaryAccumulator,
  presentDebt,
} from './debt-model.js';
import type { DebtView, StoredDebt } from './debt-model.js';
import type { DebtFiltersDto, DebtQueryDto } from './debt.dto.js';

@Injectable()
export class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tx: Prisma.TransactionClient, id: string): Promise<StoredDebt> {
    const debt = await tx.debt.findUnique({
      where: { id },
      include: debtInclude,
    });
    if (!debt) throw new NotFoundException('Debt not found.');
    return debt;
  }

  get(id: string) {
    return financialTransaction(this.prisma, async (tx) =>
      presentDebt(await this.load(tx, id)),
    );
  }

  private where(query: DebtFiltersDto): Prisma.DebtWhereInput {
    const from = query.incurredFrom
      ? calendarDate(query.incurredFrom)
      : undefined;
    const to = query.incurredTo ? calendarDate(query.incurredTo) : undefined;
    if (from && to && from > to)
      throw new BadRequestException(
        'The start date must not be after the end date.',
      );
    const active: Prisma.DebtWhereInput = {
      deletedAt: null,
      OR: [
        { origin: 'LOAN' },
        {
          origin: 'EXPENSE',
          expenseAllocation: {
            is: { deletedAt: null, expense: { is: { deletedAt: null } } },
          },
        },
      ],
    };
    return {
      debtorPersonId: query.debtorPersonId,
      creditorPersonId: query.creditorPersonId,
      origin: query.origin,
      incurredOn: from || to ? { gte: from, lte: to } : undefined,
      AND: [query.deletionState === 'deleted' ? { NOT: active } : active],
    };
  }

  // The private app favors shared Decimal rules over duplicated SQL balance logic.
  // Scan candidates in batches in one snapshot; retain only the requested page or summary.
  private async scan(
    tx: Prisma.TransactionClient,
    where: Prisma.DebtWhereInput,
    query: DebtFiltersDto,
    visit: (view: DebtView) => void,
  ) {
    let cursor: string | undefined;
    while (true) {
      const rows = await tx.debt.findMany({
        where,
        include: debtInclude,
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        const view = presentDebt(row);
        if (query.status === 'settled' && view.status !== 'PAID') continue;
        if (
          query.status === 'pending' &&
          !['OPEN', 'PARTIALLY_REPAID'].includes(view.status)
        )
          continue;
        visit(view);
      }
      if (rows.length < 100) break;
      cursor = rows.at(-1)!.id;
    }
  }

  list(query: DebtQueryDto) {
    const where = this.where(query);
    return financialTransaction(this.prisma, async (tx) => {
      const data: DebtView[] = [];
      let total = 0;
      const offset = (query.page - 1) * query.pageSize;
      await this.scan(tx, where, query, (view) => {
        if (total >= offset && data.length < query.pageSize) data.push(view);
        total++;
      });
      return { data, total, page: query.page, pageSize: query.pageSize };
    });
  }

  summary(query: DebtFiltersDto) {
    const where = this.where(query);
    return financialTransaction(this.prisma, async (tx) => {
      const summary = debtSummaryAccumulator();
      await this.scan(tx, where, query, (view) => summary.add(view));
      return summary.result();
    });
  }
}
