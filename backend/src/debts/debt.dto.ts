import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { normalizeId } from '../finance/api-validation.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class DebtFiltersDto {
  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  debtorPersonId?: string;

  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  creditorPersonId?: string;

  @IsOptional()
  @IsIn(['EXPENSE', 'LOAN'])
  origin?: 'EXPENSE' | 'LOAN';

  @IsOptional()
  @IsIn(['pending', 'settled'])
  status?: 'pending' | 'settled';

  @IsOptional()
  @IsIn(['active', 'deleted'])
  deletionState: 'active' | 'deleted' = 'active';

  @IsOptional()
  @IsString()
  @Matches(datePattern)
  incurredFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(datePattern)
  incurredTo?: string;
}

export class DebtQueryDto extends DebtFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
