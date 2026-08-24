"use client";

import Image from "next/image";
import { ArrowRight, Volume2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type SyntheticEvent
} from "react";
import {
  WELCOME_INTRO_DOCUMENT_ATTRIBUTE,
  WELCOME_INTRO_VIDEO_SRC
} from "@/lib/welcome-intro";

type WelcomeGatePhase = "entering" | "holding" | "exiting";

const ENTER_FALLBACK_MS = 250;
const EXIT_FALLBACK_MS = 450;
const E2E_TEST_ENABLED = process.env.NEXT_PUBLIC_E2E_TEST === "true";
const LOGO_ANIMATION_PLAYBACK_RATE = E2E_TEST_ENABLED ? 16 : 1;
const MEDIA_STARTUP_TIMEOUT_MS = E2E_TEST_ENABLED ? 2_000 : 8_000;
const PLAYBACK_TIMEOUT_BUFFER_MS = 1_500;
const LOADING_BACKGROUND = "#ffffff";

export function WelcomeGateOverlay() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<WelcomeGatePhase>("entering");
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [shouldLoadAnimation, setShouldLoadAnimation] = useState(false);
  const [soundStartRequired, setSoundStartRequired] = useState(false);
  const finishedRef = useRef(false);
  const autoplayAttemptedRef = useRef(false);
  const playbackTimeoutRef = useRef<number | null>(null);
  const startupTimeoutRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const beginExit = useCallback(() => {
    setPhase((current) => (current === "exiting" ? current : "exiting"));
  }, []);

  const clearStartupTimeout = useCallback(() => {
    if (startupTimeoutRef.current === null) return;
    window.clearTimeout(startupTimeoutRef.current);
    startupTimeoutRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    document.documentElement.setAttribute(WELCOME_INTRO_DOCUMENT_ATTRIBUTE, "seen");
    setVisible(false);
  }, []);

  useEffect(() => {
    if (document.documentElement.getAttribute(WELCOME_INTRO_DOCUMENT_ATTRIBUTE) !== "pending") {
      finish();
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setShouldLoadAnimation(true);
    startupTimeoutRef.current = window.setTimeout(() => {
      setMediaFailed(true);
      beginExit();
    }, MEDIA_STARTUP_TIMEOUT_MS);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") beginExit();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current);
      if (playbackTimeoutRef.current !== null) window.clearTimeout(playbackTimeoutRef.current);
    };
  }, [beginExit, finish]);

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
    const video = event.currentTarget;
    video.defaultPlaybackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    video.playbackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    video.muted = false;
    video.volume = 1;
  };

  const handleVideoCanPlay = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (autoplayAttemptedRef.current || !video.paused) return;
    autoplayAttemptedRef.current = true;
    video.muted = false;
    video.volume = 1;

    void video.play().catch(() => {
      clearStartupTimeout();
      setSoundStartRequired(true);
    });
  };

  const handleVideoPlaying = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setMediaReady(true);
    setSoundStartRequired(false);
    clearStartupTimeout();
    if (playbackTimeoutRef.current !== null) window.clearTimeout(playbackTimeoutRef.current);
    const remainingSeconds = Number.isFinite(video.duration) && video.duration > 0
      ? Math.max(0, video.duration - video.currentTime) / Math.max(video.playbackRate, 0.1)
      : 10;
    playbackTimeoutRef.current = window.setTimeout(
      beginExit,
      Math.ceil(remainingSeconds * 1_000) + PLAYBACK_TIMEOUT_BUFFER_MS
    );
  };

  const handleSkip = () => {
    videoRef.current?.pause();
    beginExit();
  };

  const handlePlayWithSound = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    video.muted = false;
    video.volume = 1;
    setSoundStartRequired(false);

    try {
      await video.play();
    } catch {
      setMediaFailed(true);
      beginExit();
    }
  };

  const handleMediaError = () => {
    setMediaFailed(true);
    beginExit();
  };

  if (!visible) return null;

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden"
      data-phase={phase}
      data-media-ready={mediaReady ? "true" : "false"}
      data-media-failed={mediaFailed ? "true" : "false"}
      data-sound-start-required={soundStartRequired ? "true" : "false"}
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
      {soundStartRequired && phase !== "exiting" ? (
        <button
          type="button"
          onClick={handlePlayWithSound}
          className="absolute z-20 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#08743f] px-6 py-3 text-base font-bold text-white shadow-[0_12px_32px_rgba(0,68,36,0.24)] transition hover:bg-[#075c32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08743f] focus-visible:ring-offset-4 focus-visible:ring-offset-white active:scale-[0.98]"
          aria-label="Play welcome animation with sound"
        >
          <Volume2 className="size-5" aria-hidden="true" />
          Play with sound
        </button>
      ) : null}
      {shouldLoadAnimation && !mediaReady ? (
        <Image
          src="/assets/wescomm-logo.png"
          alt=""
          width={1600}
          height={900}
          className="welcome-gate-fallback-logo"
          aria-hidden="true"
          priority
        />
      ) : null}
      <video
        ref={videoRef}
        className={`welcome-gate-video${mediaFailed ? " welcome-gate-video-failed" : ""}`}
        data-testid="welcome-logo-animation"
        autoPlay
        playsInline
        preload={shouldLoadAnimation ? "auto" : "none"}
        src={shouldLoadAnimation ? WELCOME_INTRO_VIDEO_SRC : undefined}
        onLoadedMetadata={handleVideoMetadata}
        onCanPlay={handleVideoCanPlay}
        onPlaying={handleVideoPlaying}
        onClick={handleSkip}
        onEnded={beginExit}
        onError={handleMediaError}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: LOADING_BACKGROUND,
          cursor: phase === "exiting" ? "default" : "pointer"
        }}
        aria-hidden="true"
      />
      <span className="sr-only" role="status" aria-live="polite">
        Opening WESCOMM
      </span>
    </div>
  );
}
