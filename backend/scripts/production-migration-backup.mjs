import { isAbsolute } from 'node:path';
import { validateArchive } from './backup-restore.mjs';

export async function verifyProductionMigrationBackup(env, now = Date.now()) {
  if (env.MIGRATION_TARGET !== 'production') return;
  try {
    const path = env.MIGRATION_BACKUP_MANIFEST;
    if (
      !path ||
      !isAbsolute(path) ||
      !path.endsWith('.dump.json') ||
      env.MIGRATION_BACKUP_CONFIRMED !== 'restored-and-verified' ||
      env.BACKUP_STORAGE_CONFIRMED !== 'encrypted'
    )
      throw new Error();
    const metadata = await validateArchive(path.slice(0, -5));
    if (metadata.sha256 !== env.MIGRATION_RESTORE_SHA256) throw new Error();
    const time = Date.parse(metadata.createdAt);
    if (
      !Number.isFinite(time) ||
      time > now ||
      now - time > 24 * 60 * 60 * 1000
    )
      throw new Error();
    // Checksum/age cannot prove restoration, encryption or source identity; require private operator review too.
  } catch {
    throw new Error(
      'Production backup verification failed: require a valid archive/manifest from the last 24 hours and a reviewed recovery drill; details omitted.',
    );
  }
}
