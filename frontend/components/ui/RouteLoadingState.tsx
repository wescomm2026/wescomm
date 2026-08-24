export function RouteLoadingState({
  label = "WESCOMM",
  title = "Loading your workspace...",
  detail = "Getting the latest information ready."
}: {
  label?: string;
  title?: string;
  detail?: string;
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid min-h-[45vh] place-items-center px-4 py-10"
    >
      <div className="w-full max-w-xl rounded-xl border border-[#dce5dd] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#e9f5eb]">
            <span className="size-6 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">{label}</p>
            <h1 className="mt-1 text-xl font-extrabold text-[#17211b]">{title}</h1>
            <p className="mt-1 text-sm leading-6 text-[#68746d]">{detail}</p>
          </div>
        </div>
        <div className="mt-6 grid gap-3" aria-hidden="true">
          <div className="h-3 w-3/4 animate-pulse rounded-full bg-[#e7eee8] motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded-full bg-[#edf2ed] motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded-full bg-[#edf2ed] motion-reduce:animate-none" />
        </div>
      </div>
    </section>
  );
}
