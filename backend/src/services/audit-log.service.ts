import { supabaseAdmin } from "../lib/supabase.js";
import { firstRow } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";

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
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogFilters = {
  action?: string;
  entityType?: string;
  actorId?: string;
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
      summary: input.summary,
      metadata: input.metadata ?? {}
    })
    .select(auditLogSelect)
    .single();

  if (error) throw new HttpError(500, error.message);
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
  let query = supabaseAdmin
    .from("audit_logs")
    .select(auditLogSelect)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);

  const { data, error } = await query;
  if (error) throw new HttpError(500, error.message);

  return ((data ?? []) as unknown as RawAuditLog[]).map(mapAuditLog);
}
