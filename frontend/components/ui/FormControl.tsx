import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const formControlClass = "min-h-11 w-full rounded-control border border-border-strong bg-white px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70";

export function FormControl({ label, htmlFor, required, helper, error, children, className }: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-bold text-foreground">{label}{required ? <span className="ml-1 text-danger" aria-hidden="true">*</span> : null}</label>
      {children}
      {error ? <p className="text-xs font-semibold text-danger" role="alert">{error}</p> : helper ? <p className="text-xs leading-5 text-muted-foreground">{helper}</p> : null}
    </div>
  );
}
