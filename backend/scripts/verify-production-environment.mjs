const requiredExplicitVariables = [
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "FRONTEND_ORIGIN",
  "FRONTEND_ORIGINS",
  "TRUST_PROXY_HOPS",
  "AUTH_ALLOWED_EMAIL_DOMAINS",
  "AUTH_ALLOWED_AUTH_PROVIDERS",
  "AUTH_ALLOWED_AUTH_METHODS",
  "AUTH_ENABLE_DEV_LOGIN",
  "AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN",
  "NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN",
  "AUTH_SESSION_TTL_HOURS",
  "AUTH_SESSION_MAX_PER_USER",
  "DATA_ENCRYPTION_CURRENT_VERSION",
  "DATA_ENCRYPTION_KEYS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "WESBOT_ENABLED",
  "WESBOT_AI_ENABLED",
  "WESBOT_AI_REWRITE_ENABLED",
  "WESBOT_SEMANTIC_MODE",
  "PAYMONGO_ENABLED",
  "PAYMONGO_LIVEMODE",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN",
  "NEXT_PUBLIC_ENABLE_DEV_LOGIN",
  "NEXT_PUBLIC_E2E_TEST"
];

function fail(message) {
  throw new Error(`Production environment verification failed: ${message}`);
}

function explicitValue(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const missingVariables = requiredExplicitVariables.filter((name) => !explicitValue(name));
if (missingVariables.length > 0) {
  fail(`missing explicit variables: ${missingVariables.join(", ")}`);
}

const exactValues = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  TRUST_PROXY_HOPS: "1",
  AUTH_ENABLE_DEV_LOGIN: "false",
  AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "false",
  NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "false",
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_API_URL: "/api",
  NEXT_PUBLIC_ENABLE_DEV_LOGIN: "false",
  NEXT_PUBLIC_E2E_TEST: "false"
};

for (const [name, expected] of Object.entries(exactValues)) {
  if (explicitValue(name) !== expected) fail(`${name} must be exactly ${expected}.`);
}

if (explicitValue("BACKEND_API_URL")) {
  fail("BACKEND_API_URL must be unset for the same-origin Vercel Services deployment.");
}

const frontendOrigin = explicitValue("FRONTEND_ORIGIN");
const frontendOriginUrl = new URL(frontendOrigin);
if (frontendOrigin !== frontendOriginUrl.origin || frontendOriginUrl.protocol !== "https:") {
  fail("FRONTEND_ORIGIN must be one exact HTTPS origin without a trailing slash, path, query, or fragment.");
}

const frontendOrigins = explicitValue("FRONTEND_ORIGINS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!frontendOrigins.includes(frontendOrigin)) {
  fail("FRONTEND_ORIGINS must include FRONTEND_ORIGIN.");
}
for (const origin of frontendOrigins) {
  const parsed = new URL(origin);
  if (origin !== parsed.origin || parsed.protocol !== "https:") {
    fail("every FRONTEND_ORIGINS entry must be one exact HTTPS origin.");
  }
}

const publicEmailDomain = explicitValue("NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN").toLowerCase();
const allowedEmailDomains = explicitValue("AUTH_ALLOWED_EMAIL_DOMAINS")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
if (!allowedEmailDomains.includes(publicEmailDomain)) {
  fail("the public email domain must be present in AUTH_ALLOWED_EMAIL_DOMAINS.");
}

const vapidPublicKey = explicitValue("VAPID_PUBLIC_KEY");
const vapidPrivateKey = explicitValue("VAPID_PRIVATE_KEY");
if (!/^[A-Za-z0-9_-]{80,100}$/.test(vapidPublicKey)) {
  fail("VAPID_PUBLIC_KEY does not have the expected URL-safe key shape.");
}
if (!/^[A-Za-z0-9_-]{40,60}$/.test(vapidPrivateKey)) {
  fail("VAPID_PRIVATE_KEY does not have the expected URL-safe key shape.");
}
if (!/^(mailto:|https:\/\/)/i.test(explicitValue("VAPID_SUBJECT"))) {
  fail("VAPID_SUBJECT must use mailto: or HTTPS.");
}

// Prevent dotenv/config in the application module from filling missing
// Production values from a developer's backend/.env file.
process.env.DOTENV_CONFIG_PATH = "__wescomm_production_verifier_no_env_file__";
const { env } = await import("../dist/config/env.js");

if (!env.IS_PRODUCTION_DEPLOYMENT) fail("the application did not recognize a Production deployment.");
if (env.AUTH_ALLOWED_AUTH_PROVIDERS.trim().toLowerCase() !== "email") {
  fail("AUTH_ALLOWED_AUTH_PROVIDERS must be email for the passwordless Production boundary.");
}

if (env.PAYMONGO_ENABLED && !env.PAYMONGO_LIVEMODE) {
  fail("enabled Production checkout must use PAYMONGO_LIVEMODE=true.");
}
if (!env.PAYMONGO_ENABLED && env.PAYMONGO_LIVEMODE) {
  fail("PAYMONGO_LIVEMODE must be false while checkout creation is disabled.");
}

console.log(JSON.stringify({
  status: "passed",
  environment: "production",
  sameOriginApi: true,
  frontendOriginCount: frontendOrigins.length,
  passwordlessAuthOnly: true,
  developmentLoginDisabled: true,
  temporaryProductionLoginDisabled: true,
  fieldEncryptionConfigured: true,
  webPushConfigured: true,
  paymongo: {
    enabled: env.PAYMONGO_ENABLED,
    liveMode: env.PAYMONGO_LIVEMODE
  },
  wesbot: {
    enabled: env.WESBOT_ENABLED,
    aiEnabled: env.WESBOT_AI_ENABLED,
    semanticMode: env.WESBOT_SEMANTIC_MODE
  }
}, null, 2));
