import "dotenv/config";

import { databaseProjectRefFromUrl, resolveStagingProjectTarget } from "../domain/staging-data-policy.js";

function fail(message: string): never {
  throw new Error(`Staging environment verification failed: ${message}`);
}

function value(name: string) {
  return process.env[name]?.trim() ?? "";
}

function required(name: string) {
  const current = value(name);
  if (!current) fail(`${name} is required.`);
  return current;
}

function exact(name: string, expected: string) {
  if (required(name) !== expected) fail(`${name} must be exactly ${expected}.`);
}

function booleanValue(name: string) {
  const current = required(name).toLowerCase();
  if (!['true', 'false'].includes(current)) fail(`${name} must be explicitly true or false.`);
  return current === "true";
}

const target = resolveStagingProjectTarget(process.env);
const targetOnly = process.argv.includes("--target-only");

for (const [name, urlValue] of [
  ["DATABASE_URL", required("DATABASE_URL")],
  ["DIRECT_URL", required("DIRECT_URL")]
] as const) {
  if (!/[?&]sslmode=(require|verify-ca|verify-full)(?:&|$)/i.test(urlValue)) {
    fail(`${name} must require or verify TLS.`);
  }
}
if (databaseProjectRefFromUrl(process.env.DIRECT_URL, "DIRECT_URL") !== target.stagingProjectRef) {
  fail("DIRECT_URL must target the declared Staging project.");
}

if (!targetOnly) {
  exact("NEXT_PUBLIC_APP_ENV", "staging");
  exact("NEXT_PUBLIC_API_URL", "/api");
  exact("NEXT_PUBLIC_E2E_TEST", "false");
  exact("AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN", "false");
  exact("NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN", "false");
  if (!booleanValue("AUTH_ENABLE_DEV_LOGIN") || !booleanValue("NEXT_PUBLIC_ENABLE_DEV_LOGIN")) {
    fail("the staging-only development login must be enabled on both backend and frontend.");
  }
  if (required("AUTH_DEV_LOGIN_PASSWORD").length < 20) {
    fail("AUTH_DEV_LOGIN_PASSWORD must contain at least 20 characters in Staging.");
  }
  if (booleanValue("PAYMONGO_ENABLED") || booleanValue("PAYMONGO_LIVEMODE")) {
    fail("PayMongo must remain disabled in the default Staging environment.");
  }
  if (value("PAYMONGO_SECRET_KEY").startsWith("sk_live_")) {
    fail("a live PayMongo secret must never be present in Staging.");
  }
  if (booleanValue("WESBOT_AI_ENABLED")) {
    fail("WesBot external AI must remain disabled in the default Staging environment.");
  }
  if (value("BACKEND_API_URL")) {
    fail("BACKEND_API_URL must be unset for the same-origin Vercel Services deployment.");
  }

  const frontendOrigin = required("FRONTEND_ORIGIN");
  const parsedOrigin = new URL(frontendOrigin);
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== frontendOrigin) {
    fail("FRONTEND_ORIGIN must be one exact HTTPS origin.");
  }
  const frontendOrigins = required("FRONTEND_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean);
  if (!frontendOrigins.includes(frontendOrigin)) fail("FRONTEND_ORIGINS must include FRONTEND_ORIGIN.");

  const requiredLoginEmails = [
    "student@wesleyan.edu.ph",
    "qa.student02@wesleyan.edu.ph",
    "staff@wesleyan.edu.ph",
    "admin@wesleyan.edu.ph"
  ];
  const loginEmails = new Set(
    required("AUTH_DEV_LOGIN_EMAILS").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
  );
  if (requiredLoginEmails.some((email) => !loginEmails.has(email))) {
    fail("AUTH_DEV_LOGIN_EMAILS must include two seeded Students, Staff, and Admin accounts.");
  }

  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey === serviceRoleKey) fail("the service-role key must differ from the public anon key.");

  if (value("VERCEL_ENV") === "production" || value("VERCEL_TARGET_ENV") === "production") {
    fail("Staging must not run as a Vercel Production target.");
  }
  if (value("VERCEL") === "1" && value("VERCEL_ENV") !== "preview") {
    fail("the supported WESCOMM staging deployment must use the Vercel Preview environment.");
  }
}

console.log(JSON.stringify({
  status: "passed",
  mode: targetOnly ? "target-only" : "full",
  environment: "staging",
  supabaseProjectRef: target.stagingProjectRef,
  productionProjectSeparated: true,
  tlsRequired: true,
  ...(targetOnly ? {} : {
    sameOriginApi: true,
    developmentLoginEnabled: true,
    livePaymentsDisabled: true,
    externalAiDisabled: true
  })
}, null, 2));
