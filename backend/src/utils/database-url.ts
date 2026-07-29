const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SUPABASE_POOLER_HOST_SUFFIX = ".pooler.supabase.com";
const SUPABASE_HOST_SUFFIX = ".supabase.co";

function parsePostgresUrl(value: string, variableName: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${variableName} must use the postgres:// or postgresql:// protocol.`);
  }

  return parsed;
}

function supabaseProjectRef(parsed: URL) {
  if (parsed.hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX)) {
    const username = decodeURIComponent(parsed.username);
    const separator = username.lastIndexOf(".");
    return separator >= 0 ? username.slice(separator + 1) : null;
  }

  if (parsed.hostname.startsWith("db.") && parsed.hostname.endsWith(SUPABASE_HOST_SUFFIX)) {
    return parsed.hostname.slice("db.".length, -SUPABASE_HOST_SUFFIX.length);
  }

  return null;
}

function supabaseApiProjectRef(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  if (!parsed.hostname.endsWith(SUPABASE_HOST_SUFFIX)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must use the standard Supabase project URL so database project consistency can be verified."
    );
  }

  const projectRef = parsed.hostname.slice(0, -SUPABASE_HOST_SUFFIX.length);
  if (!projectRef || projectRef.includes(".") || projectRef === "db") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must identify a Supabase project.");
  }

  return projectRef;
}

/**
 * Vercel can create many short-lived function instances. Keep each Prisma
 * client deliberately small and let Supavisor multiplex those connections.
 * Explicit URL values still win so production can be tuned without a code
 * change.
 */
export function buildRuntimeDatabaseUrl(value: string, serverless: boolean) {
  const parsed = parsePostgresUrl(value, "DATABASE_URL");
  if (!serverless) return parsed.toString();

  const serverlessDefaults: Record<string, string> = {
    connection_limit: "1",
    pool_timeout: "10",
    connect_timeout: "10"
  };

  for (const [name, defaultValue] of Object.entries(serverlessDefaults)) {
    if (!parsed.searchParams.has(name)) parsed.searchParams.set(name, defaultValue);
  }

  return parsed.toString();
}

/**
 * Catch the common Supabase/Vercel misconfiguration where application traffic
 * uses the session/direct endpoint. This is a startup check only; it never logs
 * or returns credentials.
 */
export function assertSafeProductionDatabaseUrls(
  databaseUrl: string,
  directUrl: string,
  supabaseUrl: string
) {
  const runtime = parsePostgresUrl(databaseUrl, "DATABASE_URL");
  const direct = parsePostgresUrl(directUrl, "DIRECT_URL");
  const apiProjectRef = supabaseApiProjectRef(supabaseUrl);

  if (
    runtime.hostname.startsWith("db.")
    && runtime.hostname.endsWith(SUPABASE_HOST_SUFFIX)
  ) {
    throw new Error(
      "DATABASE_URL must use the Supabase transaction pooler on port 6543 in production, not a direct database endpoint."
    );
  }

  if (!runtime.hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX)) return;

  if (runtime.port !== "6543") {
    throw new Error(
      "DATABASE_URL must use the Supabase transaction pooler on port 6543 in production."
    );
  }

  if (runtime.searchParams.get("pgbouncer")?.toLowerCase() !== "true") {
    throw new Error(
      "DATABASE_URL must include pgbouncer=true for Prisma with the Supabase transaction pooler."
    );
  }

  if (
    direct.hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX)
    && direct.port !== "5432"
  ) {
    throw new Error(
      "DIRECT_URL must use the Supabase session pooler on port 5432 (or a direct database endpoint)."
    );
  }

  if (
    direct.hostname.startsWith("db.")
    && direct.hostname.endsWith(SUPABASE_HOST_SUFFIX)
    && direct.port !== ""
    && direct.port !== "5432"
  ) {
    throw new Error(
      "DIRECT_URL must use port 5432 when it targets a direct Supabase database endpoint."
    );
  }

  const runtimeProjectRef = supabaseProjectRef(runtime);
  const directProjectRef = supabaseProjectRef(direct);
  if (!runtimeProjectRef) {
    throw new Error(
      "DATABASE_URL pooler username must include the Supabase project reference."
    );
  }
  if (!directProjectRef) {
    throw new Error(
      "DIRECT_URL must use a Supabase session pooler or direct endpoint for the same project."
    );
  }
  if (
    runtimeProjectRef !== directProjectRef
    || runtimeProjectRef !== apiProjectRef
  ) {
    throw new Error(
      "DATABASE_URL, DIRECT_URL, and NEXT_PUBLIC_SUPABASE_URL must target the same Supabase project."
    );
  }
}
