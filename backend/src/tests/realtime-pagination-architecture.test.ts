import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("secure realtime events stay server-only, targeted, replayable, and idempotent", () => {
  const migration = source("prisma/migrations/20260822030000_add_secure_realtime_events/migration.sql");
  const service = source("src/services/realtime-event.service.ts");
  const route = source("src/routes/realtime.routes.ts");
  const client = source("../frontend/components/realtime/RealtimeProvider.tsx");

  assert.match(migration, /CREATE TABLE "realtime_events"/);
  assert.match(migration, /exactly_one_audience_check/);
  assert.match(migration, /CREATE UNIQUE INDEX "realtime_events_dedupe_key_key"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY/i);
  assert.match(service, /audienceUserId: input\.userId/);
  assert.match(service, /audienceRole: input\.role/);
  assert.match(service, /id: \{ gt: input\.afterId \}/);
  assert.match(service, /skipDuplicates: true/);
  assert.match(route, /"\/events",\s*requireAuth/);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /Last-Event-ID/);
  assert.match(client, /new EventSource\([\s\S]*withCredentials: true/);
  assert.doesNotMatch(client, /supabase/i);
});

test("chat typing leaves process-local memory and uses authenticated realtime delivery", () => {
  const messages = source("src/services/message.service.ts");
  const studentChat = source("../frontend/components/support/StudentSupportExperience.tsx");
  const staffChat = source("../frontend/components/staff/StaffOperations.tsx");

  assert.doesNotMatch(messages, /typingState\s*=\s*new Map/);
  assert.match(messages, /topic: REALTIME_TOPICS\.typing/);
  assert.match(messages, /ttlMs: 15_000/);
  assert.match(studentChat, /useRealtimeRefresh\(\["conversations", "typing"\]/);
  assert.match(staffChat, /useRealtimeRefresh\(\["conversations", "typing"\]/);
  assert.doesNotMatch(studentChat, /setInterval\(refreshThread, 8000\)/);
  assert.doesNotMatch(staffChat, /setInterval\(refreshThread, 8000\)/);
});

test("restriction and no-show collections use independent bounded cursor pages and server filters", () => {
  const service = source("src/services/restriction.service.ts");
  const routes = source("src/routes/staff-restrictions.routes.ts");
  const client = source("../frontend/components/restrictions/StaffRestrictionManagement.tsx");

  assert.match(service, /listRestrictionOverview[\s\S]*normalizePageLimit\(filters\.limit\)/);
  assert.match(service, /listNoShowCandidates[\s\S]*normalizePageLimit\(filters\.limit\)/);
  assert.match(service, /createPage\(students, limit\)/);
  assert.match(service, /createPage\(candidates, limit\)/);
  assert.doesNotMatch(service, /take:\s*200/);
  assert.doesNotMatch(service, /take:\s*100/);
  assert.match(routes, /cursor: z\.string\(\)[\s\S]*limit: z\.coerce\.number/);
  assert.match(routes, /"\/no-shows"/);
  assert.match(client, /Load more students/);
  assert.match(client, /Load more no-show reviews/);
});

test("reservation creation retries bounded serialization conflicts without weakening stock checks", () => {
  const reservations = source("src/services/reservation.service.ts");

  assert.match(reservations, /RESERVATION_SERIALIZATION_MAX_ATTEMPTS = 6/);
  assert.match(reservations, /withReservationSerializationRetry[\s\S]*error\.code !== "P2034"[\s\S]*waitForReservationSerializationRetry\(attempt\)/);
  assert.match(reservations, /const transactionResult = await withReservationSerializationRetry\(executeTransaction\)/);
  assert.match(reservations, /const result = await withReservationSerializationRetry\(\(\) => prisma\.\$transaction/);
  assert.match(reservations, /stock: \{ gte: quantity \}/);
  assert.match(reservations, /RESERVATION_SERIALIZATION_CONFLICT/);
});
