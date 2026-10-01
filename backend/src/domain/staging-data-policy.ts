const projectRefPattern = /^[a-z0-9]{8,64}$/;

export type StagingDataEnvironment = {
  WESCOMM_ENV?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  PRODUCTION_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NODE_ENV?: string;
  APP_ENV?: string;
  NEXT_PUBLIC_APP_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
};

function requiredProjectRef(value: string | undefined, name: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !projectRefPattern.test(normalized)) {
    throw new Error(`${name} must contain one valid Supabase project reference.`);
  }
  return normalized;
}

export function supabaseProjectRefFromUrl(value: string | undefined) {
  if (!value?.trim()) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Staging Supabase must use an HTTPS project URL.");
  }
  const projectRef = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase();
  if (!projectRef) throw new Error("NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project.");
  return projectRef;
}

export function databaseProjectRefFromUrl(value: string | undefined, name = "DATABASE_URL") {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }

  const username = decodeURIComponent(url.username);
  const fromUsername = username.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? null;
  const fromHost = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase() ?? null;
  const projectRef = fromUsername ?? fromHost;
  if (!projectRef) throw new Error(`${name} must identify a hosted Supabase project.`);
  return projectRef;
}

export function resolveStagingProjectTarget(environment: StagingDataEnvironment) {
  if (environment.WESCOMM_ENV?.trim().toLowerCase() !== "staging") {
    throw new Error("WESCOMM_ENV must be exactly staging.");
  }

  const stagingProjectRef = requiredProjectRef(
    environment.STAGING_SUPABASE_PROJECT_REF,
    "STAGING_SUPABASE_PROJECT_REF"
  );
  const productionProjectRef = requiredProjectRef(
    environment.PRODUCTION_SUPABASE_PROJECT_REF,
    "PRODUCTION_SUPABASE_PROJECT_REF"
  );
  if (stagingProjectRef === productionProjectRef) {
    throw new Error("Staging and Production Supabase project references must be different.");
  }

  const databaseProjectRef = databaseProjectRefFromUrl(environment.DATABASE_URL);
  const directProjectRef = databaseProjectRefFromUrl(environment.DIRECT_URL, "DIRECT_URL");
  const supabaseProjectRef = supabaseProjectRefFromUrl(environment.NEXT_PUBLIC_SUPABASE_URL);
  const actualRefs = new Set([databaseProjectRef, directProjectRef, supabaseProjectRef]);
  if (actualRefs.size !== 1 || !actualRefs.has(stagingProjectRef)) {
    throw new Error("DATABASE_URL, DIRECT_URL, and Supabase Auth must all target the declared Staging project.");
  }
  if (actualRefs.has(productionProjectRef)) {
    throw new Error("Staging operation refused because a target resolves to the Production project.");
  }

  return {
    stagingProjectRef,
    productionProjectRef,
    databaseProjectRef,
    directProjectRef,
    supabaseProjectRef
  };
}

export function assertSafeStagingMutationEnvironment(environment: StagingDataEnvironment) {
  const target = resolveStagingProjectTarget(environment);
  const productionLabels = [
    environment.APP_ENV,
    environment.NEXT_PUBLIC_APP_ENV,
    environment.VERCEL_ENV,
    environment.VERCEL_TARGET_ENV
  ].map((value) => value?.trim().toLowerCase());
  if (productionLabels.includes("production")) {
    throw new Error("Staging mutation refused because the process is marked as production.");
  }
  return target;
}
