import { createHash } from "node:crypto";

export const CONVERSATION_PURGE_RETENTION_DAYS = 90;

export type ConversationPurgeSnapshot = {
  conversationId: string;
  updatedAt: Date;
  deletedAt: Date;
  purgeEligibleAt: Date;
  messageCount: number;
  revisionCount: number;
};

export function getConversationPurgeEligibleAt(deletedAt: Date) {
  return new Date(
    deletedAt.getTime() + CONVERSATION_PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  );
}

export function getConversationPurgeConfirmationPhrase(conversationId: string) {
  return `PURGE ${conversationId.slice(-8).toUpperCase()}`;
}

export function createConversationPurgeFingerprint(snapshot: ConversationPurgeSnapshot) {
  return createHash("sha256")
    .update(JSON.stringify({
      conversationId: snapshot.conversationId,
      updatedAt: snapshot.updatedAt.toISOString(),
      deletedAt: snapshot.deletedAt.toISOString(),
      purgeEligibleAt: snapshot.purgeEligibleAt.toISOString(),
      messageCount: snapshot.messageCount,
      revisionCount: snapshot.revisionCount
    }))
    .digest("hex");
}
