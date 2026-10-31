import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Body, Controller, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IsNotEmpty, IsString } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';

class ValidationProbeDto {
  @IsString()
  @IsNotEmpty()
  title!: string;
}

// This controller exists only in the test application, never in the real API.
@Controller('validation-probe')
class ValidationProbeController {
  @Post()
  validate(@Body() body: ValidationProbeDto) {
    return {
      title: body.title,
      transformed: body instanceof ValidationProbeDto,
    };
  }
}

describe('API configuration and health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'test',
            CORS_ORIGINS: 'http://localhost:5173,https://frontend.example',
          }),
        ),
      )
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health returns the application status as JSON', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({ status: 'ok', application: 'Together Finance' });
  });

  it('does not expose an unprefixed health route', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it.each(['http://localhost:5173', 'https://frontend.example'])(
    'allows the exact configured origin %s',
    async (origin) => {
      await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', origin)
        .expect('Access-Control-Allow-Origin', origin)
        .expect(200);
    },
  );

  it('answers an allowed frontend preflight request', async () => {
    await request(app.getHttpServer())
      .options('/api/health')
      .set('Origin', 'https://frontend.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', 'https://frontend.example')
      .expect(204);
  });

  it('does not grant CORS access to an unlisted origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://unlisted.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      response.headers['access-control-allow-credentials'],
    ).toBeUndefined();
  });

  it('transforms a valid body into its decorated DTO', async () => {
    await request(app.getHttpServer())
      .post('/api/validation-probe')
      .send({ title: 'example' })
      .expect(201)
      .expect({ title: 'example', transformed: true });
  });

  it('rejects unexpected request properties', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/validation-probe')
      .send({ title: 'example', unexpected: true })
      .expect(400);
    expect(response.body.message).toContain(
      'property unexpected should not exist',
    );
  });

  it('rejects invalid DTO field values', async () => {
    await request(app.getHttpServer())
      .post('/api/validation-probe')
      .send({ title: 123 })
      .expect(400);
  });
});
