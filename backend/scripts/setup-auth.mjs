import { randomBytes } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import { parse } from 'dotenv';
import { createPasswordHash } from '../src/auth/password.ts';

function readHidden(prompt) {
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    function cleanup() {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    function onKey(text, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        cleanup();
        reject(new Error('Configuración cancelada.'));
      } else if (key.name === 'return') {
        cleanup();
        resolve(value);
      } else if (key.name === 'backspace')
        value = [...value].slice(0, -1).join('');
      else if (
        !key.ctrl &&
        !key.meta &&
        text &&
        !/[\u0000-\u001f\u007f]/.test(text) &&
        value.length < 256
      )
        value += text;
    }
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
  });
}

let temporary;
try {
  if (!process.stdin.isTTY) throw new Error();
  const original = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const existing = parse(original);
  const rotate = process.argv.includes('--rotate');
  if (existing.SHARED_PASSWORD) throw new Error();
  const hasAuthKeys = original.split(/\r?\n/).some((line) => {
    const values = parse(line);
    return Boolean(values.SHARED_PASSWORD_HASH || values.SESSION_SECRET);
  });
  if (hasAuthKeys && !rotate) throw new Error();
  const password = await readHidden(
    'Contraseña compartida (12 a 256 caracteres): ',
  );
  const confirmation = await readHidden('Repite la contraseña: ');
  if (password !== confirmation) throw new Error();
  const hash = await createPasswordHash(password);
  const values = {
    SHARED_PASSWORD_HASH: hash,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
  };
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=`);
    let found = false;
    for (let index = 0; index < lines.length; index++)
      if (pattern.test(lines[index])) {
        lines[index] = `${key}=${value}`;
        found = true;
      }
    if (!found) lines.push(`${key}=${value}`);
  }
  if ((existsSync('.env') ? readFileSync('.env', 'utf8') : '') !== original)
    throw new Error();
  temporary = `.env.auth-${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporary, lines.join(newline), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, '.env');
  temporary = undefined;
  console.log('Acceso configurado sin mostrar claves. Reinicia la API.');
} catch {
  console.error(
    'No se completó la configuración. Usa una terminal interactiva, una contraseña de 12 a 256 caracteres y --rotate solo para reemplazar claves existentes. No se mostraron datos privados.',
  );
  process.exitCode = 1;
} finally {
  if (temporary && existsSync(temporary)) unlinkSync(temporary);
}
