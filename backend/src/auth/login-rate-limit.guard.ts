import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly windowMs = 15 * 60 * 1000;
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private global = { count: 0, resetAt: 0 };

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [key, entry] of this.attempts)
      if (entry.resetAt <= now) this.attempts.delete(key);
    if (this.global.resetAt <= now)
      this.global = { count: 0, resetAt: now + this.windowMs };
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const entry = this.attempts.get(key) ?? {
      count: 0,
      resetAt: now + this.windowMs,
    };
    if (entry.count >= 5 || this.global.count >= 60) {
      const resetAt = entry.count >= 5 ? entry.resetAt : this.global.resetAt;
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
      );
      throw new HttpException(
        'Too many login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count++;
    this.global.count++;
    this.attempts.set(key, entry);
    return true;
  }
}
