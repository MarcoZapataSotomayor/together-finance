import { Body, Controller, Get, Post, Query, UseFilters } from '@nestjs/common';
import { PaginationDto } from '../finance/api-validation.js';
import { DatabaseErrorFilter } from '../finance/database-error.filter.js';
import { ReferenceDataService } from './reference-data.service.js';
import {
  CreateCategoryDto,
  CreatePaymentMethodDto,
  CreatePersonDto,
} from './reference-data.dto.js';

@Controller()
@UseFilters(DatabaseErrorFilter)
export class ReferenceDataController {
  constructor(private readonly references: ReferenceDataService) {}
  @Get('people') listPeople(@Query() query: PaginationDto) {
    return this.references.listPeople(query);
  }
  @Post('people') createPerson(@Body() input: CreatePersonDto) {
    return this.references.createPerson(input);
  }
  @Get('categories') listCategories(@Query() query: PaginationDto) {
    return this.references.listCategories(query);
  }
  @Post('categories') createCategory(@Body() input: CreateCategoryDto) {
    return this.references.createCategory(input);
  }
  @Get('payment-methods') listPaymentMethods(@Query() query: PaginationDto) {
    return this.references.listPaymentMethods(query);
  }
  @Post('payment-methods') createPaymentMethod(
    @Body() input: CreatePaymentMethodDto,
  ) {
    return this.references.createPaymentMethod(input);
  }
}
