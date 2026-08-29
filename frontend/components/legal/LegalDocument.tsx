import { BookOpen, CalendarDays, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Surface } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

export type LegalNavigationItem = { id: string; label: string };

export function LegalDocument({
  eyebrow,
  title,
  summary,
  meta = "Effective and last updated: August 11, 2026",
  icon,
  navigation,
  variant = "document",
  children
}: {
  eyebrow: string;
  title: string;
  summary: string;
  meta?: ReactNode;
  icon?: ReactNode;
  navigation?: LegalNavigationItem[];
  variant?: "document" | "tool";
  children: ReactNode;
}) {
  const content = variant === "document" ? (
    <Surface variant="document" className="overflow-hidden px-5 sm:px-8 lg:px-10">{children}</Surface>
  ) : children;

  return (
    <PageContainer width="wide" className="py-6 sm:py-8 lg:py-10">
      <article className="space-y-6">
        <header className="relative overflow-hidden rounded-feature bg-primary px-5 py-7 text-primary-foreground shadow-[0_18px_45px_rgba(0,78,37,0.18)] sm:px-8 sm:py-9 lg:px-10">
          <div className="absolute -right-20 -top-24 size-64 rounded-full border-[42px] border-white/5" aria-hidden="true" />
          <div className="relative max-w-4xl">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-white/20 bg-white/10">
                {icon ?? <BookOpen className="size-6" />}
              </span>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-white/80">{eyebrow}</p>
            </div>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/80 sm:text-base">{summary}</p>
            {meta ? (
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/90">
                <CalendarDays className="size-4" />
                {meta}
              </div>
            ) : null}
          </div>
        </header>

        {navigation?.length ? (
          <details className="rounded-lg border bg-white p-4 shadow-sm lg:hidden">
            <summary className="cursor-pointer text-sm font-extrabold text-primary">Jump to a Privacy section</summary>
            <ol className="mt-4 grid gap-2 border-t pt-4 text-sm font-semibold text-foreground sm:grid-cols-2">
              {navigation.map((item, index) => (
                <li key={item.id}><a href={`#${item.id}`} className="block rounded-md px-3 py-2 hover:bg-primary/5 hover:text-primary">{index + 1}. {item.label}</a></li>
              ))}
            </ol>
          </details>
        ) : null}

        <div className={cn(navigation?.length ? "grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]" : "mx-auto max-w-5xl")}>
          {navigation?.length ? (
            <aside className="sticky top-28 hidden rounded-lg border bg-white p-4 shadow-sm lg:block">
              <div className="flex items-center gap-2 border-b pb-3 text-primary">
                <BookOpen className="size-5" />
                <p className="text-xs font-extrabold uppercase tracking-[0.12em]">On this page</p>
              </div>
              <ol className="mt-3 space-y-1 text-sm font-semibold text-muted-foreground">
                {navigation.map((item, index) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="flex gap-2 rounded-md px-2.5 py-2 transition-colors hover:bg-primary/5 hover:text-primary">
                      <span className="text-primary">{index + 1}.</span><span>{item.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </aside>
          ) : null}
          {content}
        </div>
      </article>
    </PageContainer>
  );
}

export function LegalSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-28 border-b py-7 first:pt-6 last:border-b-0 sm:py-9">
      <h2 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-primary">{children}</ul>;
}

export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-surface border border-primary/25 bg-primary/5 px-4 py-3.5 text-sm leading-6 text-primary">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
