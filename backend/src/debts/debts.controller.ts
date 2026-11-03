import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseFilters,
} from '@nestjs/common';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { DebtFiltersDto, DebtQueryDto } from './debt.dto.js';
import { DebtsService } from './debts.service.js';

@Controller('debts')
@UseFilters(DatabaseErrorFilter)
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get() list(@Query() query: DebtQueryDto) {
    return this.debts.list(query);
  }

  @Get('summary') summary(@Query() query: DebtFiltersDto) {
    return this.debts.summary(query);
  }

  @Get(':id') get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.debts.get(id.toLowerCase());
  }
}
