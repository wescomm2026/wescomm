"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";

export default function AuthCallbackPage() {
  const { completeEmailLogin, openAuth } = useStudentAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    completeEmailLogin().then((result) => {
      if (!cancelled && !result.success) {
        setError(result.error ?? "Unable to complete email sign-in.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [completeEmailLogin]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#fbfcfb] px-4">
      <section className="w-full max-w-md rounded-lg border border-[#dce5dd] bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-bold uppercase text-primary">Wesleyan Email</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#101820]">
          {error ? "Sign-in needs attention" : "Completing secure sign-in..."}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#68746d]">
          {error || "Please wait while WESCOMM verifies your school email and opens the correct dashboard."}
        </p>
        {error ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={openAuth}>Try again</Button>
            <Link href="/">
              <Button variant="secondary">Back to home</Button>
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
