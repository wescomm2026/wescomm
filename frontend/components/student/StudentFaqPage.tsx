import { FaqExperience } from "@/components/faq/FaqExperience";

export function StudentFaqPage() {
  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-primary">FAQ</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Frequently asked questions</h1>
        <p className="mt-2 text-sm text-muted-foreground">Quick answers about reserving, paying, picking up, and receipts.</p>
      </div>
      <FaqExperience />
    </>
  );
}
