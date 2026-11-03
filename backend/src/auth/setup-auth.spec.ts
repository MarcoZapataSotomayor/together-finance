import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from './password.js';
import { testPassword } from '../../test/auth-fixture.js';

const script = new URL('../../scripts/setup-auth.mjs', import.meta.url).href;

function removeTestDirectory(directory: string): void {
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('together-auth-setup-')
  )
    throw new Error('Unexpected test directory.');
  rmSync(directory, { recursive: true, force: true });
}

async function runSetup(
  directory: string,
  rotate = false,
): Promise<{ code: number | null; output: string }> {
  // Emulate a hidden-input terminal in an isolated child, never the developer's .env.
  const source = `Object.defineProperty(process.stdin, 'isTTY', {value: true}); process.stdin.setRawMode = () => {}; await import(${JSON.stringify(script)}); process.stdin.destroy();`;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      source,
      ...(rotate ? ['--', '--rotate'] : []),
    ],
    { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let answered = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    if (answered === 0 && output.includes('(12 a 256 caracteres): ')) {
      answered++;
      child.stdin.write(`${testPassword}\r`);
    } else if (answered === 1 && output.includes('Repite la contraseña: ')) {
      answered++;
      child.stdin.write(`${testPassword}\r`);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    return { code, output };
  } finally {
    clearTimeout(timer);
  }
}

describe('interactive auth setup', () => {
  it('writes only hashed auth keys, preserves unrelated configuration, and refuses accidental replacement', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'together-auth-setup-'));
    try {
      const original =
        '# Test-only configuration\r\nDATABASE_URL=synthetic-test-value\r\nSHARED_PASSWORD_HASH=\r\nSESSION_SECRET=\r\n';
      writeFileSync(join(directory, '.env'), original);
      const first = await runSetup(directory);
      expect(first.code).toBe(0);
      expect(first.output.includes(testPassword)).toBe(false);
      const saved = readFileSync(join(directory, '.env'), 'utf8');
      const values = parse(saved);
      expect(
        saved.startsWith(
          '# Test-only configuration\r\nDATABASE_URL=synthetic-test-value\r\n',
        ),
      ).toBe(true);
      expect(
        await verifyPassword(testPassword, values.SHARED_PASSWORD_HASH),
      ).toBe(true);
      expect(Buffer.from(values.SESSION_SECRET, 'base64url').length).toBe(32);
      expect(saved.includes(testPassword)).toBe(false);
      expect(
        first.output.includes(values.SHARED_PASSWORD_HASH) ||
          first.output.includes(values.SESSION_SECRET),
      ).toBe(false);
      expect((await runSetup(directory)).code).toBe(1);
      expect(readFileSync(join(directory, '.env'), 'utf8') === saved).toBe(
        true,
      );
      const rotated = await runSetup(directory, true);
      expect(rotated.code).toBe(0);
      const next = parse(readFileSync(join(directory, '.env'), 'utf8'));
      expect(
        next.SHARED_PASSWORD_HASH !== values.SHARED_PASSWORD_HASH &&
          next.SESSION_SECRET !== values.SESSION_SECRET,
      ).toBe(true);
      expect(next.DATABASE_URL === values.DATABASE_URL).toBe(true);
    } finally {
      removeTestDirectory(directory);
    }
  }, 20000);

  it('does not overwrite earlier auth keys hidden by later empty duplicate entries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'together-auth-setup-'));
    try {
      const original = 'SESSION_SECRET=existing-test-value\nSESSION_SECRET=\n';
      writeFileSync(join(directory, '.env'), original);
      expect((await runSetup(directory)).code).toBe(1);
      expect(readFileSync(join(directory, '.env'), 'utf8') === original).toBe(
        true,
      );
    } finally {
      removeTestDirectory(directory);
    }
  });
});
