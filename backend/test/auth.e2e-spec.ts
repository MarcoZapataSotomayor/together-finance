import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, Get, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureApp } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { authTestEnvironment, testPassword } from './auth-fixture.js';

@Controller('private-probe')
class PrivateProbeController {
  @Get() read() {
    return { access: 'shared' };
  }
  @Post() write() {
    return { accepted: true };
  }
}

interface BrowserSession {
  cookie: string;
  csrfToken: string;
}
function cookieFrom(headers: Record<string, unknown>): string {
  const cookie = headers['set-cookie'] as string[] | undefined;
  if (!cookie?.[0]) throw new Error('Expected a cookie; value omitted.');
  return cookie[0].split(';')[0];
}

async function createApp(overrides: Record<string, unknown> = {}) {
  const config = validateEnvironment({
    ...authTestEnvironment,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://database.example.invalid/finance',
    CORS_ORIGINS: 'http://localhost:5173,https://frontend.example',
    SESSION_TTL_SECONDS: '60',
    ...overrides,
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PrivateProbeController],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(config))
    .compile();
  const app = module.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('shared-password authentication (e2e)', () => {
  let app: INestApplication<App>;
  const origin = 'http://localhost:5173';
  beforeEach(async () => {
    app = await createApp();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function bootstrap(): Promise<BrowserSession> {
    const response = await request(app.getHttpServer())
      .get('/api/auth/session')
      .expect(200);
    expect(response.body.authenticated).toBe(false);
    return {
      cookie: cookieFrom(response.headers),
      csrfToken: response.body.csrfToken as string,
    };
  }

  function post(path: string, session: BrowserSession) {
    return request(app.getHttpServer())
      .post(path)
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
  }

  async function login(session = bootstrap()): Promise<BrowserSession> {
    const response = await post('/api/auth/login', await session)
      .send({ password: testPassword })
      .expect(200);
    expect(response.body.authenticated).toBe(true);
    return {
      cookie: cookieFrom(response.headers),
      csrfToken: response.body.csrfToken as string,
    };
  }

  it('keeps health public without issuing session cookies', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(Boolean(result.headers['set-cookie'])).toBe(false);
  });

  it('issues an anonymous HttpOnly CSRF bootstrap with no-store caching', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/session')
      .expect(200);
    const flags = String(
      (response.headers['set-cookie'] as unknown as string[])[0],
    );
    expect(flags.includes('HttpOnly')).toBe(true);
    expect(flags.includes('SameSite=Lax')).toBe(true);
    expect(flags.includes('Path=/')).toBe(true);
    expect(flags.includes('Domain=')).toBe(false);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.authenticated).toBe(false);
    expect(typeof response.body.csrfToken).toBe('string');
  });

  it('protects routes by default regardless of submitted POV', async () => {
    await request(app.getHttpServer())
      .get('/api/private-probe?pov=marco')
      .set('X-POV', 'shared')
      .expect(401);
    const anonymous = await bootstrap();
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', anonymous.cookie)
      .expect(401);
  });

  it('rejects an invalid password without authenticating the anonymous session', async () => {
    const session = await bootstrap();
    await post('/api/auth/login', session)
      .send({ password: 'incorrect-test-value' })
      .expect(401);
    const result = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(result.body.authenticated).toBe(false);
  });

  it('rotates the session ID and CSRF token and restores valid sessions', async () => {
    const anonymous = await bootstrap();
    const session = await login(Promise.resolve(anonymous));
    expect(session.cookie !== anonymous.cookie).toBe(true);
    expect(session.csrfToken !== anonymous.csrfToken).toBe(true);
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', session.cookie)
      .expect(200)
      .expect({ access: 'shared' });
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', anonymous.cookie)
      .expect(401);
    const restored = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(restored.body.authenticated).toBe(true);
    expect(Boolean(restored.headers['set-cookie'])).toBe(false);
  });

  it('rejects tampered signatures and ambiguous duplicate cookies', async () => {
    const session = await login();
    const changed =
      session.cookie.slice(0, -1) + (session.cookie.endsWith('A') ? 'B' : 'A');
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', changed)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', `${session.cookie}; ${session.cookie}`)
      .expect(401);
  });

  it('expires sessions absolutely rather than extending them on reads', async () => {
    const session = await login();
    const original = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 30000);
    const read = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(read.body.expiresAt === original.body.expiresAt).toBe(true);
    clock.mockReturnValue(now + 61000);
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', session.cookie)
      .expect(401);
  });

  it('revokes a logged-out cookie so replay cannot authorize requests', async () => {
    const session = await login();
    const logout = await post('/api/auth/logout', session).send({}).expect(204);
    expect(
      String((logout.headers['set-cookie'] as unknown as string[])[0]).includes(
        'Expires=Thu, 01 Jan 1970',
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', session.cookie)
      .expect(401);
  });

  it('does not log out a user on a forged request', async () => {
    const session = await login();
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', session.cookie)
      .expect(200);
  });

  it('rejects login CSRF without the bound cookie and token', async () => {
    const session = await bootstrap();
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', session.csrfToken)
      .send({ password: testPassword })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .send({ password: testPassword })
      .expect(403);
  });

  it.each([undefined, 'https://evil.example', 'null'])(
    'rejects missing, unlisted, or null origins',
    async (value) => {
      const session = await bootstrap();
      const operation = request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrfToken);
      if (value) operation.set('Origin', value);
      await operation.send({ password: testPassword }).expect(403);
    },
  );

  it('requires bound CSRF tokens on future private writes', async () => {
    const session = await login();
    await request(app.getHttpServer())
      .post('/api/private-probe')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/private-probe')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', 'a'.repeat(43))
      .send({})
      .expect(403);
    await post('/api/private-probe', session).send({}).expect(201);
  });

  it('rejects form-encoded login and unexpected login fields', async () => {
    const session = await bootstrap();
    await post('/api/auth/login', session)
      .type('form')
      .send({ password: testPassword })
      .expect(403);
    await post('/api/auth/login', session)
      .send({ password: testPassword, pov: 'marco' })
      .expect(400);
  });

  it('limits password attempts and ignores untrusted forwarded IP headers', async () => {
    const session = await bootstrap();
    for (let index = 0; index < 5; index++)
      await post('/api/auth/login', session)
        .set('X-Forwarded-For', `192.0.2.${index + 1}`)
        .send({ password: 'incorrect-test-value' })
        .expect(401);
    const limited = await post('/api/auth/login', session)
      .set('X-Forwarded-For', '198.51.100.8')
      .send({ password: testPassword })
      .expect(429);
    expect(Number(limited.headers['retry-after']) > 0).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60 * 1000 + 1);
    await login();
  }, 15000);

  it('enables credentialed CORS only for exact configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'https://frontend.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
      .expect(204);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://frontend.example',
    );
    const denied = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses production Secure host-only cookies for opt-in cross-site deployments', async () => {
    await app.close();
    app = await createApp({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://frontend.example',
      SESSION_COOKIE_SAME_SITE: 'none',
    });
    const response = await request(app.getHttpServer())
      .get('/api/auth/session')
      .expect(200);
    const flags = String(
      (response.headers['set-cookie'] as unknown as string[])[0],
    );
    expect(flags.startsWith('__Host-together_session=')).toBe(true);
    expect(flags.includes('Secure')).toBe(true);
    expect(flags.includes('HttpOnly')).toBe(true);
    expect(flags.includes('SameSite=None')).toBe(true);
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000',
    );
    expect(flags.includes('Domain=')).toBe(false);
  });

  it('invalidates sessions after a process restart', async () => {
    const session = await login();
    await app.close();
    app = await createApp();
    await request(app.getHttpServer())
      .get('/api/private-probe')
      .set('Cookie', session.cookie)
      .expect(401);
  });

  it('sets restrictive API headers on public and denied financial responses', async () => {
    for (const path of ['/api/health', '/api/expenses']) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });

  it('rejects oversized JSON before hashing or financial processing', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ password: 'x'.repeat(33000) })
      .expect(413);
  });
});
