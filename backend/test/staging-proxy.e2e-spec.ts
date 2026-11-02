import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request as upstreamRequest } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DataManagementStore } from './data-management-store.js';
import { authTestEnvironment, testPassword } from './auth-fixture.js';

// Loopback transport model, not a claim about Vercel's hosted TLS/header behavior.
describe('staging reverse-proxy transport (no external network/database)', () => {
  const origin = 'https://finance-staging.vercel.app';
  let app: INestApplication, proxy: Server, port: number;
  async function backend() {
    const config = validateEnvironment({
      ...authTestEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://database.example.invalid/finance',
      CORS_ORIGINS: origin,
      SESSION_COOKIE_SAME_SITE: 'lax',
      TRUST_PROXY_HOPS: '0',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(new DataManagementStore().prisma())
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  }
  beforeEach(async () => {
    await backend();
    proxy = createServer((incoming, outgoing) => {
      const upstream = upstreamRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: incoming.url,
          method: incoming.method,
          headers: {
            ...incoming.headers,
            host: `127.0.0.1:${port}`,
            'x-forwarded-host': new URL(origin).host,
            'x-forwarded-proto': 'https',
            'x-forwarded-for': '198.51.100.7',
          },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  });
  afterEach(async () => {
    proxy?.closeAllConnections();
    if (proxy)
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    await app?.close();
  });
  const cookie = (response: request.Response) =>
    (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  async function login() {
    const initial = await request(proxy).get('/api/auth/session').expect(200);
    const logged = await request(proxy)
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('Cookie', cookie(initial))
      .set('X-CSRF-Token', initial.body.csrfToken as string)
      .send({ password: testPassword })
      .expect(200);
    expect(cookie(initial) !== cookie(logged)).toBe(true);
    return {
      cookie: cookie(logged),
      csrf: logged.body.csrfToken as string,
      response: logged,
    };
  }
  it('preserves health, secure cookie flags/rotation, queries, financial reads, CSV and logout revocation', async () => {
    const health = await request(proxy).get('/api/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok',
      application: 'Together Finance',
    });
    expect(health.headers['cache-control']).toBe('no-store');
    await request(proxy).get('/api/expenses').expect(401);
    const session = await login();
    const header = (
      session.response.headers['set-cookie'] as unknown as string[]
    )[0];
    for (const flag of [
      '__Host-together_session=',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
    ])
      expect(header.includes(flag)).toBe(true);
    expect(header.includes('Domain=')).toBe(false);
    const restored = await request(proxy)
      .get('/api/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(restored.body.authenticated).toBe(true);
    const spending = await request(proxy)
      .get('/api/analytics/spending?from=2026-10-01&to=2026-10-31')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(spending.body.totals.amount).toBe('0.00');
    expect(spending.headers['cache-control']).toBe('no-store');
    const csv = await request(proxy)
      .get('/api/exports/expenses.csv?from=2026-10-01&to=2026-10-31')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment;');
    expect(csv.headers['cache-control']).toContain('no-store');
    expect(csv.text.codePointAt(0)).toBe(0xfeff);
    await request(proxy)
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', session.csrf)
      .send({})
      .expect(204);
    await request(proxy)
      .get('/api/expenses')
      .set('Cookie', session.cookie)
      .expect(401);
  });
  it('retains Origin/token checks through forwarded headers and rejects sessions after a backend restart', async () => {
    const session = await login();
    for (const denied of ['https://unapproved.example', 'null', '']) {
      await request(proxy)
        .post('/api/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', denied)
        .set('X-CSRF-Token', session.csrf)
        .send({})
        .expect(403);
    }
    await request(proxy)
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(403);
    await app.close();
    await backend();
    await request(proxy)
      .get('/api/expenses')
      .set('Cookie', session.cookie)
      .expect(401);
  });
});
