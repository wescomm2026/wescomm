"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";

function roleHome(role: "STAFF" | "ADMIN") {
  return role === "ADMIN" ? "/admin/dashboard" : "/staff";
}

export function StudentPortalGuard({ children }: { children: ReactNode }) {
  const { user, ready } = useStudentAuth();
  const router = useRouter();
  const assignedPortal = user && user.role !== "STUDENT" ? roleHome(user.role) : null;

  useEffect(() => {
    if (ready && assignedPortal) router.replace(assignedPortal);
  }, [assignedPortal, ready, router]);

  if (ready && assignedPortal) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfcfb] px-4">
        <div className="w-full max-w-md rounded-lg border border-[#dce5dd] bg-white p-6 text-center shadow-sm">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={155} height={64} className="mx-auto h-14 w-auto object-contain" />
          <p className="mt-5 text-sm font-bold uppercase text-primary">Assigned portal</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#101820]">Opening your dashboard...</h1>
        </div>
      </div>
    );
  }

  return children;
}
