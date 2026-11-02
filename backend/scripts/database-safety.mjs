import { Client } from 'pg';

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.hash ||
      [...url.searchParams.keys()].some(
        (key) => !['sslmode', 'channel_binding', 'schema'].includes(key),
      ) ||
      (url.searchParams.has('schema') &&
        url.searchParams.get('schema') !== 'public') ||
      url.pathname.length < 2
    )
      throw new Error();
    return url;
  } catch {
    throw new Error('A complete PostgreSQL URL is required; value omitted.');
  }
}
export function disposableAdminUrl(value, confirmed) {
  const url = parseDatabaseUrl(value);
  if (
    confirmed !== '1' ||
    !loopback.has(url.hostname) ||
    url.username !== 'together_test' ||
    url.pathname !== '/postgres' ||
    url.search
  )
    throw new Error(
      'Only an explicitly disposable loopback PostgreSQL test cluster is accepted.',
    );
  return url;
}
export function assertDisposableDatabase(value, runId) {
  const url = parseDatabaseUrl(value);
  if (
    !/^[a-f0-9]{32}$/.test(runId ?? '') ||
    !loopback.has(url.hostname) ||
    url.username !== 'together_test' ||
    url.search ||
    ![
      `/together_finance_test_${runId}`,
      `/together_finance_restore_${runId}`,
    ].includes(url.pathname)
  )
    throw new Error(
      'Refusing a database outside the generated disposable test namespace.',
    );
  return url;
}
export async function withDatabase(url, work) {
  const client = new Client({
    connectionString: String(url),
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  client.on('error', () => {
    /* Surface a safe operation failure rather than logging an idle connection error. */
  });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end();
  }
}
export async function createDisposableDatabase(
  adminValue,
  confirmed,
  runId,
  kind = 'test',
) {
  const admin = disposableAdminUrl(adminValue, confirmed);
  if (!/^[a-f0-9]{32}$/.test(runId) || !['test', 'restore'].includes(kind))
    throw new Error('Invalid generated test namespace.');
  const name = `together_finance_${kind}_${runId}`;
  await withDatabase(admin, async (client) => {
    const {
      rows: [identity],
    } = await client.query(
      'SELECT current_user AS role, current_database() AS database',
    );
    if (identity.role !== 'together_test' || identity.database !== 'postgres')
      throw new Error('Disposable cluster identity check failed.');
    // No IF NOT EXISTS: a collision must fail, never reuse or overwrite a database.
    await client.query(`CREATE DATABASE "${name}"`);
  });
  const target = new URL(admin);
  target.pathname = `/${name}`;
  return target.toString();
}

export function allowedPrismaCommand(args, env) {
  const command = args.join(' ');
  if (
    ![
      'format',
      'generate',
      'validate',
      'migrate status',
      'migrate deploy',
    ].includes(command)
  )
    throw new Error(
      'This wrapper allows only format, generate, validate, migrate status and reviewed migrate deploy.',
    );
  if (command !== 'migrate deploy') return;
  const direct =
    env.DIRECT_URL || (env.DATABASE_URL_POOLED ? env.DATABASE_URL : undefined);
  if (env.MIGRATION_TARGET === 'disposable-test') {
    if (env.TF_DISPOSABLE_POSTGRES !== '1')
      throw new Error('Disposable migration confirmation is required.');
    assertDisposableDatabase(direct, env.TF_TEST_RUN_ID);
    return;
  }
  const url = parseDatabaseUrl(direct);
  if (
    !['development', 'production'].includes(env.MIGRATION_TARGET) ||
    env.MIGRATION_EXPECTED_HOST !== url.hostname ||
    env.MIGRATION_EXPECTED_DATABASE !==
      decodeURIComponent(url.pathname.slice(1)) ||
    env.MIGRATION_APPROVED !== 'yes'
  )
    throw new Error(
      'Deployment migrations require explicit target, matching expected host/database, and reviewed approval.',
    );
  if (
    url.hostname.includes('-pooler.') ||
    !['require', 'verify-ca', 'verify-full'].includes(
      url.searchParams.get('sslmode'),
    )
  )
    throw new Error(
      'Reviewed deployment migrations require a direct TLS connection.',
    );
}
