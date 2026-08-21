import { Suspense } from "react";
import { GlobalSearchExperience } from "@/components/staff/GlobalSearchExperience";

export default function AdminSearchPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm font-semibold text-[#68746d]">Loading search…</p>}>
      <GlobalSearchExperience routeBase="/admin" />
    </Suspense>
  );
}
