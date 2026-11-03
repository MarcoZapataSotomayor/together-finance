import { describe, expect, it } from 'vitest';
import { directDatabaseUrl, runtimeDatabaseUrl } from './database-urls.js';

const pooled = 'postgresql://endpoint-pooler.example.invalid/finance';
const direct = 'postgresql://endpoint.example.invalid/finance';

describe('database URL configuration', () => {
  it('uses DATABASE_URL at runtime and DIRECT_URL for migrations', () => {
    const input = { DATABASE_URL: pooled, DIRECT_URL: direct };
    expect(runtimeDatabaseUrl(input)).toBe(pooled);
    expect(directDatabaseUrl(input)).toBe(direct);
  });

  it('preserves the existing legacy names without changing the input', () => {
    const input = { DATABASE_URL: direct, DATABASE_URL_POOLED: pooled };
    const before = { ...input };
    expect(runtimeDatabaseUrl(input)).toBe(pooled);
    expect(directDatabaseUrl(input)).toBe(direct);
    expect(input).toEqual(before);
  });

  it('does not require the privileged migration URL at runtime', () => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: pooled })).toBe(pooled);
    expect(() => directDatabaseUrl({ DATABASE_URL: pooled })).toThrow(
      'DIRECT_URL',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'https://database.example.invalid/finance',
  ])('rejects invalid runtime configuration without echoing it', (value) => {
    expect(() => runtimeDatabaseUrl({ DATABASE_URL: value })).toThrow(
      'DATABASE_URL',
    );
  });

  it('rejects unencrypted Neon URLs and pooled migration URLs', () => {
    expect(() =>
      runtimeDatabaseUrl({
        DATABASE_URL: 'postgresql://endpoint-pooler.neon.tech/finance',
      }),
    ).toThrow('TLS');
    expect(() =>
      directDatabaseUrl({
        DIRECT_URL:
          'postgresql://endpoint-pooler.neon.tech/finance?sslmode=require',
      }),
    ).toThrow('direct migration');
  });
});
