import { Suspense } from "react";
import { GlobalSearchExperience } from "@/components/staff/GlobalSearchExperience";

export default function StaffSearchPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm font-semibold text-muted-foreground">Loading search…</p>}>
      <GlobalSearchExperience routeBase="/staff" />
    </Suspense>
  );
}
