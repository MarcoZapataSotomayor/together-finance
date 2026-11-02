import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
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
