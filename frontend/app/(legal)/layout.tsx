import Image from "next/image";
import Link from "next/link";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f8faf8]">
      <header className="sticky top-0 z-40 border-b border-[#dfe8df] bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[76px] w-full max-w-[1200px] items-center gap-4 px-4 py-3 sm:px-8">
          <Link href="/student/dashboard" className="relative h-12 w-36 shrink-0 sm:w-44" aria-label="Go to WESCOMM home">
            <Image src="/assets/wescomm-logo.png" alt="WESCOMM" fill priority className="object-contain object-left" />
          </Link>
          <Link
            href="/student/dashboard"
            className="ml-auto rounded-md border border-[#cbdccb] bg-white px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-[#eef6ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Back to WESCOMM
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[#dfe8df] bg-white">
        <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-8 text-center text-sm text-[#59655e] sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end lg:text-left">
          <div>
            <p className="font-extrabold text-[#17211b]">Wesleyan University-Philippines</p>
            <p className="mt-1">Mabini Extension, Cabanatuan City, Nueva Ecija 3100, Philippines</p>
            <a className="mt-2 inline-block font-bold text-primary hover:underline" href="mailto:wescomm2026@gmail.com">
              wescomm2026@gmail.com
            </a>
          </div>
          <div className="space-y-4 lg:text-right">
            <SiteFooterLinks className="lg:justify-end" />
            <p className="text-xs text-[#748078]">© 2026 Wesleyan University-Philippines</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
