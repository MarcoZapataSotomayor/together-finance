import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDisposableDatabase } from './database-safety.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, env = process.env, inherited = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: inherited ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.resume();
    child.once('error', () =>
      reject(new Error('A required local tool could not start.')),
    );
    child.once('close', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              'An isolated PostgreSQL check failed. Tool output omitted to protect configuration.',
            ),
          ),
    );
  });
}
const runId = randomBytes(16).toString('hex');
let container;
try {
  let admin = process.env.TEST_POSTGRES_ADMIN_URL;
  if (!admin) {
    container = `together-finance-test-${runId}`;
    const password = randomBytes(32).toString('hex');
    await run(
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        container,
        '--label',
        `together-finance.disposable=${runId}`,
        '--publish',
        '127.0.0.1::5432',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m',
        '--env',
        'POSTGRES_USER=together_test',
        '--env',
        'POSTGRES_PASSWORD',
        'postgres:17@sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1',
      ],
      { ...process.env, POSTGRES_PASSWORD: password },
    );
    const port = await run('docker', ['port', container, '5432/tcp']);
    if (!/^127\.0\.0\.1:\d+$/.test(port))
      throw new Error('Docker must publish PostgreSQL on loopback only.');
    admin = `postgresql://together_test:${password}@${port}/postgres`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await run('docker', [
          'exec',
          container,
          'pg_isready',
          '-U',
          'together_test',
          '-d',
          'postgres',
        ]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
  }
  const confirmed = container ? '1' : process.env.TF_DISPOSABLE_POSTGRES;
  const url = await createDisposableDatabase(admin, confirmed, runId);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    DIRECT_URL: url,
    DATABASE_URL_POOLED: '',
    TEST_DATABASE_URL: url,
    TEST_POSTGRES_ADMIN_URL: admin,
    TF_DISPOSABLE_POSTGRES: '1',
    TF_TEST_RUN_ID: runId,
    MIGRATION_TARGET: 'disposable-test',
    ...(container ? { PG_TOOLS_CONTAINER: container } : {}),
  };
  console.log(
    'Applying reviewed migrations to a newly generated disposable database.',
  );
  await run(
    process.execPath,
    ['scripts/safe-prisma.mjs', 'migrate', 'deploy'],
    env,
    true,
  );
  await run(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.config.postgres.ts',
    ],
    env,
    true,
  );
  console.log(
    'Genuine PostgreSQL financial and isolated restore checks passed.',
  );
} catch {
  console.error(
    'PostgreSQL checks failed or were unavailable. No Neon target is accepted; configuration and raw tool errors are omitted.',
  );
  process.exitCode = 1;
} finally {
  if (container) {
    try {
      const label = await run('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "together-finance.disposable"}}',
        container,
      ]);
      if (label !== runId) throw new Error();
      await run('docker', ['stop', '--time', '5', container]);
    } catch {
      console.error(
        "Could not verify/stop this run's disposable container. Check Docker locally; do not remove unrelated containers.",
      );
      process.exitCode = 1;
    }
  }
}
