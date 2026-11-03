import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { normalizeId } from '../finance/api-validation.js';

export class SpendingQueryDto {
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
}
