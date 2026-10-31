import { runtimeDatabaseUrl } from './database-urls.js';
import { validateAuthConfig } from '../auth/auth-config.js';
import type { AuthConfig } from '../auth/auth-config.js';

export interface EnvironmentConfig extends AuthConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
}

const localOrigins = 'http://localhost:5173,http://127.0.0.1:5173';

export function validateEnvironment(
  input: Record<string, unknown>,
): EnvironmentConfig {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const rawPort = input.PORT ?? '3000';
  if (typeof rawPort !== 'string') {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort.trim()) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const rawOrigins =
    input.CORS_ORIGINS ?? (nodeEnv === 'production' ? '' : localOrigins);
  if (typeof rawOrigins !== 'string' || !rawOrigins.trim()) {
    throw new Error(
      'CORS_ORIGINS must specify at least one allowed frontend origin.',
    );
  }

  const origins = rawOrigins.split(',').map((value) => {
    const origin = value.trim();
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        origin.includes('*')
      ) {
        throw new Error('Invalid origin');
      }
      if (nodeEnv === 'production' && url.protocol !== 'https:')
        throw new Error('HTTPS required');
      return url.origin;
    } catch {
      throw new Error(
        'CORS_ORIGINS must contain only HTTP(S) origins without wildcards, credentials, paths, queries, or fragments.',
      );
    }
  });

  return {
    ...validateAuthConfig(input, nodeEnv === 'production'),
    NODE_ENV: nodeEnv,
    PORT: port,
    CORS_ORIGINS: [...new Set(origins)],
    DATABASE_URL: runtimeDatabaseUrl(input),
  };
}
