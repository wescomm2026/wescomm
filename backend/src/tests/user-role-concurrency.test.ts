import type { AppRole as PrismaAppRole } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import type { AuditLogInput } from "../services/audit-log.service.js";
import {
  USER_ROLE_UPDATE_TRANSACTION_OPTIONS,
  updateUserRoleWithDependencies,
  type UserRoleUpdateDependencies,
  type UserRoleUpdateTransaction
} from "../services/user.service.js";
import { HttpError } from "../utils/http-error.js";

type TestProfile = {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
  phone: string | null;
  department: string | null;
  role: PrismaAppRole;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function profile(id: string, role: PrismaAppRole): TestProfile {
  return {
    id,
    fullName: `User ${id}`,
    email: `${id}@wesleyan.edu.ph`,
    studentNumber: null,
    phone: null,
    department: null,
    role,
    avatarUrl: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createMutex() {
  let tail = Promise.resolve();

  return async function acquire() {
    const previous = tail;
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tail = previous.then(() => current);
    await previous;
    return release;
  };
}

function createRoleUpdateHarness(initialProfiles: TestProfile[]) {
  const profiles = new Map(initialProfiles.map((row) => [row.id, row]));
  const audits: AuditLogInput[] = [];
  const transactionEvents: string[][] = [];
  const acquireRoleLock = createMutex();

  const dependencies: UserRoleUpdateDependencies = {
    async runTransaction<T>(operation: (transaction: UserRoleUpdateTransaction) => Promise<T>) {
      const events: string[] = [];
      transactionEvents.push(events);
      let releaseRoleLock: (() => void) | undefined;

      const transaction = {
        async $queryRaw(_query: TemplateStringsArray, ..._values: unknown[]) {
          events.push("lock");
          assert.match(_query.join("?"), /pg_advisory_xact_lock/);
          assert.deepEqual(_values, [1_464_161_091, 1]);
          assert.equal(releaseRoleLock, undefined, "the role invariant lock must be acquired only once");
          releaseRoleLock = await acquireRoleLock();
          return 0;
        },
        profile: {
          async findUnique(args: { where: { id: string } }) {
            events.push("find");
            await Promise.resolve();
            const row = profiles.get(args.where.id);
            return row ? { id: row.id, role: row.role } : null;
          },
          async count() {
            events.push("count");
            const count = [...profiles.values()].filter((row) => row.role === "ADMIN").length;
            // Keep the count snapshot asynchronous. Without the advisory lock,
            // both demotions would observe two admins and reproduce the race.
            await new Promise<void>((resolve) => setImmediate(resolve));
            return count;
          },
          async update(args: { where: { id: string }; data: { role: PrismaAppRole; updatedAt: Date } }) {
            events.push("update");
            const current = profiles.get(args.where.id);
            if (!current) throw new Error("Profile disappeared during the test transaction.");
            const updated = {
              ...current,
              role: args.data.role,
              updatedAt: args.data.updatedAt
            };
            profiles.set(updated.id, updated);
            await Promise.resolve();
            return updated;
          }
        }
      } as unknown as UserRoleUpdateTransaction;

      try {
        return await operation(transaction);
      } finally {
        releaseRoleLock?.();
      }
    },
    async recordAuditLog(input) {
      audits.push(input);
      return null;
    }
  };

  return { profiles, audits, transactionEvents, dependencies };
}

function assertLastAdminError(error: unknown) {
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 400);
  assert.equal(error.message, "At least one admin account is required.");
  return true;
}

test("role updates use a bounded interactive transaction", () => {
  assert.deepEqual(USER_ROLE_UPDATE_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 20_000
  });
});

test("concurrent admin cross-demotions leave one admin and audit only the committed update", async () => {
  const harness = createRoleUpdateHarness([
    profile("admin-a", "ADMIN"),
    profile("admin-b", "ADMIN")
  ]);

  const results = await Promise.allSettled([
    updateUserRoleWithDependencies("admin-b", "STUDENT", "admin-a", harness.dependencies),
    updateUserRoleWithDependencies("admin-a", "STUDENT", "admin-b", harness.dependencies)
  ]);

  const successful = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(successful.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal([...harness.profiles.values()].filter((row) => row.role === "ADMIN").length, 1);

  const successfulResult = successful[0];
  assert.ok(successfulResult?.status === "fulfilled");
  assert.equal(successfulResult.value.role, "STUDENT");

  const rejectedResult = rejected[0];
  assert.ok(rejectedResult?.status === "rejected");
  assertLastAdminError(rejectedResult.reason);

  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0]?.entityId, successfulResult.value.id);
  assert.deepEqual(harness.audits[0]?.metadata, {
    email: successfulResult.value.email,
    previousRole: "ADMIN",
    nextRole: "STUDENT"
  });

  assert.equal(harness.transactionEvents.length, 2);
  for (const events of harness.transactionEvents) {
    assert.equal(events[0], "lock", "the advisory lock must precede every profile read");
  }
  assert.equal(harness.transactionEvents.flat().filter((event) => event === "update").length, 1);
});

test("self-demotion and last-admin rejection preserve the admin and do not create audits", async () => {
  const harness = createRoleUpdateHarness([
    profile("admin-a", "ADMIN"),
    profile("student-a", "STUDENT")
  ]);

  await assert.rejects(
    updateUserRoleWithDependencies("admin-a", "STAFF", "admin-a", harness.dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "You cannot remove your own admin access.");
      return true;
    }
  );

  await assert.rejects(
    updateUserRoleWithDependencies("admin-a", "STUDENT", "student-a", harness.dependencies),
    assertLastAdminError
  );

  assert.equal(harness.profiles.get("admin-a")?.role, "ADMIN");
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.transactionEvents.flat().filter((event) => event === "update").length, 0);
});

test("an admin demoted while waiting on the role lock cannot use stale authorization", async () => {
  const harness = createRoleUpdateHarness([
    profile("admin-a", "ADMIN"),
    profile("admin-b", "ADMIN"),
    profile("admin-c", "ADMIN")
  ]);

  const firstUpdate = updateUserRoleWithDependencies(
    "admin-b",
    "STUDENT",
    "admin-a",
    harness.dependencies
  );
  const staleWaitingUpdate = updateUserRoleWithDependencies(
    "admin-c",
    "STUDENT",
    "admin-b",
    harness.dependencies
  );

  const [firstSettled, staleSettled] = await Promise.allSettled([firstUpdate, staleWaitingUpdate]);
  assert.equal(firstSettled.status, "fulfilled");
  assert.equal(staleSettled.status, "rejected");
  if (firstSettled.status !== "fulfilled" || staleSettled.status !== "rejected") {
    throw new Error("Expected the first role update to win the advisory lock.");
  }

  const firstResult = firstSettled.value;
  assert.equal(firstResult.id, "admin-b");
  assert.equal(firstResult.role, "STUDENT");

  assert.ok(staleSettled.reason instanceof HttpError);
  assert.equal(staleSettled.reason.status, 403);
  assert.equal(staleSettled.reason.message, "You do not have access to this resource.");

  assert.equal(harness.profiles.get("admin-b")?.role, "STUDENT");
  assert.equal(harness.profiles.get("admin-c")?.role, "ADMIN");
  assert.equal([...harness.profiles.values()].filter((row) => row.role === "ADMIN").length, 2);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0]?.entityId, "admin-b");
  assert.equal(harness.transactionEvents.flat().filter((event) => event === "update").length, 1);
});

test("a successful non-admin role change keeps the existing response and audit contract", async () => {
  const harness = createRoleUpdateHarness([
    profile("admin-a", "ADMIN"),
    profile("student-a", "STUDENT")
  ]);

  const updated = await updateUserRoleWithDependencies(
    "student-a",
    "STAFF",
    "admin-a",
    harness.dependencies
  );

  assert.equal(updated.id, "student-a");
  assert.equal(updated.role, "STAFF");
  assert.equal(harness.profiles.get("student-a")?.role, "STAFF");
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0]?.action, "USER_ROLE_UPDATED");
  assert.equal(harness.audits[0]?.summary, "Updated student-a@wesleyan.edu.ph role from STUDENT to STAFF.");
  assert.deepEqual(harness.audits[0]?.metadata, {
    email: "student-a@wesleyan.edu.ph",
    previousRole: "STUDENT",
    nextRole: "STAFF"
  });
});
