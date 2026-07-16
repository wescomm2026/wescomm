"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { StudentAuthModal } from "@/components/auth/StudentAuthModal";
import { WelcomeGateOverlay } from "@/components/auth/WelcomeGateOverlay";
import { API_BASE_URL, COOKIE_SESSION_TOKEN } from "@/lib/api";
import { describeOtpSendError } from "@/lib/auth-errors";
import { clearStaffSession, storeStaffSession } from "@/lib/staff-api";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

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

export type StudentProfileInput = Pick<StudentUser, "fullName" | "phone" | "department" | "address" | "avatarDataUrl">;

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
  closeAuth: () => void;
  sendEmailOtp: (email: string) => Promise<AuthResult>;
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult>;
  loginWithTestAccount: (email: string, password: string) => Promise<AuthResult>;
  completeEmailLogin: () => Promise<AuthResult>;
  updateProfile: (input: StudentProfileInput) => void;
  logout: () => void;
};

const LEGACY_DEV_SESSION_KEY = "wescomm_dev_session";
const LEGACY_SESSION_KEY = "wescomm_student_session";
const PASSWORD_LOGIN_EMAILS = new Set(["admin@wesleyan.edu.ph", "staff@wesleyan.edu.ph", "student@wesleyan.edu.ph"]);
const DEVELOPMENT_LOGIN_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true" ||
  (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "false" && process.env.NODE_ENV === "development");
const WELCOME_GATE_DURATION_MS = process.env.NEXT_PUBLIC_E2E_TEST === "true" ? 0 : 6000;
const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN ?? "wesleyan.edu.ph";
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
type BackendProfile = {
  id: string;
  role: AppRole;
  studentNumber: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  department: string | null;
  address: string | null;
  avatarUrl: string | null;
};

function normalizeSession(value: Partial<StudentUser>): StudentUser {
  return {
    ...emptyStudentProfile,
    ...value,
    role: value.role ?? "STUDENT",
    avatarDataUrl: value.avatarDataUrl
  };
}

function mapProfileToSession(profile: BackendProfile, accessToken = COOKIE_SESSION_TOKEN): StudentUser {
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

async function loadProfileSession(accessToken?: string): Promise<StudentUser> {
  const profileResponse = await fetch(`${API_BASE_URL}/auth/me`, {
    credentials: "include",
    headers: accessToken && accessToken !== COOKIE_SESSION_TOKEN
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined
  });
  const profilePayload = await profileResponse.json().catch(() => null);
  if (!profileResponse.ok) {
    throw new Error(profilePayload?.error ?? "Unable to load account profile.");
  }

  return mapProfileToSession(profilePayload.profile as BackendProfile);
}

async function establishBackendSession(accessToken: string): Promise<StudentUser> {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Unable to establish a secure session.");
  return mapProfileToSession(payload.profile as BackendProfile);
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
  const [user, setUser] = useState<StudentUser | null>(null);
  const [ready, setReady] = useState(false);
  const [browserLoaded, setBrowserLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [welcomeGateUser, setWelcomeGateUser] = useState<StudentUser | "GUEST" | null>("GUEST");

  const showWelcomeGate = useCallback((gateUser: StudentUser | "GUEST") => {
    setWelcomeGateUser(gateUser);
  }, []);

  const showGuestWelcomeGate = useCallback(() => {
    showWelcomeGate("GUEST");
  }, [showWelcomeGate]);

  const persistSession = useCallback((session: StudentUser, options?: { showWelcomeGate?: boolean }) => {
    window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    if (session.role === "STAFF" || session.role === "ADMIN") {
      storeStaffSession(COOKIE_SESSION_TOKEN, session.email);
    } else {
      clearStaffSession();
    }
    setUser(session);
    if (options?.showWelcomeGate) showWelcomeGate(session);
  }, [showWelcomeGate]);

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
      try {
        window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
        window.localStorage.removeItem(LEGACY_SESSION_KEY);
        clearLegacyBrowserAuthTokens();
        const verifiedSession = await loadProfileSession();
        if (cancelled) return;

        persistSession(verifiedSession, { showWelcomeGate: true });
      } catch {
        if (!cancelled) {
          window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
          clearStaffSession();
          setUser(null);
          if (!shouldOpenLogin) showGuestWelcomeGate();
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [persistSession, showGuestWelcomeGate]);

  const openAuth = useCallback(() => setModalOpen(true), []);
  const closeAuth = useCallback(() => setModalOpen(false), []);

  const saveSession = useCallback((session: StudentUser) => {
    persistSession(session, { showWelcomeGate: true });
    setModalOpen(false);
    router.replace(getDashboardPath(session.role));
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

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: token.trim(),
        type: "email"
      });

      if (error) return { success: false, error: "That code is invalid or expired. Please request a new code and try again." };

      const accessToken = data.session?.access_token;
      if (!accessToken) return { success: false, error: "We could not verify your login. Please request a new code and try again." };

      const session = await establishBackendSession(accessToken);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      saveSession(session);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: "We could not verify your login. Please request a new code and try again."
      };
    }
  }, [saveSession]);

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

      const session = await establishBackendSession(accessToken);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      saveSession(session);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: "We could not complete your login. Please try again."
      };
    }
  }, [saveSession]);

  const loginWithTestAccount = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!PASSWORD_LOGIN_EMAILS.has(normalizedEmail)) {
      return { success: false, error: "Password login is not available for this account." };
    }

    try {
      if (DEVELOPMENT_LOGIN_ENABLED) {
        const response = await fetch(`${API_BASE_URL}/auth/dev-login`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email: normalizedEmail, password })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          return { success: false, error: payload?.error ?? "Unable to sign in with this account." };
        }

        const session = mapProfileToSession(payload.profile as BackendProfile);
        saveSession(session);
        return { success: true };
      }

      if (!hasSupabaseBrowserConfig()) {
        return { success: false, error: "Login is not available right now. Please try again later." };
      }

      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });
      if (error || !data.session?.access_token) {
        return { success: false, error: "The email or password is incorrect." };
      }

      const session = await establishBackendSession(data.session.access_token);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      saveSession(session);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: getAuthErrorMessage(error, "Unable to sign in with this account.")
      };
    }
  }, [saveSession]);

  const updateProfile = useCallback((input: StudentProfileInput) => {
    setUser((current) => {
      if (!current) return current;
      const updated = { ...current, ...input };
      return updated;
    });
  }, []);

  const logout = useCallback(() => {
    void fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      keepalive: true
    });
    if (hasSupabaseBrowserConfig()) {
      void getSupabaseBrowserClient().auth.signOut({ scope: "local" });
    }
    window.sessionStorage.removeItem(LEGACY_DEV_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    clearStaffSession();
    setUser(null);
    setWelcomeGateUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
      openAuth,
      closeAuth,
      sendEmailOtp,
      verifyEmailOtp,
      loginWithTestAccount,
      completeEmailLogin,
      updateProfile,
      logout
    }),
    [user, ready, openAuth, closeAuth, sendEmailOtp, verifyEmailOtp, loginWithTestAccount, completeEmailLogin, updateProfile, logout]
  );

  return (
    <StudentAuthContext.Provider value={value}>
      {children}
      <StudentAuthModal open={modalOpen} onClose={closeAuth} />
      {welcomeGateUser ? (
        <WelcomeGateOverlay
          user={welcomeGateUser}
          readyToFinish={ready && browserLoaded}
          minimumDurationMs={WELCOME_GATE_DURATION_MS}
          onFinish={() => setWelcomeGateUser(null)}
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
