import { AdminAuditLogsExperience } from "@/components/admin/AdminAuditLogsExperience";

export default function Page({ searchParams }: { searchParams?: { entityType?: string } }) {
  return <AdminAuditLogsExperience initialEntityType={searchParams?.entityType} />;
}
