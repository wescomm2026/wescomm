import "dotenv/config";
import { z } from "zod";
import { normalizeAllowedAuthMethods } from "../domain/auth-method-policy.js";
import {
  assertSafeDevelopmentLoginEnvironment,
  isProductionDeploymentEnvironment
} from "../domain/deployment-environment.js";
import { validateAllowedEmailDomains } from "../utils/auth-email-policy.js";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

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
  VAPID_SUBJECT: z.string().trim().default("mailto:wescomm@wesleyan.edu.ph")
});

const parsedEnv = envSchema.parse(process.env);
const allowedEmailDomains = validateAllowedEmailDomains(
  parsedEnv.AUTH_ALLOWED_EMAIL_DOMAINS ?? parsedEnv.AUTH_ALLOWED_EMAIL_DOMAIN,
  parsedEnv.NODE_ENV
);
const allowedAuthMethods = normalizeAllowedAuthMethods(parsedEnv.AUTH_ALLOWED_AUTH_METHODS);
const isProductionDeployment = isProductionDeploymentEnvironment(parsedEnv);

assertSafeDevelopmentLoginEnvironment(parsedEnv);

if (allowedAuthMethods.length === 0 || allowedAuthMethods.includes("*") || allowedAuthMethods.includes("password")) {
  throw new Error("AUTH_ALLOWED_AUTH_METHODS must list approved passwordless methods and cannot include '*' or 'password'.");
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

  const frontendOrigins = (parsedEnv.FRONTEND_ORIGINS ?? parsedEnv.FRONTEND_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (frontendOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("All production FRONTEND_ORIGINS must use HTTPS.");
  }
}

export const env = {
  ...parsedEnv,
  IS_PRODUCTION_DEPLOYMENT: isProductionDeployment,
  FRONTEND_ORIGINS: parsedEnv.FRONTEND_ORIGINS ?? parsedEnv.FRONTEND_ORIGIN,
  AUTH_ALLOWED_EMAIL_DOMAINS: allowedEmailDomains.join(","),
  AUTH_ALLOWED_AUTH_METHODS: allowedAuthMethods.join(",")
};
