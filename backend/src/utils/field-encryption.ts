import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ENVELOPE_PREFIX = "wescomm.enc";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

type KeyResolver = (version: string) => Buffer | undefined;

function parseConfiguredKeys() {
  const keys = new Map<string, Buffer>();

  for (const entry of (env.DATA_ENCRYPTION_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const version = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    keys.set(version, key);
  }

  return keys;
}

const configuredKeys = parseConfiguredKeys();

function requireCurrentKey() {
  const key = configuredKeys.get(env.DATA_ENCRYPTION_CURRENT_VERSION);
  if (!key) {
    throw new Error("Sensitive-data encryption is not configured. Set DATA_ENCRYPTION_KEYS before writing private data.");
  }
  return key;
}

export function isEncryptedValue(value: string | null | undefined) {
  return Boolean(value?.startsWith(`${ENVELOPE_PREFIX}.`));
}

export function encryptedValueVersion(value: string | null | undefined) {
  if (!isEncryptedValue(value)) return null;
  return value!.split(".")[2] ?? null;
}

export function hashHighEntropyLookup(value: string, context: string) {
  return createHash("sha256").update(context).update("\0").update(value).digest("hex");
}

export function encryptWithKey(value: string, context: string, version: string, key: Buffer) {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    version,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptWithKey(value: string, context: string, resolveKey: KeyResolver) {
  if (!isEncryptedValue(value)) return value;

  const parts = value.split(".");
  if (parts.length !== 6 || `${parts[0]}.${parts[1]}` !== ENVELOPE_PREFIX) {
    throw new Error("Encrypted value has an invalid envelope.");
  }

  const [, , version, encodedIv, encodedTag, encodedCiphertext] = parts;
  const key = resolveKey(version);
  if (!key) throw new Error(`Encryption key version ${version} is unavailable.`);

  const iv = Buffer.from(encodedIv, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error("Encrypted value has invalid parameters.");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptSensitiveText(value: string | null | undefined, context: string) {
  if (value == null || value === "") return value ?? null;
  if (isEncryptedValue(value)) return value;

  return encryptWithKey(
    value,
    context,
    env.DATA_ENCRYPTION_CURRENT_VERSION,
    requireCurrentKey()
  );
}

export function decryptSensitiveText(value: string | null | undefined, context: string) {
  if (value == null || value === "") return value ?? null;
  return decryptWithKey(value, context, (version) => configuredKeys.get(version));
}

export function reencryptSensitiveText(value: string | null | undefined, context: string) {
  if (value == null || value === "") return value ?? null;
  const plaintext = decryptSensitiveText(value, context);
  return encryptWithKey(
    plaintext ?? "",
    context,
    env.DATA_ENCRYPTION_CURRENT_VERSION,
    requireCurrentKey()
  );
}
