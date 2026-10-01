import Image from "next/image";
import Link from "next/link";
import { CalendarCheck2, ChevronRight, Search } from "lucide-react";
import { DashboardProductsProvider } from "@/components/dashboard/DashboardProductsProvider";
import { HeroProductCarousel } from "@/components/dashboard/HeroProductCarousel";
import { HomeActionCards } from "@/components/dashboard/HomeActionCards";
import { StockOverview } from "@/components/dashboard/StockOverview";
import { StudentFooter } from "@/components/student/StudentFooter";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";

function StudentHero() {
  return (
    <section className="student-hero-surface relative isolate overflow-hidden border p-5 sm:p-7 lg:min-h-[440px] lg:p-9 xl:p-12">
      <span aria-hidden="true" className="student-hero-leaf-top pointer-events-none absolute -right-16 -top-20 size-36 rotate-[-28deg] lg:right-[38%] lg:size-60" />
      <span aria-hidden="true" className="student-hero-leaf-bottom pointer-events-none absolute -bottom-24 right-[18%] size-44 rotate-[22deg] lg:size-64" />
      <div className="relative z-10 grid gap-5 sm:gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] md:items-stretch lg:grid-cols-[minmax(0,1fr)_minmax(0,0.93fr)] lg:gap-9">
        <div className="flex min-w-0 flex-col items-start md:justify-center">
          <span className="inline-flex max-w-full items-center rounded-full bg-accent/25 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary sm:px-4 sm:text-xs">
            Campus Essentials
          </span>
          <h1 className="mt-4 max-w-[680px] text-[clamp(2rem,7.6vw,2.75rem)] font-extrabold leading-[1.08] tracking-tight text-foreground sm:mt-6 sm:text-[clamp(2.6rem,5vw,3.25rem)] md:text-[clamp(2.2rem,4.6vw,3rem)] lg:text-[clamp(2.9rem,4.2vw,4.75rem)]">
            Reserve Campus Essentials,
            <span className="block text-primary">Ready for Pickup.</span>
          </h1>
          <p className="mt-3 max-w-[540px] text-sm leading-6 text-muted-foreground sm:mt-5 sm:text-base lg:text-lg lg:leading-7">
            Browse live campus stock, reserve what you need, and track pickup and receipts in one place.
          </p>
          <div className="mt-5 grid w-full gap-2.5 min-[360px]:grid-cols-2 sm:mt-7 sm:max-w-[460px] sm:gap-3 md:max-w-[240px] md:grid-cols-1 lg:flex lg:max-w-[460px] lg:flex-wrap">
            <Link href="/student/shop" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-surface transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-[420px]:text-sm lg:w-auto lg:px-5">
              <Search className="size-[18px] shrink-0 sm:size-5" aria-hidden="true" />
              <span>Browse Items</span>
              <ChevronRight className="ml-1 hidden size-4 shrink-0 lg:block" aria-hidden="true" />
            </Link>
            <Link href="/student/reservations" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-white/95 px-3 py-2 text-xs font-bold text-primary shadow-sm transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-[420px]:text-sm lg:w-auto lg:px-5">
              <CalendarCheck2 className="size-[18px] shrink-0 sm:size-5" aria-hidden="true" />
              <span>My Reservations</span>
              <ChevronRight className="ml-1 hidden size-4 shrink-0 lg:block" aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-5 hidden -rotate-6 font-serif text-sm italic leading-4 text-primary lg:mt-7 lg:block">
            Same Campus.<br />Brighter Days.
            <span aria-hidden="true" className="mt-1 block h-0.5 w-24 -rotate-6 rounded-full bg-accent" />
          </p>
        </div>
        <HeroProductCarousel priority className="relative min-w-0 self-stretch" />
      </div>
    </section>
  );
}

export function StudentDashboardPage() {
  return (
    <DashboardProductsProvider>
      <div className="space-y-5">
        <StudentHero />
        <HomeActionCards />
        <div className="grid gap-5 lg:grid-cols-[1.45fr_0.75fr]">
          <StockOverview />
          <section className="wes-card flex flex-col gap-4 overflow-hidden bg-[#f1f8f1] p-5 sm:flex-row sm:items-center lg:flex-col lg:items-start xl:flex-row xl:items-center">
            <Image src="/assets/chat-with-wesbot.svg" alt="" width={110} height={110} className="mx-auto size-24 shrink-0 object-contain sm:mx-0" />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h2 className="text-lg font-bold leading-snug text-primary xl:text-xl">Need help? Chat with WesBot</h2>
              <p className="mt-1 text-sm leading-5 text-[#3f4a44]">Our virtual assistant is here to help you 24/7.</p>
            </div>
            <Link href="/student/support">
              <Button className="w-full shrink-0 sm:w-auto">
                <AssetIcon src="/assets/live-chat.svg" className="size-6" />
                Start Chat
              </Button>
            </Link>
          </section>
        </div>
        <StudentFooter />
      </div>
    </DashboardProductsProvider>
  );
}
