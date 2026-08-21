"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";

const actionCardClass =
  "wes-card flex min-h-[112px] w-full items-center gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,91,43,0.08)]";

function CardContent({ image, title, text }: { image: string; title: string; text: string }) {
  return (
    <>
      <span className="grid size-14 shrink-0 place-items-center rounded-lg border-2 border-primary text-primary">
        <AssetIcon src={image} className="size-10" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-primary">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-[#3f4a44]">{text}</p>
      </div>
      <ArrowRight className="ml-auto hidden size-5 shrink-0 text-[#1f2b25] md:block" />
    </>
  );
}

export function HomeActionCards() {
  const { user, openAuth } = useStudentAuth();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/student/shop" className={actionCardClass}>
        <CardContent image="/assets/in-stock.svg" title="Real-time Stock" text="Check availability and browse campus items." />
      </Link>
      {user ? (
        <Link href="/student/reservations" className={actionCardClass}>
          <CardContent image="/assets/my-reservations.svg" title="Check My Reservations" text="View pickup schedules, payment status, and updates." />
        </Link>
      ) : (
        <button type="button" onClick={openAuth} className={actionCardClass}>
          <CardContent image="/assets/my-reservations.svg" title="Check My Reservations" text="Log in to view pickup schedules and updates." />
        </button>
      )}
      <Link href={user ? "/student/receipts" : "/verify-receipt"} className={actionCardClass}>
        <CardContent
          image="/assets/digital-receipts.svg"
          title={user ? "Digital Receipts" : "Verify a Receipt"}
          text={user ? "View and download your receipt history." : "Search an official receipt with masked student details."}
        />
      </Link>
      <Link href="/student/faq" className={actionCardClass}>
        <CardContent image="/assets/help-center.svg" title="FAQ & Support" text="Find answers about pickup, receipts, and stock." />
      </Link>
    </div>
  );
}
