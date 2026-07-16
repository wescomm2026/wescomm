"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";

type WelcomeGateUser = {
  role: "STUDENT" | "STAFF" | "ADMIN";
  fullName?: string;
};

type WelcomeGateMode = WelcomeGateUser | "GUEST";
type WelcomeGatePhase = "entering" | "holding" | "exiting";

const ENTER_FALLBACK_MS = 400;
const EXIT_FALLBACK_MS = 450;

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
  minimumDurationMs = 2200,
  maximumDurationMs = 4000,
  allowSkip = true,
  skipDelayMs = 900
}: {
  user: WelcomeGateMode;
  onFinish: () => void;
  readyToFinish?: boolean;
  minimumDurationMs?: number;
  maximumDurationMs?: number;
  allowSkip?: boolean;
  skipDelayMs?: number;
}) {
  const copy = getGateCopy(user);
  const [phase, setPhase] = useState<WelcomeGatePhase>("entering");
  const [minimumElapsed, setMinimumElapsed] = useState(minimumDurationMs <= 0);
  const [skipVisible, setSkipVisible] = useState(allowSkip && skipDelayMs <= 0);
  const finishedRef = useRef(false);

  const beginExit = useCallback(() => {
    setPhase((current) => (current === "exiting" ? current : "exiting"));
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    if (minimumDurationMs <= 0) return undefined;
    const timeout = window.setTimeout(() => setMinimumElapsed(true), minimumDurationMs);
    return () => window.clearTimeout(timeout);
  }, [minimumDurationMs]);

  useEffect(() => {
    if (!allowSkip || skipDelayMs <= 0) return undefined;
    const timeout = window.setTimeout(() => setSkipVisible(true), skipDelayMs);
    return () => window.clearTimeout(timeout);
  }, [allowSkip, skipDelayMs]);

  useEffect(() => {
    if (minimumElapsed && readyToFinish) beginExit();
  }, [beginExit, minimumElapsed, readyToFinish]);

  useEffect(() => {
    const timeout = window.setTimeout(beginExit, Math.max(0, maximumDurationMs));
    return () => window.clearTimeout(timeout);
  }, [beginExit, maximumDurationMs]);

  useEffect(() => {
    const fallbackMs = phase === "entering" ? ENTER_FALLBACK_MS : phase === "exiting" ? EXIT_FALLBACK_MS : null;
    if (fallbackMs === null) return undefined;

    const timeout = window.setTimeout(() => {
      if (phase === "entering") setPhase("holding");
      else finish();
    }, fallbackMs);

    return () => window.clearTimeout(timeout);
  }, [finish, phase]);

  const handleOverlayAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (phase === "entering") setPhase("holding");
    else if (phase === "exiting") finish();
  };

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden bg-[#f7fbf7]/95 px-4 backdrop-blur-[5px]"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onAnimationEnd={handleOverlayAnimationEnd}
    >
      <div className="welcome-gate-panel welcome-gate-panel-left" aria-hidden="true" />
      <div className="welcome-gate-panel welcome-gate-panel-right" aria-hidden="true" />

      <section
        className="welcome-gate-content relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-center text-center"
        aria-labelledby="welcome-gate-title"
      >
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
        <h1 id="welcome-gate-title" className="mt-3 text-3xl font-extrabold leading-tight text-[#101820] sm:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-4 text-base font-semibold text-[#304039] sm:text-lg">{copy.detail}</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#5f6d66]">{copy.line}</p>
        <div className="mt-6 flex items-center gap-3 text-sm font-bold text-primary">
          <span className="size-2.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" />
          {readyToFinish ? "Your dashboard is ready" : "Preparing your dashboard..."}
        </div>
        {skipVisible && phase !== "exiting" ? (
          <button
            type="button"
            onClick={beginExit}
            className="welcome-gate-skip mt-5 min-h-11 rounded-md px-4 text-sm font-bold text-[#3f5b4c] underline decoration-[#9db8a6] underline-offset-4 transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Skip intro
          </button>
        ) : null}
      </section>
    </div>
  );
}
