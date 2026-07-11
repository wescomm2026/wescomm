"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Plus, RefreshCw, Send } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createConversationFromApi,
  getConversationsFromApi,
  sendConversationMessageFromApi,
  updateConversationTypingFromApi,
  type BackendConversation
} from "@/lib/api";
import { cn } from "@/lib/utils";

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

function supportStatus(status: BackendConversation["status"]) {
  return status === "RESOLVED" ? "Resolved" : "Open";
}

export function StudentSupportExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [composingNew, setComposingNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [reply, setReply] = useState("");
  const [threadOpen, setThreadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef(0);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null,
    [conversations, selectedId]
  );

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
      if (!background) setComposingNew((current) => current || !scopedRows.length);
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

    const interval = window.setInterval(refreshInBackground, threadOpen || composingNew ? 2500 : 7000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [composingNew, loadConversations, ready, threadOpen, user?.accessToken]);

  useEffect(() => {
    setThreadOpen(false);
    setComposingNew(false);
    setSelectedId("");
    setConversations([]);
  }, [user?.id]);

  useEffect(() => {
    if (!threadOpen && !composingNew) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [threadOpen, composingNew, selectedConversation?.messages.length]);

  const openConversation = (conversationId: string) => {
    setSelectedId(conversationId);
    setComposingNew(false);
    setThreadOpen(true);
  };

  const openComposer = () => {
    setSelectedId("");
    setComposingNew(true);
    setThreadOpen(true);
  };

  const closeMobileThread = () => {
    if (selectedConversation?.id && user?.accessToken) {
      void updateConversationTypingFromApi(user.accessToken, selectedConversation.id, false);
    }
    setThreadOpen(false);
    setComposingNew(false);
    setReply("");
  };

  const sendTypingSignal = useCallback((conversationId: string, isTyping: boolean) => {
    if (!user?.accessToken) return;
    void updateConversationTypingFromApi(user.accessToken, conversationId, isTyping).catch(() => undefined);
  }, [user?.accessToken]);

  const handleReplyChange = (value: string) => {
    setReply(value);
    if (!selectedConversation) return;

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

  const startConversation = async () => {
    if (!user?.accessToken || !newSubject.trim() || !newMessage.trim()) return;
    setSubmitting(true);
    setError("");

    try {
      const conversation = await createConversationFromApi(user.accessToken, {
        subject: newSubject.trim(),
        message: newMessage.trim()
      });
      setConversations((current) => [conversation, ...current]);
      setSelectedId(conversation.id);
      setComposingNew(false);
      setThreadOpen(true);
      setNewSubject("");
      setNewMessage("");
      setNotice("Support conversation submitted.");
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "Unable to start support conversation.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!user?.accessToken || !selectedConversation || !reply.trim()) return;
    setSubmitting(true);
    setError("");

    try {
      const message = await sendConversationMessageFromApi(user.accessToken, selectedConversation.id, reply.trim());
      sendTypingSignal(selectedConversation.id, false);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selectedConversation.id
            ? {
                ...conversation,
                status: "OPEN",
                updatedAt: message.createdAt,
                messages: [...conversation.messages, message]
              }
            : conversation
        )
      );
      setReply("");
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "Unable to send message.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready || loading) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Message commissary support</h1>
        </header>
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
          Loading support conversations...
        </section>
      </div>
    );
  }

  if (!user?.accessToken) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Message commissary support</h1>
        </header>
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <p className="font-extrabold text-[#17211b]">Log in to contact support</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">
            Use your Wesleyan account to send questions about reservations, receipts, restocks, and pickup schedules.
          </p>
          <Button className="mt-5 h-11" onClick={openAuth}>Log in with Wesleyan account</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Message commissary support</h1>
          <p className="mt-2 text-sm text-[#68746d]">Ask about stock, reservations, receipts, and pickup schedules.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void loadConversations()} disabled={loading || submitting}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button onClick={openComposer}>
            <Plus className="size-5" />
            New message
          </Button>
        </div>
      </header>

      {notice ? <p className="rounded-md border border-[#cfe0d0] bg-[#f3f9f3] px-4 py-3 text-sm font-semibold text-primary">{notice}</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid min-h-[calc(100dvh-230px)] overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm lg:min-h-[620px] lg:grid-cols-[340px_1fr]">
        <aside className={cn(
          "border-b border-[#e5ebe6] lg:block lg:border-b-0 lg:border-r",
          threadOpen || composingNew ? "hidden" : "block"
        )}>
          <div className="flex items-center gap-3 border-b border-[#edf1ed] px-4 py-4">
            <AssetIcon src="/assets/support.svg" className="size-9" />
            <div>
              <p className="font-extrabold text-[#17211b]">My conversations</p>
              <p className="text-xs text-[#68746d]">{conversations.length} support thread{conversations.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto lg:max-h-[560px]">
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                className={cn(
                  "w-full border-b border-[#edf1ed] p-4 text-left transition hover:bg-[#f4f8f4]",
                  selectedConversation?.id === conversation.id && !composingNew ? "bg-[#eef6ee]" : ""
                )}
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate font-extrabold">{conversation.subject}</p>
                  <StatusBadge status={supportStatus(conversation.status)} />
                </div>
                <p className="mt-1 truncate text-sm text-[#68746d]">
                  {conversation.messages.at(-1)?.message ?? "No messages yet"}
                </p>
                <p className="mt-2 text-xs font-semibold text-[#79837d]">{formatSupportTime(conversation.updatedAt)}</p>
              </button>
            )) : (
              <div className="p-5 text-sm leading-6 text-[#68746d]">No conversations yet. Start one so staff can help you.</div>
            )}
          </div>
        </aside>

        {composingNew || !selectedConversation ? (
          <div className={cn(
            "min-h-[calc(100dvh-230px)] flex-col p-4 sm:p-5 lg:flex lg:min-h-[500px]",
            threadOpen || composingNew || !conversations.length ? "flex" : "hidden"
          )}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={closeMobileThread}
                className="grid size-10 place-items-center rounded-md border border-[#d7e1d8] text-primary lg:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="size-5" />
              </button>
              <span className="grid size-12 place-items-center rounded-md bg-[#eef6ee]">
                <MessageCircle className="size-6 text-primary" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold">Start a support conversation</h2>
                <p className="text-sm text-[#68746d]">Include the item, reservation code, or receipt code if available.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold">
                Topic
                <input
                  value={newSubject}
                  onChange={(event) => setNewSubject(event.target.value)}
                  placeholder="Example: Uniform size availability"
                  className="h-12 rounded-md border border-[#d7e1d8] px-3 font-normal outline-none focus:border-primary"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Message
                <textarea
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  placeholder="Write your question here..."
                  className="min-h-40 rounded-md border border-[#d7e1d8] p-3 font-normal leading-6 outline-none focus:border-primary"
                />
              </label>
              <Button className="h-12 justify-self-start px-6" onClick={() => void startConversation()} disabled={submitting || !newSubject.trim() || !newMessage.trim()}>
                <Send className="size-5" />
                {submitting ? "Sending..." : "Send to support"}
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn(
            "min-h-[calc(100dvh-230px)] flex-col lg:flex lg:min-h-[500px]",
            threadOpen ? "flex" : "hidden"
          )}>
            <header className="border-b border-[#e5ebe6] px-5 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  onClick={closeMobileThread}
                  className="grid size-10 place-items-center rounded-md border border-[#d7e1d8] text-primary lg:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-extrabold">{selectedConversation.subject}</h2>
                  <p className="mt-1 text-xs text-[#68746d]">Started {formatSupportTime(selectedConversation.createdAt)}</p>
                </div>
                <StatusBadge status={supportStatus(selectedConversation.status)} />
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafcfb] p-4 sm:p-5">
              {selectedConversation.messages.map((message) => {
                const mine = message.senderId === user.id;
                return (
                  <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[82%] rounded-lg p-3 text-sm shadow-sm", mine ? "bg-primary text-white" : "border border-[#dce5dd] bg-white text-[#17211b]")}>
                      <p className="leading-6">{message.message}</p>
                      <p className={cn("mt-2 text-[11px] font-semibold", mine ? "text-white/75" : "text-[#79837d]")}>
                        {mine ? "You" : message.sender?.fullName || "Commissary staff"} - {formatSupportTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {selectedConversation.typingUsers?.length ? (
                <div className="flex justify-start">
                  <div className="max-w-[82%] rounded-lg border border-[#dce5dd] bg-white px-3 py-2 text-sm font-semibold text-[#68746d] shadow-sm">
                    {selectedConversation.typingUsers[0].fullName || "Commissary staff"} is typing...
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <form
              className="flex gap-2 border-t border-[#e5ebe6] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <input
                value={reply}
                onChange={(event) => handleReplyChange(event.target.value)}
                onBlur={() => selectedConversation ? sendTypingSignal(selectedConversation.id, false) : undefined}
                placeholder={selectedConversation.status === "RESOLVED" ? "Send a reply to reopen this conversation..." : "Type your message..."}
                className="h-11 min-w-0 flex-1 rounded-md border border-[#d7e1d8] px-3 outline-none focus:border-primary"
              />
              <Button type="submit" className="h-11" disabled={submitting || !reply.trim()}>
                <Send className="size-4" />
                Send
              </Button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
