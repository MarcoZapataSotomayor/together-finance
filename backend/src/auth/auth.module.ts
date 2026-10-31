import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard, CsrfGuard } from './session.guard.js';
import { LoginRateLimitGuard } from './login-rate-limit.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginRateLimitGuard,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
