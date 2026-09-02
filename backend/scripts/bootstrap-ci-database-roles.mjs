import { PrismaClient } from "@prisma/client";

const REQUIRED_CONFIRMATION = "I_CONFIRM_EPHEMERAL_WESCOMM_CI_DATABASE";
const requiredRoles = ["anon", "authenticated", "service_role"];

function failClosed(message) {
  console.error(`CI database role bootstrap refused to run: ${message}`);
  process.exit(1);
}

if (process.env.WESCOMM_BOOTSTRAP_CI_DATABASE_ROLES !== REQUIRED_CONFIRMATION) {
  failClosed("the explicit ephemeral-database confirmation is missing.");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) failClosed("DATABASE_URL is required.");

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  failClosed("DATABASE_URL is not a valid URL.");
}

const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
const normalizedDatabaseName = databaseName.toLowerCase();
const hostname = parsedUrl.hostname.toLowerCase();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const isGitHubServiceHost = isGitHubActions && (
  hostname === "postgres"
  || hostname === "host.docker.internal"
  || /^10\./.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
);

if (!new Set(["postgres:", "postgresql:"]).has(parsedUrl.protocol)) {
  failClosed("only PostgreSQL URLs are accepted.");
}
if (!loopbackHosts.has(hostname) && !isGitHubServiceHost) {
  failClosed("only a loopback database or a GitHub Actions service database is accepted.");
}
if (
  !normalizedDatabaseName.includes("wescomm")
  || !/(^|[_-])(test|ci|sandbox)([_-]|$)/.test(normalizedDatabaseName)
) {
  failClosed("the database name must contain both 'wescomm' and a test/ci/sandbox marker.");
}
if ((parsedUrl.searchParams.get("schema") ?? "public") !== "public") {
  failClosed("the CI bootstrap requires schema=public.");
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

try {
  const identityRows = await prisma.$queryRawUnsafe(`
    SELECT current_database() AS database_name, inet_server_addr()::text AS server_address
  `);
  const identity = identityRows[0];
  if (identity?.database_name !== databaseName) {
    failClosed("the connected database does not match DATABASE_URL.");
  }

  const serverAddress = identity?.server_address ?? "";
  const loopbackServer = identity?.server_address === null
    || serverAddress === "::1"
    || /^127\./.test(serverAddress);
  const githubServiceServer = isGitHubActions && (
    /^10\./.test(serverAddress)
    || /^192\.168\./.test(serverAddress)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(serverAddress)
  );
  if (!loopbackServer && !githubServiceServer) {
    failClosed("PostgreSQL reported a server outside the permitted ephemeral network boundary.");
  }

  for (const role of requiredRoles) {
    await prisma.$executeRawUnsafe(`
      DO $bootstrap$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE "${role}" NOLOGIN;
        END IF;
      END
      $bootstrap$;
    `);
  }

  const roleRows = await prisma.$queryRawUnsafe(`
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
    ORDER BY rolname
  `);
  const installedRoles = roleRows.map((row) => row.rolname);
  if (installedRoles.length !== requiredRoles.length) {
    failClosed("one or more required Supabase-compatible roles are missing after bootstrap.");
  }

  console.log(JSON.stringify({
    status: "passed",
    database: databaseName,
    roles: installedRoles,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
