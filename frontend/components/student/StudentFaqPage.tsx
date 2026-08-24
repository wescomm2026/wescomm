import { FaqExperience } from "@/components/faq/FaqExperience";

export function StudentFaqPage() {
  return (
    <>
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">FAQ</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Frequently asked questions</h1>
      </div>
      <FaqExperience />
    </>
  );
}
