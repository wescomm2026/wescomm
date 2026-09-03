"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/ui/RouteErrorState";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("Admin portal render error", error), [error]);
  return <RouteErrorState label="Admin portal" reset={reset} homeHref="/admin/dashboard" />;
}
