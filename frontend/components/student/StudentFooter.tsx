import Image from "next/image";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";

export function StudentFooter() {
  return (
    <footer className="mt-7 flex flex-col items-center gap-4 border-t border-[#e6ece6] py-7 text-center text-sm text-[#3f4a44] md:flex-row md:justify-between md:text-left">
      <div className="flex items-center justify-center gap-3 md:justify-start">
        <Image src="/assets/wescomm-logo.png" alt="" width={86} height={42} className="object-contain" />
        <div>
          <p className="font-semibold text-[#101820]">Wesleyan University-Philippines</p>
          <p className="text-xs text-muted-foreground">Integrated Commissary Management System</p>
        </div>
      </div>
      <SiteFooterLinks />
      <p className="text-xs text-muted-foreground md:text-right">© 2026 Wesleyan University-Philippines</p>
    </footer>
  );
}
