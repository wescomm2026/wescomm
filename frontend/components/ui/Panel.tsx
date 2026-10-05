import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Titled content region used for dashboard sections and list containers. */
export function Panel({
  title,
  description,
  icon,
  action,
  children,
  footer,
  className,
  bodyClassName,
  id,
  headingLevel = "h2"
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;

  return (
    <section id={id} className={cn("overflow-hidden rounded-xl border bg-card shadow-soft", className)}>
      {title ? (
        <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
          {icon ? <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span> : null}
          <div className="min-w-[10rem] flex-1">
            <Heading className="font-extrabold leading-6 text-foreground">{title}</Heading>
            {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
      {footer ? <footer className="border-t">{footer}</footer> : null}
    </section>
  );
}
