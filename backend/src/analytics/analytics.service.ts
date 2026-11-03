import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate } from '../finance/api-validation.js';
import { financialTransaction } from '../finance/transactions.js';
import { spendingAccumulator, spendingSelect } from './spending-model.js';
import type { SpendingQueryDto } from './analytics.dto.js';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  spending(query: SpendingQueryDto) {
    const from = calendarDate(query.from),
      to = calendarDate(query.to);
    const calendarMonths =
      (Number(query.to.slice(0, 4)) - Number(query.from.slice(0, 4))) * 12 +
      Number(query.to.slice(5, 7)) -
      Number(query.from.slice(5, 7)) +
      1;
    if (from > to || calendarMonths > 24)
      throw new BadRequestException(
        'Use an ordered date range covering at most 24 calendar months.',
      );
    return financialTransaction(this.prisma, async (tx) => {
      const records = await tx.person.findMany({
        select: { id: true, name: true, isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const selected = records.find((row) => row.id === query.personId);
      if (query.personId && !selected)
        throw new BadRequestException('The selected person does not exist.');
      const accumulator = spendingAccumulator(
        query.from,
        query.to,
        query.personId,
      );
      // Read all funders as well as beneficiaries: funding must not be narrowed to one's allocations.
      for (let skip = 0; ; skip += 100) {
        const rows = await tx.expense.findMany({
          where: { deletedAt: null, purchasedOn: { gte: from, lte: to } },
          select: spendingSelect,
          orderBy: [{ purchasedOn: 'desc' }, { id: 'desc' }],
          skip,
          take: 100,
        });
        for (const row of rows) accumulator.add(row);
        if (rows.length < 100) break;
      }
      return {
        currency: 'PEN' as const,
        period: { from: query.from, to: query.to },
        basis: query.personId
          ? ('ALLOCATION' as const)
          : ('EXPENSE_TOTAL' as const),
        person: selected ? { id: selected.id, name: selected.name } : null,
        people: records.map(({ id, name, isActive }) => ({
          id,
          name,
          isActive,
        })),
        ...accumulator.result(),
      };
    });
  }
}
