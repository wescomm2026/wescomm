import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { Surface } from "@/components/ui/Surface";

export function LegalDocument({
  eyebrow,
  title,
  summary,
  children
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <PageContainer width="standard" className="py-10 sm:py-12">
      <article>
        <PageHeader eyebrow={eyebrow} title={title} description={summary} meta="Effective and last updated: August 11, 2026" />
        <Surface variant="document" className="mt-7 overflow-hidden px-5 sm:px-8">{children}</Surface>
      </article>
    </PageContainer>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b py-6 last:border-b-0 sm:py-8">
      <h2 className="text-xl font-extrabold text-foreground sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-primary">{children}</ul>;
}

export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-surface border border-primary/25 bg-primary/5 px-4 py-3 text-sm leading-6 text-primary">
      {children}
    </div>
  );
}
