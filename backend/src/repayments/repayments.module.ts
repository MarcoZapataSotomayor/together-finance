import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DebtsModule } from '../debts/debts.module.js';
import { RepaymentsController } from './repayments.controller.js';
import { RepaymentsService } from './repayments.service.js';

@Module({
  imports: [PrismaModule, DebtsModule],
  controllers: [RepaymentsController],
  providers: [RepaymentsService],
})
export class RepaymentsModule {}
