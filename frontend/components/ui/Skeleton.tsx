import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-control bg-muted motion-reduce:animate-none", className)} />;
}

/** Placeholder rows for list and table regions while the first page loads. */
export function SkeletonList({ rows = 4, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("divide-y divide-border", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-7 w-24 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function MetricSkeletonGrid({ count = 4, label = "Loading dashboard data", className }: { count?: number; label?: string; className?: string }) {
  return (
    <section role="status" aria-live="polite" aria-busy="true" className={cn("grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border bg-card p-5 shadow-soft" aria-hidden="true">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="mt-4 h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-3 h-2.5 w-32 max-w-full" />
        </div>
      ))}
    </section>
  );
}
