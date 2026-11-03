import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizeId, trimText } from '../finance/api-validation.js';
import { PaginationDto } from '../finance/api-validation.js';

export class RepaymentQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  deletionState: 'active' | 'deleted' | 'all' = 'all';
}

const moneyPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRepaymentDto {
  // Keep this UUID for retries; a deleted repayment is restored explicitly.
  @normalizeId()
  @IsUUID('4')
  id!: string;

  @IsString()
  @Matches(moneyPattern)
  amount!: string;

  @IsString()
  @Matches(datePattern)
  paidOn!: string;

  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
