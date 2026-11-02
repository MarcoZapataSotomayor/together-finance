import { Module } from '@nestjs/common';
import { DataManagementController } from './data-management.controller.js';
import { ExportService } from './export.service.js';
import { RecycleBinService } from './recycle-bin.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [DataManagementController],
  providers: [ExportService, RecycleBinService],
})
export class DataManagementModule {}
