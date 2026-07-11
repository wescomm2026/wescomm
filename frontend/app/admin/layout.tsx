import { StaffShell } from "@/components/staff/StaffShell";
import { adminNav } from "@/lib/data";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
