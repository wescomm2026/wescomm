"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/ui/RouteErrorState";

export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("Staff portal render error", error), [error]);
  return <RouteErrorState label="Staff portal" reset={reset} homeHref="/staff" />;
}
