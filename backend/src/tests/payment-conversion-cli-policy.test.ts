import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentConversionTargetFingerprint,
  resolvePaymentConversionCliPolicy
} from "../domain/payment-conversion-cli-policy.js";

const databaseUrl = "postgresql://postgres.project-a:secret@pool.example.com:6543/wescomm?schema=public";

test("payment conversion dry-runs identify the target without requiring confirmation", () => {
  const policy = resolvePaymentConversionCliPolicy({ args: ["--limit", "100"], databaseUrl });
  assert.equal(policy.dryRun, true);
  assert.match(policy.fingerprint, /^[a-f0-9]{12}$/);
  assert.equal(policy.expectedConfirmation, `--confirm-apply:${policy.fingerprint}`);
});

test("payment conversion apply always requires the exact target fingerprint", () => {
  const fingerprint = paymentConversionTargetFingerprint(databaseUrl);

  assert.throws(
    () => resolvePaymentConversionCliPolicy({ args: ["--apply"], databaseUrl }),
    /Apply requires an explicit database-target confirmation/
  );
  assert.throws(
    () => resolvePaymentConversionCliPolicy({ args: ["--apply", "--confirm-apply:wrong"], databaseUrl }),
    /Database fingerprint:/
  );
  assert.throws(
    () => resolvePaymentConversionCliPolicy({
      args: ["--apply", `--confirm-apply:${fingerprint}`, `--confirm-apply:${fingerprint}`],
      databaseUrl
    }),
    /Apply requires an explicit database-target confirmation/
  );

  const policy = resolvePaymentConversionCliPolicy({
    args: ["--apply", `--confirm-apply:${fingerprint}`],
    databaseUrl
  });
  assert.equal(policy.dryRun, false);
});

test("payment conversion fingerprints the actual Prisma target without secrets", () => {
  const original = paymentConversionTargetFingerprint(databaseUrl);
  assert.equal(
    original,
    paymentConversionTargetFingerprint(databaseUrl.replace(":secret@", ":rotated-secret@")),
    "password rotation must not change the target fingerprint"
  );
  assert.equal(
    original,
    paymentConversionTargetFingerprint(`${databaseUrl}&connection_limit=10`),
    "non-target connection options must not change the fingerprint"
  );

  for (const changed of [
    databaseUrl.replace("project-a", "project-b"),
    databaseUrl.replace("pool.example.com", "other.example.com"),
    databaseUrl.replace(":6543", ":5432"),
    databaseUrl.replace("/wescomm", "/wescomm_other"),
    databaseUrl.replace("schema=public", "schema=private")
  ]) {
    assert.notEqual(original, paymentConversionTargetFingerprint(changed));
  }
});

test("payment conversion target identification fails closed", () => {
  for (const invalid of [undefined, "", "not-a-url", "mysql://user:secret@localhost/wescomm", "postgresql://localhost/wescomm"]) {
    assert.throws(() => paymentConversionTargetFingerprint(invalid));
  }
});
