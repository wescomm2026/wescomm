import type { ReactNode } from "react";

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
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8 sm:py-14 lg:px-10">
      <header className="rounded-[24px] border border-[#d9e5da] bg-[linear-gradient(145deg,#f4faf5_0%,#ffffff_72%)] p-6 shadow-[0_16px_45px_rgba(0,68,36,0.07)] sm:p-10">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[#101820] sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[#536058] sm:text-lg">{summary}</p>
        <p className="mt-5 text-sm font-semibold text-[#68746d]">Effective and last updated: August 11, 2026</p>
      </header>

      <div className="mt-8 space-y-6">{children}</div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#dfe8df] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.035)] sm:p-8">
      <h2 className="text-xl font-extrabold text-[#152019] sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-[#4f5b54]">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-primary">{children}</ul>;
}

export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#bcd8c1] bg-[#eff8f1] px-4 py-3 text-sm leading-6 text-[#285438]">
      {children}
    </div>
  );
}
