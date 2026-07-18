import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmailAllowedForDomains,
  normalizeAllowedEmailDomains,
  validateAllowedEmailDomains
} from "../utils/auth-email-policy.js";

test("allowed school email domains are normalized and deduplicated", () => {
  assert.deepEqual(
    normalizeAllowedEmailDomains(" @WESLEYAN.EDU.PH,students.wesleyan.edu.ph,wesleyan.edu.ph "),
    ["wesleyan.edu.ph", "students.wesleyan.edu.ph"]
  );
});

test("blank allowed-domain configuration fails closed", () => {
  assert.throws(
    () => validateAllowedEmailDomains(" , @,  ", "development"),
    /must include at least one approved school email domain/
  );
});

test("production rejects wildcard email-domain access", () => {
  assert.throws(
    () => validateAllowedEmailDomains("wesleyan.edu.ph,*", "production"),
    /must not use a wildcard in production/
  );
  assert.deepEqual(validateAllowedEmailDomains("*", "development"), ["*"]);
});

test("email-domain matching is exact and an empty policy never allows access", () => {
  const domains = ["wesleyan.edu.ph"];
  assert.equal(isEmailAllowedForDomains("student@wesleyan.edu.ph", domains), true);
  assert.equal(isEmailAllowedForDomains("student@evilwesleyan.edu.ph", domains), false);
  assert.equal(isEmailAllowedForDomains("student@example.com", []), false);
  assert.equal(isEmailAllowedForDomains("student@other.example@wesleyan.edu.ph", domains), false);
  assert.equal(isEmailAllowedForDomains("not-an-email", domains), false);
});
