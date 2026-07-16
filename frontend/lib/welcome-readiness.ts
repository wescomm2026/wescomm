export const WELCOME_CONTENT_READY_EVENT = "wescomm:welcome-content-ready";

type WelcomeContentReadyDetail = {
  path: string;
};

const readyPaths = new Set<string>();

export function isWelcomeContentReady(path: string) {
  return readyPaths.has(path);
}

export function resetWelcomeContentReady(path: string) {
  readyPaths.delete(path);
}

export function markWelcomeContentReady(path: string) {
  readyPaths.add(path);

  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<WelcomeContentReadyDetail>(WELCOME_CONTENT_READY_EVENT, {
      detail: { path }
    })
  );
}

export function getWelcomeContentReadyPath(event: Event) {
  return (event as CustomEvent<WelcomeContentReadyDetail>).detail?.path;
}
