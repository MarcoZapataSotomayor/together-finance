import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  assertDisposableDatabase,
  createDisposableDatabase,
  parseDatabaseUrl,
  withDatabase,
} from './database-safety.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function tool(name, args, url, env, input, output) {
  const parsed = parseDatabaseUrl(url);
  const toolEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => !key.startsWith('PG')),
    ),
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'prefer',
    PGCHANNELBINDING: parsed.searchParams.get('channel_binding') || 'prefer',
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=120000',
  };
  let command = join(
    env.PG_BIN_DIR || '',
    process.platform === 'win32' ? `${name}.exe` : name,
  );
  let commandArgs = args;
  if (env.PG_TOOLS_CONTAINER) {
    // Docker is only a tool provider for this run's own disposable loopback server.
    assertDisposableDatabase(url, env.TF_TEST_RUN_ID);
    if (
      env.PG_TOOLS_CONTAINER !==
        `together-finance-test-${env.TF_TEST_RUN_ID}` &&
      !(env.CI === 'true' && /^[a-f0-9]{64}$/.test(env.PG_TOOLS_CONTAINER))
    )
      throw new Error('Invalid disposable tool container.');
    toolEnv.PGHOST = '127.0.0.1';
    toolEnv.PGPORT = '5432';
    toolEnv.PGSSLMODE = 'disable';
    command = 'docker';
    commandArgs = [
      'exec',
      '-i',
      ...[
        'PGHOST',
        'PGPORT',
        'PGUSER',
        'PGPASSWORD',
        'PGDATABASE',
        'PGSSLMODE',
        'PGCONNECT_TIMEOUT',
        'PGOPTIONS',
        'PGCHANNELBINDING',
      ].flatMap((key) => ['--env', key]),
      env.PG_TOOLS_CONTAINER,
      name,
      ...args,
    ];
  }
  const child = spawn(command, commandArgs, {
    env: toolEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Never echo driver/tool errors: they can contain credentials, endpoints or row contents.
  child.stderr.resume();
  let text = '';
  if (!output)
    child.stdout.on('data', (chunk) => {
      if (text.length < 4096) text += chunk;
    });
  const closed = new Promise((accept, reject) => {
    child.once('error', () =>
      reject(new Error('PostgreSQL tool unavailable.')),
    );
    child.once('close', (code) =>
      code === 0
        ? accept(text)
        : reject(new Error('PostgreSQL tool failed; details omitted.')),
    );
  });
  // Attach the rejection handler before starting any stream work.
  const streams = [closed];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output)
    streams.push(
      pipeline(
        child.stdout,
        createWriteStream(output, { flags: 'r+', mode: 0o600 }),
      ),
    );
  const results = await Promise.allSettled(streams);
  const failed = results.some(
    (r, index) =>
      r.status === 'rejected' &&
      !(
        index === 1 &&
        input &&
        args[0] === '--list' &&
        r.reason.code === 'EPIPE' &&
        results[0].status === 'fulfilled'
      ),
  );
  if (failed) {
    child.kill();
    throw new Error('PostgreSQL archive operation failed; details omitted.');
  }
  return results[0].value;
}
async function serverMajor(url) {
  return withDatabase(url, async (client) =>
    Math.floor(
      Number(
        (await client.query('SHOW server_version_num')).rows[0]
          .server_version_num,
      ) / 10000,
    ),
  );
}
async function compatibleTools(name, url, env, expectedMajor) {
  const version = await tool(name, ['--version'], url, env);
  const major = Number(/\b(\d+)\.\d+/.exec(version)?.[1]);
  if (!Number.isInteger(major) || major < expectedMajor)
    throw new Error(
      'Use PostgreSQL tools at least as new as the source server.',
    );
  return major;
}
export async function backup(env = process.env) {
  const url = parseDatabaseUrl(env.BACKUP_DATABASE_URL);
  if (
    url.hostname.includes('-pooler.') ||
    env.BACKUP_EXPECTED_HOST !== url.hostname ||
    env.BACKUP_EXPECTED_DATABASE !== decodeURIComponent(url.pathname.slice(1))
  )
    throw new Error(
      'Confirm the exact direct backup source host/database first.',
    );
  if (env.BACKUP_STORAGE_CONFIRMED === 'disposable-fixture')
    assertDisposableDatabase(String(url), env.TF_TEST_RUN_ID);
  else if (env.BACKUP_STORAGE_CONFIRMED !== 'encrypted')
    throw new Error(
      'Choose encrypted protected storage before creating a real backup.',
    );
  if (
    url.hostname.endsWith('.neon.tech') &&
    !['require', 'verify-ca', 'verify-full'].includes(
      url.searchParams.get('sslmode'),
    )
  )
    throw new Error('Neon backups require TLS.');
  const major = await serverMajor(url);
  const toolMajor = await compatibleTools('pg_dump', url, env, major);
  const directory = resolve(env.BACKUP_DIRECTORY || join(root, '../backups'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `together-finance-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(8).toString('hex')}.dump`,
  );
  const reservation = await open(path, 'wx', 0o600);
  await reservation.close();
  try {
    await tool(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--no-password',
        '--compress=6',
      ],
      url,
      env,
      null,
      path,
    );
    await chmod(path, 0o600);
    const metadata = {
      format: 1,
      createdAt: new Date().toISOString(),
      serverMajor: major,
      toolMajor,
      bytes: (await stat(path)).size,
      sha256: await digest(path),
    };
    await writeFile(`${path}.json`, JSON.stringify(metadata, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return { path, metadata };
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}
export async function validateArchive(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 5)
    throw new Error('A complete custom-format archive is required.');
  if ((await stat(`${path}.json`)).size > 4096)
    throw new Error('Invalid backup manifest size.');
  const metadata = JSON.parse(await readFile(`${path}.json`, 'utf8'));
  if (
    metadata.format !== 1 ||
    !Number.isInteger(metadata.serverMajor) ||
    metadata.serverMajor < 14 ||
    !Number.isInteger(metadata.toolMajor) ||
    metadata.toolMajor < metadata.serverMajor ||
    metadata.bytes !== info.size ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    metadata.sha256 !== (await digest(path))
  )
    throw new Error('Backup manifest/checksum validation failed.');
  const stream = createReadStream(path, { start: 0, end: 4 });
  let magic = '';
  for await (const chunk of stream) magic += chunk.toString('ascii');
  if (magic !== 'PGDMP')
    throw new Error('Only a pg_dump custom archive is accepted.');
  return metadata;
}
export async function verifyFinancialDatabase(url) {
  return withDatabase(url, async (client) => {
    await client.query('BEGIN READ ONLY');
    try {
      const {
        rows: [result],
      } = await client.query(`SELECT
        EXISTS (SELECT 1 FROM expenses e LEFT JOIN expense_allocations a ON a.expense_id=e.id AND a.deleted_at IS NULL WHERE e.deleted_at IS NULL GROUP BY e.id HAVING COALESCE(SUM(a.amount),0)<>e.amount OR COALESCE(SUM(a.percentage),0)<>100) AS bad_allocations,
        EXISTS (SELECT 1 FROM debts d JOIN expense_allocations a ON a.id=d.expense_allocation_id JOIN expenses e ON e.id=a.expense_id WHERE d.deleted_at IS NULL AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND (d.original_amount<>a.amount OR d.debtor_person_id<>a.person_id OR d.creditor_person_id<>e.funded_by_person_id OR d.incurred_on<>e.purchased_on)) AS bad_sources,
        EXISTS (SELECT 1 FROM debts d LEFT JOIN expense_allocations a ON a.id=d.expense_allocation_id LEFT JOIN expenses e ON e.id=a.expense_id WHERE d.deleted_at IS NULL AND (d.origin='LOAN' OR (a.deleted_at IS NULL AND e.deleted_at IS NULL)) AND (SELECT COALESCE(SUM(r.amount),0) FROM repayments r WHERE r.debt_id=d.id AND r.deleted_at IS NULL)>d.original_amount) AS overpaid,
        EXISTS (SELECT 1 FROM repayments r JOIN debts d ON d.id=r.debt_id WHERE r.paid_on<d.incurred_on) AS bad_dates,
        EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype IN ('f','c') AND NOT c.convalidated) AS unvalidated_constraints`);
      if (Object.values(result).some(Boolean))
        throw new Error(
          'Restored financial invariants failed; inspect the isolated target privately.',
        );
      await client.query('COMMIT');
      return { valid: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
export async function restoreIsolated(path, env = process.env) {
  path = resolve(path);
  const metadata = await validateArchive(path);
  // Admin URL is never inferred from the runtime or migration configuration.
  const admin = env.TEST_POSTGRES_ADMIN_URL;
  const runId = env.TF_TEST_RUN_ID;
  // Validate all target restrictions before invoking tools or opening a connection.
  const { disposableAdminUrl } = await import('./database-safety.mjs');
  disposableAdminUrl(admin, env.TF_DISPOSABLE_POSTGRES);
  if (!/^[a-f0-9]{32}$/.test(runId ?? ''))
    throw new Error('A generated isolated restore run ID is required.');
  const target = new URL(admin);
  target.pathname = `/together_finance_restore_${runId}`;
  await compatibleTools(
    'pg_restore',
    target.toString(),
    env,
    metadata.toolMajor,
  );
  if ((await serverMajor(admin)) < metadata.toolMajor)
    throw new Error(
      'The isolated restore server must be at least as new as the dump tool.',
    );
  await tool('pg_restore', ['--list'], target.toString(), env, path);
  const url = await createDisposableDatabase(
    admin,
    env.TF_DISPOSABLE_POSTGRES,
    runId,
    'restore',
  );
  await tool(
    'pg_restore',
    [
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      '--no-password',
      '--dbname',
      target.pathname.slice(1),
    ],
    url,
    env,
    path,
  );
  await verifyFinancialDatabase(url);
  return { url, verified: true };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, path, ...extra] = process.argv.slice(2);
    if (
      extra.length ||
      !['backup', 'restore'].includes(command) ||
      (command === 'restore' ? !path : !!path)
    )
      throw new Error('Use backup or restore <archive>.');
    if (command === 'backup') {
      const result = await backup();
      console.log(
        `Backup created with checksum: ${basename(result.path)}. The archive is not encrypted by this script; keep it on protected encrypted storage.`,
      );
    } else {
      await restoreIsolated(path);
      console.log(
        'Restore and financial checks completed in a newly created disposable loopback database. No existing database was overwritten.',
      );
    }
  } catch {
    console.error(
      'Backup/restore refused or failed. Check tools, explicit safety configuration, protected storage and archive checksum locally; raw errors and connection details are omitted.',
    );
    process.exitCode = 1;
  }
}
