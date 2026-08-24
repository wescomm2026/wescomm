"use client";

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
type WelcomeMediaState = "loading" | "playing" | "playing-muted" | "failed";

const ENTER_FALLBACK_MS = 250;
const EXIT_FALLBACK_MS = 400;
const E2E_TEST_ENABLED = process.env.NEXT_PUBLIC_E2E_TEST === "true";
const LOGO_ANIMATION_PLAYBACK_RATE = E2E_TEST_ENABLED ? 4 : 1;
const MEDIA_STARTUP_TIMEOUT_MS = 1_600;
const MEDIA_ABSOLUTE_TIMEOUT_MS = 4_000;
const PLAYBACK_TIMEOUT_BUFFER_MS = 1_500;
const LOADING_BACKGROUND = "#fbfbfb";

function isAutoplayPolicyError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "NotAllowedError";
}

export function WelcomeGateOverlay() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<WelcomeGatePhase>("entering");
  const [mediaState, setMediaState] = useState<WelcomeMediaState>("loading");
  const [shouldLoadAnimation, setShouldLoadAnimation] = useState(false);
  const finishedRef = useRef(false);
  const exitStartedRef = useRef(false);
  const mediaPlayableRef = useRef(false);
  const autoplayPolicyBlockedRef = useRef(false);
  const autoplayAttemptedRef = useRef(false);
  const bufferedUntilRef = useRef(0);
  const playbackTimeoutRef = useRef<number | null>(null);
  const startupTimeoutRef = useRef<number | null>(null);
  const absoluteStartupTimeoutRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const beginExit = useCallback(() => {
    exitStartedRef.current = true;
    setPhase((current) => (current === "exiting" ? current : "exiting"));
  }, []);

  const clearStartupTimeouts = useCallback(() => {
    if (startupTimeoutRef.current !== null) {
      window.clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
    if (absoluteStartupTimeoutRef.current !== null) {
      window.clearTimeout(absoluteStartupTimeoutRef.current);
      absoluteStartupTimeoutRef.current = null;
    }
  }, []);

  const failMediaAndExit = useCallback(() => {
    clearStartupTimeouts();
    setMediaState("failed");
    beginExit();
  }, [beginExit, clearStartupTimeouts]);

  const refreshStartupStallTimeout = useCallback(() => {
    if (exitStartedRef.current || mediaPlayableRef.current) return;
    if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current);
    startupTimeoutRef.current = window.setTimeout(() => {
      startupTimeoutRef.current = null;
      failMediaAndExit();
    }, MEDIA_STARTUP_TIMEOUT_MS);
  }, [failMediaAndExit]);

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
    refreshStartupStallTimeout();
    absoluteStartupTimeoutRef.current = window.setTimeout(
      failMediaAndExit,
      MEDIA_ABSOLUTE_TIMEOUT_MS
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") beginExit();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      clearStartupTimeouts();
      if (playbackTimeoutRef.current !== null) window.clearTimeout(playbackTimeoutRef.current);
    };
  }, [beginExit, clearStartupTimeouts, failMediaAndExit, finish, refreshStartupStallTimeout]);

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

  const startMutedPlayback = useCallback((video: HTMLVideoElement) => {
    if (exitStartedRef.current) return;
    video.muted = true;
    video.volume = 1;

    void video.play().catch(() => {
      failMediaAndExit();
    });
  }, [failMediaAndExit]);

  const attemptAudiblePlayback = useCallback((video: HTMLVideoElement) => {
    if (exitStartedRef.current || autoplayAttemptedRef.current) return;
    autoplayAttemptedRef.current = true;
    video.muted = false;
    video.volume = 1;

    void video.play().catch((error: unknown) => {
      if (isAutoplayPolicyError(error)) {
        autoplayPolicyBlockedRef.current = true;
        startMutedPlayback(video);
        return;
      }
      failMediaAndExit();
    });
  }, [failMediaAndExit, startMutedPlayback]);

  useEffect(() => {
    if (!shouldLoadAnimation) return;
    const video = videoRef.current;
    if (!video) return;

    attemptAudiblePlayback(video);
  }, [attemptAudiblePlayback, shouldLoadAnimation]);

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    refreshStartupStallTimeout();
    video.defaultPlaybackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    video.playbackRate = LOGO_ANIMATION_PLAYBACK_RATE;
    video.muted = autoplayPolicyBlockedRef.current;
    video.volume = 1;
  };

  const handleVideoCanPlay = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    refreshStartupStallTimeout();
    if (!video.paused) return;
    if (autoplayPolicyBlockedRef.current) startMutedPlayback(video);
    else attemptAudiblePlayback(video);
  };

  const handleVideoProgress = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (video.buffered.length === 0) return;

    const bufferedUntil = video.buffered.end(video.buffered.length - 1);
    if (bufferedUntil > bufferedUntilRef.current) {
      bufferedUntilRef.current = bufferedUntil;
      refreshStartupStallTimeout();
    }
  };

  const schedulePlaybackExit = useCallback((video: HTMLVideoElement) => {
    if (playbackTimeoutRef.current !== null) window.clearTimeout(playbackTimeoutRef.current);
    const remainingSeconds = Number.isFinite(video.duration) && video.duration > 0
      ? Math.max(0, video.duration - video.currentTime) / Math.max(video.playbackRate, 0.1)
      : 10;
    playbackTimeoutRef.current = window.setTimeout(
      beginExit,
      Math.ceil(remainingSeconds * 1_000) + PLAYBACK_TIMEOUT_BUFFER_MS
    );
  }, [beginExit]);

  const handleVideoPlaying = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (exitStartedRef.current) {
      video.pause();
      return;
    }
    mediaPlayableRef.current = true;
    setMediaState(video.muted ? "playing-muted" : "playing");
    clearStartupTimeouts();
    schedulePlaybackExit(video);
  };

  const handleSkip = () => {
    videoRef.current?.pause();
    beginExit();
  };

  const handleRestartWithSound = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = 0;
    autoplayPolicyBlockedRef.current = false;
    video.muted = false;
    video.volume = 1;

    try {
      await video.play();
      setMediaState("playing");
      clearStartupTimeouts();
      schedulePlaybackExit(video);
    } catch (error: unknown) {
      if (isAutoplayPolicyError(error)) {
        autoplayPolicyBlockedRef.current = true;
        startMutedPlayback(video);
        return;
      }
      failMediaAndExit();
    }
  };

  const handleMediaError = () => {
    failMediaAndExit();
  };

  if (!visible) return null;

  return (
    <div
      className="welcome-gate-overlay fixed inset-0 z-[12000] grid place-items-center overflow-hidden"
      data-phase={phase}
      data-media-state={mediaState}
      data-media-started={shouldLoadAnimation ? "true" : "false"}
      data-media-ready={mediaState === "playing" || mediaState === "playing-muted" ? "true" : "false"}
      data-media-failed={mediaState === "failed" ? "true" : "false"}
      data-sound-start-required={mediaState === "playing-muted" ? "true" : "false"}
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
      {mediaState === "playing-muted" && phase !== "exiting" ? (
        <button
          type="button"
          onClick={handleRestartWithSound}
          className="welcome-gate-sound-action z-20 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#08743f] px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_32px_rgba(0,68,36,0.24)] transition hover:bg-[#075c32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08743f] focus-visible:ring-offset-4 focus-visible:ring-offset-[#fbfbfb] active:scale-[0.98]"
          aria-label="Restart welcome animation with sound"
        >
          <Volume2 className="size-5" aria-hidden="true" />
          Restart with sound
        </button>
      ) : null}
      <video
        ref={videoRef}
        className={`welcome-gate-video${mediaState === "failed" ? " welcome-gate-video-failed" : ""}`}
        data-testid="welcome-logo-animation"
        playsInline
        preload={shouldLoadAnimation ? "auto" : "none"}
        src={shouldLoadAnimation ? WELCOME_INTRO_VIDEO_SRC : undefined}
        onLoadStart={refreshStartupStallTimeout}
        onProgress={handleVideoProgress}
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
