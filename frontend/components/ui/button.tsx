import { ButtonHTMLAttributes, forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className, variant = "primary", size = "md", loading = false, disabled, ...props }, ref) => {
    const variants = {
      primary: "bg-primary text-primary-foreground shadow-soft hover:bg-primary-hover [&_.asset-icon-img]:brightness-0 [&_.asset-icon-img]:invert",
      secondary: "border border-border-strong bg-white text-primary hover:bg-surface-subtle",
      ghost: "bg-transparent text-foreground hover:bg-surface-subtle",
      destructive: "bg-danger text-white shadow-soft hover:brightness-90"
    };
    const sizes = {
      sm: "h-9 rounded-control px-3 text-xs",
      md: "h-10 rounded-control px-4 text-sm",
      lg: "h-12 rounded-control px-5 text-base",
      icon: "size-10 rounded-control p-0"
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
