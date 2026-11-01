import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { ReferenceDataModule } from './reference-data/reference-data.module.js';
import { DebtsModule } from './debts/debts.module.js';
import { LoansModule } from './loans/loans.module.js';
import { RepaymentsModule } from './repayments/repayments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    AuthModule,
    ExpensesModule,
    ReferenceDataModule,
    DebtsModule,
    LoansModule,
    RepaymentsModule,
    HealthModule,
  ],
})
export class AppModule {}
