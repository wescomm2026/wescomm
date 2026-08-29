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
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">{eyebrow}</p> : null}
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{description}</p> : null}
        {meta ? <div className="mt-3 text-xs font-semibold text-muted-foreground">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
