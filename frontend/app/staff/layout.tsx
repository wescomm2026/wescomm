import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { StaffShell } from "@/components/staff/StaffShell";
import { staffNav } from "@/lib/data";
import { requireWorkspaceRole } from "@/lib/server-auth";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspaceRole("STAFF");
  return (
    <StudentAuthProvider>
      <RealtimeProvider>
        <StaffShell items={staffNav}>{children}</StaffShell>
      </RealtimeProvider>
    </StudentAuthProvider>
  );
}
