import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, meta, action, className }: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p> : null}
        {meta ? <div className="mt-3 text-xs font-semibold text-muted-foreground">{meta}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}
