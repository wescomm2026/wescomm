import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { FaqExperience } from "@/components/faq/FaqExperience";
import { DashboardProductsProvider } from "@/components/dashboard/DashboardProductsProvider";
import { HomeActionCards } from "@/components/dashboard/HomeActionCards";
import { HeroProductCarousel } from "@/components/dashboard/HeroProductCarousel";
import { StockOverview } from "@/components/dashboard/StockOverview";
import { StudentReservationsExperience } from "@/components/reservations/StudentReservationsExperience";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StudentShopExperience } from "@/components/ui/StudentShopExperience";

function StudentFooter() {
  return (
    <footer className="mt-7 flex flex-col gap-4 border-t border-[#e6ece6] py-7 text-sm text-[#3f4a44] md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <Image src="/assets/wescomm-logo.png" alt="" width={86} height={42} className="object-contain" />
        <div>
          <p className="font-semibold text-[#101820]">Wesleyan University-Philippines</p>
          <p className="text-xs text-muted-foreground">Integrated Commissary Management System</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-6 text-xs">
        <span>Privacy Policy</span>
        <span>Terms of Service</span>
        <span>Data Privacy Notice</span>
        <span>Contact Us</span>
      </div>
      <p className="text-xs text-muted-foreground">(c) 2026 Wesleyan University-Philippines</p>
    </footer>
  );
}

function StudentHero() {
  return (
    <section className="wes-card relative min-h-[260px] overflow-hidden p-7 md:p-12 lg:min-h-[390px]">
      <div className="relative z-10 max-w-xl lg:max-w-[48%] xl:max-w-[610px]">
        <h1 className="text-4xl font-extrabold leading-tight tracking-normal text-[#101820] md:text-6xl xl:text-[62px]">
          Reserve Campus Essentials,
          <span className="block text-primary">Ready for Pickup.</span>
        </h1>
        <p className="mt-4 max-w-md text-lg leading-7 text-[#3c4440]">
          Browse live commissary stock, reserve uniform cloth, PE items, ID accessories, and books, then track receipts in one place.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/student/shop">
            <Button className="h-12 px-6 text-base">
              <AssetIcon src="/assets/browse.svg" className="size-6" />
              Browse Items
            </Button>
          </Link>
          <Link href="/student/reservations">
            <Button variant="secondary" className="h-12 px-6 text-base">
              <AssetIcon src="/assets/my-reservations.svg" className="size-6" />
              My Reservations
            </Button>
          </Link>
        </div>
      </div>
      <div className="absolute inset-y-4 right-4 hidden w-[54%] lg:block">
        <HeroProductCarousel priority className="h-full" />
      </div>
      <HeroProductCarousel priority className="relative z-10 mt-6 lg:hidden" />
    </section>
  );
}

export function PageTitle({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{title}</h1>
    </div>
  );
}

export function StudentDashboard() {
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

export function ShopPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">Loading live shop items...</p>
            <p className="mt-1 text-sm text-muted-foreground">Preparing the WESCOMM catalog.</p>
          </div>
        }
      >
        <StudentShopExperience />
      </Suspense>
      <StudentFooter />
    </div>
  );
}

export function ReservationsPage() {
  return <StudentReservationsExperience />;
}

export function FaqPage({ manage = false }: { manage?: boolean }) {
  if (manage) return <FaqExperience manage />;

  return (
    <>
      <PageTitle eyebrow="FAQ" title="Frequently asked questions" />
      <FaqExperience />
    </>
  );
}
