import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { PaginationDto } from '../finance/api-validation.js';
import {
  datasets,
  ExportQueryDto,
  RecycleBinQueryDto,
} from './data-management.dto.js';
import type { Dataset } from './data-management.dto.js';
import { ExportService } from './export.service.js';
import { RecycleBinService } from './recycle-bin.service.js';

@Controller()
@UseFilters(DatabaseErrorFilter)
export class DataManagementController {
  constructor(
    private readonly exports: ExportService,
    private readonly bin: RecycleBinService,
  ) {}

  @Get('exports/:file')
  async download(
    @Param('file') file: string,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const dataset = file.replace(/\.csv$/, '') as Dataset;
    if (file !== `${dataset}.csv` || !datasets.includes(dataset))
      throw new NotFoundException();
    const result = await this.exports.export(dataset, query);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    if (response.destroyed) result.stream.destroy();
    else response.once('close', () => result.stream.destroy());
    return new StreamableFile(result.stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${result.filename}"`,
      length: result.length,
    });
  }

  @Get('recycle-bin')
  list(@Query() query: RecycleBinQueryDto) {
    return this.bin.list(query);
  }

  @Get('data-management/people')
  people(@Query() query: PaginationDto) {
    return this.bin.people(query);
  }
}
