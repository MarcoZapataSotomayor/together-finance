import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function adapterWriteConflict(error: unknown): boolean {
  // Prisma 7 adapter-pg can surface commit failures directly instead of P2034.
  // Inspect the specific adapter discriminant; never retry generic driver errors.
  return (
    error instanceof Error &&
    error.name === 'DriverAdapterError' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'kind' in error.cause &&
    error.cause.kind === 'TransactionWriteConflict'
  );
}

export async function financialTransaction<T>(
  prisma: PrismaService,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  retryUniqueConflict = false,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      const retryable =
        adapterWriteConflict(error) ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' ||
            (retryUniqueConflict && error.code === 'P2002')));
      if (!retryable) throw error;
      if (attempt === 2)
        throw new ConflictException(
          'Concurrent financial changes could not be resolved. Retry the request with the same record ID.',
        );
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new ConflictException('Retry the financial operation.');
}
