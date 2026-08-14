import "dotenv/config";
import { z } from "zod";
import { normalizeAllowedAuthMethods } from "../domain/auth-method-policy.js";
import {
  assertSafeDevelopmentLoginEnvironment,
  isProductionDeploymentEnvironment
} from "../domain/deployment-environment.js";
import { assertSafeTemporaryStaffLoginEnvironment } from "../domain/temporary-staff-login-policy.js";
import { validateAllowedEmailDomains } from "../utils/auth-email-policy.js";
import { assertSafeProductionDatabaseUrls } from "../utils/database-url.js";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const optionalTrimmedString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional()
);

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL: z.literal("1").optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_TARGET_ENV: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  FRONTEND_ORIGINS: z.string().trim().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  AUTH_ALLOWED_EMAIL_DOMAIN: z.string().trim().default("wesleyan.edu.ph"),
  AUTH_ALLOWED_EMAIL_DOMAINS: z.string().trim().optional(),
  AUTH_ALLOWED_AUTH_PROVIDERS: z.string().trim().default("email"),
  AUTH_ALLOWED_AUTH_METHODS: z.string().trim().default("otp,magiclink,email/signup,token_refresh"),
  AUTH_ENABLE_DEV_LOGIN: booleanEnv.default(false),
  AUTH_DEV_LOGIN_PASSWORD: z.string().max(128).optional(),
  AUTH_DEV_LOGIN_EMAILS: z.string().trim().default(
    "student@wesleyan.edu.ph,staff@wesleyan.edu.ph,admin@wesleyan.edu.ph"
  ),
  AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: booleanEnv.default(false),
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD: z.string().max(128).optional(),
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: z.string().trim().optional(),
  NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: booleanEnv.default(false),
  NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: z.string().trim().optional(),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  AUTH_SESSION_MAX_PER_USER: z.coerce.number().int().min(1).max(20).default(5),
  DATA_ENCRYPTION_KEYS: z.string().trim().optional(),
  DATA_ENCRYPTION_CURRENT_VERSION: z.string().trim().regex(/^[A-Za-z0-9_-]{1,24}$/).default("v1"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().trim().optional(),
  VAPID_PRIVATE_KEY: z.string().trim().optional(),
  VAPID_SUBJECT: z.string().trim().default("mailto:wescomm@wesleyan.edu.ph"),
  WESBOT_ENABLED: booleanEnv.default(false),
  WESBOT_AI_ENABLED: booleanEnv.default(false),
  WESBOT_MODEL: z.string().trim().min(3).default("openai/gpt-5.6-luna"),
  AI_GATEWAY_API_KEY: optionalTrimmedString,
  VERCEL_OIDC_TOKEN: optionalTrimmedString,
  PAYMONGO_ENABLED: booleanEnv.default(false),
  PAYMONGO_SECRET_KEY: optionalTrimmedString,
  PAYMONGO_WEBHOOK_SECRET: optionalTrimmedString,
  PAYMONGO_LIVEMODE: booleanEnv.default(false),
  PAYMONGO_RETURN_ORIGIN: optionalUrl,
  PAYMONGO_CHECKOUT_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  PAYMENT_MAINTENANCE_SECRET: optionalTrimmedString
});

const parsedEnv = envSchema.parse(process.env);
const allowedEmailDomains = validateAllowedEmailDomains(
  parsedEnv.AUTH_ALLOWED_EMAIL_DOMAINS ?? parsedEnv.AUTH_ALLOWED_EMAIL_DOMAIN,
  parsedEnv.NODE_ENV
);
const allowedAuthMethods = normalizeAllowedAuthMethods(parsedEnv.AUTH_ALLOWED_AUTH_METHODS);
const isProductionDeployment = isProductionDeploymentEnvironment(parsedEnv);
const frontendOrigins = (parsedEnv.FRONTEND_ORIGINS ?? parsedEnv.FRONTEND_ORIGIN)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const paymongoReturnUrl = new URL(parsedEnv.PAYMONGO_RETURN_ORIGIN ?? parsedEnv.FRONTEND_ORIGIN);
const paymongoReturnOrigin = paymongoReturnUrl.origin;

assertSafeDevelopmentLoginEnvironment(parsedEnv);
assertSafeTemporaryStaffLoginEnvironment(parsedEnv);

if (allowedAuthMethods.length === 0 || allowedAuthMethods.includes("*") || allowedAuthMethods.includes("password")) {
  throw new Error("AUTH_ALLOWED_AUTH_METHODS must list approved passwordless methods and cannot include '*' or 'password'.");
}

if (
  paymongoReturnUrl.username ||
  paymongoReturnUrl.password ||
  paymongoReturnUrl.pathname !== "/" ||
  paymongoReturnUrl.search ||
  paymongoReturnUrl.hash
) {
  throw new Error("PAYMONGO_RETURN_ORIGIN must contain only an approved frontend origin.");
}
if (!frontendOrigins.map((origin) => new URL(origin).origin).includes(paymongoReturnOrigin)) {
  throw new Error("PAYMONGO_RETURN_ORIGIN must match an origin in FRONTEND_ORIGINS.");
}

if (parsedEnv.PAYMONGO_WEBHOOK_SECRET && parsedEnv.PAYMONGO_WEBHOOK_SECRET.length < 16) {
  throw new Error("PAYMONGO_WEBHOOK_SECRET must contain at least 16 characters when configured.");
}
if (parsedEnv.PAYMENT_MAINTENANCE_SECRET && parsedEnv.PAYMENT_MAINTENANCE_SECRET.length < 32) {
  throw new Error("PAYMENT_MAINTENANCE_SECRET must contain at least 32 characters when configured.");
}

if (parsedEnv.PAYMONGO_ENABLED) {
  if (!parsedEnv.PAYMONGO_SECRET_KEY) {
    throw new Error("PAYMONGO_SECRET_KEY is required when PAYMONGO_ENABLED is true.");
  }
  if (!parsedEnv.PAYMONGO_WEBHOOK_SECRET) {
    throw new Error("PAYMONGO_WEBHOOK_SECRET of at least 16 characters is required when PAYMONGO_ENABLED is true.");
  }
  if (isProductionDeployment && !parsedEnv.PAYMENT_MAINTENANCE_SECRET) {
    throw new Error(
      "PAYMENT_MAINTENANCE_SECRET of at least 32 characters is required when PayMongo is enabled in production."
    );
  }

  const expectedKeyPrefix = parsedEnv.PAYMONGO_LIVEMODE ? "sk_live_" : "sk_test_";
  if (!parsedEnv.PAYMONGO_SECRET_KEY.startsWith(expectedKeyPrefix)) {
    throw new Error(`PAYMONGO_SECRET_KEY must start with ${expectedKeyPrefix} for the configured mode.`);
  }

}

if (parsedEnv.PAYMONGO_LIVEMODE && !isProductionDeployment) {
  throw new Error("Live PayMongo payment processing is allowed only in the production deployment.");
}

if (parsedEnv.WESBOT_AI_ENABLED) {
  if (!parsedEnv.WESBOT_ENABLED) {
    throw new Error("WESBOT_AI_ENABLED requires WESBOT_ENABLED to be true.");
  }
  if (!parsedEnv.WESBOT_MODEL.includes("/")) {
    throw new Error("WESBOT_MODEL must use the AI Gateway provider/model format.");
  }
  if (!parsedEnv.AI_GATEWAY_API_KEY && !parsedEnv.VERCEL_OIDC_TOKEN) {
    throw new Error("WesBot AI requires Vercel OIDC or an AI Gateway API key.");
  }
}

function validateEncryptionKeys(value: string | undefined, currentVersion: string) {
  if (!value) return false;

  const versions = new Set<string>();
  for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("DATA_ENCRYPTION_KEYS must use version:base64 entries.");

    const version = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(version) || versions.has(version)) {
      throw new Error("DATA_ENCRYPTION_KEYS contains an invalid or duplicate key version.");
    }

    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) throw new Error(`Encryption key ${version} must decode to exactly 32 bytes.`);
    versions.add(version);
  }

  if (!versions.has(currentVersion)) {
    throw new Error("DATA_ENCRYPTION_CURRENT_VERSION must identify a configured encryption key.");
  }

  return true;
}

const hasEncryptionKeys = validateEncryptionKeys(
  parsedEnv.DATA_ENCRYPTION_KEYS,
  parsedEnv.DATA_ENCRYPTION_CURRENT_VERSION
);

function requiresDatabaseTls(value: string) {
  return /[?&]sslmode=(require|verify-ca|verify-full)(?:&|$)/i.test(value);
}

if (parsedEnv.NODE_ENV === "production") {
  if (!hasEncryptionKeys) throw new Error("DATA_ENCRYPTION_KEYS is required in production.");
  if (!requiresDatabaseTls(parsedEnv.DATABASE_URL)) {
    throw new Error("DATABASE_URL must require or verify TLS in production.");
  }
  if (!requiresDatabaseTls(parsedEnv.DIRECT_URL)) {
    throw new Error("DIRECT_URL must require or verify TLS in production.");
  }
  if (!parsedEnv.NEXT_PUBLIC_SUPABASE_URL.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production.");
  }
  if (parsedEnv.SUPABASE_SERVICE_ROLE_KEY === parsedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("The Supabase service-role key must not match the public anon key.");
  }

  if (frontendOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("All production FRONTEND_ORIGINS must use HTTPS.");
  }
  assertSafeProductionDatabaseUrls(
    parsedEnv.DATABASE_URL,
    parsedEnv.DIRECT_URL,
    parsedEnv.NEXT_PUBLIC_SUPABASE_URL
  );
  if (parsedEnv.PAYMONGO_ENABLED && !paymongoReturnOrigin.startsWith("https://")) {
    throw new Error("PAYMONGO_RETURN_ORIGIN must use HTTPS when PayMongo is enabled in production.");
  }
}

export const env = {
  ...parsedEnv,
  IS_PRODUCTION_DEPLOYMENT: isProductionDeployment,
  FRONTEND_ORIGINS: parsedEnv.FRONTEND_ORIGINS ?? parsedEnv.FRONTEND_ORIGIN,
  PAYMONGO_RETURN_ORIGIN: paymongoReturnOrigin,
  AUTH_ALLOWED_EMAIL_DOMAINS: allowedEmailDomains.join(","),
  AUTH_ALLOWED_AUTH_METHODS: allowedAuthMethods.join(",")
};
