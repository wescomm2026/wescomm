import assert from "node:assert/strict";
import test from "node:test";
import {
  maskPublicPersonName,
  maskPublicReferenceCode,
  maskPublicStudentNumber,
  summarizePublicReceiptItems
} from "../domain/public-receipt.js";

test("public receipt identity fields expose only masked values", () => {
  assert.equal(maskPublicPersonName("John Mark Doe"), "J*** D.");
  assert.equal(maskPublicPersonName("Li"), "L***");
  assert.equal(maskPublicPersonName(null), "Verified student");

  const studentNumber = maskPublicStudentNumber("2026-123456");
  assert.equal(studentNumber?.endsWith("3456"), true);
  assert.equal(studentNumber?.includes("2026"), false);

  const referenceCode = maskPublicReferenceCode("WES-2026-ABC123");
  assert.equal(referenceCode?.endsWith("C123"), true);
  assert.equal(referenceCode?.includes("WES-2026"), false);
});

test("public receipt item summaries reveal counts without product details", () => {
  assert.deepEqual(
    summarizePublicReceiptItems([{ quantity: 2 }, { quantity: 1 }, { quantity: 4 }]),
    { itemCount: 3, totalQuantity: 7 }
  );
  assert.deepEqual(summarizePublicReceiptItems(null), { itemCount: 0, totalQuantity: 0 });
});
