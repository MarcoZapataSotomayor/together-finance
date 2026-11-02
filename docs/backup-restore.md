# PostgreSQL backup and isolated restoration

## Scope and verified result

`backend/scripts/backup-restore.mjs` creates portable PostgreSQL custom archives and restores them only into a **freshly created disposable loopback database**. It never infers credentials from DATABASE_URL, DIRECT_URL or `.env`. There is no upload, deployment, automatic production restore, retention expiry or database reset.

An actual local PostgreSQL 17 drill passed: fictional records and the existing migration were dumped/restored with real pg_dump/pg_restore. Fingerprints matched all seven financial tables, exact amounts, deletion flags, repayment history, migration metadata, foreign keys, CHECK constraints and indexes. The source was unchanged. A corrupt archive and an attempt to reuse the generated restore target were rejected. **No actual Neon backup or restore was performed.**

## Free long-term policy

Start with a daily backup on days the app is used, plus one before any migration/manual correction. Suggested manual retention: 7 daily, 4 weekly and 12 monthly verified copies, adjusted to available storage. These recommendations do not install automatic deletion jobs. Never remove the last known-good copy before proving a replacement.

Under that schedule the recovery-point objective is 24 hours; take extra backups after important changes if losing a day is unacceptable. Initially allow one working session for recovery, then replace that estimate with a measured real-data drill result. The local fixture drill is not a production recovery-time benchmark.

Use existing protected storage: one encrypted local copy and another encrypted copy on an existing removable drive kept separately/offline. Keep the encryption key separately and privately record backup/verification dates and storage location. No automatic external upload is configured. A local operator reminder is sufficient initially; a future scheduler needs protected credentials and failure monitoring.

PITR handles recent mistakes but is not independent archival storage. As checked on 2026-11-01, [Neon's Free plan](https://neon.com/docs/introduction/plans) documents a six-hour history limit with a change-history cap. Verify the actual plan/window before relying on it; do not enable paid snapshot/storage features for this strategy. A separately stored logical backup extends recovery beyond that history window and provider-account access.

CSV is a filtered spreadsheet extract: it omits schema/constraints/indexes and may change text for formula safety. It cannot restore this database. A PostgreSQL dump preserves relational data and structure, but not backend environment secrets, hosting configuration or cluster roles/passwords. The portability flags below also omit ownership/grants; recreate an appropriate least-privilege policy separately during an eventual reviewed cutover.

## Encryption and storage prerequisites

**This script does not encrypt archives.** Real-source backups require BACKUP_STORAGE_CONFIRMED=encrypted as an operator acknowledgement, not proof or activation of encryption. Set it only after checking the destination. A compressed custom archive still contains readable financial information.

Use an encrypted volume/container and restricted OS access first. Windows ACLs determine access; POSIX archives/manifests request 0600 and new directories 0700. Do not stage real data in Downloads, shared folders or accidental sync locations. Before off-volume transfer, additionally encrypt the archive and manifest using a maintained free tool such as GnuPG or 7-Zip AES-256, with its interactive password prompt. Never put a password in command arguments/history. Prove decryption and retain the key separately before removing a staging copy. No custom cryptography was added.

Never commit archives, attach them to issues or upload them as Actions artifacts. Git ignores backups/ and common archive/manifest extensions; the scoped repository check detects unignored archives. This prevents future mistakes, not recovery of already disclosed files. Do not print environment variables or record credentials in screenshots.

## Create a backup

Install official PostgreSQL client tools, preferably matching the source major. An older pg_dump is rejected. The restore tool and server must be at least as new as the dump tool; this conservative policy avoids assuming newer dump output works on an older target. Provider extensions also need compatible target support; never silently omit an extension to bypass a restore error. See [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

Use the direct Neon connection, not the pooled endpoint, as described in [Neon's backup guide](https://neon.com/docs/manage/backup-pg-dump). Confirm the branch in the console; a database name does not prove branch identity. The tool never fetches a URL automatically.

From backend/, supply these variables in a trusted process without echoing values:

| Variable | Purpose |
| --- | --- |
| BACKUP_DATABASE_URL | Explicit direct source URL with credentials and TLS for Neon |
| BACKUP_EXPECTED_HOST | Independently verified exact endpoint hostname |
| BACKUP_EXPECTED_DATABASE | Exact decoded database name |
| BACKUP_DIRECTORY | Already encrypted/access-controlled destination; default repository-root backups/ |
| BACKUP_STORAGE_CONFIRMED | encrypted, after checking storage protection |
| PG_BIN_DIR | Optional native PostgreSQL executable directory |

Only sslmode, channel_binding and optional schema=public URL options are accepted. Host/service/database overrides are rejected. Tools receive explicit connection fields in their environment, with ambient PG variables removed; credentials never appear in their arguments. Neon requires TLS. Prefer verify-full with correctly configured trusted roots; do not disable certificate checking to hide connection errors.

PowerShell can collect the URL through hidden input instead of a literal in command history:

```powershell
$sourceSecret = Read-Host 'Direct PostgreSQL backup URL' -AsSecureString
$sourcePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sourceSecret)
try {
    $env:BACKUP_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sourcePointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sourcePointer)
}
# Privately configure expected host/database and the encrypted directory.
# Set BACKUP_STORAGE_CONFIRMED only after checking storage protection.
try { npm run db:backup } finally { Remove-Item Env:BACKUP_DATABASE_URL }
```

Environment variables are not a vault: trusted administrators/process owners may inspect them. Clear them and close the trusted process afterward. Do not add backup secrets to repository configuration.

The tool streams pg_dump with custom format, compression, no-owner, no-acl and no-password into a newly reserved timestamp/random-named archive. It prints no verbose rows or source identifiers. PostgreSQL supplies a consistent snapshot, including deleted records; avoid concurrent schema migrations. The source role must read all intended objects.

The adjacent `.dump.json` manifest records format version, creation time, server/tool major, byte count and SHA-256, without credentials or rows. Failed dumps are removed. Keep/encrypt/copy the pair together and verify the copied checksum. SHA-256 detects corruption, not a trusted author if an attacker replaces both files. Restore trusted archives only: their SQL can execute on the target. Connection/statement timeouts are finite; larger databases need a reviewed time budget rather than weakened safety checks.

## Isolated restoration

`npm run db:restore:isolated -- <archive.dump>` checks the manifest, checksum, archive magic/listing and tool/server compatibility. It then creates `together_finance_restore_<run-id>` without IF NOT EXISTS; collisions fail. pg_restore uses single-transaction, exit-on-error, no-owner, no-acl and no-password. There is no clean, DROP, TRUNCATE, reset or overwrite option.

Required settings:

- TEST_POSTGRES_ADMIN_URL: a loopback-only URL to /postgres using the together_test role on a genuinely disposable cluster. It must allow database creation. Do not use a Neon tunnel or a shared local installation.
- TF_DISPOSABLE_POSTGRES=1: explicit disposable-cluster acknowledgement.
- TF_TEST_RUN_ID: a new 32-character lowercase hexadecimal identifier.
- Native PG_BIN_DIR or PG_TOOLS_CONTAINER=together-finance-test-<run-id>. CI may instead use its own service's full container ID.

The following local Docker setup uses RAM-backed storage. Use the tested 17 image for a 17 source; review a compatible image if the source major changes. Keep real-data archives protected during drills.

```powershell
cd backend
$drillId = [guid]::NewGuid().ToString('N')
$drillContainer = "together-finance-test-$drillId"
$drillImage = 'postgres:17@sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1'
$env:POSTGRES_PASSWORD = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker run --detach --rm --name $drillContainer --label "together-finance.disposable=$drillId" --publish '127.0.0.1::5432' --tmpfs '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m' --env POSTGRES_USER=together_test --env POSTGRES_PASSWORD $drillImage
try {
    # Wait until pg_isready succeeds before continuing.
    docker exec $drillContainer pg_isready -U together_test -d postgres
    $drillPort = (docker port $drillContainer '5432/tcp').Trim()
    if ($drillPort -notmatch '^127\.0\.0\.1:\d+$') { throw 'Loopback mapping required.' }
    $env:TEST_POSTGRES_ADMIN_URL = "postgresql://together_test:$($env:POSTGRES_PASSWORD)@$drillPort/postgres"
    $env:TF_TEST_RUN_ID = $drillId
    $env:TF_DISPOSABLE_POSTGRES = '1'
    $env:PG_TOOLS_CONTAINER = $drillContainer
    npm run db:restore:isolated -- 'X:\ProtectedBackups\chosen.dump'
    # Inspect only the new together_finance_restore_<run-id> database here.
} finally {
    $drillLabel = docker inspect --format '{{index .Config.Labels "together-finance.disposable"}}' $drillContainer
    if ($drillLabel -ne $drillId) { throw 'Container identity mismatch: refusing cleanup.' }
    docker stop --time 5 $drillContainer
    Remove-Item Env:POSTGRES_PASSWORD,Env:TEST_POSTGRES_ADMIN_URL,Env:TF_TEST_RUN_ID,Env:TF_DISPOSABLE_POSTGRES,Env:PG_TOOLS_CONTAINER -ErrorAction SilentlyContinue
}
```

Keep manual inspection inside the try block. Stopping this verified container discards only its temporary cluster. Do not substitute system prune, remove unrelated containers or delete a Neon branch. A new drill must use a fresh namespace rather than reuse a target.

After import, focused read-only SQL checks verify active allocation sums/percentages, source-debt terms, active repayments versus principal, chronology and constraint validation. Failure requires private inspection of the isolated target; the source is untouched. A failed restore may leave its new empty/rolled-back database until the disposable cluster is discarded. Full domain/UI review is still needed before recovery promotion.

### Verification record and incident procedure

1. Prove decryption and validate the archive/manifest checksum on protected storage.
2. Restore into a fresh target; verify FK/CHECK/index presence and migration state there.
3. Privately compare expected counts and sample exact amounts/histories, both active and deleted. Confirm deleted ancestry is excluded from active balances and loans/repayments are not new spending.
4. For UI inspection use a separately configured local instance pointing only to the restored database, with isolated auth. Do not edit/reuse the ordinary backend .env or reconnect the drill to Neon. Verify configuration before enabling writes.
5. Privately record dates, tool versions, pass/fail and recovery duration. Discard only the verified disposable cluster; keep the protected backup according to manual retention policy.

During a real incident stop new writes, preserve the affected state and diagnose before choosing PITR or archive recovery. Prove recovery in isolation, then separately approve a cutover to a **new** production target with appropriate roles/grants, credentials and compatible application/migrations. These scripts never promote, merge newer records or overwrite production. Reconciliation of post-backup records is an explicit financial correction task.

## Validation and remaining limits

`npm run test:postgres` provisions/disposes a local cluster, migrates a fresh test database and runs ten genuine database/restore tests with fictional records. CI uses its own disposable service and uploads no archive. `npm run test:safety` tests cloud/namespace/command/source/storage refusal without external connections.

Not verified: a real Neon backup/restore, provider-specific objects, actual storage encryption or removable-media custody, key recovery, scheduled backups or production recovery timing. The successful local drill proves tooling and current schema/financial behavior; these operational checks remain release prerequisites.
