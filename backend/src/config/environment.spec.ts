import { describe, expect, it } from 'vitest';
import { validateEnvironment as validateConfig } from './environment.js';

const testDatabaseUrl = 'postgresql://database.example.invalid/finance';
const validateEnvironment = (input: Record<string, unknown>) =>
  validateConfig({ DATABASE_URL: testDatabaseUrl, ...input });

describe('environment configuration', () => {
  it('defaults to port 3000 and exact local frontend origins', () => {
    expect(validateEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: testDatabaseUrl,
      CORS_ORIGINS: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    });
  });

  it('accepts a custom port and trims, normalizes, and deduplicates origins', () => {
    expect(
      validateEnvironment({
        PORT: '4100',
        CORS_ORIGINS:
          ' https://frontend.example/ ,http://localhost:5173,https://frontend.example',
      }),
    ).toMatchObject({
      PORT: 4100,
      CORS_ORIGINS: ['https://frontend.example', 'http://localhost:5173'],
    });
  });

  it.each(['0', '65536', '-1', '3000.5', '3000abc', '', {}, true])(
    'rejects invalid port %j',
    (port) => {
      expect(() => validateEnvironment({ PORT: port })).toThrow('PORT');
    },
  );

  it('requires explicit allowed origins in production', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'CORS_ORIGINS',
    );
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://frontend.example',
      }).CORS_ORIGINS,
    ).toEqual(['https://frontend.example']);
  });

  it.each([
    '*',
    'https://*.vercel.app',
    'null',
    '',
    'not-a-url',
    'ftp://frontend.example',
    'https://user:password@frontend.example',
    'https://frontend.example/path',
    'https://frontend.example?query=1',
    'https://frontend.example#fragment',
    'http://localhost:5173,',
  ])('rejects unsafe or malformed origins %j', (origins) => {
    expect(() => validateEnvironment({ CORS_ORIGINS: origins })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('rejects unsupported runtime modes', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'invalid' })).toThrow(
      'NODE_ENV',
    );
  });
});
