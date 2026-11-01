import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calendarDate } from '../finance/api-validation.js';
import { financialTransaction } from '../finance/transactions.js';
import {
  expenseData,
  expenseInclude,
  expenseInput,
  matchesExpense,
  planExpense,
  presentExpense,
  validateStoredExpense,
} from './expense-model.js';
import type { ExpensePlan, StoredExpense } from './expense-model.js';
import type {
  CreateExpenseDto,
  ExpenseQueryDto,
  UpdateExpenseDto,
} from './expense.dto.js';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private async load(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<StoredExpense> {
    const expense = await tx.expense.findUnique({
      where: { id },
      include: expenseInclude,
    });
    if (!expense) throw new NotFoundException('Expense not found.');
    return expense;
  }

  private async checkReferences(
    tx: Prisma.TransactionClient,
    plan: ExpensePlan,
    requireActive = true,
  ): Promise<void> {
    const isActive = requireActive ? true : undefined;
    const category = await tx.category.findFirst({
      where: { id: plan.categoryId, isActive },
    });
    const method = await tx.paymentMethod.findFirst({
      where: { id: plan.paymentMethodId, isActive },
    });
    const ids = [
      ...new Set([
        plan.fundedByPersonId,
        ...plan.allocations.map((row) => row.personId),
      ]),
    ];
    const people = await tx.person.count({
      where: { id: { in: ids }, isActive },
    });
    if (!category || !method || people !== ids.length)
      throw new BadRequestException(
        requireActive
          ? 'Category, payment method, funder, and beneficiaries must exist and be active.'
          : 'The expense references missing financial records.',
      );
  }

  private protectRepayments(previous: StoredExpense, plan: ExpensePlan): void {
    for (const row of previous.allocations) {
      const debt = row.debt;
      if (!debt?.repayments.length) continue;
      const replacement = plan.allocations.find(
        (share) => share.personId === row.personId,
      );
      if (row.deletedAt && !replacement) continue;
      const needed =
        replacement &&
        replacement.amount.gt(0) &&
        replacement.personId !== plan.fundedByPersonId;
      const paid = debt.repayments
        .filter((payment) => !payment.deletedAt)
        .reduce(
          (sum, payment) => sum.plus(payment.amount),
          new Prisma.Decimal(0),
        );
      if (!needed || paid.gt(replacement.amount))
        throw new ConflictException(
          'This edit would remove a repaid obligation or reduce it below its active repayments.',
        );
      if (
        debt.creditorPersonId !== plan.fundedByPersonId ||
        !debt.originalAmount.eq(replacement.amount) ||
        debt.incurredOn.getTime() !== plan.purchasedOn.getTime() ||
        row.deletedAt
      ) {
        throw new ConflictException(
          'Debt principal, counterparties, and purchase date cannot change once repayment history exists. An explicit correction workflow is required.',
        );
      }
    }
  }

  private async synchronizeAllocations(
    tx: Prisma.TransactionClient,
    expenseId: string,
    plan: ExpensePlan,
    previous?: StoredExpense,
  ): Promise<void> {
    const now = new Date();
    const oldRows = previous?.allocations ?? [];
    for (const old of oldRows) {
      if (
        !old.deletedAt &&
        !plan.allocations.some((row) => row.personId === old.personId)
      ) {
        await tx.expenseAllocation.update({
          where: { id: old.id },
          data: { deletedAt: now },
        });
      }
    }
    // Stable order reduces contention; existing unique links are always reused.
    for (const share of [...plan.allocations].sort((a, b) =>
      a.personId.localeCompare(b.personId),
    )) {
      const old = oldRows.find((row) => row.personId === share.personId);
      const allocation = await tx.expenseAllocation.upsert({
        where: { expenseId_personId: { expenseId, personId: share.personId } },
        create: {
          expenseId,
          personId: share.personId,
          percentage: share.percentage,
          amount: share.amount,
        },
        update: {
          percentage: share.percentage,
          amount: share.amount,
          deletedAt: null,
        },
      });
      if (share.personId !== plan.fundedByPersonId && share.amount.gt(0)) {
        const wasNeeded =
          old &&
          !old.deletedAt &&
          old.personId !== previous?.fundedByPersonId &&
          old.amount.gt(0);
        const data = {
          origin: 'EXPENSE' as const,
          debtorPersonId: share.personId,
          creditorPersonId: plan.fundedByPersonId,
          originalAmount: share.amount,
          currency: plan.currency,
          incurredOn: plan.purchasedOn,
          deletedAt: wasNeeded ? (old.debt?.deletedAt ?? null) : null,
        };
        await tx.debt.upsert({
          where: { expenseAllocationId: allocation.id },
          create: { ...data, expenseAllocationId: allocation.id },
          update: data,
        });
      } else if (old?.debt && !old.debt.deletedAt) {
        await tx.debt.update({
          where: { id: old.debt.id },
          data: { deletedAt: now },
        });
      }
    }
  }

  async create(input: CreateExpenseDto) {
    const plan = planExpense(input);
    return financialTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.expense.findUnique({
          where: { id: input.id },
          include: expenseInclude,
        });
        if (existing) {
          if (!matchesExpense(existing, plan))
            throw new ConflictException(
              'This expense ID is already reserved for a different or deleted expense.',
            );
          return presentExpense(existing);
        }
        await this.checkReferences(tx, plan);
        await tx.expense.create({
          data: { id: input.id, ...expenseData(plan) },
        });
        await this.synchronizeAllocations(tx, input.id, plan);
        return presentExpense(await this.load(tx, input.id));
      },
      true,
    );
  }

  get(id: string) {
    return financialTransaction(this.prisma, async (tx) =>
      presentExpense(await this.load(tx, id)),
    );
  }

  list(query: ExpenseQueryDto) {
    const from = query.purchasedFrom
      ? calendarDate(query.purchasedFrom)
      : undefined;
    const to = query.purchasedTo ? calendarDate(query.purchasedTo) : undefined;
    if (from && to && from > to)
      throw new BadRequestException(
        'The start date must not be after the end date.',
      );
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      categoryId: query.categoryId,
      fundedByPersonId: query.fundedByPersonId,
      classification: query.classification,
      purchasedOn: from || to ? { gte: from, lte: to } : undefined,
      allocations: query.beneficiaryPersonId
        ? { some: { personId: query.beneficiaryPersonId, deletedAt: null } }
        : undefined,
    };
    return financialTransaction(this.prisma, async (tx) => ({
      data: (
        await tx.expense.findMany({
          where,
          include: expenseInclude,
          orderBy: [{ purchasedOn: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        })
      ).map(presentExpense),
      total: await tx.expense.count({ where }),
      page: query.page,
      pageSize: query.pageSize,
    }));
  }

  update(id: string, input: UpdateExpenseDto) {
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(changes).length === 0)
      throw new BadRequestException(
        'At least one expense field must be supplied.',
      );
    return financialTransaction(this.prisma, async (tx) => {
      const previous = await this.load(tx, id);
      if (previous.deletedAt)
        throw new ConflictException('Restore the expense before editing it.');
      validateStoredExpense(previous);
      const plan = planExpense(Object.assign(expenseInput(previous), changes));
      await this.checkReferences(tx, plan);
      this.protectRepayments(previous, plan);
      await tx.expense.update({ where: { id }, data: expenseData(plan) });
      await this.synchronizeAllocations(tx, id, plan, previous);
      return presentExpense(await this.load(tx, id));
    });
  }

  async remove(id: string): Promise<void> {
    await financialTransaction(this.prisma, async (tx) => {
      const expense = await this.load(tx, id);
      validateStoredExpense(expense);
      if (!expense.deletedAt)
        await tx.expense.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
    });
  }

  restore(id: string) {
    return financialTransaction(this.prisma, async (tx) => {
      const expense = await this.load(tx, id);
      const restored = { ...expense, deletedAt: null };
      validateStoredExpense(restored);
      await this.checkReferences(
        tx,
        planExpense(expenseInput(restored)),
        false,
      );
      if (expense.deletedAt)
        await tx.expense.update({ where: { id }, data: { deletedAt: null } });
      return presentExpense(await this.load(tx, id));
    });
  }
}
