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
import { usePathname, useRouter } from "next/navigation";
import { StudentAuthModal } from "@/components/auth/StudentAuthModal";
import { WelcomeGateOverlay } from "@/components/auth/WelcomeGateOverlay";
import {
  API_BASE_URL,
  AUTH_UNAUTHORIZED_EVENT,
  BackendApiError,
  COOKIE_SESSION_TOKEN,
  onlineFetch,
  updateMyProfileFromApi,
  type BackendAuthProfile
} from "@/lib/api";
import { describeOtpSendError } from "@/lib/auth-errors";
import { EMAIL_OTP_LENGTH, isCompleteEmailOtp, normalizeEmailOtp } from "@/lib/auth-otp";
import { unsubscribeWebPushFromBrowser } from "@/lib/push-notifications";
import {
  passwordLoginTarget,
  temporaryStaffLoginExpirationTimestamp
} from "@/lib/password-login-policy.mjs";
import { clearStaffSession, storeStaffSession } from "@/lib/staff-api";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import {
  getWelcomeContentReadyPath,
  isWelcomeContentReady,
  resetWelcomeContentReady,
  WELCOME_CONTENT_READY_EVENT
} from "@/lib/welcome-readiness";

type AppRole = "STUDENT" | "STAFF" | "ADMIN";

export type StudentUser = {
  id: string;
  role: AppRole;
  accessToken?: string;
  studentNumber: string;
  fullName: string;
  email: string;
  phone: string;
  department: string;
  address: string;
  avatarDataUrl?: string;
};

export type StudentProfileInput = Pick<StudentUser, "fullName" | "phone" | "department" | "address">;

export type AuthResult = {
  success: boolean;
  error?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
};

type StudentAuthContextValue = {
  user: StudentUser | null;
  ready: boolean;
  allowedEmailDomain: string;
  openAuth: () => void;
  openAuthAt: (returnTo: string) => void;
  closeAuth: () => void;
  sendEmailOtp: (email: string) => Promise<AuthResult>;
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult>;
  loginWithTestAccount: (email: string, password: string) => Promise<AuthResult>;
  isPasswordLoginAvailable: (email: string) => boolean;
  completeEmailLogin: () => Promise<AuthResult>;
  updateProfile: (input: StudentProfileInput) => Promise<AuthResult>;
  logout: () => Promise<boolean>;
};

const LEGACY_DEV_SESSION_KEY = "wescomm_dev_session";
const LEGACY_SESSION_KEY = "wescomm_student_session";
const LOGOUT_PENDING_KEY = "wescomm_logout_pending";
const DEVELOPMENT_LOGIN_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true" ||
  (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "false" && process.env.NODE_ENV === "development");
const TEMPORARY_PRODUCTION_STAFF_LOGIN_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN === "true";
const TEMPORARY_PRODUCTION_STAFF_LOGIN_EXPIRES_AT =
  process.env.NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT;
const E2E_TEST_ENABLED = process.env.NEXT_PUBLIC_E2E_TEST === "true";
const WELCOME_GATE_MINIMUM_DURATION_MS = E2E_TEST_ENABLED ? 0 : 2200;
const WELCOME_GATE_MAXIMUM_DURATION_MS = E2E_TEST_ENABLED ? 1000 : 4000;
const READINESS_AWARE_DASHBOARD_PATHS = new Set(["/student/dashboard", "/staff", "/admin/dashboard"]);
const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN ?? "wesleyan.edu.ph";
const AUTH_SESSION_LOCK_NAME = "wescomm-auth-session";
const StudentAuthContext = createContext<StudentAuthContextValue | null>(null);
const emptyStudentProfile: StudentUser = {
  id: "",
  role: "STUDENT",
  studentNumber: "",
  fullName: "",
  email: "",
  phone: "",
  department: "",
  address: ""
};
type ProfileCheckResult =
  | { status: "authenticated"; session: StudentUser }
  | { status: "unauthorized" }
  | { status: "transient" }
  | { status: "stale" };

async function withAuthSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(AUTH_SESSION_LOCK_NAME, operation);
  }
  return operation();
}

function normalizeSession(value: Partial<StudentUser>): StudentUser {
  return {
    ...emptyStudentProfile,
    ...value,
    role: value.role ?? "STUDENT",
    avatarDataUrl: value.avatarDataUrl
  };
}

function mapProfileToSession(profile: BackendAuthProfile, accessToken = COOKIE_SESSION_TOKEN): StudentUser {
  return normalizeSession({
    id: profile.id,
    role: profile.role,
    accessToken,
    studentNumber: profile.studentNumber ?? "",
    fullName: profile.fullName || profile.email,
    email: profile.email,
    phone: profile.phone ?? "",
    department: profile.department ?? "",
    address: profile.address ?? "",
    avatarDataUrl: profile.avatarUrl ?? undefined
  });
}

function getDashboardPath(role: AppRole) {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "STAFF") return "/staff";
  return "/student/dashboard";
}

function safeStudentReturnPath(value?: string) {
  if (!value || typeof window === "undefined") return null;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/student/")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function loadProfileSession(accessToken?: string): Promise<StudentUser> {
  const profileResponse = await onlineFetch(`${API_BASE_URL}/auth/me`, {
    credentials: "include",
    headers: accessToken && accessToken !== COOKIE_SESSION_TOKEN
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined
  });
  const profilePayload = await profileResponse.json().catch(() => null);
  if (!profileResponse.ok) {
    throw new BackendApiError(
      profileResponse.status,
      profilePayload?.error ?? "Unable to load account profile.",
      profilePayload?.code,
      profilePayload?.details
    );
  }

  return mapProfileToSession(profilePayload.profile as BackendAuthProfile);
}

async function establishBackendSession(accessToken: string): Promise<StudentUser> {
  const response = await onlineFetch(`${API_BASE_URL}/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Unable to establish a secure session.");
  return mapProfileToSession(payload.profile as BackendAuthProfile);
}

function isAllowedEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedDomain = ALLOWED_EMAIL_DOMAIN.trim().toLowerCase().replace(/^@/, "");
  const parts = normalizedEmail.split("@");

  return parts.length === 2 && Boolean(parts[0]) && !/\s/.test(parts[0]) && parts[1] === normalizedDomain;
}

function getAuthErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim() && error.message.trim() !== "{}") {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message && message !== "{}") return message;
  }

  return fallback;
}

function clearLegacyBrowserAuthTokens() {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key && /^sb-[A-Za-z0-9]+-auth-token$/.test(key)) {
      window.localStorage.removeItem(key);
    }
  }
}

export function StudentAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StudentUser | null>(null);
  const [ready, setReady] = useState(false);
  const [browserLoaded, setBrowserLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [welcomeGateUser, setWelcomeGateUser] = useState<StudentUser | "GUEST" | null>("GUEST");
  const [welcomeGateTargetPath, setWelcomeGateTargetPath] = useState(pathname);
  const [welcomeContentReady, setWelcomeContentReady] = useState(false);
  const [, refreshTemporaryLoginPolicy] = useState(0);
  const mountedRef = useRef(false);
  const profileCheckRef = useRef<Promise<ProfileCheckResult> | null>(null);
  const pendingLogoutRef = useRef<Promise<boolean> | null>(null);
  const pendingAuthReturnPathRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const welcomeTargetNeedsContentReady = READINESS_AWARE_DASHBOARD_PATHS.has(welcomeGateTargetPath);
  const dismissWelcomeGate = useCallback(() => setWelcomeGateUser(null), []);

  useEffect(() => {
    if (!TEMPORARY_PRODUCTION_STAFF_LOGIN_ENABLED) return;
    const expirationMs = temporaryStaffLoginExpirationTimestamp(
      TEMPORARY_PRODUCTION_STAFF_LOGIN_EXPIRES_AT
    );
    const delayMs = expirationMs - Date.now();
    if (!Number.isFinite(delayMs) || delayMs <= 0) return;

    const timer = window.setTimeout(() => {
      refreshTemporaryLoginPolicy((version) => version + 1);
    }, delayMs + 50);
    return () => window.clearTimeout(timer);
  }, []);

  const showWelcomeGate = useCallback((gateUser: StudentUser | "GUEST", targetPath: string) => {
    setWelcomeGateTargetPath(targetPath);
    setWelcomeContentReady(
      targetPath === window.location.pathname && isWelcomeContentReady(targetPath)
    );
    setWelcomeGateUser(gateUser);
  }, []);

  const showGuestWelcomeGate = useCallback((targetPath: string) => {
    showWelcomeGate("GUEST", targetPath);
  }, [showWelcomeGate]);

  const persistSession = useCallback((
    session: StudentUser,
    options?: { showWelcomeGate?: boolean; welcomeGateTargetPath?: string }
  ) => {
    window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    if (session.role === "STAFF" || session.role === "ADMIN") {
      storeStaffSession(COOKIE_SESSION_TOKEN, session.email);
    } else {
      clearStaffSession();
    }
    setUser(session);
    if (options?.showWelcomeGate) {
      showWelcomeGate(session, options.welcomeGateTargetPath ?? window.location.pathname);
    }
  }, [showWelcomeGate]);

  const clearConfirmedSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    profileCheckRef.current = null;
    window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    clearLegacyBrowserAuthTokens();
    clearStaffSession();
    setUser(null);
    setWelcomeGateUser(null);
  }, []);

  const flushPendingLogout = useCallback((expectedGeneration = sessionGenerationRef.current) => {
    if (pendingLogoutRef.current) return pendingLogoutRef.current;
    if (window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true") return Promise.resolve(true);
    if (!navigator.onLine) return Promise.resolve(false);

    const pendingLogout = withAuthSessionLock(async () => {
      if (window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true") return true;
      let response: Response;
      try {
        response = await onlineFetch(`${API_BASE_URL}/auth/logout`, {
          method: "POST",
          credentials: "include",
          keepalive: true
        });
      } catch {
        return false;
      }

      if (!response.ok && response.status !== 401) return false;
      if (
        expectedGeneration !== sessionGenerationRef.current ||
        window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true"
      ) {
        return true;
      }

      // Session revocation takes priority. Browser push cleanup is best-effort
      // afterward and cannot delay or accidentally target a newer login.
      await unsubscribeWebPushFromBrowser().catch(() => undefined);
      if (
        expectedGeneration !== sessionGenerationRef.current ||
        window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true"
      ) {
        return true;
      }
      if (hasSupabaseBrowserConfig()) {
        await getSupabaseBrowserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
      }
      window.localStorage.removeItem(LOGOUT_PENDING_KEY);
      return true;
    });

    pendingLogoutRef.current = pendingLogout;
    void pendingLogout.finally(() => {
      if (pendingLogoutRef.current === pendingLogout) pendingLogoutRef.current = null;
    });
    return pendingLogout;
  }, []);

  const prepareForNewSession = useCallback(async () => {
    if (window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true") return true;
    if (!navigator.onLine) return false;
    const completed = await flushPendingLogout();
    return completed && window.localStorage.getItem(LOGOUT_PENDING_KEY) !== "true";
  }, [flushPendingLogout]);

  const revalidateProfileSession = useCallback(() => {
    if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
      return Promise.resolve<ProfileCheckResult>({ status: "stale" });
    }
    if (profileCheckRef.current) return profileCheckRef.current;
    const sessionGeneration = sessionGenerationRef.current;

    const profileCheck = (async (): Promise<ProfileCheckResult> => {
      try {
        const session = await loadProfileSession();
        if (sessionGeneration !== sessionGenerationRef.current) return { status: "stale" };
        if (mountedRef.current) persistSession(session);
        return { status: "authenticated", session };
      } catch (error) {
        if (sessionGeneration !== sessionGenerationRef.current) return { status: "stale" };
        const confirmedUnauthorized =
          error instanceof BackendApiError && (error.status === 401 || error.status === 403);

        if (confirmedUnauthorized) {
          if (mountedRef.current && sessionGeneration === sessionGenerationRef.current) {
            clearConfirmedSession();
          }
          return { status: "unauthorized" };
        }

        // Offline, network, rate-limit, and server failures do not prove that
        // the HttpOnly session is invalid. Keep the current account in memory
        // and retry when the browser reconnects or becomes active again.
        return { status: "transient" };
      }
    })();

    profileCheckRef.current = profileCheck;
    void profileCheck.finally(() => {
      if (profileCheckRef.current === profileCheck) profileCheckRef.current = null;
    });
    return profileCheck;
  }, [clearConfirmedSession, persistSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const verifyUnauthorizedSession = () => {
      // A delayed request from a previous account can return 401 after a new
      // cookie session is active. Verify the current cookie before clearing it.
      if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") return;
      void revalidateProfileSession();
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, verifyUnauthorizedSession);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, verifyUnauthorizedSession);
  }, [revalidateProfileSession]);

  useEffect(() => {
    const handleCrossTabLogout = (event: StorageEvent) => {
      if (event.key !== LOGOUT_PENDING_KEY || event.newValue !== "true") return;
      if (user) clearConfirmedSession();
      if (navigator.onLine) void flushPendingLogout();
    };
    window.addEventListener("storage", handleCrossTabLogout);
    return () => window.removeEventListener("storage", handleCrossTabLogout);
  }, [clearConfirmedSession, flushPendingLogout, user]);

  useEffect(() => {
    if (!welcomeGateUser) return undefined;

    const syncReadiness = () => {
      const currentPath = window.location.pathname;
      const targetIsCurrent = welcomeGateTargetPath === currentPath && welcomeGateTargetPath === pathname;
      setWelcomeContentReady(
        targetIsCurrent && isWelcomeContentReady(welcomeGateTargetPath)
      );
    };

    const handleContentReady = (event: Event) => {
      const readyPath = getWelcomeContentReadyPath(event);
      if (
        readyPath === welcomeGateTargetPath &&
        readyPath === window.location.pathname &&
        isWelcomeContentReady(readyPath)
      ) {
        setWelcomeContentReady(true);
      }
    };

    syncReadiness();
    window.addEventListener(WELCOME_CONTENT_READY_EVENT, handleContentReady);

    return () => window.removeEventListener(WELCOME_CONTENT_READY_EVENT, handleContentReady);
  }, [pathname, welcomeGateTargetPath, welcomeGateUser]);

  useEffect(() => {
    if (document.readyState === "complete") {
      setBrowserLoaded(true);
      return undefined;
    }

    const markBrowserLoaded = () => setBrowserLoaded(true);
    window.addEventListener("load", markBrowserLoaded, { once: true });

    return () => window.removeEventListener("load", markBrowserLoaded);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const url = new URL(window.location.href);
    const shouldOpenLogin = url.searchParams.get("auth") === "login";
    if (shouldOpenLogin) {
      setModalOpen(true);
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    async function restoreSession() {
      window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
      clearLegacyBrowserAuthTokens();

      if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
        clearConfirmedSession();
        const logoutGeneration = sessionGenerationRef.current;
        await flushPendingLogout(logoutGeneration);
        if (cancelled) return;
        if (!shouldOpenLogin) showGuestWelcomeGate(window.location.pathname);
        setReady(true);
        return;
      }

      const result = await revalidateProfileSession();
      if (cancelled) return;

      if (result.status === "authenticated") {
        showWelcomeGate(result.session, window.location.pathname);
      } else if (result.status !== "stale" && !shouldOpenLogin) {
        showGuestWelcomeGate(window.location.pathname);
      }
      setReady(true);
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [clearConfirmedSession, flushPendingLogout, revalidateProfileSession, showGuestWelcomeGate, showWelcomeGate]);

  useEffect(() => {
    if (!ready) return;

    const refreshSession = async () => {
      if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
        if (user) clearConfirmedSession();
        await flushPendingLogout();
        return;
      }
      await revalidateProfileSession();
    };
    const refreshVisibleSession = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    const sessionTimer = window.setInterval(refreshVisibleSession, 60_000);

    window.addEventListener("online", refreshVisibleSession);
    window.addEventListener("focus", refreshVisibleSession);
    document.addEventListener("visibilitychange", refreshVisibleSession);

    return () => {
      window.clearInterval(sessionTimer);
      window.removeEventListener("online", refreshVisibleSession);
      window.removeEventListener("focus", refreshVisibleSession);
      document.removeEventListener("visibilitychange", refreshVisibleSession);
    };
  }, [clearConfirmedSession, flushPendingLogout, ready, revalidateProfileSession, user]);

  const openAuth = useCallback(() => {
    pendingAuthReturnPathRef.current = null;
    setModalOpen(true);
  }, []);
  const openAuthAt = useCallback((returnTo: string) => {
    pendingAuthReturnPathRef.current = safeStudentReturnPath(returnTo);
    setModalOpen(true);
  }, []);
  const closeAuth = useCallback(() => {
    pendingAuthReturnPathRef.current = null;
    setModalOpen(false);
  }, []);

  const saveSession = useCallback((session: StudentUser) => {
    if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") return false;
    sessionGenerationRef.current += 1;
    profileCheckRef.current = null;
    const requestedReturnPath = session.role === "STUDENT" ? pendingAuthReturnPathRef.current : null;
    pendingAuthReturnPathRef.current = null;
    const targetPath = requestedReturnPath ?? getDashboardPath(session.role);
    if (targetPath !== window.location.pathname) {
      resetWelcomeContentReady(targetPath);
    }
    persistSession(session, {
      showWelcomeGate: true,
      welcomeGateTargetPath: targetPath
    });
    setModalOpen(false);
    router.replace(targetPath);
    return true;
  }, [persistSession, router]);

  const sendEmailOtp = useCallback(async (email: string): Promise<AuthResult> => {
    if (!hasSupabaseBrowserConfig()) {
      return { success: false, error: "Login is not available right now. Please try again later." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isAllowedEmail(normalizedEmail)) {
      return { success: false, error: `Please use your official @${ALLOWED_EMAIL_DOMAIN} account.` };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: true
        }
      });

      if (error) {
        const failure = describeOtpSendError(error);
        return {
          success: false,
          error: failure.message,
          errorCode: failure.code,
          retryAfterSeconds: failure.retryAfterSeconds
        };
      }
      return { success: true };
    } catch (error) {
      const failure = describeOtpSendError(error);
      return {
        success: false,
        error: failure.message,
        errorCode: failure.code,
        retryAfterSeconds: failure.retryAfterSeconds
      };
    }
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string): Promise<AuthResult> => {
    if (!hasSupabaseBrowserConfig()) {
      return { success: false, error: "Login is not available right now. Please try again later." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isAllowedEmail(normalizedEmail)) {
      return { success: false, error: `Please use your official @${ALLOWED_EMAIL_DOMAIN} account.` };
    }

    const normalizedToken = normalizeEmailOtp(token);
    if (!isCompleteEmailOtp(normalizedToken)) {
      return { success: false, error: `Enter the complete ${EMAIL_OTP_LENGTH}-digit verification code.` };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedToken,
        type: "email"
      });

      if (error) return { success: false, error: "That code is invalid or expired. Please request a new code and try again." };

      const accessToken = data.session?.access_token;
      if (!accessToken) return { success: false, error: "We could not verify your login. Please request a new code and try again." };

      if (!await prepareForNewSession()) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        return { success: false, error: "Please wait for the previous account to finish signing out, then try again." };
      }
      const session = await withAuthSessionLock(async () => {
        if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
          throw new Error("A sign out is still in progress.");
        }
        return establishBackendSession(accessToken);
      });
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (!saveSession(session)) {
        return { success: false, error: "A sign out was requested before login completed. Please try again." };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: "We could not verify your login. Please request a new code and try again."
      };
    }
  }, [prepareForNewSession, saveSession]);

  const completeEmailLogin = useCallback(async (): Promise<AuthResult> => {
    if (!hasSupabaseBrowserConfig()) {
      return { success: false, error: "Login is not available right now. Please try again later." };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const url = new URL(window.location.href);

      let accessToken = "";
      if (url.searchParams.has("code")) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(url.searchParams.get("code") ?? "");
        if (error) return { success: false, error: "This sign-in link is invalid or expired. Please request a new code." };
        accessToken = data.session?.access_token ?? "";
      }

      if (!accessToken) {
        const { data, error } = await supabase.auth.getSession();
        if (error) return { success: false, error: "We could not complete your login. Please try again." };
        accessToken = data.session?.access_token ?? "";
      }
      if (!accessToken) return { success: false, error: "We could not complete your login. Please try again." };

      if (!await prepareForNewSession()) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        return { success: false, error: "Please wait for the previous account to finish signing out, then try again." };
      }
      const session = await withAuthSessionLock(async () => {
        if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
          throw new Error("A sign out is still in progress.");
        }
        return establishBackendSession(accessToken);
      });
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (!saveSession(session)) {
        return { success: false, error: "A sign out was requested before login completed. Please try again." };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: "We could not complete your login. Please try again."
      };
    }
  }, [prepareForNewSession, saveSession]);

  const getPasswordLoginTarget = useCallback((email: string) => passwordLoginTarget({
    email,
    developmentEnabled: DEVELOPMENT_LOGIN_ENABLED,
    temporaryStaffEnabled: TEMPORARY_PRODUCTION_STAFF_LOGIN_ENABLED,
    temporaryStaffExpiresAt: TEMPORARY_PRODUCTION_STAFF_LOGIN_EXPIRES_AT
  }), []);

  const isPasswordLoginAvailable = useCallback((email: string) => (
    getPasswordLoginTarget(email) !== null
  ), [getPasswordLoginTarget]);

  const loginWithTestAccount = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    const loginTarget = getPasswordLoginTarget(normalizedEmail);
    if (!loginTarget) {
      return { success: false, error: "Password login is not available for this account." };
    }

    try {
      if (!await prepareForNewSession()) {
        return { success: false, error: "Please wait for the previous account to finish signing out, then try again." };
      }
      const response = await withAuthSessionLock(async () => {
        if (window.localStorage.getItem(LOGOUT_PENDING_KEY) === "true") {
          throw new Error("A sign out is still in progress.");
        }
        return onlineFetch(`${API_BASE_URL}/auth/${loginTarget}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email: normalizedEmail, password })
        });
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return { success: false, error: payload?.error ?? "Unable to sign in with this account." };
      }

      const session = mapProfileToSession(payload.profile as BackendAuthProfile);
      if (!saveSession(session)) {
        return { success: false, error: "A sign out was requested before login completed. Please try again." };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: getAuthErrorMessage(error, "Unable to sign in with this account.")
      };
    }
  }, [getPasswordLoginTarget, prepareForNewSession, saveSession]);

  const updateProfile = useCallback(async (input: StudentProfileInput): Promise<AuthResult> => {
    if (!user?.id) return { success: false, error: "Log in again before updating your profile." };

    const requestGeneration = sessionGenerationRef.current;
    const accountId = user.id;
    const accessToken = user.accessToken ?? COOKIE_SESSION_TOKEN;

    try {
      const profile = await updateMyProfileFromApi(accessToken, {
        fullName: input.fullName.trim(),
        phone: input.phone.trim() || null,
        department: input.department.trim() || null,
        address: input.address.trim() || null
      });

      if (requestGeneration !== sessionGenerationRef.current || profile.id !== accountId) {
        return { success: false, error: "The active account changed before the profile update completed." };
      }

      setUser((current) => (
        current?.id === accountId
          ? mapProfileToSession(profile, current.accessToken ?? COOKIE_SESSION_TOKEN)
          : current
      ));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: getAuthErrorMessage(error, "Unable to save your profile. Please try again.")
      };
    }
  }, [user?.accessToken, user?.id]);

  const logout = useCallback(async () => {
    window.localStorage.setItem(LOGOUT_PENDING_KEY, "true");
    clearConfirmedSession();
    const logoutGeneration = sessionGenerationRef.current;
    const remoteLogout = navigator.onLine
      ? flushPendingLogout(logoutGeneration)
      : Promise.resolve(false);
    if (hasSupabaseBrowserConfig()) {
      await getSupabaseBrowserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
    }

    await remoteLogout;
    return true;
  }, [clearConfirmedSession, flushPendingLogout]);

  const value = useMemo(
    () => ({
      user,
      ready,
      allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
      openAuth,
      openAuthAt,
      closeAuth,
      sendEmailOtp,
      verifyEmailOtp,
      loginWithTestAccount,
      isPasswordLoginAvailable,
      completeEmailLogin,
      updateProfile,
      logout
    }),
    [user, ready, openAuth, openAuthAt, closeAuth, sendEmailOtp, verifyEmailOtp, loginWithTestAccount, isPasswordLoginAvailable, completeEmailLogin, updateProfile, logout]
  );

  return (
    <StudentAuthContext.Provider value={value}>
      {children}
      <StudentAuthModal open={modalOpen} onClose={closeAuth} />
      {welcomeGateUser ? (
        <WelcomeGateOverlay
          user={welcomeGateUser}
          readyToFinish={ready && browserLoaded && (!welcomeTargetNeedsContentReady || welcomeContentReady)}
          minimumDurationMs={WELCOME_GATE_MINIMUM_DURATION_MS}
          maximumDurationMs={WELCOME_GATE_MAXIMUM_DURATION_MS}
          onFinish={dismissWelcomeGate}
        />
      ) : null}
    </StudentAuthContext.Provider>
  );
}

export function useStudentAuth() {
  const context = useContext(StudentAuthContext);
  if (!context) throw new Error("useStudentAuth must be used inside StudentAuthProvider");
  return context;
}
