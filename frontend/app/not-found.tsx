import Image from "next/image";
import Link from "next/link";
import { Headphones, Home } from "lucide-react";

function DotPattern({ className }: { className: string }) {
  return (
    <div className={`grid grid-cols-6 gap-3 ${className}`} aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <span key={index} className="size-2 rounded-full bg-[#bdd8bc]" />
      ))}
    </div>
  );
}

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-svh w-full items-center justify-center overflow-hidden bg-white px-4 py-8 sm:px-8 sm:py-10">
      <div className="absolute left-0 top-0 -z-10 h-40 w-56 rounded-br-[140px] bg-[#f0f7ef] sm:h-56 sm:w-80" aria-hidden="true" />
      <div className="absolute right-0 top-0 -z-10 h-32 w-56 rounded-bl-[120px] border-b-2 border-l-2 border-[#c8ddc5] bg-[#edf6eb] sm:h-52 sm:w-[420px]" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 -z-10 h-24 w-64 rounded-tr-[130px] bg-[#a9cc92] sm:h-40 sm:w-[440px]" aria-hidden="true" />
      <div className="absolute bottom-0 right-0 -z-10 h-24 w-48 rounded-tl-[110px] bg-[#f3f8f2] sm:h-36 sm:w-72" aria-hidden="true" />

      <DotPattern className="absolute left-7 top-7 hidden opacity-70 sm:grid" />
      <DotPattern className="absolute bottom-8 right-8 hidden opacity-60 sm:grid" />

      <div className="pointer-events-none absolute bottom-24 left-10 hidden size-48 opacity-[0.15] lg:block" aria-hidden="true">
        <Image src="/assets/id-accessories.svg" alt="" fill sizes="192px" className="object-contain" />
      </div>
      <div className="pointer-events-none absolute bottom-12 right-8 hidden h-72 w-72 opacity-10 lg:block" aria-hidden="true">
        <Image src="/assets/wup shop assets/wup-girls-uniform-set.png" alt="" fill sizes="288px" className="object-contain" />
      </div>

      <section className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <Link href="/" aria-label="WESCOMM home" className="relative h-24 w-[250px] sm:h-28 sm:w-[330px]">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" fill priority sizes="(max-width: 640px) 250px, 330px" className="object-contain" />
        </Link>

        <div className="mt-3 flex h-[126px] items-center justify-center font-black leading-none sm:mt-5 sm:h-[180px] lg:h-[215px]" aria-label="Error 404">
          <span className="text-[150px] text-[#08662f] sm:text-[220px] lg:text-[270px]">4</span>
          <span className="relative text-[150px] text-[#ffc400] sm:text-[220px] lg:text-[270px]">
            0
            <span className="pointer-events-none absolute inset-x-[28%] inset-y-[22%] rounded-full border-2 border-dashed border-white/90 sm:border-[3px]" aria-hidden="true" />
            <span className="absolute bottom-[12%] right-[12%] grid size-8 grid-cols-2 place-items-center gap-1 rounded-full bg-[#087037] p-1.5 sm:size-11 sm:p-2" aria-hidden="true">
              <span className="size-1.5 rounded-full bg-[#ffc400] sm:size-2" /><span className="size-1.5 rounded-full bg-[#ffc400] sm:size-2" /><span className="size-1.5 rounded-full bg-[#ffc400] sm:size-2" /><span className="size-1.5 rounded-full bg-[#ffc400] sm:size-2" />
            </span>
          </span>
          <span className="text-[150px] text-[#08662f] sm:text-[220px] lg:text-[270px]">4</span>
        </div>

        <p className="mt-6 text-sm font-extrabold uppercase text-primary sm:mt-8">Page not found</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211b] sm:text-4xl">Oops! This page is not available.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#5f6b64] sm:text-base sm:leading-7">
          The page may have been moved, deleted, or the address may be incorrect. You can return to WESCOMM or ask commissary support for help.
        </p>

        <div className="mt-7 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(0,91,43,0.24)] transition hover:bg-[#00451f] focus:outline-none focus:ring-2 focus:ring-primary/30">
            <Home className="size-5 text-[#ffd21a]" aria-hidden="true" />
            Back to Home
          </Link>
          <Link href="/student/support" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-[#bfd3c0] bg-white px-6 text-sm font-extrabold text-primary transition hover:bg-[#f2f8f2] focus:outline-none focus:ring-2 focus:ring-primary/20">
            <Headphones className="size-5" aria-hidden="true" />
            Contact Support
          </Link>
        </div>
      </section>
    </main>
  );
}
