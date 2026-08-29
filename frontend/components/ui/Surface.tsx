import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Surface({ variant = "standard", className, ...props }: HTMLAttributes<HTMLElement> & {
  variant?: "standard" | "interactive" | "document" | "notice" | "result";
}) {
  const variants = {
    standard: "rounded-surface border bg-white shadow-soft",
    interactive: "rounded-surface border bg-white shadow-soft transition hover:border-border-strong hover:shadow-md",
    document: "rounded-surface border bg-white shadow-soft",
    notice: "rounded-surface border border-primary/20 bg-primary/5",
    result: "rounded-surface border border-primary/25 bg-white shadow-soft"
  };
  return <section className={cn(variants[variant], className)} {...props} />;
}
