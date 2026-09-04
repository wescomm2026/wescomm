import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { editConversationMessage } from "../services/message.service.js";
import { decryptSensitiveText, encryptSensitiveText } from "../utils/field-encryption.js";

test("PostgreSQL edits the selected student message in place after a bot reply", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const conversationId = randomUUID();
  const studentMessageId = randomUUID();
  const botMessageId = randomUUID();
  const originalMessage = "Is the WESCOMM shirt available?";
  const editedMessage = "Is the blue WESCOMM shirt available?";
  const createdAt = new Date(Date.now() - 5 * 60_000);

  try {
    await prisma.profile.create({
      data: {
        id: studentId,
        fullName: "Message Edit Student",
        email: `message-edit-${suffix}@example.invalid`,
        role: "STUDENT"
      }
    });
    await prisma.conversation.create({
      data: {
        id: conversationId,
        studentId,
        subject: "Message edit integration test",
        status: "OPEN",
        mode: "BOT_ACTIVE"
      }
    });
    await prisma.conversationMessage.createMany({
      data: [
        {
          id: studentMessageId,
          conversationId,
          senderId: studentId,
          senderType: "STUDENT",
          message: encryptSensitiveText(originalMessage, "conversation.message")!,
          createdAt
        },
        {
          id: botMessageId,
          conversationId,
          senderType: "BOT",
          message: encryptSensitiveText("The original answer remains part of the history.", "conversation.message")!,
          createdAt: new Date(createdAt.getTime() + 1_000)
        }
      ]
    });

    const updated = await editConversationMessage({
      conversationId,
      messageId: studentMessageId,
      userId: studentId,
      role: "STUDENT",
      message: editedMessage,
      expectedEditVersion: 0
    });

    assert.equal(updated.id, studentMessageId);
    assert.equal(updated.message, editedMessage);
    assert.equal(updated.editVersion, 1);
    assert.ok(updated.editedAt);

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, studentMessageId);
    assert.equal(decryptSensitiveText(messages[0].message, "conversation.message"), editedMessage);
    assert.equal(messages[1].id, botMessageId);

    const revisions = await prisma.conversationMessageRevision.findMany({
      where: { messageId: studentMessageId }
    });
    assert.equal(revisions.length, 1);
    assert.equal(decryptSensitiveText(revisions[0].previousMessage, "conversation.message"), originalMessage);
    assert.equal(decryptSensitiveText(revisions[0].newMessage, "conversation.message"), editedMessage);
  } finally {
    await prisma.realtimeEvent.deleteMany({ where: { entityId: conversationId } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: conversationId } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "conversation_message", entityId: studentMessageId }
    });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.profile.deleteMany({ where: { id: studentId } });
  }
});
