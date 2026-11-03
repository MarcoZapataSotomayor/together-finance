import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  application: string;
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return { status: 'ok', application: 'Together Finance' };
  }
}
