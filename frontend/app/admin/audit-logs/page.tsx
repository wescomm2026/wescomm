import { AdminAuditLogsExperience } from "@/components/admin/AdminAuditLogsExperience";

export default async function Page(props: { searchParams?: Promise<{ entityType?: string }> }) {
  const searchParams = await props.searchParams;
  return <AdminAuditLogsExperience initialEntityType={searchParams?.entityType} />;
}
