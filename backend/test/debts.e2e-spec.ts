import { randomUUID } from 'node:crypto';
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

const loanId = '00000000-0000-4000-8000-000000000040';
const repaymentId = '00000000-0000-4000-8000-000000000050';
const loan = (overrides = {}) => ({
  id: loanId,
  debtorPersonId: ids.antonella,
  creditorPersonId: ids.marco,
  amount: '100.00',
  incurredOn: '2026-10-30',
  ...overrides,
});
const payment = (overrides = {}) => ({
  id: repaymentId,
  amount: '30.00',
  paidOn: '2026-10-31',
  ...overrides,
});
const privateRoutes = [
  ['get', '/debts'],
  ['get', '/debts/summary'],
  ['get', `/debts/${loanId}`],
  ['post', '/loans'],
  ['get', '/loans'],
  ['get', `/loans/${loanId}`],
  ['patch', `/loans/${loanId}`],
  ['delete', `/loans/${loanId}`],
  ['post', `/loans/${loanId}/restore`],
  ['post', `/debts/${loanId}/repayments`],
  ['get', `/debts/${loanId}/repayments`],
  ['get', `/repayments/${repaymentId}`],
  ['delete', `/repayments/${repaymentId}`],
  ['post', `/repayments/${repaymentId}/restore`],
] as const;

describe('protected debts, loans and repayments API (mocked database)', () => {
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
    const anonymous = (
      bootstrap.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous)
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
  async function createLoan() {
    await api('post', '/loans').send(loan()).expect(201);
  }

  it.each(privateRoutes)(
    'requires authentication on %s %s',
    async (method, path) => {
      await request(app.getHttpServer())[method](`/api${path}`).expect(401);
      expect(store.debts).toHaveLength(0);
      expect(store.repayments).toHaveLength(0);
    },
  );

  it.each(privateRoutes.filter(([method]) => method !== 'get'))(
    'requires CSRF on %s %s',
    async (method, path) => {
      await request(app.getHttpServer())
        [method](`/api${path}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({})
        .expect(403);
      expect(store.debts).toHaveLength(0);
    },
  );

  it('rejects forged CSRF and untrusted origins on new financial routes', async () => {
    await request(app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', 'forged')
      .send(loan())
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .set('X-CSRF-Token', csrfToken)
      .send(loan())
      .expect(403);
    expect(store.debts).toHaveLength(0);
  });

  it('creates, reads, edits and replays loans with precise amounts and no expense rows', async () => {
    const created = await api('post', '/loans')
      .send(loan({ dueOn: '2026-11-30', description: ' Example ' }))
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).toMatchObject({
      id: loanId,
      origin: 'LOAN',
      originalAmount: '100.00',
      outstandingAmount: '100.00',
      incurredOn: '2026-10-30',
      dueOn: '2026-11-30',
      source: null,
      description: 'Example',
    });
    await api('post', '/loans')
      .send(loan({ dueOn: '2026-11-30', description: 'Example' }))
      .expect(201);
    await api('post', '/loans')
      .send(loan({ amount: '101' }))
      .expect(409);
    await api('get', `/loans/${loanId}`).expect(200);
    const edited = await api('patch', `/loans/${loanId}`)
      .send({ amount: '120', dueOn: null })
      .expect(200);
    expect(edited.body.originalAmount).toBe('120.00');
    expect(edited.body.dueOn).toBeNull();
    expect(store.debts).toHaveLength(1);
    expect(store.expenses).toHaveLength(0);
    expect(store.allocations).toHaveLength(0);
  });

  it.each([
    { id: undefined },
    { amount: 100 },
    { amount: '0' },
    { amount: '-1' },
    { amount: '0.001' },
    { amount: '1e2' },
    { amount: '1000000000000' },
    { incurredOn: '2026-02-30' },
    { incurredOn: '0000-01-01' },
    { dueOn: '2026-10-29' },
    { debtorPersonId: ids.marco },
    { creditorPersonId: null },
    { creditorPersonId: 'not-a-uuid' },
    { creditorPersonId: randomUUID() },
    { pov: 'antonella' },
    { currency: 'USD' },
    { origin: 'EXPENSE' },
    { expenseAllocationId: ids.expense },
    { description: 'x'.repeat(2001) },
  ])('rejects invalid or forbidden loan data %#', async (changes) => {
    await api('post', '/loans').send(loan(changes)).expect(400);
    expect(store.debts).toHaveLength(0);
  });

  it('validates PATCH nullability, required changes, due dates and inactive references', async () => {
    await createLoan();
    for (const body of [
      {},
      { amount: null },
      { debtorPersonId: null },
      { incurredOn: null },
      { id: randomUUID() },
      { dueOn: '2026-02-30' },
      { dueOn: '2026-10-29' },
    ]) {
      await api('patch', `/loans/${loanId}`).send(body).expect(400);
    }
    store.people[0].isActive = false;
    await api('post', '/loans')
      .send(loan({ id: randomUUID() }))
      .expect(400);
  });

  it('repays partially and fully, replays the UUID and rejects overpayment', async () => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(201);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ amount: '30' }))
      .expect(201);
    const partial = await api('get', `/debts/${loanId}`).expect(200);
    expect(partial.body).toMatchObject({
      repaidAmount: '30.00',
      outstandingAmount: '70.00',
      status: 'PARTIALLY_REPAID',
    });
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ id: randomUUID(), amount: '70.01' }))
      .expect(409);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ id: randomUUID(), amount: '70' }))
      .expect(201);
    expect((await api('get', `/loans/${loanId}`).expect(200)).body.status).toBe(
      'PAID',
    );
    expect(store.repayments).toHaveLength(2);
    expect(store.expenses).toHaveLength(0);
    const detail = await api('get', `/repayments/${repaymentId}`).expect(200);
    expect(detail.body).toMatchObject({
      amount: '30.00',
      active: true,
      debt: { status: 'PAID' },
    });
  });

  it.each([
    { id: undefined },
    { amount: 1 },
    { amount: '0' },
    { amount: '-1' },
    { amount: '0.001' },
    { amount: '1e2' },
    { paidOn: '2026-02-30' },
    { paidOn: '2026-10-29' },
    { debtId: loanId },
    { debtorPersonId: ids.antonella },
    { currency: 'PEN' },
    { pov: 'shared' },
    { description: 'x'.repeat(2001) },
  ])('rejects invalid repayment input %#', async (changes) => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment(changes))
      .expect(400);
    expect(store.repayments).toHaveLength(0);
  });

  it('blocks changed and cross-debt repayment UUID replays', async () => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(201);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ amount: '31' }))
      .expect(409);
    const other = randomUUID();
    await api('post', '/loans')
      .send(loan({ id: other }))
      .expect(201);
    await api('post', `/debts/${other}/repayments`).send(payment()).expect(409);
    expect(store.repayments).toHaveLength(1);
  });

  it('deletes/restores repayments, revalidates overpayment and lists historical activity', async () => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ amount: '60' }))
      .expect(201);
    await api('delete', `/repayments/${repaymentId}`).send({}).expect(204);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ amount: '60' }))
      .expect(409);
    const other = randomUUID();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ id: other, amount: '50' }))
      .expect(201);
    await api('post', `/repayments/${repaymentId}/restore`)
      .send({})
      .expect(409);
    await api('delete', `/repayments/${other}`).send({}).expect(204);
    await api('post', `/repayments/${repaymentId}/restore`)
      .send({})
      .expect(200);
    const list = await api(
      'get',
      `/debts/${loanId}/repayments?deletionState=all&pageSize=1`,
    ).expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.data).toHaveLength(1);
    expect(
      (
        await api(
          'get',
          `/debts/${loanId}/repayments?deletionState=deleted`,
        ).expect(200)
      ).body.total,
    ).toBe(1);
    expect(
      (await api('get', `/debts/${loanId}`).expect(200)).body.outstandingAmount,
    ).toBe('40.00');
  });

  it('freezes loan terms with any repayment history, including deleted rows', async () => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(201);
    for (const change of [
      { amount: '101' },
      { debtorPersonId: ids.thirdParty },
      { creditorPersonId: ids.thirdParty },
      { incurredOn: '2026-10-29' },
    ]) {
      await api('patch', `/loans/${loanId}`).send(change).expect(409);
    }
    await api('patch', `/loans/${loanId}`)
      .send({ dueOn: '2026-11-30', description: 'Metadata' })
      .expect(200);
    await api('delete', `/repayments/${repaymentId}`).send({}).expect(204);
    await api('patch', `/loans/${loanId}`).send({ amount: '99' }).expect(409);
  });

  it('soft deletes/restores loans and blocks repayments while deleted', async () => {
    await createLoan();
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(201);
    await api('delete', `/loans/${loanId}`).send({}).expect(204);
    expect((await api('get', '/loans').expect(200)).body.total).toBe(0);
    expect(
      (await api('get', '/loans?deletionState=deleted').expect(200)).body
        .data[0].status,
    ).toBe('INACTIVE');
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment({ id: randomUUID() }))
      .expect(409);
    await api('post', `/repayments/${repaymentId}/restore`)
      .send({})
      .expect(409);
    await api('patch', `/loans/${loanId}`)
      .send({ description: 'No' })
      .expect(409);
    const restored = await api('post', `/loans/${loanId}/restore`)
      .send({})
      .expect(200);
    expect(restored.body).toMatchObject({
      repaidAmount: '30.00',
      outstandingAmount: '70.00',
    });
    expect(store.repayments[0].deletedAt).toBeNull();
  });

  it('repays expense debt and preserves source deletion/restoration behavior', async () => {
    const expense = await api('post', '/expenses')
      .send(exampleExpense())
      .expect(201);
    const debtId = expense.body.allocations[0].debt.id as string;
    const detail = await api('get', `/debts/${debtId}`).expect(200);
    expect(detail.body.source).toMatchObject({
      expenseId: ids.expense,
      merchant: 'Example shop',
    });
    await api('post', `/debts/${debtId}/repayments`)
      .send(payment())
      .expect(201);
    await api('patch', `/expenses/${ids.expense}`)
      .send({ amount: '120' })
      .expect(409);
    await api('delete', `/expenses/${ids.expense}`).send({}).expect(204);
    expect((await api('get', '/debts').expect(200)).body.total).toBe(0);
    expect(
      (await api('get', '/debts?deletionState=deleted').expect(200)).body.total,
    ).toBe(1);
    await api('post', `/debts/${debtId}/repayments`)
      .send(payment({ id: randomUUID() }))
      .expect(409);
    await api('post', `/expenses/${ids.expense}/restore`).send({}).expect(200);
    expect(
      (await api('get', `/debts/${debtId}`).expect(200)).body.outstandingAmount,
    ).toBe('20.00');
    await api('get', `/loans/${debtId}`).expect(404);
    await api('delete', `/loans/${debtId}`).send({}).expect(404);
  });

  it('combines filters, paginates, resolves summary before UUID routes and never nets obligations', async () => {
    await createLoan();
    const other = randomUUID();
    await api('post', '/loans')
      .send(
        loan({
          id: other,
          debtorPersonId: ids.marco,
          creditorPersonId: ids.antonella,
          amount: '30',
        }),
      )
      .expect(201);
    const page = await api(
      'get',
      `/debts?debtorPersonId=${ids.antonella}&creditorPersonId=${ids.marco}&origin=LOAN&status=pending&incurredFrom=2026-10-30&incurredTo=2026-10-30&pageSize=1`,
    ).expect(200);
    expect(page.body).toMatchObject({ total: 1, pageSize: 1 });
    expect(page.body.data[0].id).toBe(loanId);
    const summary = await api('get', '/debts/summary').expect(200);
    expect(summary.body.totals).toMatchObject({
      outstandingAmount: '130.00',
      activeCount: 2,
      settledCount: 0,
    });
    expect(
      summary.body.byPerson.find((row: any) => row.person.id === ids.antonella),
    ).toMatchObject({
      owed: { outstandingAmount: '100.00' },
      receivable: { outstandingAmount: '30.00' },
    });
    await api('post', `/debts/${other}/repayments`).send(payment()).expect(201);
    expect(
      (await api('get', '/debts?status=settled').expect(200)).body.total,
    ).toBe(1);
    expect(
      (await api('get', '/debts/summary?status=settled').expect(200)).body
        .totals.settledCount,
    ).toBe(1);
  });

  it.each([
    '/debts?status=OPEN',
    '/debts?deletionState=all',
    '/debts?page=0',
    '/debts?pageSize=101',
    '/debts?incurredFrom=2026-02-30',
    '/debts?incurredFrom=2026-11-01&incurredTo=2026-10-01',
    '/debts?debtorPersonId=wrong',
    '/debts?origin=OTHER',
    '/debts?pov=marco',
    '/debts/summary?page=1',
    '/loans?origin=EXPENSE',
    '/debts/not-a-uuid',
  ])('rejects unsupported filters and malformed IDs: %s', async (path) => {
    await api('get', path).expect(400);
  });

  it('returns safe not-found responses and rejects extra fields on delete/restore', async () => {
    await api('get', `/debts/${loanId}`).expect(404);
    await api('get', `/loans/${loanId}`).expect(404);
    await api('get', `/repayments/${repaymentId}`).expect(404);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(404);
    await createLoan();
    await api('delete', `/loans/${loanId}`).send({ amount: '1' }).expect(400);
    await api('post', `/loans/${loanId}/restore`)
      .send({ deletedAt: null })
      .expect(400);
    await api('post', `/debts/${loanId}/repayments`)
      .send(payment())
      .expect(201);
    await api('delete', `/repayments/${repaymentId}`)
      .send({ amount: '1' })
      .expect(400);
    await api('post', `/repayments/${repaymentId}/restore`)
      .send({ amount: '1' })
      .expect(400);
  });

  it('bounds serialization retries and never returns internal database messages', async () => {
    store.conflictBeforeCommit = 3;
    const conflict = await api('post', '/loans').send(loan()).expect(409);
    expect(JSON.stringify(conflict.body)).not.toContain('Private database');
    expect(store.debts).toHaveLength(0);
    store.client.debt.findUnique.mockRejectedValueOnce(
      databaseFailure('P1001'),
    );
    const unavailable = await api('get', `/debts/${loanId}`).expect(503);
    expect(JSON.stringify(unavailable.body)).not.toContain('Private database');
  });
});
