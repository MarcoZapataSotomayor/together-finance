import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { EmptyMutationDto } from '../finance/api-validation.js';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { DebtQueryDto } from '../debts/debt.dto.js';
import { CreateLoanDto, UpdateLoanDto } from './loan.dto.js';
import { LoansService } from './loans.service.js';

const loanId = new ParseUUIDPipe({ version: '4' });

@Controller('loans')
@UseFilters(DatabaseErrorFilter)
export class LoansController {
  constructor(private readonly loans: LoansService) {}
  @Post() create(@Body() input: CreateLoanDto) {
    return this.loans.create(input);
  }
  @Get() list(@Query() query: DebtQueryDto) {
    return this.loans.list(query);
  }
  @Get(':id') get(@Param('id', loanId) id: string) {
    return this.loans.get(id.toLowerCase());
  }
  @Patch(':id') update(
    @Param('id', loanId) id: string,
    @Body() input: UpdateLoanDto,
  ) {
    return this.loans.update(id.toLowerCase(), input);
  }
  @Delete(':id') @HttpCode(204) remove(
    @Param('id', loanId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.loans.remove(id.toLowerCase());
  }
  @Post(':id/restore') @HttpCode(200) restore(
    @Param('id', loanId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.loans.restore(id.toLowerCase());
  }
}
