import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { authTestEnvironment, testPassword } from './auth-fixture.js';
import {
  databaseFailure,
  exampleExpense,
  FinanceStore,
  ids,
} from './finance-store.js';
import { ExpensesService } from '../src/expenses/expenses.service.js';

describe('authenticated read-only spending analytics (mocked database)', () => {
  let app: INestApplication<App>, store: FinanceStore, cookie: string;
  const path = '/api/analytics/spending?from=2026-10-01&to=2026-10-31';
  beforeEach(async () => {
    store = new FinanceStore();
    const config = validateEnvironment({
      ...authTestEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://database.example.invalid/finance',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(store.prisma())
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    const bootstrap = await request(app.getHttpServer())
      .get('/api/auth/session')
      .expect(200);
    const initial = (
      bootstrap.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', initial)
      .set('X-CSRF-Token', bootstrap.body.csrfToken as string)
      .send({ password: testPassword })
      .expect(200);
    cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
  });
  afterEach(async () => {
    await app?.close();
  });
  const get = (url = path) =>
    request(app.getHttpServer()).get(url).set('Cookie', cookie);

  it('requires authentication and rejects revoked sessions', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    const session = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', session.body.csrfToken as string)
      .send({})
      .expect(204);
    await get().expect(401);
  });

  it('returns exact string totals, categories, zero-filled monthly data, and explicit roles', async () => {
    await new ExpensesService(store.prisma()).create(
      exampleExpense({ amount: '80.01' }),
    );
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      currency: 'PEN',
      basis: 'EXPENSE_TOTAL',
      person: null,
      totals: {
        amount: '80.01',
        sharedAmount: '80.01',
        fundedAmount: '80.01',
        expenseCount: 1,
      },
    });
    const personal = await get(`${path}&personId=${ids.antonella}`).expect(200);
    expect(personal.body).toMatchObject({
      basis: 'ALLOCATION',
      person: { id: ids.antonella },
      totals: { amount: '40.01', fundedAmount: '0.00' },
    });
    expect(personal.body.categories[0].amount).toBe('40.01');
    expect(personal.body.recentExpenses[0]).toMatchObject({
      attributedAmount: '40.01',
      expenseAmount: '80.01',
    });
    expect(response.body.people[0]).not.toHaveProperty('notes');
  });

  it.each([
    '/api/analytics/spending',
    `${path}&pov=marco`,
    `${path}&currency=USD`,
    `${path}&personId=marco`,
    '/api/analytics/spending?from=2026-02-30&to=2026-03-01',
    '/api/analytics/spending?from=0000-01-01&to=0001-01-01',
    '/api/analytics/spending?from=2026-11-01&to=2026-10-31',
    '/api/analytics/spending?from=2024-01-01&to=2026-01-01',
    `${path}&personId=00000000-0000-4000-8000-000000000099`,
  ])('rejects invalid/unsupported filters: %s', async (url) => {
    await get(url).expect(400);
  });

  it('returns a real empty report and does not expose a mutation endpoint', async () => {
    const response = await get().expect(200);
    expect(response.body.totals.amount).toBe('0.00');
    expect(response.body.monthly).toHaveLength(1);
    expect(response.body.categories).toEqual([]);
    await request(app.getHttpServer())
      .post('/api/analytics/spending')
      .set('Cookie', cookie)
      .send({})
      .expect(404);
    expect(store.client.expense.create).not.toHaveBeenCalled();
  });

  it('excludes deleted expenses and refuses inconsistent active allocations safely', async () => {
    const expenses = new ExpensesService(store.prisma());
    await expenses.create(exampleExpense());
    await expenses.remove(ids.expense);
    expect((await get().expect(200)).body.totals.amount).toBe('0.00');
    await expenses.restore(ids.expense);
    store.allocations[0].deletedAt = new Date();
    const conflict = await get().expect(409);
    expect(conflict.body.message).toContain('inconsistent');
    expect(conflict.body).not.toHaveProperty('totals');
  });

  it('redacts database errors and reports temporary unavailability without fake zero totals', async () => {
    store.client.expense.findMany.mockRejectedValueOnce(
      databaseFailure('P1001'),
    );
    const response = await get().expect(503);
    expect(JSON.stringify(response.body)).not.toContain('Private database');
    expect(response.body).not.toHaveProperty('totals');
  });
});
