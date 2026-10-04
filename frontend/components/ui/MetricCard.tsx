import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { cn } from "@/lib/utils";

export type MetricTone = "default" | "attention" | "critical" | "success";

const toneStyles: Record<MetricTone, { icon: string; value: string; accent: string }> = {
  default: { icon: "bg-primary/10", value: "text-foreground", accent: "bg-transparent" },
  success: { icon: "bg-success/10", value: "text-foreground", accent: "bg-transparent" },
  attention: { icon: "bg-accent/15", value: "text-warning", accent: "bg-accent" },
  critical: { icon: "bg-danger/10", value: "text-danger", accent: "bg-danger" }
};

/** One KPI tile used across the Staff and Admin dashboards. */
export function MetricCard({
  label,
  value,
  detail,
  iconSrc,
  icon,
  tone = "default",
  href,
  actionLabel,
  className
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  iconSrc?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  href?: string;
  actionLabel?: string;
  className?: string;
}) {
  const styles = toneStyles[tone];
  const content = (
    <>
      <span className={cn("absolute inset-y-0 left-0 w-1", styles.accent)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg sm:size-11", styles.icon)}>
          {iconSrc ? <AssetIcon src={iconSrc} className="size-6 sm:size-7" /> : icon}
        </span>
        {href ? <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" /> : null}
      </div>
      <p className="mt-3 text-xs font-semibold text-muted-foreground sm:mt-4 sm:text-sm">{label}</p>
      <p className={cn("mt-1 break-words text-xl font-extrabold tabular-nums tracking-tight sm:text-[1.75rem] sm:leading-9", styles.value)}>{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p> : null}
      {href && actionLabel ? <span className="mt-3 hidden text-sm font-bold sm:inline-flex text-primary group-hover:underline">{actionLabel}</span> : null}
    </>
  );
  const base = "group relative block overflow-hidden rounded-xl border bg-card p-4 shadow-soft sm:p-5";

  return href ? (
    <Link href={href} className={cn(base, "transition hover:border-primary/40 hover:shadow-md", className)}>
      {content}
    </Link>
  ) : (
    <article className={cn(base, className)}>{content}</article>
  );
}
