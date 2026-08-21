"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type SyntheticEvent
} from "react";

type WelcomeGateUser = {
  role: "STUDENT" | "STAFF" | "ADMIN";
  fullName?: string;
};

type WelcomeGateMode = WelcomeGateUser | "GUEST";
type WelcomeGatePhase = "entering" | "holding" | "exiting";

const ENTER_FALLBACK_MS = 250;
const EXIT_FALLBACK_MS = 450;
const E2E_TEST_ENABLED = process.env.NEXT_PUBLIC_E2E_TEST === "true";
const LOGO_ANIMATION_PLAYBACK_RATE = E2E_TEST_ENABLED ? 16 : 1;
const LOGO_VISIBLE_END_BUFFER_SECONDS = 0.8;
const LOADING_BACKGROUND = "radial-gradient(circle at center, #f8f9f3 0%, #edf2ec 100%)";

function getLoadingLabel(user: WelcomeGateMode) {
  if (user === "GUEST") return "Loading WESCOMM";
  if (user.role === "ADMIN") return "Loading the WESCOMM admin portal";
  if (user.role === "STAFF") return "Loading the WESCOMM staff portal";
  return "Loading the WESCOMM student portal";
}

export function WelcomeGateOverlay({
  user,
  onFinish,
  readyToFinish = true,
  minimumDurationMs = 2200,
  maximumDurationMs = 7000
}: {
  user: WelcomeGateMode;
  onFinish: () => void;
  readyToFinish?: boolean;
  minimumDurationMs?: number;
  maximumDurationMs?: number;
}) {
  const [phase, setPhase] = useState<WelcomeGatePhase>("entering");
  const [minimumElapsed, setMinimumElapsed] = useState(minimumDurationMs <= 0);
  const [animationComplete, setAnimationComplete] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [shouldLoadAnimation, setShouldLoadAnimation] = useState(false);
  const animationCompleteRef = useRef(false);
  const finishedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const beginExit = useCallback(() => {
    setPhase((current) => (current === "exiting" ? current : "exiting"));
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  }, [onFinish]);

  const holdLastVisibleFrame = useCallback((video?: HTMLVideoElement | null) => {
    if (animationCompleteRef.current) return;
    animationCompleteRef.current = true;

    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      const lastVisibleTime = Math.max(0, video.duration - LOGO_VISIBLE_END_BUFFER_SECONDS);
      video.pause();
      if (video.currentTime > lastVisibleTime) video.currentTime = lastVisibleTime;
    }

    setAnimationComplete(true);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    setShouldLoadAnimation(true);
  }, [finish]);

  useEffect(() => {
    if (minimumDurationMs <= 0) return undefined;
    const timeout = window.setTimeout(() => setMinimumElapsed(true), minimumDurationMs);
    return () => window.clearTimeout(timeout);
  }, [minimumDurationMs]);

  useEffect(() => {
    if (minimumElapsed && readyToFinish && animationComplete) beginExit();
  }, [animationComplete, beginExit, minimumElapsed, readyToFinish]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => holdLastVisibleFrame(videoRef.current),
      Math.max(0, maximumDurationMs)
    );
    return () => window.clearTimeout(timeout);
  }, [holdLastVisibleFrame, maximumDurationMs]);

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

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    event.currentTarget.defaultPlaybackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    event.currentTarget.playbackRate = LOGO_ANIMATION_PLAYBACK_RATE;
  };

  const handleVideoTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    if (video.duration - video.currentTime > LOGO_VISIBLE_END_BUFFER_SECONDS) return;
    holdLastVisibleFrame(video);
  };

  const handleSkip = () => {
    videoRef.current?.pause();
    beginExit();
  };

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden"
      data-phase={phase}
      data-animation-complete={animationComplete ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-label="WESCOMM welcome animation"
      onAnimationEnd={handleOverlayAnimationEnd}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        isolation: "isolate",
        background: LOADING_BACKGROUND
      }}
    >
      {shouldLoadAnimation ? (
        <button
          type="button"
          onClick={handleSkip}
          disabled={phase === "exiting"}
          aria-label="Skip welcome animation and continue"
          className="absolute z-10 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#cddbcf] bg-white/90 px-4 py-2 text-sm font-bold text-[#075c32] shadow-[0_8px_24px_rgba(0,68,36,0.12)] backdrop-blur-sm transition hover:border-[#96b99e] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08743f] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-0"
          style={{
            bottom: "max(1rem, env(safe-area-inset-bottom))",
            right: "max(1rem, env(safe-area-inset-right))",
          }}
        >
          Skip
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <video
        ref={videoRef}
        className={`welcome-gate-video${mediaFailed ? " welcome-gate-video-failed" : ""}`}
        data-testid="welcome-logo-animation"
        autoPlay
        muted
        playsInline
        preload={shouldLoadAnimation ? "auto" : "none"}
        src={shouldLoadAnimation ? "/assets/wescomm-logo-intro.mp4" : undefined}
        onLoadedMetadata={handleVideoMetadata}
         onTimeUpdate={handleVideoTimeUpdate}
         onClick={handleSkip}
        onEnded={(event) => holdLastVisibleFrame(event.currentTarget)}
        onError={() => {
          setMediaFailed(true);
          holdLastVisibleFrame();
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: LOADING_BACKGROUND,
          cursor: phase === "exiting" ? "default" : "pointer"
        }}
        aria-hidden="true"
      />
      {mediaFailed ? (
        <Image
          src="/assets/wescomm-logo.png"
          alt=""
          width={1600}
          height={900}
          className="welcome-gate-fallback-logo"
          aria-hidden="true"
        />
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {getLoadingLabel(user)}
      </span>
    </div>
  );
}
