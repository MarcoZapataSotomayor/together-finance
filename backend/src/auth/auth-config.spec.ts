import { describe, expect, it } from 'vitest';
import { validateAuthConfig } from './auth-config.js';
import {
  createPasswordHash,
  parsePasswordHash,
  verifyPassword,
} from './password.js';
import { authTestEnvironment, testPassword } from '../../test/auth-fixture.js';

describe('shared-password configuration', () => {
  it('requires a generated hash and independent signing secret', () => {
    expect(() => validateAuthConfig({}, false)).toThrow('SHARED_PASSWORD_HASH');
    expect(() =>
      validateAuthConfig(
        { ...authTestEnvironment, SESSION_SECRET: 'short' },
        false,
      ),
    ).toThrow('SESSION_SECRET');
    expect(() =>
      validateAuthConfig(
        { ...authTestEnvironment, SHARED_PASSWORD: 'not-permitted' },
        false,
      ),
    ).toThrow('plaintext');
  });

  it('rejects unsupported hash parameters and expiration policies', () => {
    expect(() =>
      parsePasswordHash(
        authTestEnvironment.SHARED_PASSWORD_HASH.replace('131072', '1024'),
      ),
    ).toThrow();
    for (const ttl of ['0', '59', '86401', 'not-a-number'])
      expect(() =>
        validateAuthConfig(
          { ...authTestEnvironment, SESSION_TTL_SECONDS: ttl },
          false,
        ),
      ).toThrow('SESSION_TTL_SECONDS');
    expect(() =>
      validateAuthConfig(
        { ...authTestEnvironment, TRUST_PROXY_HOPS: 'true' },
        false,
      ),
    ).toThrow('TRUST_PROXY_HOPS');
  });

  it('requires HTTPS production configuration for SameSite=None', () => {
    expect(() =>
      validateAuthConfig(
        { ...authTestEnvironment, SESSION_COOKIE_SAME_SITE: 'none' },
        false,
      ),
    ).toThrow('HTTPS');
    expect(
      validateAuthConfig(
        { ...authTestEnvironment, SESSION_COOKIE_SAME_SITE: 'none' },
        true,
      ).SESSION_COOKIE_SAME_SITE,
    ).toBe('none');
  });

  it('verifies a strong salted scrypt hash and rejects incorrect passwords', async () => {
    expect(
      await verifyPassword(
        testPassword,
        authTestEnvironment.SHARED_PASSWORD_HASH,
      ),
    ).toBe(true);
    expect(
      await verifyPassword(
        'incorrect-test-value',
        authTestEnvironment.SHARED_PASSWORD_HASH,
      ),
    ).toBe(false);
    const fresh = await createPasswordHash(testPassword);
    expect(fresh !== authTestEnvironment.SHARED_PASSWORD_HASH).toBe(true);
    expect(await verifyPassword(testPassword, fresh)).toBe(true);
  });
});
