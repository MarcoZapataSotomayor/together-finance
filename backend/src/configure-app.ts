import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const expressApp = app as NestExpressApplication;
  expressApp.set('x-powered-by', false);
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    response.setHeader('Cache-Control', 'no-store');
    if (config.get('NODE_ENV') === 'production')
      response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  expressApp.useBodyParser('json', { limit: '32kb' });
  (app as NestExpressApplication).set(
    'trust proxy',
    config.getOrThrow<number>('TRUST_PROXY_HOPS'),
  );
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const allowedOrigins = config.getOrThrow<string[]>('CORS_ORIGINS');
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, origin?: string | boolean) => void,
    ) =>
      callback(
        null,
        origin && allowedOrigins.includes(origin) ? origin : false,
      ),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Disposition'],
  });
}
