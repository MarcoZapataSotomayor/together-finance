import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate } from '../finance/api-validation.js';
import { money } from '../finance/financial-model.js';
import { financialTransaction } from '../finance/transactions.js';
import {
  debtInclude,
  presentDebt,
  storedDebtBalance,
} from '../debts/debt-model.js';
import type { StoredDebt } from '../debts/debt-model.js';
import { DebtsService } from '../debts/debts.service.js';
import { DebtQueryDto } from '../debts/debt.dto.js';
import type { CreateLoanDto, UpdateLoanDto } from './loan.dto.js';

function planLoan(input: Omit<CreateLoanDto, 'id'>) {
  const incurredOn = calendarDate(input.incurredOn);
  const dueOn = input.dueOn ? calendarDate(input.dueOn) : null;
  if (input.debtorPersonId === input.creditorPersonId)
    throw new BadRequestException(
      'A loan requires distinct explicit debtor and creditor IDs.',
    );
  if (dueOn && dueOn < incurredOn)
    throw new BadRequestException(
      'The due date must not precede the loan date.',
    );
  let originalAmount: Prisma.Decimal;
  try {
    originalAmount = money(input.amount);
  } catch {
    throw new BadRequestException(
      'Use a positive PEN amount with at most two decimals within Decimal(14,2).',
    );
  }
  return {
    origin: 'LOAN' as const,
    debtorPersonId: input.debtorPersonId,
    creditorPersonId: input.creditorPersonId,
    originalAmount,
    currency: 'PEN' as const,
    incurredOn,
    dueOn,
    description: input.description?.trim().normalize('NFKC') || null,
  };
}
type LoanPlan = ReturnType<typeof planLoan>;
function sameTerms(debt: StoredDebt, plan: LoanPlan) {
  return (
    debt.debtorPersonId === plan.debtorPersonId &&
    debt.creditorPersonId === plan.creditorPersonId &&
    debt.originalAmount.eq(plan.originalAmount) &&
    debt.incurredOn.getTime() === plan.incurredOn.getTime()
  );
}

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly debts: DebtsService,
  ) {}

  private async load(tx: Prisma.TransactionClient, id: string) {
    const debt = await this.debts.load(tx, id);
    if (debt.origin !== 'LOAN') throw new NotFoundException('Loan not found.');
    return debt;
  }

  private async checkPeople(
    tx: Prisma.TransactionClient,
    plan: LoanPlan,
    requireActive = true,
  ) {
    const count = await tx.person.count({
      where: {
        id: { in: [plan.debtorPersonId, plan.creditorPersonId] },
        isActive: requireActive ? true : undefined,
      },
    });
    if (count !== 2)
      throw new BadRequestException(
        requireActive
          ? 'Debtor and creditor must exist and be active.'
          : 'The loan references missing people.',
      );
  }

  async create(input: CreateLoanDto) {
    const plan = planLoan(input);
    return financialTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.debt.findUnique({
          where: { id: input.id },
          include: debtInclude,
        });
        if (existing) {
          if (
            existing.origin !== 'LOAN' ||
            existing.deletedAt ||
            !sameTerms(existing, plan) ||
            existing.currency !== plan.currency ||
            existing.description !== plan.description ||
            (existing.dueOn?.getTime() ?? null) !==
              (plan.dueOn?.getTime() ?? null)
          ) {
            throw new ConflictException(
              'This loan ID is already reserved for a different or deleted obligation.',
            );
          }
          return presentDebt(existing);
        }
        await this.checkPeople(tx, plan);
        await tx.debt.create({ data: { id: input.id, ...plan } });
        return presentDebt(await this.load(tx, input.id));
      },
      true,
    );
  }

  get(id: string) {
    return financialTransaction(this.prisma, async (tx) =>
      presentDebt(await this.load(tx, id)),
    );
  }

  async list(query: DebtQueryDto) {
    if (query.origin && query.origin !== 'LOAN')
      throw new BadRequestException(
        'The loans endpoint only supports origin LOAN.',
      );
    return this.debts.list(
      Object.assign(new DebtQueryDto(), query, { origin: 'LOAN' as const }),
    );
  }

  async update(id: string, input: UpdateLoanDto) {
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    if (!Object.keys(changes).length)
      throw new BadRequestException(
        'At least one loan field must be supplied.',
      );
    return financialTransaction(this.prisma, async (tx) => {
      const previous = await this.load(tx, id);
      if (previous.deletedAt)
        throw new ConflictException('Restore the loan before editing it.');
      storedDebtBalance(previous);
      const plan = planLoan(
        Object.assign(
          {
            debtorPersonId: previous.debtorPersonId,
            creditorPersonId: previous.creditorPersonId,
            amount: previous.originalAmount.toFixed(2),
            incurredOn: previous.incurredOn.toISOString().slice(0, 10),
            dueOn: previous.dueOn?.toISOString().slice(0, 10) ?? null,
            description: previous.description,
          },
          changes,
        ),
      );
      if (previous.repayments.length && !sameTerms(previous, plan))
        throw new ConflictException(
          'Loan principal, counterparties, and incurrence date cannot change once repayment history exists. An explicit correction workflow is required.',
        );
      await this.checkPeople(tx, plan);
      await tx.debt.update({ where: { id }, data: plan });
      return presentDebt(await this.load(tx, id));
    });
  }

  async remove(id: string): Promise<void> {
    await financialTransaction(this.prisma, async (tx) => {
      const debt = await this.load(tx, id);
      storedDebtBalance(debt);
      if (!debt.deletedAt)
        await tx.debt.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
    });
  }

  restore(id: string) {
    return financialTransaction(this.prisma, async (tx) => {
      const debt = await this.load(tx, id);
      storedDebtBalance({ ...debt, deletedAt: null });
      const plan = planLoan({
        debtorPersonId: debt.debtorPersonId,
        creditorPersonId: debt.creditorPersonId,
        amount: debt.originalAmount.toFixed(2),
        incurredOn: debt.incurredOn.toISOString().slice(0, 10),
        dueOn: debt.dueOn?.toISOString().slice(0, 10),
        description: debt.description,
      });
      await this.checkPeople(tx, plan, false);
      if (debt.deletedAt)
        await tx.debt.update({ where: { id }, data: { deletedAt: null } });
      return presentDebt(await this.load(tx, id));
    });
  }
}
