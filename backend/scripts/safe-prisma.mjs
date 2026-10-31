import { spawn } from 'node:child_process';
import { config } from 'dotenv';

config({ quiet: true });

// Redact connection strings and their identifying components before CLI output.
const secrets = [];
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'DATABASE_URL_POOLED']) {
  const value = process.env[key];
  if (!value) continue;
  secrets.push(value);
  try {
    const url = new URL(value);
    secrets.push(
      url.username,
      url.password,
      decodeURIComponent(url.username),
      decodeURIComponent(url.password),
      url.hostname,
      url.pathname.slice(1),
    );
  } catch {
    /* Prisma will report invalid configuration with the value redacted. */
  }
}

function sanitize(value) {
  let result = value.replace(
    /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
    '[REDACTED_DATABASE_URL]',
  );
  for (const secret of secrets
    .filter((value) => value.length >= 3)
    .sort((a, b) => b.length - a.length))
    result = result.split(secret).join('[REDACTED]');
  return result;
}

const child = spawn(
  process.execPath,
  ['node_modules/prisma/build/index.js', ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      CHECKPOINT_DISABLE: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});
child.on('error', () => {
  console.error('Unable to start the Prisma CLI.');
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.stdout.write(sanitize(output));
  process.exitCode = code ?? 1;
});
