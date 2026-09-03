import { StaffShell } from "@/components/staff/StaffShell";
import { adminNav } from "@/lib/data";
import { requireWorkspaceRole } from "@/lib/server-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspaceRole("ADMIN");
  return (
    <StudentAuthProvider>
      <RealtimeProvider>
        <StaffShell
          items={adminNav}
          role="ADMIN"
          homeHref="/admin/dashboard"
          routeBase="/admin"
          portalLabel="Admin portal"
          portalTitle="Monitoring and Decisions"
        >
          {children}
        </StaffShell>
      </RealtimeProvider>
    </StudentAuthProvider>
  );
}
import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
