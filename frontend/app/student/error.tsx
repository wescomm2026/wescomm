"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/ui/RouteErrorState";

export default function StudentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("Student portal render error", error), [error]);
  return <RouteErrorState label="Student portal" reset={reset} homeHref="/student/dashboard" />;
}
