import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { normalizeId, trimText } from '../finance/api-validation.js';

const moneyPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreateLoanDto {
  // Keep this UUID for retries of the same intended loan.
  @normalizeId()
  @IsUUID('4')
  id!: string;

  @normalizeId()
  @IsUUID('4')
  debtorPersonId!: string;

  @normalizeId()
  @IsUUID('4')
  creditorPersonId!: string;

  @IsString()
  @Matches(moneyPattern)
  amount!: string;

  @IsString()
  @Matches(datePattern)
  incurredOn!: string;

  @IsOptional()
  @IsString()
  @Matches(datePattern)
  dueOn?: string | null;

  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateLoanDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @normalizeId()
  @IsUUID('4')
  debtorPersonId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @normalizeId()
  @IsUUID('4')
  creditorPersonId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(moneyPattern)
  amount?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(datePattern)
  incurredOn?: string;

  @IsOptional()
  @IsString()
  @Matches(datePattern)
  dueOn?: string | null;

  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
