import { Prisma } from "@prisma/client";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { firstRow } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";

type RawAuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor:
    | { id: string; full_name: string; email: string; student_number: string | null; role: string }
    | Array<{ id: string; full_name: string; email: string; student_number: string | null; role: string }>
    | null;
};

export type AuditLogInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  dedupeKey?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogFilters = {
  action?: string;
  entityType?: string;
  actorId?: string;
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit?: number;
};

const auditLogSelect = `
  id,
  actor_id,
  action,
  entity_type,
  entity_id,
  summary,
  metadata,
  created_at,
  actor:profiles!audit_logs_actor_id_fkey(id,full_name,email,student_number,role)
`;

function mapAuditLog(row: RawAuditLog) {
  const actor = firstRow(row.actor);
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    actor: actor
      ? {
          id: actor.id,
          fullName: actor.full_name,
          email: actor.email,
          studentNumber: actor.student_number,
          role: actor.role
        }
      : null
  };
}

export async function recordAuditLog(input: AuditLogInput) {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .insert({
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
      summary: input.summary,
      metadata: input.metadata ?? {}
    })
    .select(auditLogSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  return mapAuditLog(data as unknown as RawAuditLog);
}

export async function safelyRecordAuditLog(input: AuditLogInput) {
  try {
    return await recordAuditLog(input);
  } catch (error) {
    console.warn("Audit log skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function listAuditLogs(filters: AuditLogFilters = {}) {
  const limit = normalizePageLimit(filters.limit);
  const cursorId = decodeCursor(filters.cursor);
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {})
    };
  }
  if (filters.query?.trim()) {
    const query = filters.query.trim();
    where.OR = [
      { summary: { contains: query, mode: "insensitive" } },
      { action: { contains: query, mode: "insensitive" } },
      { entityType: { contains: query, mode: "insensitive" } },
      { entityId: { contains: query, mode: "insensitive" } },
      { actor: { is: { OR: [
        { fullName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } }
      ] } } }
    ];
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      actorId: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, email: true, studentNumber: true, role: true } }
    }
  });
  return createPage(rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor
      ? {
          id: row.actor.id,
          fullName: row.actor.fullName,
          email: row.actor.email,
          studentNumber: row.actor.studentNumber,
          role: row.actor.role
        }
      : null
  })), limit);
}
