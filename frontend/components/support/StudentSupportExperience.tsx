"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Check, Headphones, MessageCircleMore, Pencil, Plus, RefreshCw, Send, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createConversationFromApi,
  editConversationMessageFromApi,
  getConversationMessagesFromApi,
  getConversationsFromApi,
  requestConversationBotReplyFromApi,
  requestConversationHandoffFromApi,
  sendConversationMessageFromApi,
  setConversationArchivedFromApi,
  updateConversationTypingFromApi,
  type BackendConversation,
  type BackendConversationMessage,
  type BackendTypingUser
} from "@/lib/api";
import { cn } from "@/lib/utils";

const quickQuestions = [
  { label: "Browse FAQs", message: "FAQ" },
  { label: "Product availability", message: "Available ba ang item na ito? Pangalan ng item: " },
  { label: "My reservation", message: "Ano na ang status ng reservation ko? Reservation code: " },
  { label: "GCash payment", message: "Paki-check ang status ng GCash payment ko. Reservation code: " },
  { label: "My receipt", message: "Paki-check ang receipt ko. Receipt code: " },
  { label: "Pickup schedule", message: "Kailan ko puwedeng i-pick up ang reservation ko? Reservation code: " },
  { label: "Cancellation", message: "Puwede ko pa bang i-cancel ang reservation ko? Reservation code: " }
];

type WesbotSuggestedAction = {
  id: string;
  label: string;
  message: string;
};

function messageSuggestedActions(message: BackendConversationMessage): WesbotSuggestedAction[] {
  const actions = message.metadata?.suggestedActions;
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return [];
    const record = action as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const actionMessage = typeof record.message === "string" ? record.message.trim() : "";
    if (!id || !label || !actionMessage || label.length > 40 || actionMessage.length > 240) return [];
    return [{ id, label, message: actionMessage }];
  }).slice(0, 4);
}

function mergeSupportMessages(
  current: BackendConversationMessage[],
  incoming: BackendConversationMessage[]
) {
  return Array.from(new Map([...current, ...incoming].map((message) => [message.id, message])).values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

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

function formatSupportDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
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

function ChatAvatar({ kind, size = "md" }: { kind: "BOT" | "STAFF"; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "size-8" : size === "lg" ? "size-16" : "size-11";

  if (kind === "BOT") {
    return (
      <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full", sizeClass)} aria-hidden="true">
        <Image src="/assets/chat-with-wesbot.svg" alt="" fill sizes={size === "sm" ? "32px" : size === "lg" ? "64px" : "44px"} className="object-contain" />
      </span>
    );
  }

  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-full bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200", sizeClass)} aria-hidden="true">
      <Headphones className={size === "sm" ? "size-4" : size === "lg" ? "size-7" : "size-5"} />
    </span>
  );
}

export function StudentSupportExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [conversationView, setConversationView] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [selectedId, setSelectedId] = useState("");
  const [startingNew, setStartingNew] = useState(false);
  const [composer, setComposer] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [threadOpen, setThreadOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [botReplyPending, setBotReplyPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState("");
  const messagesLogRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef(0);
  const loadedThreadIdsRef = useRef(new Set<string>());
  const latestMessageAtRef = useRef("");
  const typingExpiryTimersRef = useRef(new Map<string, number>());
  const stickToBottomRef = useRef(true);

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
      const rows = await getConversationsFromApi(user.accessToken, { view: conversationView });
      const scopedRows = user.role === "STUDENT"
        ? rows.filter((conversation) => conversation.studentId === user.id)
        : rows;
      setConversations((current) => scopedRows.map((row) => {
        const existing = current.find((conversation) => conversation.id === row.id);
        if (!existing || !loadedThreadIdsRef.current.has(row.id)) return row;
        return { ...row, messages: mergeSupportMessages(existing.messages, row.messages) };
      }));
      const conversationId = new URL(window.location.href).searchParams.get("conversationId");
      setSelectedId((current) => conversationId && scopedRows.some((conversation) => conversation.id === conversationId)
        ? conversationId
        : scopedRows.some((conversation) => conversation.id === current) ? current : scopedRows[0]?.id || "");
      if (!background && !scopedRows.length) setStartingNew(conversationView === "ACTIVE");
      if (!background) setThreadOpen(true);
    } catch (supportError) {
      if (!background) {
        setError(userFacingErrorMessage(supportError, "Unable to load support conversations."));
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [conversationView, user?.accessToken, user?.id, user?.role]);

  const refreshConversations = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadConversations({ background: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadConversations, refreshing]);

  const loadThreadMessages = useCallback(async (conversationId: string, after?: string) => {
    if (!user?.accessToken) return;
    try {
      const result = await getConversationMessagesFromApi(user.accessToken, conversationId, {
        limit: 50,
        after: after || undefined
      });
      setConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: after ? mergeSupportMessages(conversation.messages, result.messages) : result.messages,
          typingUsers: result.typingUsers
        };
      }));
      loadedThreadIdsRef.current.add(conversationId);
    } catch (supportError) {
      if (!after) setError(userFacingErrorMessage(supportError, "Unable to load this conversation."));
    }
  }, [user?.accessToken]);

  useRealtimeRefresh(["conversations", "typing"], (update) => {
    if (update.topic === "conversations") {
      void loadConversations({ background: true });
      if (threadOpen && selectedConversation?.id && update.entityId === selectedConversation.id) {
        void loadThreadMessages(selectedConversation.id, latestMessageAtRef.current || undefined);
      }
      return;
    }

    const payload = update.payload as Partial<BackendTypingUser> & {
      conversationId?: string;
      isTyping?: boolean;
    };
    if (!payload.conversationId || !payload.userId || payload.userId === user?.id) return;
    const conversationId = payload.conversationId;
    const userId = payload.userId;
    const timerKey = `${conversationId}:${userId}`;
    const existingTimer = typingExpiryTimersRef.current.get(timerKey);
    if (existingTimer) window.clearTimeout(existingTimer);

    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const withoutSender = (conversation.typingUsers ?? []).filter((typingUser) => typingUser.userId !== userId);
      if (!payload.isTyping || !payload.fullName || !payload.email || !payload.role || !payload.updatedAt) {
        return { ...conversation, typingUsers: withoutSender };
      }
      return {
        ...conversation,
        typingUsers: [...withoutSender, {
          userId,
          fullName: payload.fullName,
          email: payload.email,
          role: payload.role,
          updatedAt: payload.updatedAt
        }]
      };
    }));

    if (payload.isTyping) {
      const timer = window.setTimeout(() => {
        setConversations((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, typingUsers: (conversation.typingUsers ?? []).filter((typingUser) => typingUser.userId !== userId) }
          : conversation));
        typingExpiryTimersRef.current.delete(timerKey);
      }, 7_000);
      typingExpiryTimersRef.current.set(timerKey, timer);
    } else {
      typingExpiryTimersRef.current.delete(timerKey);
    }
  });

  useEffect(() => {
    if (!ready) return;
    void loadConversations();
  }, [loadConversations, ready]);

  useEffect(() => {
    if (!ready || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadConversations({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 5 * 60_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadConversations, ready, user?.accessToken]);

  useEffect(() => {
    latestMessageAtRef.current = selectedConversation?.messages.at(-1)?.createdAt ?? "";
  }, [selectedConversation?.messages]);

  useEffect(() => {
    if (!ready || !user?.accessToken || !selectedConversation?.id || !threadOpen) return;
    const conversationId = selectedConversation.id;
    void loadThreadMessages(
      conversationId,
      loadedThreadIdsRef.current.has(conversationId) ? latestMessageAtRef.current : undefined
    );

    const refreshThread = () => {
      if (document.visibilityState === "visible") {
        void loadThreadMessages(conversationId, latestMessageAtRef.current || undefined);
      }
    };
    const interval = window.setInterval(refreshThread, 5 * 60_000);
    window.addEventListener("focus", refreshThread);
    window.addEventListener("online", refreshThread);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshThread);
      window.removeEventListener("online", refreshThread);
    };
  }, [loadThreadMessages, ready, selectedConversation?.id, threadOpen, user?.accessToken]);

  useEffect(() => {
    setThreadOpen(true);
    setStartingNew(false);
    setSelectedId("");
    setConversations([]);
    setConversationView("ACTIVE");
    setComposer("");
    setPendingMessage("");
    loadedThreadIdsRef.current.clear();
  }, [user?.id]);

  useEffect(() => {
    if (!threadOpen) return;
    const messageLog = messagesLogRef.current;
    if (!messageLog) return;
    if (stickToBottomRef.current || pendingMessage) {
      messageLog.scrollTop = selectedConversation?.id || pendingMessage ? messageLog.scrollHeight : 0;
    }
  }, [pendingMessage, selectedConversation?.id, selectedConversation?.messages.length, threadOpen]);

  useEffect(() => {
    const input = composerRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [composer]);

  useEffect(() => () => {
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingExpiryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    typingExpiryTimersRef.current.clear();
  }, []);

  const sendTypingSignal = useCallback((conversationId: string, isTyping: boolean) => {
    if (!user?.accessToken) return;
    void updateConversationTypingFromApi(user.accessToken, conversationId, isTyping).catch(() => undefined);
  }, [user?.accessToken]);

  const openConversation = (conversationId: string) => {
    stickToBottomRef.current = true;
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
    setConversationView("ACTIVE");
    setStartingNew(true);
    setComposer("");
    setError("");
    setThreadOpen(true);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const handleMessageScroll = () => {
    const messageLog = messagesLogRef.current;
    if (!messageLog) return;
    stickToBottomRef.current = messageLog.scrollHeight - messageLog.scrollTop - messageLog.clientHeight < 120;
  };

  const focusLatestMessage = () => {
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      const messageLog = messagesLogRef.current;
      if (messageLog) messageLog.scrollTop = messageLog.scrollHeight;
    });
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

  const requestBotReply = useCallback(async (conversationId: string, messageId: string) => {
    if (!user?.accessToken) return;
    setBotReplyPending(true);
    try {
      const botMessage = await requestConversationBotReplyFromApi(user.accessToken, conversationId, messageId);
      if (!botMessage) return;
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: mergeSupportMessages(conversation.messages, [botMessage]) }
        : conversation));
    } catch (replyError) {
      const replyMessage = userFacingErrorMessage(replyError, "Please try again or ask Staff for help.");
      setError(`Your message was sent, but WesBot could not reply. ${replyMessage}`);
      void loadThreadMessages(conversationId, latestMessageAtRef.current || undefined);
    } finally {
      setBotReplyPending(false);
    }
  }, [loadThreadMessages, user?.accessToken]);

  const sendMessage = async () => {
    const message = composer.trim();
    if (!user?.accessToken || !message || submitting || botReplyPending) return;

    const conversationAtSend = selectedConversation;
    setSubmitting(true);
    setError("");
    setComposer("");
    setPendingMessage(message);

    try {
      if (!conversationAtSend) {
        const result = await createConversationFromApi(user.accessToken, {
          subject: createConversationSubject(message),
          message
        });
        const conversation = result.conversation;
        loadedThreadIdsRef.current.add(conversation.id);
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        setSelectedId(conversation.id);
        setStartingNew(false);
        if (result.botReplyPending) void requestBotReply(conversation.id, result.message.id);
      } else {
        const result = await sendConversationMessageFromApi(user.accessToken, conversationAtSend.id, message);
        sendTypingSignal(conversationAtSend.id, false);
        setConversations((current) => current.map((conversation) => conversation.id === conversationAtSend.id
          ? {
              ...result.conversation,
              messages: mergeSupportMessages(
                conversation.messages,
                [result.message, ...(result.botMessage ? [result.botMessage] : [])]
              )
            }
          : conversation));
        if (result.botReplyPending) void requestBotReply(conversationAtSend.id, result.message.id);
      }
    } catch (supportError) {
      setComposer(message);
      setError(userFacingErrorMessage(supportError, "Unable to send your message."));
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
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...conversation, messages: item.messages }
        : item));
      void loadThreadMessages(conversation.id, latestMessageAtRef.current || undefined);
    } catch (supportError) {
      setError(userFacingErrorMessage(supportError, "Unable to connect you with staff."));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveConversation = async (conversation: BackendConversation) => {
    if (!user?.accessToken || conversation.status !== "RESOLVED") return;
    setSubmitting(true);
    setError("");
    try {
      await setConversationArchivedFromApi(user.accessToken, conversation.id, conversationView === "ACTIVE");
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      setSelectedId("");
      setThreadOpen(false);
    } catch (archiveError) {
      setError(userFacingErrorMessage(archiveError, "Unable to update the conversation archive."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveMessageEdit = async (conversation: BackendConversation, message: BackendConversationMessage) => {
    const nextMessage = editDraft.trim();
    if (!user?.accessToken || !nextMessage || savingEdit) return;
    setSavingEdit(true);
    setError("");
    try {
      const updated = await editConversationMessageFromApi(
        user.accessToken,
        conversation.id,
        message.id,
        nextMessage,
        message.editVersion ?? 0
      );
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...item, messages: item.messages.map((entry) => entry.id === updated.id ? updated : entry) }
        : item));
      setEditingMessageId(null);
      setEditDraft("");
    } catch (editError) {
      setError(userFacingErrorMessage(editError, "Unable to edit this message."));
      void loadThreadMessages(conversation.id);
    } finally {
      setSavingEdit(false);
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
    <div className="space-y-4">
      <header className="hidden flex-col gap-4 sm:flex sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-primary">Support</p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Chat with WesBot</h1>
          <p className="mt-2 text-sm text-[#68746d]">Ask WesBot first, then switch to a real staff member in the same conversation anytime.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={startNewChat} disabled={submitting}>
            <Plus className="size-5" />
            New chat
          </Button>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <h1 className="sr-only sm:hidden">Chat with WesBot</h1>

      <section
        aria-label="WESCOMM support messenger"
        className="grid h-[calc(100dvh-11.375rem)] min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#dce5dd] bg-white shadow-[0_16px_48px_rgba(16,24,32,0.08)] sm:h-[calc(100dvh-15.5rem)] lg:grid-cols-[310px_minmax(0,1fr)]"
      >
        <aside className={cn(
          "h-full min-h-0 min-w-0 flex-col border-[#e5ebe6] bg-[#fbfcfb] lg:flex lg:border-r",
          threadOpen ? "hidden" : "flex"
        )}>
          <div className="flex min-h-[68px] items-center gap-3 border-b border-[#edf1ed] px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eaf6eb] text-primary" aria-hidden="true">
              <MessageCircleMore className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#17211b]">Messages</p>
              <p className="text-xs text-[#68746d]">WesBot and staff history</p>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              disabled={submitting}
              aria-label="Start a new chat"
              title="New chat"
              className="ml-auto grid size-10 shrink-0 place-items-center rounded-full text-primary transition hover:bg-[#eaf4eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <Plus className="size-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 border-b border-[#edf1ed] p-2" aria-label="Conversation view">
            <button type="button" onClick={() => { setConversationView("ACTIVE"); setStartingNew(false); }} aria-pressed={conversationView === "ACTIVE"} className={cn("rounded-lg px-3 py-2 text-xs font-extrabold", conversationView === "ACTIVE" ? "bg-primary text-white" : "text-[#68746d] hover:bg-[#eef4ef]")}>Active</button>
            <button type="button" onClick={() => { setConversationView("ARCHIVED"); setStartingNew(false); }} aria-pressed={conversationView === "ARCHIVED"} className={cn("rounded-lg px-3 py-2 text-xs font-extrabold", conversationView === "ARCHIVED" ? "bg-primary text-white" : "text-[#68746d] hover:bg-[#eef4ef]")}>Archived</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                aria-current={selectedConversation?.id === conversation.id ? "true" : undefined}
                className={cn(
                  "mb-1 flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-[#f0f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                  selectedConversation?.id === conversation.id ? "bg-[#e8f3e9]" : ""
                )}
              >
                <ChatAvatar kind={conversation.mode === "BOT_ACTIVE" ? "BOT" : "STAFF"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#17211b]">{conversation.subject}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-[#879089]">{formatSupportTime(conversation.updatedAt)}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#68746d]">
                    {conversation.messages.at(-1)?.message ?? "No messages yet"}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-[#68746d]">
                    <span className={cn(
                      "size-1.5 rounded-full",
                      conversation.mode === "BOT_ACTIVE" ? "bg-emerald-500" : conversation.mode === "WAITING_FOR_STAFF" ? "bg-amber-500" : conversation.mode === "STAFF_ACTIVE" ? "bg-sky-500" : "bg-slate-400"
                    )} />
                    {conversation.mode === "STAFF_ACTIVE"
                      ? `Handled by ${conversation.assignedStaff?.fullName || "Commissary Staff"}`
                      : supportStatus(conversation)}
                  </span>
                </span>
              </button>
            )) : (
              <div className="grid h-full min-h-56 place-items-center px-6 text-center">
                <div>
                  <ChatAvatar kind="BOT" size="lg" />
                  <p className="mt-3 font-extrabold text-[#17211b]">No messages yet</p>
                  <p className="mt-1 text-sm leading-5 text-[#68746d]">Start with WesBot and your conversation will stay here.</p>
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className={cn(
          "h-full min-h-0 min-w-0 flex-col lg:flex",
          threadOpen ? "flex" : "hidden"
        )}>
          <header data-testid="conversation-header" className="flex min-h-[68px] shrink-0 items-center gap-2 border-b border-[#e5ebe6] bg-white px-3 py-2.5 sm:gap-3 sm:px-5">
            <button
              type="button"
              onClick={showConversationList}
              className="grid size-10 shrink-0 place-items-center rounded-full text-primary transition hover:bg-[#eef6ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              aria-label="Open chat history"
            >
              <ArrowLeft className="size-5" />
            </button>
            <ChatAvatar kind={identity.icon} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-extrabold text-[#17211b] sm:text-base">{identity.title}</h2>
              <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-[#68746d] sm:text-xs">
                {identity.icon === "BOT" && selectedConversation?.mode !== "WAITING_FOR_STAFF" ? <span className="size-2 shrink-0 rounded-full bg-emerald-500" /> : null}
                <span className="truncate">{identity.subtitle}</span>
              </p>
            </div>
            {selectedConversation ? (
              <span className="hidden shrink-0 md:inline-flex"><StatusBadge status={supportStatus(selectedConversation)} /></span>
            ) : null}
            {selectedConversation?.status === "RESOLVED" ? (
              <button
                type="button"
                onClick={() => void archiveConversation(selectedConversation)}
                disabled={submitting}
                aria-label={conversationView === "ACTIVE" ? "Archive conversation" : "Restore conversation"}
                title={conversationView === "ACTIVE" ? "Archive" : "Restore"}
                className="grid size-10 shrink-0 place-items-center rounded-full text-[#5d6962] transition hover:bg-[#f0f5f1] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {conversationView === "ACTIVE" ? <Archive className="size-[18px]" /> : <ArchiveRestore className="size-[18px]" />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refreshConversations()}
              disabled={submitting || refreshing}
              aria-label="Refresh conversations"
              title="Refresh"
              className="grid size-10 shrink-0 place-items-center rounded-full text-[#5d6962] transition hover:bg-[#f0f5f1] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <RefreshCw className={`size-[18px] ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={startNewChat}
              disabled={submitting}
              aria-label="Start a new chat"
              title="New chat"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eaf6eb] text-primary transition hover:bg-[#dceede] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 sm:hidden"
            >
              <Plus className="size-5" />
            </button>
          </header>

          <div ref={messagesLogRef} onScroll={handleMessageScroll} role="log" aria-live="polite" aria-relevant="additions" className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain bg-[#f4f7f4] px-3 py-4 scroll-smooth sm:px-5 sm:py-5">
            {showWelcome ? (
              <>
                <div className="pb-2 pt-1 text-center">
                  <ChatAvatar kind="BOT" size="lg" />
                  <h2 className="mt-2 font-extrabold text-[#17211b]">WesBot</h2>
                  <p className="mx-auto mt-1 max-w-[min(24rem,100%)] text-xs leading-5 text-[#68746d]">WESCOMM&apos;s automated assistant using current product, reservation, payment, and receipt records.</p>
                </div>
                <div className="flex items-end gap-2">
                  <ChatAvatar kind="BOT" size="sm" />
                  <div className="min-w-0 max-w-[84%] sm:max-w-[72%]">
                    <p className="mb-1 px-1 text-[11px] font-bold text-primary">WesBot</p>
                    <div className="rounded-[20px] rounded-bl-md bg-white px-4 py-3 text-sm text-[#17211b] shadow-sm ring-1 ring-[#dfe8e0]">
                      <p className="whitespace-pre-wrap leading-6">
                        Hi! I&apos;m WesBot. Ask me about products, live availability, reservations, GCash payments, receipts, cancellations, or pickup schedules.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-end gap-2 pl-10">
                  <div className="max-w-[84%] rounded-[20px] rounded-bl-md bg-white px-4 py-3 text-sm leading-6 text-[#17211b] shadow-sm ring-1 ring-[#dfe8e0] sm:max-w-[72%]">
                    If you want a real person, type <strong>staff</strong> anytime. I&apos;ll keep this same chat and connect it to the commissary team.
                  </div>
                </div>
                <div className="flex w-full min-w-0 max-w-full flex-wrap gap-2 pb-1 pt-2 sm:pl-10">
                  {quickQuestions.map((question) => (
                    <button
                      key={question.label}
                      type="button"
                      onClick={() => chooseQuickQuestion(question.message)}
                      className="shrink-0 rounded-full border border-[#bcd5bf] bg-white px-3.5 py-2 text-xs font-bold text-primary shadow-sm transition hover:bg-[#eef7ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {question.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {selectedConversation?.messages.map((message, index, messages) => {
              const mine = message.senderType === "STUDENT" && message.senderId === user.id;
              const day = formatSupportDay(message.createdAt);
              const showDay = index === 0 || formatSupportDay(messages[index - 1].createdAt) !== day;
              const canEdit = mine
                && messages.at(-1)?.id === message.id
                && selectedConversation.status === "OPEN"
                && (selectedConversation.mode === "WAITING_FOR_STAFF" || selectedConversation.mode === "STAFF_ACTIVE")
                && Date.now() - new Date(message.createdAt).getTime() <= 30 * 60_000;

              if (message.senderType === "SYSTEM") {
                return (
                  <div key={message.id}>
                    {showDay ? <p className="mb-3 text-center text-[11px] font-bold text-[#879089]">{day}</p> : null}
                    <div className="flex justify-center py-1">
                      <p className="max-w-[92%] rounded-full bg-[#e3e9e4] px-3 py-1.5 text-center text-[11px] font-semibold leading-4 text-[#667169]">
                        {message.message}
                      </p>
                    </div>
                  </div>
                );
              }

              const botMessage = message.senderType === "BOT";
              const suggestedActions = botMessage ? messageSuggestedActions(message) : [];
              return (
                <div key={message.id}>
                  {showDay ? <p className="mb-3 text-center text-[11px] font-bold text-[#879089]">{day}</p> : null}
                  <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                    {!mine ? <ChatAvatar kind={botMessage ? "BOT" : "STAFF"} size="sm" /> : null}
                    <div className={cn("flex min-w-0 max-w-[82%] flex-col sm:max-w-[72%]", mine ? "items-end" : "items-start")}>
                      {!mine ? (
                        <p className={cn("mb-1 px-1 text-[11px] font-bold", botMessage ? "text-primary" : "text-sky-800")}>
                          {botMessage ? "WesBot" : message.sender?.fullName || "Commissary staff"}
                        </p>
                      ) : null}
                      <div className={cn(
                        "rounded-[20px] px-4 py-2.5 text-sm shadow-sm",
                        mine
                          ? "rounded-br-md bg-primary text-white"
                          : botMessage
                            ? "rounded-bl-md bg-white text-[#17211b] ring-1 ring-[#dfe8e0]"
                            : "rounded-bl-md bg-white text-[#17211b] ring-1 ring-sky-200"
                      )}>
                        {editingMessageId === message.id ? (
                          <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} maxLength={2000} rows={3} className="min-w-[220px] resize-y rounded-lg border border-white/50 bg-white/95 p-2 text-[#17211b] outline-none focus:ring-2 focus:ring-white" aria-label="Edit message" />
                        ) : <p className="whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{message.message}</p>}
                      </div>
                      <p className={cn("mt-1 px-1 text-[10px] font-semibold", mine ? "text-[#718078]" : "text-[#7b867f]")}>
                        {mine ? "You" : botMessage ? "WesBot" : "Staff"} · {formatSupportTime(message.createdAt)}
                      </p>
                      {message.editedAt ? <span className="px-1 text-[10px] font-semibold text-[#7b867f]">Edited</span> : null}
                      {editingMessageId === message.id ? (
                        <div className="mt-1 flex gap-1">
                          <button type="button" disabled={savingEdit || !editDraft.trim()} onClick={() => void saveMessageEdit(selectedConversation, message)} className="grid size-8 place-items-center rounded-full bg-primary text-white disabled:opacity-50" aria-label="Save edited message"><Check className="size-4" /></button>
                          <button type="button" disabled={savingEdit} onClick={() => { setEditingMessageId(null); setEditDraft(""); }} className="grid size-8 place-items-center rounded-full border bg-white text-muted-foreground" aria-label="Cancel editing"><X className="size-4" /></button>
                        </div>
                      ) : canEdit ? (
                        <button type="button" onClick={() => { setEditingMessageId(message.id); setEditDraft(message.message); }} className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-primary hover:bg-primary/10" aria-label="Edit your latest message"><Pencil className="size-3" />Edit</button>
                      ) : null}
                      {suggestedActions.length ? (
                        <div className="mt-2 flex max-w-full flex-wrap gap-1.5" aria-label="Suggested WesBot replies">
                          {suggestedActions.map((action) => (
                            <button
                              key={`${message.id}-${action.id}`}
                              type="button"
                              onClick={() => chooseQuickQuestion(action.message)}
                              className="rounded-full border border-[#bcd5bf] bg-white px-3 py-1.5 text-[11px] font-extrabold text-primary transition hover:bg-[#eef7ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}

            {pendingMessage ? (
              <div className="flex justify-end">
                <div className="flex max-w-[82%] flex-col items-end sm:max-w-[72%]">
                  <div className="rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-sm text-white opacity-80 shadow-sm">
                    <p className="whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{pendingMessage}</p>
                  </div>
                  <p className="mt-1 px-1 text-[10px] font-semibold text-[#718078]">Sending...</p>
                </div>
              </div>
            ) : null}

            {(submitting && pendingMessage && botWillReply) || botReplyPending ? (
              <div className="flex items-end gap-2">
                <ChatAvatar kind="BOT" size="sm" />
                <div className="flex items-center gap-1 rounded-[20px] rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-[#dfe8e0]" aria-label="WesBot is checking WESCOMM records">
                  <span className="size-2 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
                  <span className="size-2 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
                  <span className="size-2 animate-bounce rounded-full bg-primary/70" />
                </div>
              </div>
            ) : null}

            {selectedConversation?.typingUsers?.length ? (
              <div className="flex items-end gap-2">
                <ChatAvatar kind="STAFF" size="sm" />
                <div className="rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-xs font-semibold text-[#68746d] shadow-sm ring-1 ring-sky-200">
                  {selectedConversation.typingUsers[0].fullName || "Commissary staff"} is typing<span className="animate-pulse">...</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-[#e5ebe6] bg-white px-3 pt-2.5 pb-[calc(.625rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
            {selectedConversation?.mode === "BOT_ACTIVE" ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[#eef7ef] px-3 py-2 text-xs text-[#526058]">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />WesBot is replying</span>
                <button
                  type="button"
                  onClick={() => void requestStaff()}
                  disabled={submitting}
                  aria-label="Talk to a real staff member"
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#bcd5bf] bg-white px-3 font-extrabold text-primary transition hover:bg-[#e7f2e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Headphones className="size-3.5" />
                  <span className="hidden min-[390px]:inline">Talk to staff</span>
                  <span className="min-[390px]:hidden">Staff</span>
                </button>
              </div>
            ) : null}
            {selectedConversation?.mode === "WAITING_FOR_STAFF" ? (
              <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200">Waiting for commissary staff. You can keep adding details here.</p>
            ) : null}
            {selectedConversation?.mode === "STAFF_ACTIVE" ? (
              <p className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-200">Handled by: {selectedConversation.assignedStaff?.fullName || "Commissary Staff"}. WesBot replies are paused.</p>
            ) : null}
            <form
              className="flex min-w-0 items-end gap-1.5 rounded-[24px] border border-[#d7e1d8] bg-[#f6f8f6] p-1.5 transition focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15"
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
                onFocus={focusLatestMessage}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                maxLength={2000}
                rows={1}
                placeholder={selectedConversation?.status === "RESOLVED" ? "Send a message to reopen this chat..." : selectedConversation?.mode === "STAFF_ACTIVE" ? "Message commissary staff..." : "Message WesBot..."}
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-6 text-[#17211b] outline-none placeholder:text-[#8a948e] sm:text-sm"
              />
              <Button type="submit" className="size-11 shrink-0 rounded-full p-0" disabled={submitting || botReplyPending || !composer.trim()} aria-label="Send message">
                <Send className="size-[18px]" />
              </Button>
            </form>
            <p className="mt-2 hidden px-1 text-[11px] text-[#88918b] sm:block">WesBot uses current WESCOMM records. Press Enter to send, Shift+Enter for a new line.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
