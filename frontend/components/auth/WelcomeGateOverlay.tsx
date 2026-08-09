"use client";

import Image from "next/image";
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
const LOGO_ANIMATION_PLAYBACK_RATE = 1.6;

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
  maximumDurationMs = 4000
}: {
  user: WelcomeGateMode;
  onFinish: () => void;
  readyToFinish?: boolean;
  minimumDurationMs?: number;
  maximumDurationMs?: number;
}) {
  const [phase, setPhase] = useState<WelcomeGatePhase>("entering");
  const [minimumElapsed, setMinimumElapsed] = useState(minimumDurationMs <= 0);
  const [mediaFailed, setMediaFailed] = useState(false);
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

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    event.currentTarget.defaultPlaybackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    event.currentTarget.playbackRate = LOGO_ANIMATION_PLAYBACK_RATE;
  };

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onAnimationEnd={handleOverlayAnimationEnd}
    >
      <video
        className={`welcome-gate-video${mediaFailed ? " welcome-gate-video-failed" : ""}`}
        data-testid="welcome-logo-animation"
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={handleVideoMetadata}
        onError={() => setMediaFailed(true)}
        aria-hidden="true"
      >
        <source
          src="/assets/wescomm-logo-intro.mp4"
          type="video/mp4"
          media="(prefers-reduced-motion: no-preference)"
        />
      </video>
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
      <span className="sr-only">{getLoadingLabel(user)}</span>
    </div>
  );
}
