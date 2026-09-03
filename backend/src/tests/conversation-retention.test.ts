import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_PURGE_RETENTION_DAYS,
  createConversationPurgeFingerprint,
  getConversationPurgeConfirmationPhrase,
  getConversationPurgeEligibleAt,
  type ConversationPurgeSnapshot
} from "../domain/conversation-retention.js";

const snapshot: ConversationPurgeSnapshot = {
  conversationId: "12345678-1234-1234-1234-1234abcdef90",
  updatedAt: new Date("2026-09-01T01:02:03.000Z"),
  deletedAt: new Date("2026-09-01T01:02:03.000Z"),
  purgeEligibleAt: new Date("2026-11-30T01:02:03.000Z"),
  messageCount: 4,
  revisionCount: 2
};

test("conversation purge eligibility starts exactly after the 90-day recovery window", () => {
  assert.equal(CONVERSATION_PURGE_RETENTION_DAYS, 90);
  assert.equal(
    getConversationPurgeEligibleAt(snapshot.deletedAt).toISOString(),
    snapshot.purgeEligibleAt.toISOString()
  );
});

test("conversation purge requires a conversation-specific exact phrase", () => {
  assert.equal(
    getConversationPurgeConfirmationPhrase(snapshot.conversationId),
    "PURGE ABCDEF90"
  );
});

test("purge preview fingerprint is deterministic and changes with retained evidence", () => {
  const first = createConversationPurgeFingerprint(snapshot);
  const second = createConversationPurgeFingerprint({ ...snapshot });
  const changed = createConversationPurgeFingerprint({ ...snapshot, messageCount: 5 });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});
