import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { SpendingQueryDto } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('analytics')
@UseFilters(DatabaseErrorFilter)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('spending') spending(@Query() query: SpendingQueryDto) {
    return this.analytics.spending(query);
  }
}
