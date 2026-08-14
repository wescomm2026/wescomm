"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Headphones, MessageCircleMore, Plus, RefreshCw, Send } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createConversationFromApi,
  getConversationsFromApi,
  requestConversationHandoffFromApi,
  sendConversationMessageFromApi,
  updateConversationTypingFromApi,
  type BackendConversation
} from "@/lib/api";
import { cn } from "@/lib/utils";

const quickQuestions = [
  { label: "Product availability", message: "Available ba ang item na ito? Pangalan ng item: " },
  { label: "My reservation", message: "Ano na ang status ng reservation ko? Reservation code: " },
  { label: "GCash payment", message: "Paki-check ang status ng GCash payment ko. Reservation code: " },
  { label: "My receipt", message: "Paki-check ang receipt ko. Receipt code: " },
  { label: "Pickup schedule", message: "Kailan ko puwedeng i-pick up ang reservation ko? Reservation code: " },
  { label: "Cancellation", message: "Puwede ko pa bang i-cancel ang reservation ko? Reservation code: " }
];

function formatSupportTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function supportStatus(conversation: BackendConversation) {
  if (conversation.mode === "BOT_ACTIVE") return "WesBot active";
  if (conversation.mode === "WAITING_FOR_STAFF") return "Waiting for Staff";
  if (conversation.mode === "STAFF_ACTIVE") return "Staff active";
  return "Resolved";
}

function createConversationSubject(message: string) {
  const compactMessage = message.replace(/\s+/g, " ").trim();
  if (compactMessage.length < 3) return "WesBot inquiry";
  if (compactMessage.length <= 72) return compactMessage;
  return `${compactMessage.slice(0, 69).trimEnd()}...`;
}

function conversationIdentity(conversation: BackendConversation | null) {
  if (!conversation || conversation.mode === "BOT_ACTIVE") {
    return {
      title: "WesBot",
      subtitle: "Automated assistant · Online",
      icon: "BOT" as const
    };
  }

  if (conversation.mode === "WAITING_FOR_STAFF") {
    return {
      title: "WesBot",
      subtitle: "Connecting you to commissary staff",
      icon: "STAFF" as const
    };
  }

  if (conversation.mode === "STAFF_ACTIVE") {
    return {
      title: conversation.assignedStaff?.fullName || "Commissary Staff",
      subtitle: "Real staff member · Connected",
      icon: "STAFF" as const
    };
  }

  return {
    title: "WESCOMM Support",
    subtitle: "Conversation resolved",
    icon: "STAFF" as const
  };
}

export function StudentSupportExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [startingNew, setStartingNew] = useState(false);
  const [composer, setComposer] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [threadOpen, setThreadOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef(0);

  const selectedConversation = useMemo(() => {
    if (startingNew) return null;
    return conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null;
  }, [conversations, selectedId, startingNew]);
  const identity = conversationIdentity(selectedConversation);

  const loadConversations = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!user?.accessToken || !user.id) {
      setConversations([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getConversationsFromApi(user.accessToken);
      const scopedRows = user.role === "STUDENT"
        ? rows.filter((conversation) => conversation.studentId === user.id)
        : rows;
      setConversations(scopedRows);
      setSelectedId((current) =>
        scopedRows.some((conversation) => conversation.id === current) ? current : scopedRows[0]?.id || ""
      );
      if (!background && !scopedRows.length) setStartingNew(true);
      if (!background) setThreadOpen(true);
    } catch (supportError) {
      if (!background) {
        setError(supportError instanceof Error ? supportError.message : "Unable to load support conversations.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [user?.accessToken, user?.id, user?.role]);

  useEffect(() => {
    if (!ready) return;
    void loadConversations();
  }, [loadConversations, ready]);

  useEffect(() => {
    if (!ready || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadConversations({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, threadOpen ? 2500 : 7000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadConversations, ready, threadOpen, user?.accessToken]);

  useEffect(() => {
    setThreadOpen(true);
    setStartingNew(false);
    setSelectedId("");
    setConversations([]);
    setComposer("");
    setPendingMessage("");
  }, [user?.id]);

  useEffect(() => {
    if (!threadOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [pendingMessage, selectedConversation?.messages.length, threadOpen]);

  useEffect(() => () => {
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
  }, []);

  const sendTypingSignal = useCallback((conversationId: string, isTyping: boolean) => {
    if (!user?.accessToken) return;
    void updateConversationTypingFromApi(user.accessToken, conversationId, isTyping).catch(() => undefined);
  }, [user?.accessToken]);

  const openConversation = (conversationId: string) => {
    setSelectedId(conversationId);
    setStartingNew(false);
    setComposer("");
    setError("");
    setThreadOpen(true);
  };

  const startNewChat = () => {
    if (selectedConversation?.id && user?.accessToken) {
      sendTypingSignal(selectedConversation.id, false);
    }
    setSelectedId("");
    setStartingNew(true);
    setComposer("");
    setError("");
    setThreadOpen(true);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const showConversationList = () => {
    if (selectedConversation?.id && user?.accessToken) {
      sendTypingSignal(selectedConversation.id, false);
    }
    setThreadOpen(false);
  };

  const chooseQuickQuestion = (message: string) => {
    setComposer(message);
    setError("");
    window.setTimeout(() => {
      const input = composerRef.current;
      input?.focus();
      input?.setSelectionRange(message.length, message.length);
    }, 0);
  };

  const handleComposerChange = (value: string) => {
    setComposer(value);
    if (!selectedConversation || selectedConversation.mode === "BOT_ACTIVE" || selectedConversation.mode === "RESOLVED") return;

    if (!value.trim()) {
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
      lastTypingSignalRef.current = 0;
      sendTypingSignal(selectedConversation.id, false);
      return;
    }

    const now = Date.now();
    if (now - lastTypingSignalRef.current > 1500) {
      lastTypingSignalRef.current = now;
      sendTypingSignal(selectedConversation.id, true);
    }

    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      lastTypingSignalRef.current = 0;
      sendTypingSignal(selectedConversation.id, false);
    }, 2500);
  };

  const sendMessage = async () => {
    const message = composer.trim();
    if (!user?.accessToken || !message || submitting) return;

    const conversationAtSend = selectedConversation;
    setSubmitting(true);
    setError("");
    setComposer("");
    setPendingMessage(message);

    try {
      if (!conversationAtSend) {
        const conversation = await createConversationFromApi(user.accessToken, {
          subject: createConversationSubject(message),
          message
        });
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        setSelectedId(conversation.id);
        setStartingNew(false);
      } else {
        const result = await sendConversationMessageFromApi(user.accessToken, conversationAtSend.id, message);
        sendTypingSignal(conversationAtSend.id, false);
        setConversations((current) =>
          current.map((conversation) => conversation.id === conversationAtSend.id ? result.conversation : conversation)
        );
      }
    } catch (supportError) {
      setComposer(message);
      setError(supportError instanceof Error ? supportError.message : "Unable to send message.");
    } finally {
      setPendingMessage("");
      setSubmitting(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    }
  };

  const requestStaff = async () => {
    if (!user?.accessToken || !selectedConversation || selectedConversation.mode !== "BOT_ACTIVE") return;
    setSubmitting(true);
    setError("");

    try {
      const conversation = await requestConversationHandoffFromApi(
        user.accessToken,
        selectedConversation.id,
        "Student requested a real staff member from the chat."
      );
      setConversations((current) => current.map((item) => item.id === conversation.id ? conversation : item));
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "Unable to connect you with staff.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready || loading) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Chat with WesBot</h1>
        </header>
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
          Opening your chat...
        </section>
      </div>
    );
  }

  if (!user?.accessToken) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Chat with WesBot</h1>
        </header>
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <p className="font-extrabold text-[#17211b]">Log in to start chatting</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">
            WesBot can check products, reservations, payments, receipts, and pickup information connected to your account.
          </p>
          <Button className="mt-5 h-11" onClick={openAuth}>Log in with Wesleyan account</Button>
        </section>
      </div>
    );
  }

  const showWelcome = !selectedConversation;
  const botWillReply = !selectedConversation || selectedConversation.mode === "BOT_ACTIVE";

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Chat with WesBot</h1>
          <p className="mt-2 text-sm text-[#68746d]">Message WesBot first. Ask for a real staff member anytime without leaving the chat.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void loadConversations()} disabled={loading || submitting} aria-label="Refresh conversations">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button onClick={startNewChat} disabled={submitting}>
            <Plus className="size-5" />
            New chat
          </Button>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid min-h-[calc(100dvh-230px)] overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm lg:min-h-[620px] lg:grid-cols-[320px_1fr]">
        <aside className={cn(
          "border-b border-[#e5ebe6] lg:block lg:border-b-0 lg:border-r",
          threadOpen ? "hidden" : "block"
        )}>
          <div className="flex items-center gap-3 border-b border-[#edf1ed] px-4 py-4">
            <span className="grid size-10 place-items-center rounded-full bg-[#eef6ee]">
              <MessageCircleMore className="size-5 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#17211b]">Chats</p>
              <p className="text-xs text-[#68746d]">Your WesBot and staff message history</p>
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto lg:max-h-[560px]">
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                className={cn(
                  "w-full border-b border-[#edf1ed] p-4 text-left transition hover:bg-[#f4f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                  selectedConversation?.id === conversation.id ? "bg-[#eef6ee]" : ""
                )}
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate font-extrabold">{conversation.subject}</p>
                  <StatusBadge status={supportStatus(conversation)} />
                </div>
                <p className="mt-1 truncate text-sm text-[#68746d]">
                  {conversation.messages.at(-1)?.message ?? "No messages yet"}
                </p>
                <p className="mt-2 text-xs font-semibold text-[#79837d]">{formatSupportTime(conversation.updatedAt)}</p>
              </button>
            )) : (
              <div className="p-5 text-sm leading-6 text-[#68746d]">Your first message to WesBot will appear here.</div>
            )}
          </div>
        </aside>

        <div className={cn(
          "min-h-[calc(100dvh-230px)] flex-col lg:flex lg:min-h-[500px]",
          threadOpen ? "flex" : "hidden"
        )}>
          <header className="flex items-center gap-3 border-b border-[#e5ebe6] px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={showConversationList}
              className="grid size-10 place-items-center rounded-md border border-[#d7e1d8] text-primary lg:hidden"
              aria-label="Open chat history"
            >
              <ArrowLeft className="size-5" />
            </button>
            <span className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full",
              identity.icon === "BOT" ? "bg-[#eaf6eb] text-primary" : "bg-sky-50 text-sky-800"
            )}>
              {identity.icon === "BOT" ? <Bot className="size-6" /> : <Headphones className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-extrabold text-[#17211b]">{identity.title}</h2>
              <p className="truncate text-xs font-semibold text-[#68746d]">{identity.subtitle}</p>
            </div>
            {selectedConversation ? (
              <span className="hidden shrink-0 sm:inline-flex"><StatusBadge status={supportStatus(selectedConversation)} /></span>
            ) : (
              <span className="hidden shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">Online</span>
            )}
          </header>

          <div role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-3 overflow-y-auto bg-[#fafcfb] p-4 sm:p-5">
            {showWelcome ? (
              <>
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-[#cfe0d0] bg-[#f3f9f3] p-3 text-sm text-[#17211b] shadow-sm sm:max-w-[78%]">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-extrabold text-primary">
                      <Bot className="size-3.5" />
                      WesBot · Automated Assistant
                    </p>
                    <p className="whitespace-pre-wrap leading-6">
                      Hi! I&apos;m WesBot. Ask me about products, live availability, reservations, GCash payments, receipts, cancellations, or pickup schedules.
                    </p>
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-[#cfe0d0] bg-[#f3f9f3] p-3 text-sm leading-6 text-[#17211b] shadow-sm sm:max-w-[78%]">
                    If you want a real person, type <strong>staff</strong> anytime. I&apos;ll keep this same chat and connect it to the commissary team.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {quickQuestions.map((question) => (
                    <button
                      key={question.label}
                      type="button"
                      onClick={() => chooseQuickQuestion(question.message)}
                      className="rounded-full border border-[#cfe0d0] bg-white px-3 py-2 text-xs font-bold text-primary transition hover:bg-[#eef7ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {question.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {selectedConversation?.messages.map((message) => {
              const mine = message.senderType === "STUDENT" && message.senderId === user.id;
              if (message.senderType === "SYSTEM") {
                return (
                  <div key={message.id} className="flex justify-center py-1">
                    <p className="max-w-[92%] rounded-full bg-[#edf1ed] px-3 py-1.5 text-center text-xs font-semibold text-[#68746d]">
                      {message.message}
                    </p>
                  </div>
                );
              }

              const botMessage = message.senderType === "BOT";
              return (
                <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[88%] rounded-2xl p-3 text-sm shadow-sm sm:max-w-[78%]",
                    mine
                      ? "rounded-br-md bg-primary text-white"
                      : botMessage
                        ? "rounded-bl-md border border-[#cfe0d0] bg-[#f3f9f3] text-[#17211b]"
                        : "rounded-bl-md border border-sky-200 bg-white text-[#17211b]"
                  )}>
                    {!mine ? (
                      <p className={cn("mb-1 flex items-center gap-1.5 text-xs font-extrabold", botMessage ? "text-primary" : "text-sky-800")}>
                        {botMessage ? <Bot className="size-3.5" /> : <Headphones className="size-3.5" />}
                        {botMessage ? "WesBot · Automated Assistant" : `Staff · ${message.sender?.fullName || "Commissary staff"}`}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap leading-6">{message.message}</p>
                    <p className={cn("mt-2 text-[11px] font-semibold", mine ? "text-white/75" : "text-[#79837d]")}>
                      {mine ? "You" : botMessage ? "WesBot" : "Staff"} · {formatSupportTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}

            {pendingMessage ? (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary p-3 text-sm text-white opacity-80 shadow-sm sm:max-w-[78%]">
                  <p className="whitespace-pre-wrap leading-6">{pendingMessage}</p>
                  <p className="mt-2 text-[11px] font-semibold text-white/75">Sending...</p>
                </div>
              </div>
            ) : null}

            {submitting && pendingMessage && botWillReply ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#cfe0d0] bg-[#f3f9f3] px-4 py-3 text-sm font-semibold text-[#68746d] shadow-sm">
                  <Bot className="size-4 text-primary" />
                  WesBot is checking WESCOMM records...
                </div>
              </div>
            ) : null}

            {selectedConversation?.typingUsers?.length ? (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-[#dce5dd] bg-white px-3 py-2 text-sm font-semibold text-[#68746d] shadow-sm">
                  {selectedConversation.typingUsers[0].fullName || "Commissary staff"} is typing...
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-[#e5ebe6] bg-white px-3 py-3 sm:px-4">
            {selectedConversation?.mode === "BOT_ACTIVE" ? (
              <div className="mb-2 flex items-center justify-between gap-3 px-1 text-xs text-[#68746d]">
                <span>WesBot is replying in this chat.</span>
                <button
                  type="button"
                  onClick={() => void requestStaff()}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 font-extrabold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Headphones className="size-3.5" />
                  Talk to a real staff member
                </button>
              </div>
            ) : null}
            {selectedConversation?.mode === "WAITING_FOR_STAFF" ? (
              <p className="mb-2 px-1 text-xs font-bold text-amber-800">Waiting for commissary staff. You can keep adding details here.</p>
            ) : null}
            {selectedConversation?.mode === "STAFF_ACTIVE" ? (
              <p className="mb-2 px-1 text-xs font-bold text-sky-800">You&apos;re now chatting with a real staff member in the same conversation.</p>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <label htmlFor="wesbot-message" className="sr-only">Message WesBot or commissary staff</label>
              <textarea
                ref={composerRef}
                id="wesbot-message"
                value={composer}
                onChange={(event) => handleComposerChange(event.target.value)}
                onBlur={() => selectedConversation ? sendTypingSignal(selectedConversation.id, false) : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                maxLength={2000}
                rows={1}
                placeholder={selectedConversation?.status === "RESOLVED" ? "Send a message to reopen this chat..." : "Message WesBot..."}
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-[#d7e1d8] px-4 py-2.5 leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <Button type="submit" className="size-11 shrink-0 rounded-full p-0" disabled={submitting || !composer.trim()} aria-label="Send message">
                <Send className="size-4" />
              </Button>
            </form>
            <p className="mt-2 px-1 text-[11px] text-[#88918b]">WesBot is automated and uses current WESCOMM records. Press Enter to send, Shift+Enter for a new line.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
