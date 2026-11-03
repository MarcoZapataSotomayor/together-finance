import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DataManagementStore } from './data-management-store.js';
import { databaseFailure, exampleExpense, ids } from './finance-store.js';
import { ExpensesService } from '../src/expenses/expenses.service.js';
import { DebtsService } from '../src/debts/debts.service.js';
import { LoansService } from '../src/loans/loans.service.js';
import { RepaymentsService } from '../src/repayments/repayments.service.js';
import { ExportService } from '../src/data-management/export.service.js';

describe('authenticated data management (isolated database double)', () => {
  let app: INestApplication<App>,
    store: DataManagementStore,
    cookie: string,
    csrf: string;
  const suffix = '?from=2026-10-01&to=2026-10-31';
  beforeEach(async () => {
    store = new DataManagementStore();
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
    csrf = login.body.csrfToken as string;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });
  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrf)
      .send({});

  it.each(['expenses', 'allocations', 'debts', 'loans', 'repayments'])(
    'requires a session for %s exports',
    async (dataset) => {
      await request(app.getHttpServer())
        .get(`/api/exports/${dataset}.csv${suffix}`)
        .expect(401);
      const response = await get(`/api/exports/${dataset}.csv${suffix}`).expect(
        200,
      );
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="together-finance-/,
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.text.charCodeAt(0)).toBe(65279);
      expect(response.text.split('\r\n').length).toBe(2);
    },
  );
  it('protects bin and historical-person metadata and expires sessions on logout', async () => {
    for (const path of ['/api/recycle-bin', '/api/data-management/people'])
      await request(app.getHttpServer()).get(path).expect(401);
    expect((await get('/api/recycle-bin').expect(200)).body).toMatchObject({
      data: [],
      total: 0,
    });
    store.people[0].isActive = false;
    const people = await get('/api/data-management/people').expect(200);
    expect(people.body.data[0]).not.toHaveProperty('notes');
    await post('/api/auth/logout').expect(204);
    await get('/api/recycle-bin').expect(401);
    await get(`/api/exports/expenses.csv${suffix}`).expect(401);
  });
  it.each([
    'from=2026-02-30&to=2026-03-01',
    'from=2026-10-31&to=2026-10-01',
    'from=2024-01-01&to=2026-10-31',
    'from=2026-10-01&to=2026-10-31&personId=bad',
    'from=2026-10-01&to=2026-10-31&scope=hidden',
    'from=2026-10-01&to=2026-10-31&secret=true',
  ])('rejects invalid/unknown export filters %s', async (query) => {
    await get(`/api/exports/expenses.csv?${query}`).expect(400);
  });
  it('sends safe exact CSV fields and credentialed CORS only to allowed origins', async () => {
    await new ExpensesService(store.prisma()).create(
      exampleExpense({
        amount: '999999999999.99',
        merchant: '=1+2',
        description: 'Line, "one"\nLine two',
      }),
    );
    const response = await get(`/api/exports/expenses.csv${suffix}`)
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(response.text).toContain('"\t=1+2"');
    expect(response.text).toContain('"Line, ""one""\nLine two"');
    expect(response.text).toContain('"999999999999.99"');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-expose-headers']).toBe(
      'Content-Disposition',
    );
    expect(response.text).not.toMatch(
      /csrf|password|database_url|cookie|token/i,
    );
    expect(
      (
        await get(`/api/exports/expenses.csv${suffix}`)
          .set('Origin', 'https://untrusted.example')
          .expect(200)
      ).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });
  it('restores through existing CSRF-protected endpoints and updates bin membership', async () => {
    const expenses = new ExpensesService(store.prisma());
    await expenses.create(exampleExpense());
    await expenses.remove(ids.expense);
    const path = `/api/expenses/${ids.expense}/restore`;
    await request(app.getHttpServer()).post(path).send({}).expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(403);
    expect((await get('/api/recycle-bin').expect(200)).body.total).toBe(1);
    await post(path).expect(200);
    expect((await get('/api/recycle-bin').expect(200)).body.total).toBe(0);
  });
  it('rejects repayment restoration that would overpay and preserves all history', async () => {
    const debts = new DebtsService(store.prisma());
    const loans = new LoansService(store.prisma(), debts);
    const repayments = new RepaymentsService(store.prisma(), debts);
    const loan = await loans.create({
      id: '00000000-0000-4000-8000-000000000080',
      debtorPersonId: ids.marco,
      creditorPersonId: ids.antonella,
      amount: '20.00',
      incurredOn: '2026-10-30',
    });
    const first = await repayments.create(loan.id, {
      id: '00000000-0000-4000-8000-000000000081',
      amount: '20.00',
      paidOn: '2026-10-31',
    });
    await repayments.remove(first.id);
    await repayments.create(loan.id, {
      id: '00000000-0000-4000-8000-000000000082',
      amount: '20.00',
      paidOn: '2026-10-31',
    });
    await post(`/api/repayments/${first.id}/restore`).expect(409);
    expect(
      (await get('/api/recycle-bin?type=repayment').expect(200)).body.data[0]
        .id,
    ).toBe(first.id);
    expect(store.repayments).toHaveLength(2);
  });
  it('rejects unsupported permanent deletion, even for deleted records with dependents', async () => {
    const expenses = new ExpensesService(store.prisma());
    await expenses.create(exampleExpense());
    store.addRepayment('1.00');
    await expenses.remove(ids.expense);
    for (const path of [
      `/api/recycle-bin/expense/${ids.expense}`,
      `/api/expenses/${ids.expense}/permanent`,
    ]) {
      await request(app.getHttpServer())
        .delete(path)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173')
        .set('X-CSRF-Token', csrf)
        .send({})
        .expect(404);
    }
    expect(store.expenses).toHaveLength(1);
    expect(store.allocations).toHaveLength(2);
    expect(store.repayments).toHaveLength(1);
  });
  it('masks database failures before CSV headers and validates bin pagination/date filters', async () => {
    store.client.expense.findMany.mockRejectedValueOnce(
      databaseFailure('P1001'),
    );
    const response = await get(`/api/exports/expenses.csv${suffix}`).expect(
      503,
    );
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|postgresql|database\.example|driver/i,
    );
    for (const query of [
      'pageSize=101',
      'page=0',
      'type=debt',
      'deletedFrom=2026-02-30',
      'deletedFrom=2026-11-01&deletedTo=2026-10-01',
    ])
      await get(`/api/recycle-bin?${query}`).expect(400);
    await get(`/api/exports/unknown.csv${suffix}`).expect(404);
    // No successful partial file is returned when the configured row bound is exceeded.
    vi.spyOn(app.get(ExportService), 'export').mockRejectedValueOnce(
      new (await import('@nestjs/common')).PayloadTooLargeException(),
    );
    await get(`/api/exports/expenses.csv${suffix}`).expect(413);
  });
});
