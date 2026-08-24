import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    const variants = {
      primary: "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(0,91,43,0.22)] hover:bg-[#004320] [&_.asset-icon-img]:brightness-0 [&_.asset-icon-img]:invert",
      secondary: "border border-[#cddccd] bg-white text-primary hover:bg-[#f4faf4]",
      ghost: "bg-transparent text-foreground hover:bg-[#eef6ee]",
      destructive: "bg-red-700 text-white shadow-[0_8px_18px_rgba(185,28,28,0.2)] hover:bg-red-800"
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
