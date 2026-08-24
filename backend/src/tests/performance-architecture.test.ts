import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function sources(...relativePaths: string[]) {
  return relativePaths.map(source).join("\n");
}

test("read-heavy pages minimize database round trips without read-only transactions", () => {
  const dashboard = source("src/services/dashboard.service.ts");
  const reports = source("src/services/report.service.ts");
  const users = source("src/services/user.service.ts");

  assert.match(dashboard, /buildStaffDashboardSummary[\s\S]*withTransientPrismaReadRetry\(\(\) => prisma\.\$queryRaw/);
  assert.equal(dashboard.match(/prisma\.\$queryRaw/g)?.length, 1);
  assert.match(reports, /buildReportSummary[\s\S]*withTransientPrismaReadRetry\(\(\) => prisma\.\$queryRaw/);
  assert.equal(reports.match(/prisma\.\$queryRaw/g)?.length, 1);
  assert.match(users, /listUsers[\s\S]*withTransientPrismaReadRetry\(\(\) => prisma\.\$queryRaw/);
  assert.doesNotMatch(dashboard, /prisma\.\$transaction/);
  assert.doesNotMatch(reports, /prisma\.\$transaction/);
});

test("bounded shared read caches are invalidated only after successful operational writes", () => {
  const products = source("src/services/product.service.ts");
  const dashboard = source("src/services/dashboard.service.ts");
  const invalidation = source("src/services/operational-cache.service.ts");
  const staffProducts = source("src/routes/staff-products.routes.ts");
  const reservations = source("src/routes/reservations.routes.ts");

  assert.match(products, /getCache\(\{ namespace: "wescomm-products" \}\)/);
  assert.match(products, /tags: \["products"\]/);
  assert.match(products, /invalidateByTag\("products"\)/);
  assert.match(dashboard, /getCache\(\{ namespace: "wescomm-dashboard" \}\)/);
  assert.match(dashboard, /DASHBOARD_CACHE_TTL_MS = 10_000/);
  assert.match(invalidation, /invalidatePublicProductCache\(\)[\s\S]*invalidateStaffDashboardCache\(\)[\s\S]*invalidateReportSummaryCache\(\)/);
  assert.match(staffProducts, /async function publishInventoryChange[\s\S]*await invalidateOperationalReadCaches\(\)[\s\S]*publishRealtimeEventsBestEffort/);
  assert.match(reservations, /const result = await measureRequestPhase[\s\S]*await invalidateOperationalReadCaches\(\)[\s\S]*scheduleOutboxProcessing\(\)/);
});

test("role bundles and list refreshes avoid startup blockers and stale responses", () => {
  const rootLayout = source("../frontend/app/layout.tsx");
  const studentLayout = source("../frontend/app/student/layout.tsx");
  const auth = source("../frontend/components/auth/StudentAuthProvider.tsx");
  const welcomeOverlay = source("../frontend/components/auth/WelcomeGateOverlay.tsx");
  const welcomeIntro = source("../frontend/lib/welcome-intro.ts");
  const adminCharts = sources(
    "../frontend/components/admin/AdminDashboardExperience.tsx",
    "../frontend/components/admin/AdminReportsExperience.tsx",
  );
  const adminRequests = sources(
    "../frontend/components/admin/AdminExperienceShared.tsx",
    "../frontend/components/admin/AdminUsersExperience.tsx",
    "../frontend/components/admin/AdminAuditLogsExperience.tsx",
  );
  const staffRequests = sources(
    "../frontend/components/staff/StaffDashboard.tsx",
    "../frontend/components/staff/StaffReports.tsx",
    "../frontend/components/staff/StaffReservationsExperience.tsx",
    "../frontend/components/staff/StaffReceiptsExperience.tsx",
    "../frontend/components/staff/StaffUsersExperience.tsx",
  );
  const api = source("../frontend/lib/api.ts");

  assert.doesNotMatch(rootLayout, /StudentCartProvider|StudentRestrictionProvider|wescomm-logo-intro\.mp4/);
  assert.match(studentLayout, /StudentRestrictionProvider[\s\S]*StudentCartProvider/);
  assert.match(rootLayout, /welcomeIntroBootstrapScript\(\)[\s\S]*<WelcomeGateOverlay/);
  assert.match(auth, /useState<StudentUser \| null>\(null\)/);
  assert.doesNotMatch(auth, /WelcomeGateOverlay|WELCOME_GATE_(?:MINIMUM|MAXIMUM)_DURATION_MS/);
  assert.match(welcomeIntro, /window\.sessionStorage\.getItem/);
  assert.match(welcomeIntro, /prefers-reduced-motion: reduce/);
  assert.match(welcomeOverlay, /WELCOME_INTRO_VIDEO_SRC/);
  assert.match(welcomeOverlay, /Play with sound/);
  assert.doesNotMatch(welcomeOverlay, /\n\s*muted\s*\n/);
  assert.doesNotMatch(welcomeOverlay, /\n\s*autoPlay\s*\n/);
  assert.match(welcomeOverlay, /startupTimeoutRef\.current = window\.setTimeout\([\s\S]*setSoundStartRequired\(true\)/);
  assert.match(adminCharts, /dynamic\([\s\S]*AdminCharts/);
  assert.doesNotMatch(adminCharts, /from "recharts"/);
  assert.match(adminRequests, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(staffRequests, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(api, /signal\?: AbortSignal/);
});
