import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptWithKey,
  encryptWithKey,
  isEncryptedValue
} from "../utils/field-encryption-core.js";

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");

test("AES-GCM field encryption round-trips without exposing plaintext", () => {
  const plaintext = "Private support conversation";
  const encrypted = encryptWithKey(plaintext, "conversation.message", "test-v1", key);

  assert.equal(isEncryptedValue(encrypted), true);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(
    decryptWithKey(encrypted, "conversation.message", (version) => version === "test-v1" ? key : undefined),
    plaintext
  );
});

test("encrypted values cannot be moved to a different field context", () => {
  const encrypted = encryptWithKey("09123456789", "profile.phone", "test-v1", key);

  assert.throws(() => {
    decryptWithKey(encrypted, "profile.address", () => key);
  });
});

test("tampering with encrypted data is detected", () => {
  const encrypted = encryptWithKey("Sensitive value", "profile.address", "test-v1", key);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => {
    decryptWithKey(tampered, "profile.address", () => key);
  });
});

test("legacy plaintext stays readable during the migration window", () => {
  assert.equal(decryptWithKey("Existing plaintext", "conversation.message", () => key), "Existing plaintext");
});
