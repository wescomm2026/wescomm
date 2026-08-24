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
  assert.match(welcomeIntro, /display-mode: standalone/);
  assert.match(welcomeIntro, /display-mode: minimal-ui/);
  assert.match(welcomeIntro, /window\.navigator\.standalone === true/);
  assert.match(welcomeIntro, /shouldShow = isInstalledApp && !reducedMotion && !alreadySeen/);
  assert.match(welcomeOverlay, /WELCOME_INTRO_VIDEO_SRC/);
  assert.match(welcomeOverlay, /Restart with sound/);
  assert.doesNotMatch(welcomeOverlay, /next\/image|welcome-gate-fallback-logo/);
  assert.doesNotMatch(welcomeOverlay, /\n\s*muted\s*\n/);
  assert.doesNotMatch(welcomeOverlay, /\n\s*autoPlay\s*\n/);
  assert.match(welcomeOverlay, /MEDIA_STARTUP_TIMEOUT_MS = 1_600/);
  assert.match(welcomeOverlay, /MEDIA_ABSOLUTE_TIMEOUT_MS = 4_000/);
  assert.match(welcomeOverlay, /refreshStartupStallTimeout[\s\S]*failMediaAndExit/);
  assert.match(welcomeOverlay, /handleVideoProgress[\s\S]*bufferedUntil > bufferedUntilRef\.current/);
  assert.match(welcomeOverlay, /onProgress=\{handleVideoProgress\}/);
  assert.match(welcomeOverlay, /type WelcomeMediaState = "loading" \| "playing" \| "playing-muted" \| "failed"/);
  assert.match(welcomeOverlay, /startMutedPlayback[\s\S]*video\.muted = true/);
  assert.match(welcomeOverlay, /isAutoplayPolicyError[\s\S]*autoplayPolicyBlockedRef\.current = true;[\s\S]*startMutedPlayback\(video\)/);
  assert.match(welcomeOverlay, /data-media-ready=\{mediaState === "playing" \|\| mediaState === "playing-muted"/);
  assert.match(welcomeOverlay, /data-sound-start-required=\{mediaState === "playing-muted"/);
  assert.doesNotMatch(welcomeOverlay, /awaiting-sound|Play with sound/);
  assert.match(adminCharts, /dynamic\([\s\S]*AdminCharts/);
  assert.doesNotMatch(adminCharts, /from "recharts"/);
  assert.match(adminRequests, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(staffRequests, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(api, /signal\?: AbortSignal/);
});

test("welcome media stays compact, progressively playable, and outside the PWA install payload", () => {
  const welcomeMedia = readFileSync(path.resolve(
    process.cwd(),
    "../frontend/public/assets/wescomm-logo-intro-new.mp4",
  ));
  const mediaAtoms = welcomeMedia.toString("latin1");
  const serviceWorker = source("../frontend/public/sw.js");
  const precacheUrls = serviceWorker.match(/const PRECACHE_URLS = \[[\s\S]*?\];/)?.[0] ?? "";

  assert.ok(welcomeMedia.byteLength <= 750 * 1024);
  assert.ok(mediaAtoms.indexOf("moov") >= 0);
  assert.ok(mediaAtoms.indexOf("mdat") >= 0);
  assert.ok(mediaAtoms.indexOf("moov") < mediaAtoms.indexOf("mdat"));
  assert.match(mediaAtoms, /avc1/);
  assert.match(mediaAtoms, /mp4a/);
  assert.doesNotMatch(precacheUrls, /wescomm-logo-intro|\.mp4/);
});

test("staff and FAQ confirmations use one accessible responsive dialog", () => {
  const rootLayout = source("../frontend/app/layout.tsx");
  const confirmationDialog = source("../frontend/components/ui/ConfirmationDialogProvider.tsx");
  const confirmationFlows = sources(
    "../frontend/components/faq/FaqManagementExperience.tsx",
    "../frontend/components/staff/SkuInventoryDialog.tsx",
    "../frontend/components/staff/StaffInventoryExperience.tsx",
    "../frontend/components/staff/ProductOptionsManager.tsx",
    "../frontend/components/staff/StaffMessagesExperience.tsx",
    "../frontend/components/staff/StaffReservationsExperience.tsx",
  );

  assert.match(rootLayout, /ConfirmationDialogProvider/);
  assert.match(confirmationDialog, /useAccessibleDialog/);
  assert.match(confirmationDialog, /role="alertdialog"/);
  assert.match(confirmationDialog, /aria-describedby/);
  assert.match(confirmationDialog, /data-dialog-autofocus/);
  assert.match(confirmationDialog, /sm:flex-row/);
  assert.match(confirmationFlows, /useConfirmationDialog/);
  assert.match(confirmationFlows, /Save these corrected stock counts\?/);
  assert.match(confirmationFlows, /Cancel this reservation\?/);
  assert.match(confirmationFlows, /Return this conversation to WesBot\?/);
  assert.doesNotMatch(confirmationFlows, /\bwindow\.(?:confirm|alert|prompt)\s*\(/);
});
