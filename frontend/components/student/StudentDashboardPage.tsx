import Image from "next/image";
import Link from "next/link";
import { DashboardProductsProvider } from "@/components/dashboard/DashboardProductsProvider";
import { HeroProductCarousel } from "@/components/dashboard/HeroProductCarousel";
import { HomeActionCards } from "@/components/dashboard/HomeActionCards";
import { StockOverview } from "@/components/dashboard/StockOverview";
import { StudentFooter } from "@/components/student/StudentFooter";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";

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
