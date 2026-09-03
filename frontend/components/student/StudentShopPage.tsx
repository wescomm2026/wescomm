import { Suspense } from "react";
import { StudentFooter } from "@/components/student/StudentFooter";
import { StudentShopExperience } from "@/components/ui/StudentShopExperience";

export function StudentShopPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">Loading live shop items...</p>
            <p className="mt-1 text-sm text-muted-foreground">Preparing the WESCOMM catalog.</p>
          </div>
        }
      >
        <StudentShopExperience />
      </Suspense>
      <StudentFooter />
    </div>
  );
}
