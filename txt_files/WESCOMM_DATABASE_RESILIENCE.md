# WESCOMM database resilience on the free plan

## Current audit

Audited on 2026-07-29:

- The application uses Supabase Free Postgres and Supabase Auth/Storage.
- The configured database is reachable and all four Prisma migrations are
  applied.
- `DATABASE_URL` is the TLS Supavisor transaction endpoint on port `6543` with
  `pgbouncer=true`.
- `DIRECT_URL` is the TLS Supavisor session endpoint on port `5432`.
- Before this hardening, the backend Prisma client overrode the schema and used
  `DIRECT_URL` for normal Vercel traffic. That bypassed transaction pooling and
  increased connection-exhaustion risk.

Supabase Free still has one primary Postgres instance. It does not provide a
managed standby, read replica, automatic database failover, daily managed
backups, or point-in-time recovery. Pooling and retries improve resilience, but
they do not turn the free database into high availability.

## Controls implemented in the application

1. Runtime Prisma queries use `DATABASE_URL`; `DIRECT_URL` remains reserved for
   migrations, dumps, and restores.
2. Vercel Prisma clients default to one connection plus bounded connect/pool
   timeouts. Supavisor multiplexes those small client pools.
3. Selected idempotent Prisma reads (sessions, wishlists, user lists, reports,
   and readiness) retry with three bounded attempts, exponential backoff, and
   jitter. Reads that also expire restriction rows are deliberately excluded.
   Writes are never blindly replayed because a disconnected client may not know
   whether the database committed them.
4. Supabase Data API calls have a 15-second deadline. The pinned
   `supabase-js` version provides bounded retries for transient idempotent
   PostgREST reads.
5. Prisma and Supabase connection/pool failures consistently return HTTP `503`,
   `Retry-After: 2`, and `details.retryable=true`.
6. `/api/health` remains a database-independent liveness check.
   `/api/health/ready` retries a brief transient failure and returns
   `checks.database=false` with HTTP `503` when Postgres is unavailable.
7. `.github/workflows/database-backup.yml` creates an encrypted daily logical
   dump outside Supabase and retains seven rolling days in GitHub Actions.

## Required GitHub repository settings

The backup workflow intentionally fails until both secrets and the project
variable are configured:

- `DATABASE_BACKUP_URL`: the Supabase session pooler URL on port `5432` with
  `sslmode=require`. It must target the same project as `DIRECT_URL`. Use the
  same kind of endpoint as `DIRECT_URL`; do not use transaction mode on port
  `6543`.
- `DATABASE_BACKUP_PASSPHRASE`: a new random value of at least 24 characters.
  Do not reuse the database password or `DATA_ENCRYPTION_KEYS`.
- `SUPABASE_PROJECT_REF` (GitHub repository variable, not a secret): the exact
  project reference from the Supabase project URL or dashboard. The workflow
  compares this value with the project encoded in `DATABASE_BACKUP_URL` and
  stops before exporting if they differ.

Keep an offline copy of the backup passphrase and every version of
`DATA_ENCRYPTION_KEYS`. A database dump cannot decrypt WESCOMM's protected
profile/support fields without the matching application encryption keys.

After adding the settings, open **Actions > Encrypted Supabase database
backup** and run `workflow_dispatch` once. Confirm that:

1. the three dumps complete;
2. the encrypted archive verification passes;
3. the artifact contains one `.tar.gz.enc` file and its `.sha256`;
4. no plaintext `.sql` or `.tar.gz` file is uploaded.

GitHub schedule times use UTC. The configured `18:20 UTC` run is `02:20` the
next day in Asia/Singapore.

## What the backup contains

The workflow follows Supabase's logical migration sequence:

- `roles.sql`
- `schema.sql`
- `data.sql`

The files are packaged, encrypted using AES-256-CBC with PBKDF2-SHA256 (600,000
iterations), verified, and only then uploaded. This is disaster recovery, not
automatic failover. The recovery point can be up to 24 hours old.

Supabase database dumps contain Storage metadata, not the actual object bytes.
WESCOMM's `product-images` bucket must be exported separately after product
image uploads begin. Auth settings, API keys, Edge Functions, Realtime settings,
and project-level configuration must also be recorded outside the database.

## Monthly restore drill

Always restore into a newly created temporary Supabase project. Never test a
restore against Production.

1. Download the latest artifact and verify its checksum:

   ```powershell
   $encryptedBackup = Get-ChildItem -File -Filter "wescomm-database-*.tar.gz.enc" | Select-Object -First 1
   if (-not $encryptedBackup) { throw "Encrypted backup not found." }
   $checksumFile = Get-Item -LiteralPath "$($encryptedBackup.FullName).sha256"
   $expectedHash = ((Get-Content -Raw -LiteralPath $checksumFile.FullName).Trim() -split "\s+")[0].ToUpperInvariant()
   $actualHash = (Get-FileHash -LiteralPath $encryptedBackup.FullName -Algorithm SHA256).Hash
   if ($actualHash -ne $expectedHash) { throw "Backup checksum mismatch; do not decrypt or restore it." }
   ```

2. Create a dedicated temporary working directory, set the passphrase without
   displaying it, and decrypt there:

   ```powershell
   $restoreDir = Join-Path ([IO.Path]::GetTempPath()) ("wescomm-restore-" + [Guid]::NewGuid())
   New-Item -ItemType Directory -Path $restoreDir | Out-Null
   $securePassphrase = Read-Host "Backup passphrase" -AsSecureString
   $env:DATABASE_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $securePassphrase).Password
   $plainArchive = Join-Path $restoreDir "wescomm-database.tar.gz"
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in $encryptedBackup.FullName -out $plainArchive -pass env:DATABASE_BACKUP_PASSPHRASE
   tar -xzf $plainArchive -C $restoreDir
   ```

3. Create a temporary Supabase project and copy its port `5432` session pooler
   URL into `RECOVERY_DATABASE_URL`.
4. Restore with `psql` in one transaction:

   ```powershell
   psql --single-transaction --variable ON_ERROR_STOP=1 --file (Join-Path $restoreDir "roles.sql") --file (Join-Path $restoreDir "schema.sql") --command "SET session_replication_role = replica" --file (Join-Path $restoreDir "data.sql") --dbname "$env:RECOVERY_DATABASE_URL"
   ```

5. Configure the matching `DATA_ENCRYPTION_KEYS`, Supabase credentials, and a
   temporary WESCOMM backend against the recovery project.
6. Run:

   ```powershell
   cd backend
   npm run prisma:migrate:status
   npm run prisma:migrate:verify
   ```

7. Confirm `/api/health/ready`, sign-in, product browsing, reservations,
   inventory, receipts, and decryption of protected fields.
8. Record the backup timestamp, restore start/end time, failures, and fixes.
   Delete the temporary recovery project only after verification.
9. In a `finally` block (or immediately after the drill), remove the exact
   generated working directory and clear secrets from the process:

   ```powershell
   if ($restoreDir -and (Test-Path -LiteralPath $restoreDir)) {
     $resolvedRestoreDir = [IO.Path]::GetFullPath($restoreDir)
     $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
     if (-not $resolvedRestoreDir.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
       throw "Refusing to clean a restore path outside the temporary directory."
     }
     Remove-Item -LiteralPath $resolvedRestoreDir -Recurse -Force
   }
   Remove-Item Env:DATABASE_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
   Remove-Item Env:RECOVERY_DATABASE_URL -ErrorAction SilentlyContinue
   $securePassphrase = $null
   ```

   The encrypted artifact may be retained according to policy; no plaintext
   `.sql` or `.tar.gz` files should remain on the operator machine.

## Remaining single point of failure

During a full Supabase primary outage, writes and uncached reads will still be
unavailable. The application now fails cleanly and can recover data, but true
automatic failover requires a database service/plan that supplies managed HA.
A second Free project or logical replica would be a manually operated recovery
copy, not a safe automatic failover pair, and would add schema drift, sequence,
Auth, and Storage consistency risks.

## Official references

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase read replica requirements](https://supabase.com/docs/guides/platform/read-replicas/getting-started)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
