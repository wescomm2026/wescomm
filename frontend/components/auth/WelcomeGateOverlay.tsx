"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type WelcomeGateUser = {
  role: "STUDENT" | "STAFF" | "ADMIN";
  fullName?: string;
};

type WelcomeGateMode = WelcomeGateUser | "GUEST";

function getGateCopy(user: WelcomeGateMode) {
  if (user === "GUEST") {
    return {
      eyebrow: "Preparing WESCOMM",
      title: "Welcome to WESCOMM",
      detail: "Browse campus essentials, check stock, and sign in to reserve items.",
      line: "Preparing real-time stock browsing, FAQs, support, and digital services..."
    };
  }

  if (user.role === "ADMIN") {
    return {
      eyebrow: "Preparing admin overview",
      title: "Welcome Back to WESCOMM",
      detail: "Your campus essentials are loading.",
      line: "Checking reports, users, inventory, and system activity..."
    };
  }

  if (user.role === "STAFF") {
    return {
      eyebrow: "Preparing staff operations",
      title: "Welcome Back to WESCOMM",
      detail: "Your campus essentials are loading.",
      line: "Checking inventory, reservations, receipt verification, and messages..."
    };
  }

  return {
    eyebrow: "Preparing student portal",
    title: "Welcome Back to WESCOMM",
    detail: "Your campus essentials are loading.",
    line: "Checking your reservations, stock updates, and digital receipts..."
  };
}

export function WelcomeGateOverlay({
  user,
  onFinish,
  readyToFinish = true,
  minimumDurationMs = 6000
}: {
  user: WelcomeGateMode;
  onFinish: () => void;
  readyToFinish?: boolean;
  minimumDurationMs?: number;
}) {
  const copy = getGateCopy(user);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const canEnter = readyToFinish && minimumElapsed;

  useEffect(() => {
    const timeout = window.setTimeout(() => setMinimumElapsed(true), minimumDurationMs);
    return () => window.clearTimeout(timeout);
  }, [minimumDurationMs]);

  useEffect(() => {
    if (!canEnter) return undefined;
    const timeout = window.setTimeout(onFinish, 300);
    return () => window.clearTimeout(timeout);
  }, [canEnter, onFinish]);

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden bg-[#f7fbf7]/95 px-4 backdrop-blur-[5px]"
      role="status"
      aria-live="polite"
    >
      <div className="welcome-gate-panel welcome-gate-panel-left" aria-hidden="true" />
      <div className="welcome-gate-panel welcome-gate-panel-right" aria-hidden="true" />

      <section className="welcome-gate-content relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-center text-center">
        <div className="grid size-24 place-items-center rounded-full border border-[#cfe2d1] bg-white shadow-[0_20px_60px_rgba(0,91,43,0.12)] sm:size-28">
          <Image
            src="/assets/wescomm-logo.png"
            alt="WESCOMM"
            width={190}
            height={86}
            priority
            className="h-auto w-[150px] object-contain sm:w-[178px]"
          />
        </div>
        <p className="mt-7 text-xs font-extrabold uppercase tracking-[0.16em] text-primary">{copy.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[#101820] sm:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-4 text-base font-semibold text-[#304039] sm:text-lg">{copy.detail}</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#5f6d66]">{copy.line}</p>
        {!canEnter ? (
          <div className="mt-6 flex items-center gap-3 text-sm font-bold text-primary">
            <span className="size-2.5 animate-pulse rounded-full bg-primary" />
            Loading WESCOMM data...
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (canEnter) onFinish();
          }}
          disabled={!canEnter}
          className="mt-7 min-h-11 rounded-md bg-primary px-5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(0,91,43,0.22)] transition hover:bg-[#004320] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-wait disabled:bg-primary/70"
        >
          {canEnter ? "Enter WESCOMM" : "Preparing WESCOMM"}
        </button>
      </section>
    </div>
  );
}
