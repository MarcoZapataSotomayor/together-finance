import { BadRequestException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import {
  calendarDate,
  normalizeId,
  PaginationDto,
} from '../finance/api-validation.js';

export const datasets = [
  'expenses',
  'allocations',
  'debts',
  'loans',
  'repayments',
] as const;
export type Dataset = (typeof datasets)[number];
export type RecordKind = 'expense' | 'loan' | 'repayment';

export class ExportQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  personId?: string;

  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  scope: 'active' | 'deleted' | 'all' = 'active';
}

export class RecycleBinQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['expense', 'loan', 'repayment'])
  type?: RecordKind;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deletedFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deletedTo?: string;
}

export function exportPeriod(query: ExportQueryDto) {
  const from = calendarDate(query.from);
  const to = calendarDate(query.to);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    to.getUTCMonth() -
    from.getUTCMonth();
  if (from > to || months >= 24)
    throw new BadRequestException(
      'Use an ordered range of at most 24 calendar months.',
    );
  return { gte: from, lte: to };
}
