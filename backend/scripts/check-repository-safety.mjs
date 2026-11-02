import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// A scoped regression check, not a replacement for a full secret scanner or review.
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)
  .split('\0')
  .filter(Boolean);
let findings = 0;
for (const file of files) {
  if (
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
    /(^|\/)backups\//.test(file) ||
    /\.(dump|backup|tfbackup)(\.|$)|\.sql\.gz$/.test(file)
  ) {
    findings++;
    continue;
  }
  if (!/\.(ts|tsx|js|mjs|json|md|ya?ml|txt|pem)$/.test(file)) continue;
  const text = readFileSync(resolve(root, file), 'utf8');
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) &&
    !file.endsWith('check-repository-safety.mjs')
  )
    findings++;
  for (const match of text.matchAll(/postgres(?:ql)?:\/\/[^\s"'`<>]+/g)) {
    try {
      const url = new URL(match[0]);
      if (
        url.hostname.endsWith('.neon.tech') &&
        url.password &&
        !/^(password|placeholder)$/i.test(url.password)
      )
        findings++;
    } catch {
      /* Ignore non-URL documentation placeholders. */
    }
  }
}
if (findings) {
  console.error(
    `Repository safety check found ${findings} potential secret/backup exposures. Inspect locally; values are never printed.`,
  );
  process.exitCode = 1;
} else
  console.log(
    'Scoped repository safety check passed: no tracked/unignored environment files, backup archives, private-key blocks or literal Neon credentials detected.',
  );
