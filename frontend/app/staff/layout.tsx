import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { StaffShell } from "@/components/staff/StaffShell";
import { staffNav } from "@/lib/data";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentAuthProvider>
      <RealtimeProvider>
        <StaffShell items={staffNav}>{children}</StaffShell>
      </RealtimeProvider>
    </StudentAuthProvider>
  );
}
