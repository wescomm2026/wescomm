import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveServerApiBaseUrl } from "@/lib/server-api-url.mjs";

type ServerProfile = { role?: "STUDENT" | "STAFF" | "ADMIN" };

const LOGIN_PATH = "/student/dashboard?auth=login";

function roleHome(role: ServerProfile["role"]) {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "STAFF") return "/staff";
  return "/student/dashboard";
}

export async function requireWorkspaceRole(role: "STAFF" | "ADMIN") {
  const cookieStore = cookies();
  const testRole = cookieStore.get("wescomm_e2e_workspace_role")?.value;
  if (
    process.env.E2E_WORKSPACE_BYPASS_TOKEN
    && process.env.NEXT_PUBLIC_E2E_TEST === "true"
    && testRole === role
  ) return;

  const hasSession = cookieStore.has("wescomm_session") || cookieStore.has("__Host-wescomm_session");
  if (!hasSession) redirect(LOGIN_PATH);

  let response: Response;
  try {
    response = await fetch(`${resolveServerApiBaseUrl()}/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    console.warn(`Workspace role preflight is temporarily unavailable; client auth will retry (${detail}).`);
    return;
  }

  if (response.status === 401 || response.status === 403) redirect(LOGIN_PATH);
  if (!response.ok) {
    console.warn(`Workspace role preflight returned ${response.status}; client auth will retry.`);
    return;
  }

  const payload = await response.json().catch(() => null) as { profile?: ServerProfile } | null;
  const actualRole = payload?.profile?.role;
  if (actualRole === role) return;
  if (actualRole) redirect(roleHome(actualRole));

  console.warn("Workspace role preflight returned an invalid profile; client auth will retry.");
}
