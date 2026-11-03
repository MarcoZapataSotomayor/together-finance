import { config } from 'dotenv';
import pg from 'pg';
import {
  directDatabaseUrl,
  runtimeDatabaseUrl,
} from '../src/config/database-urls.ts';

config({ quiet: true });

const clients = [];
try {
  const directConnection = directDatabaseUrl(process.env);
  const runtimeConnection = runtimeDatabaseUrl(process.env);
  const direct = new URL(directConnection);
  const runtime = new URL(runtimeConnection);
  if (
    direct.hostname !== runtime.hostname.replace('-pooler.', '.') ||
    direct.pathname !== runtime.pathname
  ) {
    throw new Error('DATABASE_TARGETS_DO_NOT_MATCH');
  }
  if (
    [direct, runtime].some(
      (url) => (url.searchParams.get('schema') ?? 'public') !== 'public',
    )
  ) {
    throw new Error('EXPECTED_PUBLIC_APPLICATION_SCHEMA');
  }
  for (const connectionString of [directConnection, runtimeConnection]) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
    });
    client.on('error', () => {});
    clients.push(client);
    await client.connect();
    await client.query('SELECT 1');
  }
  const client = clients[0];
  await client.query('BEGIN READ ONLY');
  const objects = await client.query(`
    SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY n.nspname, c.relname
  `);
  const types = await client.query(`
    SELECT n.nspname AS schema, t.typname AS name
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND t.typtype IN ('e', 'd')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    ORDER BY n.nspname, t.typname
  `);
  const routines = await client.query(`
    SELECT n.nspname AS schema, p.proname AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ORDER BY n.nspname, p.proname
  `);
  const schemas = await client.query(`
    SELECT n.nspname AS name FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema', 'public')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  `);
  await client.query('ROLLBACK');
  const empty =
    !objects.rowCount &&
    !types.rowCount &&
    !routines.rowCount &&
    !schemas.rowCount;
  console.log(
    JSON.stringify(
      {
        directConnection: 'ok',
        pooledConnection: 'ok',
        empty,
        objects: objects.rows,
        types: types.rows,
        routines: routines.rows,
        otherSchemas: schemas.rows,
      },
      null,
      2,
    ),
  );
  if (process.argv.includes('--require-empty') && !empty) process.exitCode = 2;
} catch (error) {
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : undefined;
  const knownMessage =
    typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : undefined;
  console.error(
    'Database inspection failed. No connection details were logged.',
    code ?? knownMessage ?? 'CHECK_CONFIGURATION_AND_NETWORK',
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
}
