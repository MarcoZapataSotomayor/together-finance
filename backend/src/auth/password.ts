import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const hashPattern =
  /^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;

export function parsePasswordHash(value: unknown): {
  salt: Buffer;
  digest: Buffer;
} {
  const match = typeof value === 'string' ? hashPattern.exec(value) : null;
  if (!match)
    throw new Error(
      'SHARED_PASSWORD_HASH must be generated with the auth setup command.',
    );
  const salt = Buffer.from(match[1], 'base64url');
  const digest = Buffer.from(match[2], 'base64url');
  if (
    salt.length !== 16 ||
    digest.length !== 64 ||
    salt.toString('base64url') !== match[1] ||
    digest.toString('base64url') !== match[2]
  ) {
    throw new Error('SHARED_PASSWORD_HASH has an invalid encoding.');
  }
  return { salt, digest };
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function createPasswordHash(password: string): Promise<string> {
  if (
    password.length < 12 ||
    password.length > 256 ||
    Buffer.byteLength(password) > 1024
  )
    throw new Error('Use a password of 12 to 256 characters.');
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (
    !password.length ||
    password.length > 256 ||
    Buffer.byteLength(password) > 1024
  )
    return false;
  const { salt, digest } = parsePasswordHash(hash);
  return timingSafeEqual(await derive(password, salt), digest);
}
