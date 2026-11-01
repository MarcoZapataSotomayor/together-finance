import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('authenticated expense and reference API (mocked database)', () => {
  let app: INestApplication<App>;
  let store: FinanceStore;
  let cookie: string;
  let csrfToken: string;
  const origin = 'http://localhost:5173';
  beforeEach(async () => {
    store = new FinanceStore();
    const config = validateEnvironment({
      ...authTestEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://database.example.invalid/finance',
      CORS_ORIGINS: origin,
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
      .set('Origin', origin)
      .set('Cookie', initial)
      .set('X-CSRF-Token', bootstrap.body.csrfToken as string)
      .send({ password: testPassword })
      .expect(200);
    cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
    csrfToken = login.body.csrfToken as string;
  });
  afterEach(async () => {
    await app?.close();
  });

  function api(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    return request(app.getHttpServer())
      [method](`/api${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken);
  }

  it.each([
    ['post', '/expenses'],
    ['get', '/expenses'],
    ['get', `/expenses/${ids.expense}`],
    ['patch', `/expenses/${ids.expense}`],
    ['delete', `/expenses/${ids.expense}`],
    ['post', `/expenses/${ids.expense}/restore`],
    ['post', '/people'],
    ['get', '/people'],
    ['post', '/categories'],
    ['get', '/categories'],
    ['post', '/payment-methods'],
    ['get', '/payment-methods'],
  ] as const)('requires authentication for %s %s', async (method, path) => {
    await request(app.getHttpServer())[method](`/api${path}`).expect(401);
    expect(store.expenses).toHaveLength(0);
  });

  it.each([
    ['post', '/expenses'],
    ['patch', `/expenses/${ids.expense}`],
    ['delete', `/expenses/${ids.expense}`],
    ['post', `/expenses/${ids.expense}/restore`],
    ['post', '/people'],
    ['post', '/categories'],
    ['post', '/payment-methods'],
  ] as const)('requires CSRF on %s %s', async (method, path) => {
    await request(app.getHttpServer())
      [method](`/api${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({})
      .expect(403);
    expect(store.expenses).toHaveLength(0);
  });

  it('persists a shared expense and serializes precise strings, explicit parties and purchase-date debts', async () => {
    const result = await api('post', '/expenses')
      .send(exampleExpense())
      .expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({
      id: ids.expense,
      amount: '100.00',
      currency: 'PEN',
      purchasedOn: '2026-10-30',
    });
    expect(result.body.allocations[0].debt).toMatchObject({
      debtorPersonId: ids.antonella,
      creditorPersonId: ids.marco,
      originalAmount: '50.00',
      incurredOn: '2026-10-30',
    });
    await api('post', '/expenses').send(exampleExpense()).expect(201);
    expect(store.expenses).toHaveLength(1);
    expect(store.debts).toHaveLength(1);
    await api('post', '/expenses')
      .send(exampleExpense({ amount: '120' }))
      .expect(409);
  });

  it.each([
    { amount: 100 },
    { amount: '0' },
    { amount: '0.001' },
    { amount: '1e2' },
    { amount: 'NaN' },
    { amount: '1000000000000' },
    { purchasedOn: '2026-02-30' },
    { purchasedOn: '0000-01-01' },
    { fundedByPersonId: undefined },
    { merchant: '   ' },
    { allocations: [{ personId: ids.antonella, percentage: 100 }] },
    {
      allocations: [
        { personId: ids.antonella, percentage: '100', amount: '100' },
      ],
    },
    {
      allocations: [
        { personId: ids.antonella, percentage: '100' },
        { personId: ids.antonella, percentage: '0' },
      ],
    },
    { pov: 'marco' },
    { currency: 'USD' },
    { id: undefined },
  ])('rejects malformed or ambiguous expense input %j', async (changes) => {
    await api('post', '/expenses')
      .send(Object.assign(exampleExpense(), changes))
      .expect(400);
    expect(store.expenses).toHaveLength(0);
  });

  it('supports partial updates without overwriting omitted fields and rejects explicit nulls', async () => {
    await api('post', '/expenses').send(exampleExpense()).expect(201);
    const metadata = await api('patch', `/expenses/${ids.expense}`)
      .send({ merchant: 'Corrected example', description: 'Example note' })
      .expect(200);
    expect(metadata.body.amount).toBe('100.00');
    expect(metadata.body.merchant).toBe('Corrected example');
    await api('patch', `/expenses/${ids.expense}`)
      .send({ amount: '120', description: null })
      .expect(200);
    expect(store.debts[0].originalAmount.toFixed(2)).toBe('60.00');
    await api('patch', `/expenses/${ids.expense}`)
      .send({ amount: null })
      .expect(400);
    await api('patch', `/expenses/${ids.expense}`)
      .send({ allocations: null })
      .expect(400);
    await api('patch', `/expenses/${ids.expense}`).send({}).expect(400);
    await api('patch', `/expenses/${ids.expense}`)
      .send({ deletedAt: null })
      .expect(400);
  });

  it('protects linked repayments and returns an actionable conflict without partial writes', async () => {
    await api('post', '/expenses').send(exampleExpense()).expect(201);
    store.addRepayment('40');
    await api('patch', `/expenses/${ids.expense}`)
      .send({ amount: '20' })
      .expect(409);
    expect(store.expenses[0].amount.toFixed(2)).toBe('100.00');
    expect(store.repayments).toHaveLength(1);
  });

  it('soft deletes, excludes active balances/listing, retains details and restores the same records', async () => {
    await api('post', '/expenses').send(exampleExpense()).expect(201);
    store.addRepayment('20');
    await api('delete', `/expenses/${ids.expense}`).expect(204);
    expect((await api('get', '/expenses').expect(200)).body.total).toBe(0);
    const deleted = await api('get', `/expenses/${ids.expense}`).expect(200);
    expect(deleted.body.allocations[0].debt.status).toBe('INACTIVE');
    expect(deleted.body.allocations[0].debt.repayments).toHaveLength(1);
    const restored = await api('post', `/expenses/${ids.expense}/restore`)
      .send({})
      .expect(200);
    expect(restored.body.allocations[0].debt.outstandingAmount).toBe('30.00');
    expect(store.debts).toHaveLength(1);
    await api('post', `/expenses/${ids.expense}/restore`)
      .send({ amount: '1' })
      .expect(400);
    await api('delete', `/expenses/${ids.expense}`)
      .send({ amount: '1' })
      .expect(400);
  });

  it('paginates and filters active expenses by explicit financial fields', async () => {
    await api('post', '/expenses').send(exampleExpense()).expect(201);
    const result = await api(
      'get',
      `/expenses?page=1&pageSize=1&purchasedFrom=2026-10-01&purchasedTo=2026-10-31&categoryId=${ids.category}&beneficiaryPersonId=${ids.antonella}&fundedByPersonId=${ids.marco}&classification=SHARED`,
    ).expect(200);
    expect(result.body).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.body.data).toHaveLength(1);
    await api('get', '/expenses?page=0').expect(400);
    await api('get', '/expenses?pageSize=101').expect(400);
    await api(
      'get',
      '/expenses?purchasedFrom=2026-11-01&purchasedTo=2026-10-01',
    ).expect(400);
    await api('get', '/expenses?pov=antonella').expect(400);
    await api('get', '/expenses/not-a-uuid').expect(400);
    await api('get', '/expenses/00000000-0000-4000-8000-000000000099').expect(
      404,
    );
  });

  it('creates and lists people/categories/methods with duplicate and owner validation', async () => {
    const person = await api('post', '/people')
      .send({ name: 'Example relative' })
      .expect(201);
    await api('post', '/people')
      .send({ name: ' example relative ' })
      .expect(409);
    await api('post', '/categories')
      .send({ name: 'Example meals' })
      .expect(201);
    await api('post', '/categories')
      .send({ name: 'EXAMPLE MEALS' })
      .expect(409);
    await api('post', '/payment-methods')
      .send({
        name: 'Example cash',
        type: 'CASH',
        ownerPersonId: person.body.id,
      })
      .expect(201);
    await api('post', '/payment-methods')
      .send({ name: 'example cash', type: 'OTHER' })
      .expect(409);
    await api('post', '/payment-methods')
      .send({
        name: 'Example invalid owner',
        type: 'DEBIT_CARD',
        ownerPersonId: '00000000-0000-4000-8000-000000000099',
      })
      .expect(400);
    await api('post', '/people').send({ name: '   ' }).expect(400);
    await api('post', '/people')
      .send({ name: 'Example', password: 'not-an-account' })
      .expect(400);
    for (const path of ['/people', '/categories', '/payment-methods'])
      expect((await api('get', path).expect(200)).body.data.length > 0).toBe(
        true,
      );
  });

  it('rolls back linked failures and never returns internal database details', async () => {
    store.failDebtWrite = true;
    const failed = await api('post', '/expenses')
      .send(exampleExpense())
      .expect(409);
    expect(JSON.stringify(failed.body).includes('Private database')).toBe(
      false,
    );
    expect(store.expenses).toHaveLength(0);
    expect(store.allocations).toHaveLength(0);
    store.client.expense.findUnique.mockRejectedValueOnce(
      new Error('Private connection details'),
    );
    const unknown = await api('get', `/expenses/${ids.expense}`).expect(500);
    expect(unknown.body.message).toBe('The operation could not be completed.');
    store.client.category.findFirst.mockRejectedValueOnce(
      databaseFailure('P2002'),
    );
    await api('post', '/categories').send({ name: 'Example race' }).expect(409);
  });
});
