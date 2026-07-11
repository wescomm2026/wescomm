import { StaffShell } from "@/components/staff/StaffShell";
import { staffNav } from "@/lib/data";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell items={staffNav}>{children}</StaffShell>;
}
