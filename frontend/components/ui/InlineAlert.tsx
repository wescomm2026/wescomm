import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type InlineAlertTone = "error" | "warning" | "success" | "info";

const toneStyles: Record<InlineAlertTone, { box: string; icon: string; Icon: typeof AlertCircle }> = {
  error: { box: "border-danger/25 bg-danger/5 text-danger", icon: "text-danger", Icon: AlertCircle },
  warning: { box: "border-warning/30 bg-warning/10 text-foreground", icon: "text-warning", Icon: AlertTriangle },
  success: { box: "border-success/25 bg-success/5 text-success", icon: "text-success", Icon: CheckCircle2 },
  info: { box: "border-primary/20 bg-primary/5 text-foreground", icon: "text-primary", Icon: Info }
};

/** Page-level feedback that stays in the layout flow (errors, warnings, confirmations). */
export function InlineAlert({
  tone = "error",
  title,
  children,
  action,
  onDismiss,
  className
}: {
  tone?: InlineAlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { box, icon, Icon } = toneStyles[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", box, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-6">
        {title ? <p className="font-extrabold">{title}</p> : null}
        {children ? <div className={cn("font-semibold", title && "font-medium opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-mr-1 grid size-7 shrink-0 place-items-center rounded-control opacity-70 transition hover:bg-foreground/5 hover:opacity-100"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
