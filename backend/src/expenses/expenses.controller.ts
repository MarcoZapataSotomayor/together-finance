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
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { EmptyMutationDto } from '../finance/api-validation.js';
import {
  CreateExpenseDto,
  ExpenseQueryDto,
  UpdateExpenseDto,
} from './expense.dto.js';
import { ExpensesService } from './expenses.service.js';

const expenseId = new ParseUUIDPipe({ version: '4' });

@Controller('expenses')
@UseFilters(DatabaseErrorFilter)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Post() create(@Body() input: CreateExpenseDto) {
    return this.expenses.create(input);
  }
  @Get() list(@Query() query: ExpenseQueryDto) {
    return this.expenses.list(query);
  }
  @Get(':id') get(@Param('id', expenseId) id: string) {
    return this.expenses.get(id.toLowerCase());
  }
  @Patch(':id') update(
    @Param('id', expenseId) id: string,
    @Body() input: UpdateExpenseDto,
  ) {
    return this.expenses.update(id.toLowerCase(), input);
  }
  @Delete(':id') @HttpCode(204) remove(
    @Param('id', expenseId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.expenses.remove(id.toLowerCase());
  }
  @Post(':id/restore') @HttpCode(200) restore(
    @Param('id', expenseId) id: string,
    @Body() _input: EmptyMutationDto,
  ) {
    return this.expenses.restore(id.toLowerCase());
  }
}
