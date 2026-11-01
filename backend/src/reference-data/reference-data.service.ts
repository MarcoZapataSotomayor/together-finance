import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { financialTransaction } from '../finance/transactions.js';
import type { PaginationDto } from '../finance/api-validation.js';
import type {
  CreateCategoryDto,
  CreatePaymentMethodDto,
  CreatePersonDto,
} from './reference-data.dto.js';

@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  createPerson(input: CreatePersonDto) {
    return financialTransaction(this.prisma, async (tx) => {
      const name = input.name.trim().normalize('NFKC');
      if (
        await tx.person.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        })
      )
        throw new ConflictException('A person with this name already exists.');
      return tx.person.create({
        data: { name, notes: input.notes?.trim() || null },
      });
    });
  }

  createCategory(input: CreateCategoryDto) {
    return financialTransaction(this.prisma, async (tx) => {
      const name = input.name.trim().normalize('NFKC');
      if (
        await tx.category.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        })
      )
        throw new ConflictException(
          'A category with this name already exists.',
        );
      return tx.category.create({
        data: { name, description: input.description?.trim() || null },
      });
    });
  }

  createPaymentMethod(input: CreatePaymentMethodDto) {
    return financialTransaction(this.prisma, async (tx) => {
      const name = input.name.trim().normalize('NFKC');
      if (
        await tx.paymentMethod.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        })
      )
        throw new ConflictException(
          'A payment method with this name already exists.',
        );
      if (
        input.ownerPersonId &&
        !(await tx.person.findFirst({
          where: { id: input.ownerPersonId, isActive: true },
        }))
      )
        throw new BadRequestException(
          'The payment method owner must be an active person.',
        );
      return tx.paymentMethod.create({
        data: {
          name,
          type: input.type,
          ownerPersonId: input.ownerPersonId ?? null,
          description: input.description?.trim() || null,
        },
      });
    });
  }

  listPeople(query: PaginationDto) {
    return financialTransaction(this.prisma, async (tx) => ({
      data: await tx.person.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      total: await tx.person.count({ where: { isActive: true } }),
      page: query.page,
      pageSize: query.pageSize,
    }));
  }

  listCategories(query: PaginationDto) {
    return financialTransaction(this.prisma, async (tx) => ({
      data: await tx.category.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      total: await tx.category.count({ where: { isActive: true } }),
      page: query.page,
      pageSize: query.pageSize,
    }));
  }

  listPaymentMethods(query: PaginationDto) {
    return financialTransaction(this.prisma, async (tx) => ({
      data: await tx.paymentMethod.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      total: await tx.paymentMethod.count({ where: { isActive: true } }),
      page: query.page,
      pageSize: query.pageSize,
    }));
  }
}
