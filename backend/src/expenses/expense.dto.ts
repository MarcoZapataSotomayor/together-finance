import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  normalizeId,
  PaginationDto,
  trimText,
} from '../finance/api-validation.js';
import type { Classification } from '../finance/financial-model.js';

const moneyPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class ExpenseShareDto {
  @normalizeId()
  @IsUUID('4')
  personId!: string;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/)
  percentage!: string;
}

export class CreateExpenseDto {
  // Reuse this client-generated UUID for retries of the same intended expense.
  @normalizeId()
  @IsUUID('4')
  id!: string;

  @IsString()
  @Matches(moneyPattern)
  amount!: string;

  @IsString()
  @Matches(datePattern)
  purchasedOn!: string;

  @trimText()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  merchant!: string;

  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @normalizeId()
  @IsUUID('4')
  categoryId!: string;

  @normalizeId()
  @IsUUID('4')
  paymentMethodId!: string;

  @normalizeId()
  @IsUUID('4')
  fundedByPersonId!: string;

  @IsIn(['PERSONAL', 'SHARED'])
  classification!: Classification;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExpenseShareDto)
  allocations!: ExpenseShareDto[];
}

export class UpdateExpenseDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(moneyPattern)
  amount?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(datePattern)
  purchasedOn?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @trimText()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  merchant?: string;

  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @normalizeId()
  @IsUUID('4')
  categoryId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @normalizeId()
  @IsUUID('4')
  paymentMethodId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @normalizeId()
  @IsUUID('4')
  fundedByPersonId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['PERSONAL', 'SHARED'])
  classification?: Classification;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExpenseShareDto)
  allocations?: ExpenseShareDto[];
}

export class ExpenseQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Matches(datePattern)
  purchasedFrom?: string;
  @IsOptional()
  @IsString()
  @Matches(datePattern)
  purchasedTo?: string;
  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  categoryId?: string;
  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  beneficiaryPersonId?: string;
  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  fundedByPersonId?: string;
  @IsOptional()
  @IsIn(['PERSONAL', 'SHARED'])
  classification?: Classification;
}
