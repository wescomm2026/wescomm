"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, LockKeyhole, Mail, ShieldCheck, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";

const OTP_MAX_LENGTH = 8;
const RESEND_COOLDOWN_SECONDS = 60;
const SEND_LIMIT_COUNT = 5;
const SEND_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const REMEMBER_EMAIL_KEY = "wescomm_remembered_email_name";
const REMEMBER_EMAIL_ENABLED_KEY = "wescomm_remember_email_enabled";
const SEND_ATTEMPTS_KEY_PREFIX = "wescomm_auth_send_attempts:";
const PASSWORD_LOGIN_EMAILS = new Set(["admin@wesleyan.edu.ph", "staff@wesleyan.edu.ph", "student@wesleyan.edu.ph"]);
type AuthStep = "email" | "code" | "password";

function schoolEmailDomainSuffix(allowedEmailDomain: string) {
  return `@${allowedEmailDomain.trim().toLowerCase().replace(/^@/, "")}`;
}

function stripSchoolEmailDomain(value: string, allowedEmailDomain: string) {
  const normalizedInput = value.trim().toLowerCase();
  const domainSuffix = schoolEmailDomainSuffix(allowedEmailDomain);
  return normalizedInput.endsWith(domainSuffix)
    ? normalizedInput.slice(0, -domainSuffix.length)
    : normalizedInput;
}

function normalizeSchoolEmailInput(value: string, allowedEmailDomain: string) {
  const normalizedInput = value.trim().toLowerCase();
  const domainSuffix = schoolEmailDomainSuffix(allowedEmailDomain);
  const hasDomain = normalizedInput.includes("@");

  if (hasDomain && !normalizedInput.endsWith(domainSuffix)) return null;

  const emailName = hasDomain
    ? normalizedInput.slice(0, -domainSuffix.length)
    : normalizedInput;

  if (!emailName || /[\s@]/.test(emailName)) return null;

  return {
    emailName,
    email: `${emailName}${domainSuffix}`
  };
}

function getAttemptKey(email: string) {
  return `${SEND_ATTEMPTS_KEY_PREFIX}${email.toLowerCase()}`;
}

function getRecentAttempts(email: string) {
  try {
    const rawAttempts = window.localStorage.getItem(getAttemptKey(email));
    const attempts = rawAttempts ? (JSON.parse(rawAttempts) as number[]) : [];
    const cutoff = Date.now() - SEND_LIMIT_WINDOW_MS;
    return attempts.filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff);
  } catch {
    return [];
  }
}

function saveRecentAttempts(email: string, attempts: number[]) {
  window.localStorage.setItem(getAttemptKey(email), JSON.stringify(attempts));
}

function getSendLimitMessage(email: string) {
  const attempts = getRecentAttempts(email);
  const now = Date.now();
  const latestAttempt = attempts.at(-1);

  if (latestAttempt && now - latestAttempt < RESEND_COOLDOWN_SECONDS * 1000) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (now - latestAttempt)) / 1000);
    return `Please wait ${waitSeconds}s before requesting another code.`;
  }

  if (attempts.length >= SEND_LIMIT_COUNT) {
    const oldestAttempt = attempts[0] ?? now;
    const waitMinutes = Math.ceil((SEND_LIMIT_WINDOW_MS - (now - oldestAttempt)) / 60000);
    return `Too many code requests. Please try again in about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`;
  }

  return "";
}

function recordSendAttempt(email: string) {
  const attempts = getRecentAttempts(email);
  attempts.push(Date.now());
  saveRecentAttempts(email, attempts);
}

export function StudentAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { allowedEmailDomain, sendEmailOtp, verifyEmailOtp, loginWithTestAccount } = useStudentAuth();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState<"send" | "verify" | "password" | "">("");
  const [step, setStep] = useState<AuthStep>("email");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailName, setEmailName] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [rememberEmail, setRememberEmail] = useState(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    setLoading("");
    setStep("email");
    setError("");
    setNotice("");
    setSentEmail("");
    setCode("");
    setPassword("");
    setResendSeconds(0);

    const rememberEnabled = window.localStorage.getItem(REMEMBER_EMAIL_ENABLED_KEY) !== "false";
    const rememberedEmailName = rememberEnabled ? window.localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "" : "";
    setRememberEmail(rememberEnabled);
    setEmailName(rememberedEmailName);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || resendSeconds <= 0) return;

    const timer = window.setTimeout(() => {
      setResendSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [open, resendSeconds]);

  const handleSendOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resendSeconds > 0 || loading) return;

    setLoading("send");
    setError("");
    setNotice("");

    const normalizedSchoolEmail = normalizeSchoolEmailInput(emailName, allowedEmailDomain);
    if (!normalizedSchoolEmail) {
      setError(`Please use your official @${allowedEmailDomain} account.`);
      setLoading("");
      return;
    }

    const { emailName: normalizedName, email: normalizedEmail } = normalizedSchoolEmail;
    setEmailName(normalizedName);
    setSentEmail(normalizedEmail);

    if (rememberEmail) {
      window.localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "true");
      window.localStorage.setItem(REMEMBER_EMAIL_KEY, normalizedName);
    } else {
      window.localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "false");
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }

    if (PASSWORD_LOGIN_EMAILS.has(normalizedEmail)) {
      setStep("password");
      setNotice("Enter the password for this WESCOMM account.");
      setLoading("");
      return;
    }

    const limitMessage = getSendLimitMessage(normalizedEmail);
    if (limitMessage) {
      setError(limitMessage);
      setLoading("");
      return;
    }

    const result = await sendEmailOtp(normalizedEmail);
    if (!result.success) {
      setError(result.error ?? "Unable to send the verification email.");
      setResendSeconds(result.retryAfterSeconds ?? 0);
      setLoading("");
      return;
    }

    recordSendAttempt(normalizedEmail);
    setStep("code");
    setNotice("Verification code sent. Enter the full code from your inbox.");
    setResendSeconds(RESEND_COOLDOWN_SECONDS);
    setLoading("");
  };

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading("verify");
    setError("");
    setNotice("");

    const result = await verifyEmailOtp(sentEmail, code);
    if (!result.success) {
      setError(result.error ?? "Unable to verify the email code.");
      setLoading("");
      return;
    }

    if (rememberEmail) {
      window.localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "true");
      window.localStorage.setItem(REMEMBER_EMAIL_KEY, stripSchoolEmailDomain(sentEmail, allowedEmailDomain));
    }
  };

  const handlePasswordLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading("password");
    setError("");
    setNotice("");

    const result = await loginWithTestAccount(sentEmail, password);
    if (!result.success) {
      setError(result.error ?? "Unable to sign in with this account.");
      setLoading("");
    }
  };

  const handleResendCode = async () => {
    if (resendSeconds > 0 || loading) return;

    setLoading("send");
    setError("");
    setNotice("");
    setCode("");

    const limitMessage = getSendLimitMessage(sentEmail);
    if (limitMessage) {
      setError(limitMessage);
      setLoading("");
      return;
    }

    const result = await sendEmailOtp(sentEmail);
    if (!result.success) {
      setError(result.error ?? "Unable to resend the verification email.");
      setResendSeconds(result.retryAfterSeconds ?? 0);
      setLoading("");
      return;
    }

    recordSendAttempt(sentEmail);
    setNotice("New verification code sent. Use the latest code from your inbox.");
    setResendSeconds(RESEND_COOLDOWN_SECONDS);
    setLoading("");
  };

  const handleChangeEmail = () => {
    if (loading) return;
    setStep("email");
    setCode("");
    setPassword("");
    setError("");
    setNotice("");
    setResendSeconds(0);
  };

  if (!open || !mounted) return null;

  const loadingCopy = {
    send: {
      title: "Sending verification code",
      detail: "WESCOMM is sending your one-time code. This can take a few seconds depending on the email provider.",
      steps: ["Checking email limit", "Sending secure code", "Preparing verification step"]
    },
    verify: {
      title: "Verifying your code",
      detail: "WESCOMM is confirming the latest code and loading your account session.",
      steps: ["Checking code", "Creating secure session", "Opening your dashboard"]
    },
    password: {
      title: "Signing you in",
      detail: "WESCOMM is checking your test account and preparing the correct dashboard.",
      steps: ["Checking credentials", "Loading account role", "Opening WESCOMM"]
    }
  } as const;
  const activeLoadingCopy = loading ? loadingCopy[loading] : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-auth-title"
        className="relative w-full max-w-[520px] overflow-hidden rounded-lg border border-[#dce6dc] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.24)]"
      >
        <ActionLoadingOverlay
          active={Boolean(activeLoadingCopy)}
          title={activeLoadingCopy?.title ?? ""}
          detail={activeLoadingCopy?.detail ?? ""}
          steps={activeLoadingCopy?.steps ?? []}
        />
        <div className="h-1.5 bg-primary" />
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(loading)}
          aria-label="Close login dialog"
          className="absolute right-4 top-4 z-20 grid size-10 place-items-center rounded-md border border-[#dce6dc] bg-white text-[#25322b] shadow-sm transition hover:bg-[#eef6ee] disabled:opacity-50"
        >
          <X className="size-5" />
        </button>

        <div className="px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-8">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={155} height={62} className="h-12 w-auto object-contain object-left" />

          <div className="mt-7 flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-md bg-[#e8f4e8] text-primary">
              {step === "code" ? <KeyRound className="size-7" /> : step === "password" ? <LockKeyhole className="size-7" /> : <ShieldCheck className="size-7" />}
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">Secure email access</p>
              <h1 id="student-auth-title" className="mt-1 text-2xl font-extrabold leading-tight text-[#101820] sm:text-3xl">
                {step === "code" ? "Enter verification code" : step === "password" ? "Enter account password" : "Log in with your school email"}
              </h1>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-[#657169]">
            {step === "code" ? (
              <>
                We sent a code to <strong>{sentEmail}</strong>. Enter the newest code to continue.
              </>
            ) : step === "password" ? (
              <>
                Continue as <strong>{sentEmail}</strong> using the account password.
              </>
            ) : (
              <>
                Enter your official <strong>@{allowedEmailDomain}</strong> email. WESCOMM will send a verification code.
              </>
            )}
          </p>

          <div className="mt-6">
            {error ? (
              <p className="mb-3 rounded-md border border-[#f0b9b9] bg-[#fff3f3] px-3 py-2.5 text-sm font-medium text-[#a22828]" role="alert">
                {error}
              </p>
            ) : null}

            {notice ? (
              <p className="mb-3 rounded-md border border-[#bde4cc] bg-[#f0faf3] px-3 py-2.5 text-sm font-medium text-primary" role="status">
                {notice}
              </p>
            ) : null}

            {step === "email" ? (
              <form onSubmit={handleSendOtp} className="space-y-3">
                <label className="block">
                  <span className="text-xs font-bold text-[#25322b]">School email</span>
                  <div className="mt-1 flex h-12 items-center gap-2 rounded-md border border-[#cbd8cb] px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <Mail className="size-5 shrink-0 text-primary" />
                    <input
                      type="text"
                      required
                      value={emailName}
                      onChange={(event) => {
                        setEmailName(stripSchoolEmailDomain(event.target.value, allowedEmailDomain));
                      }}
                      disabled={Boolean(loading)}
                      className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-60"
                      placeholder="student.name"
                    />
                    <span className="shrink-0 border-l border-[#dce6dc] pl-2 text-xs font-bold text-primary sm:text-sm">
                      @{allowedEmailDomain}
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-[#dce6dc] bg-[#fbfdfb] px-3 py-3 text-sm text-[#536158]">
                  <input
                    type="checkbox"
                    checked={rememberEmail}
                    onChange={(event) => setRememberEmail(event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <strong className="text-[#25322b]">Remember me on this device.</strong>
                    <span className="block text-xs leading-5 text-[#657169]">
                      WESCOMM can open faster next time on this browser.
                    </span>
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={Boolean(loading) || resendSeconds > 0}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,102,51,0.20)] transition hover:bg-[#00552a] disabled:cursor-wait disabled:opacity-70"
                >
                  <Mail className="size-5" />
                  {loading === "send"
                    ? "Sending verification..."
                    : resendSeconds > 0
                      ? `Try again in ${resendSeconds}s`
                      : "Send verification code"}
                </button>
              </form>
            ) : step === "code" ? (
              <form onSubmit={handleVerifyOtp} className="space-y-3 rounded-md border border-[#dce6dc] bg-[#fbfdfb] p-3">
                <label className="block">
                  <span className="text-xs font-bold text-[#25322b]">Verification code</span>
                  <div className="mt-1 flex h-12 items-center gap-2 rounded-md border border-[#cbd8cb] bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <KeyRound className="size-5 shrink-0 text-primary" />
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_MAX_LENGTH))}
                      disabled={Boolean(loading)}
                      className="h-full min-w-0 flex-1 bg-transparent text-center text-xl font-extrabold tracking-[0.22em] text-[#101820] outline-none disabled:opacity-60"
                      placeholder="00000000"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={Boolean(loading) || code.length < 6}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,102,51,0.18)] transition hover:bg-[#00552a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <ShieldCheck className="size-5" />
                  {loading === "verify" ? "Verifying..." : "Verify and continue"}
                </button>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={Boolean(loading) || resendSeconds > 0}
                    className="min-h-11 flex-1 rounded-md border border-[#cbd8cb] px-4 text-sm font-bold text-primary transition hover:bg-[#eef7ee] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                  </button>

                  <button
                    type="button"
                    onClick={handleChangeEmail}
                    disabled={Boolean(loading)}
                    className="min-h-11 flex-1 rounded-md px-4 text-sm font-bold text-[#536158] transition hover:bg-[#eef7ee] disabled:opacity-60"
                  >
                    Change email
                  </button>
                </div>

                <p className="text-xs leading-5 text-[#657169]">
                  Use the latest code from your inbox. If it does not arrive, you can request another one after a short wait.
                </p>
              </form>
            ) : (
              <form onSubmit={handlePasswordLogin} className="space-y-3 rounded-md border border-[#dce6dc] bg-[#fbfdfb] p-3">
                <label className="block">
                  <span className="text-xs font-bold text-[#25322b]">Password</span>
                  <div className="mt-1 flex h-12 items-center gap-2 rounded-md border border-[#cbd8cb] bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <LockKeyhole className="size-5 shrink-0 text-primary" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={Boolean(loading)}
                      className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-60"
                      placeholder="Enter password"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={Boolean(loading) || !password.trim()}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,102,51,0.18)] transition hover:bg-[#00552a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <ShieldCheck className="size-5" />
                  {loading === "password" ? "Signing in..." : "Sign in"}
                </button>

                <button
                  type="button"
                  onClick={handleChangeEmail}
                  disabled={Boolean(loading)}
                  className="min-h-11 w-full rounded-md px-4 text-sm font-bold text-[#536158] transition hover:bg-[#eef7ee] disabled:opacity-60"
                >
                  Change email
                </button>
              </form>
            )}
          </div>

          <div className="mt-5 rounded-md bg-[#f5faf5] px-3 py-3 text-xs leading-5 text-[#657169]">
            Access is limited to verified <strong>@{allowedEmailDomain}</strong> email accounts.
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
