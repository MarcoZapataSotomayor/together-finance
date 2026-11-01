import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentMethodType } from '../generated/prisma/client.js';
import { normalizeId, trimText } from '../finance/api-validation.js';

class NamedReferenceDto {
  @trimText()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class CreatePersonDto extends NamedReferenceDto {
  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateCategoryDto extends NamedReferenceDto {
  @IsOptional()
  @trimText()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class CreatePaymentMethodDto extends CreateCategoryDto {
  @IsEnum(PaymentMethodType)
  type!: PaymentMethodType;

  @IsOptional()
  @normalizeId()
  @IsUUID('4')
  ownerPersonId?: string | null;
}
