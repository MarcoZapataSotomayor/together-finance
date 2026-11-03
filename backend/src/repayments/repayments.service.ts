import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate } from '../finance/api-validation.js';
import { money, validateRepayment } from '../finance/financial-model.js';
import { financialTransaction } from '../finance/transactions.js';
import { DebtsService } from '../debts/debts.service.js';
import {
  isStoredDebtActive,
  presentDebt,
  presentRepayment,
  storedDebtBalance,
} from '../debts/debt-model.js';
import type { StoredDebt } from '../debts/debt-model.js';
import type { CreateRepaymentDto } from './repayment.dto.js';
import type { RepaymentQueryDto } from './repayment.dto.js';

@Injectable()
export class RepaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly debts: DebtsService,
  ) {}

  private requireActive(debt: StoredDebt) {
    storedDebtBalance(debt);
    if (!isStoredDebtActive(debt))
      throw new ConflictException(
        'Restore the debt and its source before recording or restoring repayments.',
      );
  }

  private validateAmount(
    debt: StoredDebt,
    amount: Prisma.Decimal,
    replacingId?: string,
  ) {
    this.requireActive(debt);
    try {
      validateRepayment(
        { ...debt, sourceAllocation: debt.expenseAllocation },
        debt.repayments,
        amount,
        replacingId,
      );
    } catch {
      throw new ConflictException(
        'The repayment exceeds the current outstanding balance. Reload the debt before retrying.',
      );
    }
  }

  private async load(tx: Prisma.TransactionClient, id: string) {
    const payment = await tx.repayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Repayment not found.');
    const debt = await this.debts.load(tx, payment.debtId);
    storedDebtBalance(debt);
    return { payment, debt };
  }

  async create(debtId: string, input: CreateRepaymentDto) {
    const paidOn = calendarDate(input.paidOn);
    let amount: Prisma.Decimal;
    try {
      amount = money(input.amount);
    } catch {
      throw new BadRequestException(
        'Use a positive PEN amount with at most two decimals within Decimal(14,2).',
      );
    }
    const description = input.description?.trim().normalize('NFKC') || null;
    return financialTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.repayment.findUnique({
          where: { id: input.id },
        });
        if (
          existing &&
          (existing.deletedAt ||
            existing.debtId !== debtId ||
            !existing.amount.eq(amount) ||
            existing.paidOn.getTime() !== paidOn.getTime() ||
            existing.description !== description)
        ) {
          throw new ConflictException(
            'This repayment ID is already reserved for a different or deleted repayment.',
          );
        }
        const debt = await this.debts.load(tx, debtId);
        this.requireActive(debt);
        if (paidOn < debt.incurredOn)
          throw new BadRequestException(
            'The payment date must not precede the debt incurrence date.',
          );
        if (existing) return presentRepayment(existing, debt);
        this.validateAmount(debt, amount);
        const payment = await tx.repayment.create({
          data: { id: input.id, debtId, amount, paidOn, description },
        });
        return presentRepayment(payment, debt);
      },
      true,
    );
  }

  list(debtId: string, query: RepaymentQueryDto) {
    return financialTransaction(this.prisma, async (tx) => {
      const debt = await this.debts.load(tx, debtId);
      storedDebtBalance(debt);
      const rows = debt.repayments
        .map((row) => presentRepayment(row, debt))
        .filter(
          (row) =>
            query.deletionState === 'all' ||
            (query.deletionState === 'active' ? row.active : !row.active),
        )
        .sort(
          (a, b) =>
            b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id),
        );
      const offset = (query.page - 1) * query.pageSize;
      return {
        data: rows.slice(offset, offset + query.pageSize),
        total: rows.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(id: string) {
    return financialTransaction(this.prisma, async (tx) => {
      const { payment, debt } = await this.load(tx, id);
      const { repayments: _history, ...debtView } = presentDebt(debt);
      return { ...presentRepayment(payment, debt), debt: debtView };
    });
  }

  async remove(id: string): Promise<void> {
    await financialTransaction(this.prisma, async (tx) => {
      const { payment } = await this.load(tx, id);
      if (!payment.deletedAt)
        await tx.repayment.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
    });
  }

  restore(id: string) {
    return financialTransaction(this.prisma, async (tx) => {
      const { payment, debt } = await this.load(tx, id);
      this.validateAmount(debt, payment.amount, payment.id);
      if (payment.deletedAt)
        await tx.repayment.update({ where: { id }, data: { deletedAt: null } });
      const current = await this.load(tx, id);
      return presentRepayment(current.payment, current.debt);
    });
  }
}
