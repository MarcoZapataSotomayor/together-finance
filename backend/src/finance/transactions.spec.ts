import { describe, expect, it, vi } from 'vitest';
import { financialTransaction } from './transactions.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function adapterError(kind: string) {
  const error = new Error('Private driver details', { cause: { kind } });
  error.name = 'DriverAdapterError';
  return error;
}
describe('bounded adapter commit retry', () => {
  it('retries the entire transaction after a commit-time serialization conflict', async () => {
    const work = vi.fn(async () => 'committed');
    const $transaction = vi
      .fn()
      .mockImplementationOnce(async () => {
        await work();
        throw adapterError('TransactionWriteConflict');
      })
      .mockImplementation(async () => work());
    expect(
      await financialTransaction(
        { $transaction } as unknown as PrismaService,
        work,
      ),
    ).toBe('committed');
    expect(work).toHaveBeenCalledTimes(2);
    expect(
      $transaction.mock.calls.every(
        ([, options]) => options.isolationLevel === 'Serializable',
      ),
    ).toBe(true);
  });
  it('returns safe 409 after exactly three adapter conflicts', async () => {
    const $transaction = vi
      .fn()
      .mockRejectedValue(adapterError('TransactionWriteConflict'));
    await expect(
      financialTransaction(
        { $transaction } as unknown as PrismaService,
        async () => undefined,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect($transaction).toHaveBeenCalledTimes(3);
  });
  it.each(['ConnectionClosed', 'AuthenticationFailed', 'GenericJs'])(
    'does not retry ambiguous driver failure %s',
    async (kind) => {
      const $transaction = vi.fn().mockRejectedValue(adapterError(kind));
      await expect(
        financialTransaction(
          { $transaction } as unknown as PrismaService,
          async () => undefined,
        ),
      ).rejects.toMatchObject({ cause: { kind } });
      expect($transaction).toHaveBeenCalledTimes(1);
    },
  );
});
