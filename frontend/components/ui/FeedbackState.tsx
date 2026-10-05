import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function FeedbackState({ kind, title, description, action, compact = false, plain = false, className }: {
  kind: "loading" | "empty" | "error" | "success";
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
  /** Render without its own card chrome, for use inside an existing panel. */
  plain?: boolean;
  className?: string;
}) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "empty" ? Inbox : kind === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "text-center",
        !plain && "rounded-xl border bg-white shadow-soft",
        compact ? "p-4" : "p-7",
        className
      )}
    >
      <span className={cn(
        "mx-auto grid size-12 place-items-center rounded-full",
        kind === "error" ? "bg-danger/10 text-danger" : kind === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
      )}>
        <Icon className={cn("size-6", kind === "loading" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      </span>
      <p className="mt-3 font-extrabold text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
