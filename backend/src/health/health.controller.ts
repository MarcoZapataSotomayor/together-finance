import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { HealthStatus } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
