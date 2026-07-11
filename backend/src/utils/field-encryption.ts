import { env } from "../config/env.js";
import {
  decryptWithKey,
  encryptWithKey,
  isEncryptedValue
} from "./field-encryption-core.js";

export {
  decryptWithKey,
  encryptedValueVersion,
  encryptWithKey,
  hashHighEntropyLookup,
  isEncryptedValue
} from "./field-encryption-core.js";

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
