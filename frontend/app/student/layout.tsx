import { StudentPortalGuard } from "@/components/auth/StudentPortalGuard";
import { PageShell } from "@/components/layout/PageShell";
import { StudentRestrictionNotice } from "@/components/restrictions/StudentRestrictionProvider";
import { studentNav } from "@/lib/data";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentPortalGuard>
      <PageShell items={studentNav} role="Student">
        <StudentRestrictionNotice />
        {children}
      </PageShell>
    </StudentPortalGuard>
  );
}
