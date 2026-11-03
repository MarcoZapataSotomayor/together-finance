import { scryptSync } from 'node:crypto';

// Deliberately synthetic fixtures, never application credentials.
export const testPassword = 'test-only-shared-password';
const salt = Buffer.alloc(16, 3);
const digest = scryptSync(testPassword, salt, 64, {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 192 * 1024 * 1024,
});
export const authTestEnvironment = {
  SHARED_PASSWORD_HASH: `scrypt$131072$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`,
  SESSION_SECRET: Buffer.alloc(32, 5).toString('base64url'),
};
