import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

type ServerProfile = { role?: "STUDENT" | "STAFF" | "ADMIN" };

const backendBaseUrl = (process.env.BACKEND_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

export async function requireWorkspaceRole(role: "STAFF" | "ADMIN") {
  const cookieStore = cookies();
  const testRole = cookieStore.get("wescomm_e2e_workspace_role")?.value;
  if (
    process.env.E2E_WORKSPACE_BYPASS_TOKEN
    && process.env.NEXT_PUBLIC_E2E_TEST === "true"
    && testRole === role
  ) return;

  const hasSession = cookieStore.has("wescomm_session") || cookieStore.has("__Host-wescomm_session");
  if (!hasSession) notFound();

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl}/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store"
    });
  } catch {
    notFound();
  }

  if (!response.ok) notFound();
  const payload = await response.json().catch(() => null) as { profile?: ServerProfile } | null;
  const actualRole = payload?.profile?.role;
  if (actualRole === role) return;
  if (actualRole === "ADMIN") redirect("/admin/dashboard");
  if (actualRole === "STAFF") redirect("/staff");
  notFound();
}
