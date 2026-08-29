import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function FeedbackState({ kind, title, description, action, compact = false }: {
  kind: "loading" | "empty" | "error" | "success";
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "empty" ? Inbox : kind === "error" ? AlertCircle : CheckCircle2;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("rounded-surface border bg-white text-center shadow-soft", compact ? "p-4" : "p-7") }>
      <Icon className={cn("mx-auto size-8", kind === "error" ? "text-danger" : kind === "success" ? "text-success" : "text-primary", kind === "loading" && "animate-spin")} aria-hidden="true" />
      <p className="mt-3 font-extrabold text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
