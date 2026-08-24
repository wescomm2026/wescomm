export const WELCOME_INTRO_SESSION_KEY = "wescomm_welcome_intro_v2_seen";
export const WELCOME_INTRO_DOCUMENT_ATTRIBUTE = "data-wescomm-intro";
export const WELCOME_INTRO_VIDEO_SRC = "/assets/wescomm-logo-intro-new.mp4";

export function welcomeIntroBootstrapScript() {
  const sessionKey = JSON.stringify(WELCOME_INTRO_SESSION_KEY);
  const documentAttribute = JSON.stringify(WELCOME_INTRO_DOCUMENT_ATTRIBUTE);

  return `(() => {
    const root = document.documentElement;
    const existingState = root.getAttribute(${documentAttribute});
    if (existingState === "pending" || existingState === "seen") return;
    let shouldShow = true;
    try {
      const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches
        || window.matchMedia("(display-mode: minimal-ui)").matches
        || window.navigator.standalone === true;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const alreadySeen = window.sessionStorage.getItem(${sessionKey}) === "1";
      shouldShow = isInstalledApp && !reducedMotion && !alreadySeen;
      if (shouldShow) window.sessionStorage.setItem(${sessionKey}, "1");
    } catch {}
    root.setAttribute(${documentAttribute}, shouldShow ? "pending" : "seen");
  })();`;
}
