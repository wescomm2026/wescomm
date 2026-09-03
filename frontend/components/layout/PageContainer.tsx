import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageContainer({ width = "standard", className, ...props }: HTMLAttributes<HTMLDivElement> & {
  width?: "narrow" | "standard" | "wide" | "operations";
}) {
  const widths = { narrow: "max-w-3xl", standard: "max-w-5xl", wide: "max-w-7xl", operations: "max-w-[1580px]" };
  return <div className={cn("mx-auto w-full px-4 py-8 sm:px-6 lg:px-8", widths[width], className)} {...props} />;
}
