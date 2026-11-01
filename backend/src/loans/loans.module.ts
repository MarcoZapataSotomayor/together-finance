import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DebtsModule } from '../debts/debts.module.js';
import { LoansController } from './loans.controller.js';
import { LoansService } from './loans.service.js';

@Module({
  imports: [PrismaModule, DebtsModule],
  controllers: [LoansController],
  providers: [LoansService],
})
export class LoansModule {}
