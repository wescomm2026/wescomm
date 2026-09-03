import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { StudentPortalGuard } from "@/components/auth/StudentPortalGuard";
import { StudentCartProvider } from "@/components/cart/StudentCartProvider";
import { PageShell } from "@/components/layout/PageShell";
import {
  StudentRestrictionNotice,
  StudentRestrictionProvider
} from "@/components/restrictions/StudentRestrictionProvider";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { studentNav } from "@/lib/data";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentAuthProvider>
      <RealtimeProvider>
        <StudentRestrictionProvider>
          <StudentCartProvider>
            <StudentPortalGuard>
              <PageShell items={studentNav} role="Student">
                <StudentRestrictionNotice />
                {children}
              </PageShell>
            </StudentPortalGuard>
          </StudentCartProvider>
        </StudentRestrictionProvider>
      </RealtimeProvider>
    </StudentAuthProvider>
  );
}
