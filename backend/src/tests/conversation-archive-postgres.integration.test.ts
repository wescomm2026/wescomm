import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { setConversationArchived } from "../services/message.service.js";

test("PostgreSQL allows personal student archive on an open conversation while keeping operations resolved-only", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const conversationId = randomUUID();

  try {
    await prisma.profile.create({
      data: {
        id: studentId,
        fullName: "Conversation Archive Student",
        email: `conversation-archive-${suffix}@example.invalid`,
        role: "STUDENT"
      }
    });
    await prisma.conversation.create({
      data: {
        id: conversationId,
        studentId,
        subject: "Conversation archive integration test",
        status: "OPEN",
        mode: "BOT_ACTIVE"
      }
    });

    await setConversationArchived({
      conversationId,
      userId: studentId,
      role: "STUDENT",
      archived: true
    });

    const studentArchived = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        status: true,
        studentArchivedAt: true,
        operationsArchivedAt: true
      }
    });
    assert.equal(studentArchived.status, "OPEN");
    assert.ok(studentArchived.studentArchivedAt instanceof Date);
    assert.equal(studentArchived.operationsArchivedAt, null);

    await setConversationArchived({
      conversationId,
      userId: studentId,
      role: "STUDENT",
      archived: false
    });
    assert.equal(
      (await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { studentArchivedAt: true }
      })).studentArchivedAt,
      null
    );

    await assert.rejects(
      prisma.conversation.update({
        where: { id: conversationId },
        data: { operationsArchivedAt: new Date() }
      }),
      (error: unknown) => {
        assert.match(String(error), /conversations_operations_archive_requires_resolved_check/);
        return true;
      }
    );

    const resolvedAt = new Date();
    const operationsArchived = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: "RESOLVED",
        mode: "RESOLVED",
        resolvedAt,
        operationsArchivedAt: resolvedAt
      },
      select: {
        status: true,
        operationsArchivedAt: true
      }
    });
    assert.equal(operationsArchived.status, "RESOLVED");
    assert.ok(operationsArchived.operationsArchivedAt instanceof Date);
  } finally {
    await prisma.realtimeEvent.deleteMany({ where: { entityId: conversationId } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: conversationId } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "conversation", entityId: conversationId }
    });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.profile.deleteMany({ where: { id: studentId } });
  }
});
