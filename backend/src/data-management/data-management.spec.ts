import { afterEach, describe, expect, it, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { CsvFile, csvCell, csvRow, exportLimits } from './csv.js';
import { ExportService } from './export.service.js';
import { RecycleBinService } from './recycle-bin.service.js';
import {
  ExportQueryDto,
  exportPeriod,
  RecycleBinQueryDto,
} from './data-management.dto.js';
import type { Dataset } from './data-management.dto.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { LoansService } from '../loans/loans.service.js';
import { DebtsService } from '../debts/debts.service.js';
import { DataManagementStore } from '../../test/data-management-store.js';
import {
  exampleExpense,
  ids,
  databaseFailure,
} from '../../test/finance-store.js';

const query = (extra: Partial<ExportQueryDto> = {}) =>
  Object.assign(new ExportQueryDto(), {
    from: '2026-10-01',
    to: '2026-10-31',
    ...extra,
  });
async function download(
  service: ExportService,
  dataset: Dataset,
  filters = query(),
) {
  const result = await service.export(dataset, filters);
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  return {
    ...result,
    bytes: Buffer.concat(chunks),
    text: Buffer.concat(chunks).toString('utf8'),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('bounded spreadsheet-safe CSV', () => {
  it('quotes every field, preserves commas/quotes/newlines and uses CRLF', () => {
    expect(csvRow(['A,B', 'a"b', 'a\nb', '', null])).toBe(
      '"A,B","a""b","a\nb","",""\r\n',
    );
    expect(csvCell('0.01')).toBe('"0.01"');
    expect(csvCell('999999999999.99')).toBe('"999999999999.99"');
  });
  it.each([
    '=SUM(A1)',
    '+cmd',
    '-1+2',
    '@sum()',
    '\tvalue',
    '\r=1',
    '\n=1',
    ' \ufeff\u200b=1',
    '\u0000=1',
    '＝1',
    '＋1',
    '  @cmd',
  ])('neutralizes formula entry %j', (value) => {
    expect(csvCell(value).startsWith('"\t')).toBe(true);
  });
  it('cleans up private files and enforces byte and row limits', async () => {
    const file = await CsvFile.create();
    try {
      await file.reset(['ID']);
      for (let i = 0; i < exportLimits.rows; i++) await file.row(['x']);
      await expect(file.row(['too many'])).rejects.toMatchObject({
        status: 413,
      });
      await file.reset(['ID']);
      await expect(
        file.row(['x'.repeat(exportLimits.bytes)]),
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      await file.dispose();
    }
    await expect(access(file.path)).rejects.toThrow();
  });
  it('validates ordered real dates and a bounded calendar range', () => {
    expect(() => exportPeriod(query({ from: '2026-02-30' }))).toThrow();
    expect(() => exportPeriod(query({ from: '2026-11-01' }))).toThrow();
    expect(() => exportPeriod(query({ from: '2024-10-01' }))).toThrow();
    expect(
      exportPeriod(query({ from: '2024-11-01' })).gte.toISOString(),
    ).toContain('2024-11-01');
  });
});

describe('financial exports and central recycle bin', () => {
  async function fixture() {
    const store = new DataManagementStore();
    await new ExpensesService(store.prisma()).create(
      exampleExpense({ amount: '100.01' }),
    );
    const loan = await new LoansService(
      store.prisma(),
      new DebtsService(store.prisma()),
    ).create({
      id: '00000000-0000-4000-8000-000000000070',
      amount: '0.03',
      debtorPersonId: ids.marco,
      creditorPersonId: ids.antonella,
      incurredOn: '2026-10-31',
      description: 'Independent example',
    });
    return {
      store,
      loan,
      service: new ExportService(store.prisma()),
      bin: new RecycleBinService(store.prisma()),
    };
  }
  it('exports one parent expense, exact separate allocations, distinct debt/loan/payment datasets and BOM', async () => {
    const { store, service } = await fixture();
    store.addRepayment('0.01');
    const expense = await download(service, 'expenses');
    expect([...expense.bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(expense.text).toContain('"100.01","PEN"');
    expect(expense.text.split('\r\n').length).toBe(3);
    expect(expense.text).not.toContain('Independent example');
    const allocations = await download(service, 'allocations');
    expect(allocations.text).toContain('"50.01"');
    expect(allocations.text).toContain('"50.00"');
    expect(allocations.text).not.toContain('"100.01"');
    expect((await download(service, 'debts')).text).toContain('"Consumo"');
    const loans = await download(service, 'loans');
    expect(loans.text).toContain('"0.03"');
    expect(loans.text).not.toContain('"Consumo"');
    expect((await download(service, 'repayments')).text).toContain('"0.01"');
    expect(expense.filename).toBe(
      'together-finance-consumos-activos-2026-10-01-a-2026-10-31.csv',
    );
  });
  it('filters original transaction dates and explicit financial participants, including inactive people', async () => {
    const { service, store } = await fixture();
    store.people[0].isActive = false;
    expect(
      (await download(service, 'expenses', query({ personId: ids.antonella })))
        .text,
    ).toContain('100.01');
    expect(
      (await download(service, 'expenses', query({ personId: ids.marco })))
        .text,
    ).toContain('100.01');
    expect(
      (
        await download(service, 'expenses', query({ personId: ids.thirdParty }))
      ).text.split('\r\n').length,
    ).toBe(2);
    expect(
      (
        await download(
          service,
          'allocations',
          query({ personId: ids.antonella }),
        )
      ).text,
    ).not.toContain('"50.00"');
    expect(
      (
        await download(
          service,
          'loans',
          query({ from: '2026-10-01', to: '2026-10-30' }),
        )
      ).text.split('\r\n').length,
    ).toBe(2);
    store.addRepayment('0.01');
    for (const dataset of ['debts', 'loans', 'repayments'] as const) {
      for (const personId of [ids.antonella, ids.marco])
        expect(
          (await download(service, dataset, query({ personId }))).text.split(
            '\r\n',
          ).length,
        ).toBeGreaterThan(2);
      expect(
        (
          await download(service, dataset, query({ personId: ids.thirdParty }))
        ).text.split('\r\n').length,
      ).toBe(2);
    }
    expect(
      (
        await download(service, 'repayments', query({ to: '2026-10-30' }))
      ).text.split('\r\n').length,
    ).toBe(2);
  });
  it('distinguishes own deletion from inherited inactivity in exports and the bin', async () => {
    const { store, service, bin } = await fixture();
    const payment = store.addRepayment('1.00');
    await new ExpensesService(store.prisma()).remove(ids.expense);
    for (const type of ['expenses', 'allocations', 'repayments'] as const) {
      expect((await download(service, type)).text.split('\r\n').length).toBe(2);
      expect(
        (await download(service, type, query({ scope: 'deleted' }))).text,
      ).toContain('Eliminado');
      expect(
        (await download(service, type, query({ scope: 'all' }))).text,
      ).toContain('Eliminado');
    }
    const result = await bin.list(new RecycleBinQueryDto());
    expect(result.data.map((r) => r.kind)).toEqual(['expense']);
    payment.deletedAt = new Date();
    const updated = await bin.list(new RecycleBinQueryDto());
    expect(updated.data.find((r) => r.kind === 'repayment')).toMatchObject({
      canRestore: false,
      parent: { kind: 'expense', id: ids.expense, active: false },
    });
  });
  it('uses bounded keyset pages and resets the file on a serializable retry', async () => {
    const { store, service } = await fixture();
    const original = store.expenses[0];
    for (let i = 1; i <= 105; i++)
      store.expenses.push({
        ...original,
        id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`,
      });
    store.conflictBeforeCommit = 1;
    const result = await download(service, 'expenses');
    expect(result.text.split('\r\n').length).toBe(108);
    expect(result.text.split('\ufeff').length).toBe(2);
    expect(
      store.client.expense.findMany.mock.calls.every(
        ([args]) => args.take === 100,
      ),
    ).toBe(true);
    expect(store.transactionOptions.at(-1)).toMatchObject({
      isolationLevel: 'Serializable',
    });
    store.client.expense.findMany.mockRejectedValueOnce(
      databaseFailure('P1001'),
    );
    await expect(service.export('expenses', query())).rejects.toMatchObject({
      code: 'P1001',
    });
  });
  it('paginates all record types together and parameterizes deletion-date/type filters', async () => {
    const { store, bin, loan } = await fixture();
    const moment = new Date('2026-11-01T00:00:00Z');
    store.expenses[0].deletedAt = moment;
    store.debts.find((d) => d.id === loan.id)!.deletedAt = moment;
    store.addRepayment('1.00', moment);
    const page1 = await bin.list(
      Object.assign(new RecycleBinQueryDto(), { pageSize: 2 }),
    );
    const page2 = await bin.list(
      Object.assign(new RecycleBinQueryDto(), { pageSize: 2, page: 2 }),
    );
    expect(page1.total).toBe(3);
    expect(new Set([...page1.data, ...page2.data].map((r) => r.id)).size).toBe(
      3,
    );
    const result = await bin.list(
      Object.assign(new RecycleBinQueryDto(), {
        type: 'loan',
        deletedFrom: '2026-11-01',
        deletedTo: '2026-11-01',
      }),
    );
    expect(result.data.map((r) => r.id)).toEqual([loan.id]);
    expect(
      (
        await bin.list(
          Object.assign(new RecycleBinQueryDto(), { deletedTo: '2026-10-31' }),
        )
      ).total,
    ).toBe(0);
    expect(() =>
      bin.list(
        Object.assign(new RecycleBinQueryDto(), {
          deletedFrom: '2026-11-02',
          deletedTo: '2026-11-01',
        }),
      ),
    ).toThrow('Deletion dates must be ordered.');
  });
});
