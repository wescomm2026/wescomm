import { invalidateStaffDashboardCache } from "./dashboard.service.js";
import { invalidatePublicProductCache } from "./product.service.js";
import { invalidateReportSummaryCache } from "./report.service.js";

export async function invalidateOperationalReadCaches() {
  await Promise.all([
    invalidatePublicProductCache(),
    invalidateStaffDashboardCache(),
    invalidateReportSummaryCache()
  ]);
}

export async function invalidateDashboardAndReportCaches() {
  await Promise.all([
    invalidateStaffDashboardCache(),
    invalidateReportSummaryCache()
  ]);
}

export async function invalidateReportReadCache() {
  await invalidateReportSummaryCache();
}
