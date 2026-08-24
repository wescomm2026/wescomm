"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RouteErrorState({
  label = "WESCOMM",
  title = "We could not open this page.",
  detail = "The page hit an unexpected problem. Your saved data was not changed.",
  reset,
  homeHref = "/student/dashboard"
}: {
  label?: string;
  title?: string;
  detail?: string;
  reset: () => void;
  homeHref?: string;
}) {
  return (
    <main className="grid min-h-[60vh] place-items-center bg-[#fbfcfb] px-4 py-10">
      <section role="alert" className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-wide text-primary">{label}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#17211b]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#68746d]">{detail}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button type="button" onClick={reset}>
            <RefreshCw className="size-4" /> Try again
          </Button>
          <Link href={homeHref}>
            <Button type="button" variant="secondary" className="w-full">Return to dashboard</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
