import { parsePasswordHash } from './password.js';

export interface AuthConfig {
  SHARED_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: number;
  SESSION_COOKIE_SAME_SITE: 'lax' | 'strict' | 'none';
  TRUST_PROXY_HOPS: number;
}

export function validateAuthConfig(
  input: Record<string, unknown>,
  production: boolean,
): AuthConfig {
  if (input.SHARED_PASSWORD)
    throw new Error(
      'Remove plaintext SHARED_PASSWORD; configure only SHARED_PASSWORD_HASH.',
    );
  parsePasswordHash(input.SHARED_PASSWORD_HASH);
  const secret = input.SESSION_SECRET;
  if (
    typeof secret !== 'string' ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
    Buffer.from(secret, 'base64url').length < 32
  )
    throw new Error(
      'SESSION_SECRET must be an independently generated random secret of at least 32 bytes.',
    );
  const rawTtl = input.SESSION_TTL_SECONDS ?? '28800';
  if (
    typeof rawTtl !== 'string' ||
    !/^\d+$/.test(rawTtl) ||
    Number(rawTtl) < 60 ||
    Number(rawTtl) > 86400
  )
    throw new Error(
      'SESSION_TTL_SECONDS must be an integer between 60 and 86400.',
    );
  const sameSite = input.SESSION_COOKIE_SAME_SITE ?? 'lax';
  if (sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none')
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax, strict, or none.');
  if (sameSite === 'none' && !production)
    throw new Error(
      'Cross-site cookies require production HTTPS and Secure cookies.',
    );
  const rawHops = input.TRUST_PROXY_HOPS ?? '0';
  if (typeof rawHops !== 'string' || !/^[0-2]$/.test(rawHops))
    throw new Error(
      'TRUST_PROXY_HOPS must be 0, 1, or 2; trust only the verified deployment proxy path.',
    );
  return {
    SHARED_PASSWORD_HASH: input.SHARED_PASSWORD_HASH as string,
    SESSION_SECRET: secret,
    SESSION_TTL_SECONDS: Number(rawTtl),
    SESSION_COOKIE_SAME_SITE: sameSite,
    TRUST_PROXY_HOPS: Number(rawHops),
  };
}
