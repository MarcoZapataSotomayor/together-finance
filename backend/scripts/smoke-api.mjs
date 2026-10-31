import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Reserve an ephemeral local port so another development API is not disturbed.
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['dist/main.js'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let initializedPrisma = false;
child.stdout.on('data', (chunk) => {
  if (chunk.toString().includes('PrismaModule dependencies initialized'))
    initializedPrisma = true;
});
// Do not forward third-party startup diagnostics that could contain credentials.
child.stderr.on('data', () => {});
try {
  let response;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) break;
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      break;
    } catch {
      await delay(100);
    }
  }
  if (!response || response.status !== 200 || !initializedPrisma)
    throw new Error();
  const body = await response.json();
  if (body.status !== 'ok' || body.application !== 'Together Finance')
    throw new Error();
  console.log(
    JSON.stringify(
      {
        nestStartup: 'passed',
        prismaConfigured: true,
        healthStatus: response.status,
        body,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'API smoke test failed. Verify database configuration and network access. No startup diagnostics were logged.',
  );
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
}
