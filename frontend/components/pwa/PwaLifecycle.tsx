"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { usePathname } from "next/navigation";
import { Download, RefreshCw, Share2, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registerWescommServiceWorker } from "@/lib/service-worker";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<InstallChoice>;
  prompt(): Promise<void>;
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export type PwaInstallResult = "accepted" | "dismissed" | "instructions";

type PwaInstallContextValue = {
  canPrompt: boolean;
  isInstalled: boolean;
  isIos: boolean;
  isMobile: boolean;
  requestInstall: () => Promise<PwaInstallResult>;
};

const INSTALL_DISMISSED_KEY = "wescomm:pwa-install-dismissed:v1";
const INSTALL_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALL_REMINDER_DELAY_MS = process.env.NEXT_PUBLIC_E2E_TEST === "true" ? 0 : 20 * 1000;
const MOBILE_VIEW_QUERY = "(max-width: 767px)";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_ACTIVATION_TIMEOUT_MS = 10 * 1000;

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall() {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error("usePwaInstall must be used inside PwaLifecycle.");
  return context;
}

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  );
}

function isIosDevice() {
  const userAgent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function wasInstallPromptDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY));
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < INSTALL_PROMPT_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function PwaLifecycle({
  children,
  enableServiceWorker,
  enableRuntimeCaching
}: {
  children: ReactNode;
  enableServiceWorker: boolean;
  enableRuntimeCaching: boolean;
}) {
  const pathname = usePathname();
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadForUpdateRef = useRef(false);
  const updateActivationTimerRef = useRef<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [installReminderReady, setInstallReminderReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const mobileView = window.matchMedia(MOBILE_VIEW_QUERY);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void registrationRef.current?.update().catch(() => undefined);
      }
    };
    const syncDisplayMode = () => setIsStandalone(isStandaloneDisplay());
    const syncMobileView = () => setIsMobile(mobileView.matches);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      setInstallDismissed(true);
      setIsStandalone(true);
      try {
        window.localStorage.removeItem(INSTALL_DISMISSED_KEY);
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
    };

    setIsOnline(navigator.onLine);
    syncDisplayMode();
    syncMobileView();
    setIsIos(isIosDevice());
    setInstallDismissed(wasInstallPromptDismissed());

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    document.addEventListener("visibilitychange", onVisibilityChange);
    displayMode.addEventListener("change", syncDisplayMode);
    mobileView.addEventListener("change", syncMobileView);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      displayMode.removeEventListener("change", syncDisplayMode);
      mobileView.removeEventListener("change", syncMobileView);
    };
  }, []);

  useEffect(() => {
    if (isStandalone || !isMobile) {
      setInstallReminderReady(false);
      return;
    }

    const reminderTimer = window.setTimeout(
      () => setInstallReminderReady(true),
      INSTALL_REMINDER_DELAY_MS
    );
    return () => window.clearTimeout(reminderTimer);
  }, [isMobile, isStandalone]);

  useEffect(() => {
    if (!enableServiceWorker || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let updateInterval = 0;
    let installingWorker: ServiceWorker | null = null;

    const revealWaitingUpdate = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
        setUpdateDismissed(false);
      }
    };

    const onInstallingStateChange = () => {
      const registration = registrationRef.current;
      if (installingWorker?.state === "installed" && registration) {
        revealWaitingUpdate(registration);
      }
    };

    const onUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", onInstallingStateChange);
      installingWorker = registrationRef.current?.installing ?? null;
      installingWorker?.addEventListener("statechange", onInstallingStateChange);
    };

    const checkForUpdate = () => {
      void registrationRef.current?.update().catch(() => undefined);
    };

    const onControllerChange = () => {
      if (reloadForUpdateRef.current) {
        if (updateActivationTimerRef.current) {
          window.clearTimeout(updateActivationTimerRef.current);
          updateActivationTimerRef.current = null;
        }
        reloadForUpdateRef.current = false;
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void registerWescommServiceWorker(enableRuntimeCaching)
      .then((registration) => {
        if (disposed) return;

        registrationRef.current = registration;
        revealWaitingUpdate(registration);
        registration.addEventListener("updatefound", onUpdateFound);
        checkForUpdate();
        updateInterval = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (updateInterval) window.clearInterval(updateInterval);
      if (updateActivationTimerRef.current) {
        window.clearTimeout(updateActivationTimerRef.current);
        updateActivationTimerRef.current = null;
      }
      installingWorker?.removeEventListener("statechange", onInstallingStateChange);
      registrationRef.current?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [enableRuntimeCaching, enableServiceWorker]);

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Dismissal remains in component state when storage is unavailable.
    }
  }, []);

  const requestInstall = useCallback(async (): Promise<PwaInstallResult> => {
    if (isStandalone) return "accepted";
    if (!installPrompt) return "instructions";

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "dismissed") dismissInstall();
      return choice.outcome;
    } catch {
      setInstallPrompt(null);
      return "instructions";
    }
  }, [dismissInstall, installPrompt, isStandalone]);

  const installContext = useMemo<PwaInstallContextValue>(() => ({
    canPrompt: Boolean(installPrompt),
    isInstalled: isStandalone,
    isIos,
    isMobile,
    requestInstall
  }), [installPrompt, isIos, isMobile, isStandalone, requestInstall]);

  const applyUpdate = () => {
    const waitingWorker = registrationRef.current?.waiting;
    if (!waitingWorker) {
      void registrationRef.current?.update().catch(() => undefined);
      return;
    }

    setApplyingUpdate(true);
    reloadForUpdateRef.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    updateActivationTimerRef.current = window.setTimeout(() => {
      reloadForUpdateRef.current = false;
      updateActivationTimerRef.current = null;
      setApplyingUpdate(false);
      void registrationRef.current?.update().catch(() => undefined);
    }, UPDATE_ACTIVATION_TIMEOUT_MS);
  };

  const showUpdate = isOnline && updateAvailable && !updateDismissed;
  const showInstall =
    isOnline &&
    !showUpdate &&
    !isStandalone &&
    isMobile &&
    pathname !== "/student/profile" &&
    installReminderReady &&
    !installDismissed &&
    Boolean(installPrompt || isIos);

  return (
    <PwaInstallContext.Provider value={installContext}>
      {children}
      {!isOnline ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-offline-banner"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[10000] mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-amber-300 bg-[#fff8e7] px-4 py-3 text-sm font-semibold text-[#754f00] shadow-[0_16px_45px_rgba(70,48,0,0.2)] sm:inset-x-6"
        >
          <WifiOff className="size-5 shrink-0" aria-hidden="true" />
          <span>You are offline. WESCOMM data and transactions need an internet connection.</span>
        </div>
      ) : null}

      {showUpdate ? (
        <aside
          aria-live="polite"
          data-testid="pwa-update-prompt"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] mx-auto max-w-md rounded-2xl border border-[#cfe0d1] bg-white p-4 shadow-[0_20px_60px_rgba(0,64,31,0.2)] sm:inset-x-auto sm:right-6 sm:mx-0 sm:p-5"
        >
          <button
            type="button"
            onClick={() => setUpdateDismissed(true)}
            aria-label="Remind me about this update later"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[#647068] hover:bg-[#eef6ee] focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e8f4ea] text-primary">
              <RefreshCw className={`size-5 ${applyingUpdate ? "animate-spin" : ""}`} aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">WESCOMM update available</h2>
              <p className="mt-1 text-sm leading-6 text-[#5f6c64]">
                Update now to use the latest version. Your server data will remain current and safe.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setUpdateDismissed(true)} disabled={applyingUpdate}>
              Later
            </Button>
            <Button type="button" onClick={applyUpdate} disabled={applyingUpdate}>
              {applyingUpdate ? "Updating..." : "Update now"}
            </Button>
          </div>
        </aside>
      ) : null}

      {showInstall ? (
        <aside
          aria-live="polite"
          data-testid="pwa-install-prompt"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md rounded-2xl border border-[#cfe0d1] bg-white p-4 shadow-[0_20px_60px_rgba(0,64,31,0.2)] sm:inset-x-auto sm:right-6 sm:mx-0 sm:p-5"
        >
          <button
            type="button"
            onClick={dismissInstall}
            aria-label="Dismiss install instructions"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[#647068] hover:bg-[#eef6ee] focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e8f4ea] text-primary">
              {installPrompt ? (
                <Download className="size-5" aria-hidden="true" />
              ) : (
                <Share2 className="size-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">Install WESCOMM on your phone</h2>
              <p className="mt-1 text-sm leading-6 text-[#5f6c64]">
                {installPrompt
                  ? "Add WESCOMM to your Home Screen for faster, app-like access."
                  : "On iPhone or iPad, tap Share, then choose Add to Home Screen."}
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={dismissInstall}>
              Not now
            </Button>
            {installPrompt ? (
              <Button type="button" onClick={() => void requestInstall()}>
                <Download className="size-4" aria-hidden="true" />
                Install
              </Button>
            ) : (
              <Button type="button" onClick={dismissInstall}>Got it</Button>
            )}
          </div>
        </aside>
      ) : null}
    </PwaInstallContext.Provider>
  );
}
