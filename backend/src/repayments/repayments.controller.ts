import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { EmptyMutationDto } from '../finance/api-validation.js';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { CreateRepaymentDto } from './repayment.dto.js';
import { RepaymentQueryDto } from './repayment.dto.js';
import { RepaymentsService } from './repayments.service.js';

const recordId = new ParseUUIDPipe({ version: '4' });

@Controller()
@UseFilters(DatabaseErrorFilter)
export class RepaymentsController {
  constructor(private readonly repayments: RepaymentsService) {}
  @Post('debts/:id/repayments') create(
    @Param('id', recordId) id: string,
    @Body() input: CreateRepaymentDto,
  ) {
    return this.repayments.create(id.toLowerCase(), input);
  }
  @Get('debts/:id/repayments') list(
    @Param('id', recordId) id: string,
    @Query() query: RepaymentQueryDto,
  ) {
    return this.repayments.list(id.toLowerCase(), query);
  }
  @Get('repayments/:id') get(@Param('id', recordId) id: string) {
    return this.repayments.get(id.toLowerCase());
  }
  @Delete('repayments/:id') @HttpCode(204) remove(
    @Param('id', recordId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.repayments.remove(id.toLowerCase());
  }
  @Post('repayments/:id/restore') @HttpCode(200) restore(
    @Param('id', recordId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.repayments.restore(id.toLowerCase());
  }
}
