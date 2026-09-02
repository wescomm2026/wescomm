"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Bot, Check, Filter, Headphones, LoaderCircle, Pencil, RefreshCw, RotateCcw, Search, Send, ShieldAlert, Trash2, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  editConversationMessageFromApi,
  getConversationPurgePreviewFromApi,
  getConversationMessagesFromApi,
  getConversationsFromApi,
  isRequestAbortError,
  permanentlyPurgeConversationFromApi,
  returnConversationToBotFromApi,
  sendConversationMessageFromApi,
  setConversationArchivedFromApi,
  setConversationDeletedFromApi,
  takeOverConversationFromApi,
  type BackendConversation,
  type BackendConversationMessage,
  type BackendConversationPurgePreview,
  type BackendConversationStatus,
  type BackendTypingUser,
  updateConversationTypingFromApi,
  updateConversationStatusFromApi
} from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import { cn } from "@/lib/utils";
import {
  formatConversationStatus,
  formatConversationTime,
  formatConversationDay,
  conversationPreview,
  mergeStaffMessages,
  StaffConversationAvatar,
  PageHeading,
  Notice
} from "@/components/staff/StaffOperationsShared";

export function StaffMessagesExperience() {
  const { user } = useStudentAuth();
  const confirm = useConfirmationDialog();
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [conversationView, setConversationView] = useState<"ACTIVE" | "ARCHIVED" | "DELETED">("ACTIVE");
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const [pendingReply, setPendingReply] = useState("");
  const [threadOpen, setThreadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [purgeDialog, setPurgeDialog] = useState<{
    conversation: BackendConversation;
    preview: BackendConversationPurgePreview;
  } | null>(null);
  const [purgePhrase, setPurgePhrase] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    conversationId: string;
    type: "takeover" | "return-to-bot" | "resolve" | "reopen" | "archive" | "soft-delete" | "retention-restore" | "purge-preview" | "purge" | "send";
  } | null>(null);
  const messagesLogRef = useRef<HTMLDivElement | null>(null);
  const replyComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef(0);
  const loadedThreadIdsRef = useRef(new Set<string>());
  const latestMessageAtRef = useRef("");
  const typingExpiryTimersRef = useRef(new Map<string, number>());
  const stickToBottomRef = useRef(true);
  const conversationRequestRef = useRef(0);
  const conversationAbortRef = useRef<AbortController | null>(null);
  const threadRequestRef = useRef(new Map<string, number>());
  const threadAbortRef = useRef(new Map<string, AbortController>());
  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null,
    [conversations, selectedId]
  );
  const isAdmin = user?.role === "ADMIN";
  const submitting = pendingAction !== null;
  const activeAction = selected && pendingAction?.conversationId === selected.id ? pendingAction.type : null;
  const ownsConversation = Boolean(selected && selected.mode === "STAFF_ACTIVE" && selected.assignedStaffId === user?.id);
  const deletedView = conversationView === "DELETED";
  const canReply = !deletedView && selected?.status !== "RESOLVED" && ownsConversation;
  const canTakeOver = Boolean(!deletedView && selected && selected.status !== "RESOLVED" && !ownsConversation);
  const handlerName = selected?.assignedStaff?.fullName || "another staff member";
  const composerStatus = activeAction === "send"
    ? "Sending reply to the student..."
    : deletedView
      ? "This conversation is read-only while it is in retention. Restore it before changing the thread."
    : selected?.status === "RESOLVED"
      ? "This conversation is resolved. Reopen it before replying."
      : selected?.mode === "BOT_ACTIVE"
        ? "WesBot is replying. Take over this conversation to pause WesBot and reply as Staff."
        : selected?.mode === "WAITING_FOR_STAFF"
          ? "No Staff handler yet. Take over this conversation to reply."
          : !ownsConversation
            ? `Handled by: ${handlerName}. Take over ownership before replying.`
            : `You are the current handler${user?.fullName ? `: ${user.fullName}` : ""}.`;
  const pendingActionLabel = activeAction === "send"
    ? "Sending reply to student"
    : activeAction === "takeover"
      ? "Taking over conversation"
      : activeAction === "return-to-bot"
        ? "Returning conversation to WesBot"
        : activeAction === "resolve"
          ? "Resolving conversation"
          : activeAction === "reopen"
            ? "Reopening conversation"
            : activeAction === "archive"
              ? "Updating conversation archive"
              : activeAction === "soft-delete"
                ? "Moving conversation into retention"
                : activeAction === "retention-restore"
                  ? "Restoring conversation from retention"
                  : activeAction === "purge-preview"
                    ? "Checking permanent purge eligibility"
                    : activeAction === "purge"
                      ? "Permanently purging conversation"
            : "";

  const closePurgeDialog = useCallback(() => {
    if (pendingAction?.type === "purge") return;
    setPurgeDialog(null);
    setPurgePhrase("");
  }, [pendingAction?.type]);
  const purgeDialogA11y = useAccessibleDialog<HTMLElement>(Boolean(purgeDialog), closePurgeDialog);
  const purgeDescriptionId = `${purgeDialogA11y.titleId}-description`;

  const loadConversations = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const requestId = ++conversationRequestRef.current;
    conversationAbortRef.current?.abort();
    const requestController = new AbortController();
    conversationAbortRef.current = requestController;
    const session = getStoredStaffSession();
    if (!session.token) {
      requestController.abort();
      setConversations([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getConversationsFromApi(session.token, { view: conversationView, signal: requestController.signal });
      if (requestId !== conversationRequestRef.current) return;
      setConversations((current) => rows.map((row) => {
        const existing = current.find((conversation) => conversation.id === row.id);
        if (!existing || !loadedThreadIdsRef.current.has(row.id)) return row;
        return { ...row, messages: mergeStaffMessages(existing.messages, row.messages) };
      }));
      const conversationId = new URL(window.location.href).searchParams.get("conversationId");
      setSelectedId((current) => conversationId && rows.some((conversation) => conversation.id === conversationId)
        ? conversationId
        : rows.some((conversation) => conversation.id === current) ? current : rows[0]?.id || "");
      if (conversationId && rows.some((conversation) => conversation.id === conversationId)) setThreadOpen(true);
    } catch (messageError) {
      if (requestId === conversationRequestRef.current && !background && !isRequestAbortError(messageError)) {
        setError(userFacingErrorMessage(messageError, "Unable to load student messages."));
      }
    } finally {
      if (requestId === conversationRequestRef.current && !background) setLoading(false);
    }
  }, [conversationView]);

  const loadThreadMessages = useCallback(async (conversationId: string, after?: string) => {
    const session = getStoredStaffSession();
    if (!session.token) return;
    const requestId = (threadRequestRef.current.get(conversationId) ?? 0) + 1;
    threadRequestRef.current.set(conversationId, requestId);
    threadAbortRef.current.get(conversationId)?.abort();
    const requestController = new AbortController();
    threadAbortRef.current.set(conversationId, requestController);
    try {
      const result = await getConversationMessagesFromApi(session.token, conversationId, {
        limit: 50,
        after: after || undefined,
        signal: requestController.signal
      });
      if (threadRequestRef.current.get(conversationId) !== requestId) return;
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? {
            ...conversation,
            messages: after ? mergeStaffMessages(conversation.messages, result.messages) : result.messages,
            typingUsers: result.typingUsers
          }
        : conversation));
      loadedThreadIdsRef.current.add(conversationId);
    } catch (messageError) {
      if (
        threadRequestRef.current.get(conversationId) === requestId
        && !after
        && !isRequestAbortError(messageError)
      ) {
        setError(userFacingErrorMessage(messageError, "Unable to load this conversation."));
      }
    } finally {
      if (threadAbortRef.current.get(conversationId) === requestController) {
        threadAbortRef.current.delete(conversationId);
      }
    }
  }, []);

  useEffect(() => {
    if (!user || isAdmin || conversationView !== "DELETED") return;
    setConversations([]);
    setSelectedId("");
    setThreadOpen(false);
    setConversationView("ACTIVE");
  }, [conversationView, isAdmin, user]);

  useRealtimeRefresh(["conversations", "typing"], (update) => {
    if (update.topic === "conversations") {
      void loadConversations({ background: true });
      if (threadOpen && selected?.id && update.entityId === selected.id) {
        void loadThreadMessages(selected.id, latestMessageAtRef.current || undefined);
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
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
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
  }, [loadConversations]);

  useEffect(() => {
    latestMessageAtRef.current = selected?.messages.at(-1)?.createdAt ?? "";
  }, [selected?.messages]);

  useEffect(() => {
    if (!selected?.id || !threadOpen) return;
    const conversationId = selected.id;
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
  }, [loadThreadMessages, selected?.id, threadOpen]);

  useEffect(() => () => {
    conversationRequestRef.current += 1;
    conversationAbortRef.current?.abort();
    threadAbortRef.current.forEach((controller) => controller.abort());
    threadAbortRef.current.clear();
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingExpiryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    typingExpiryTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!threadOpen) return;
    const messagesLog = messagesLogRef.current;
    if (messagesLog && (stickToBottomRef.current || pendingReply)) {
      messagesLog.scrollTop = messagesLog.scrollHeight;
    }
  }, [pendingReply, threadOpen, selected?.messages.length, selected?.typingUsers?.length]);

  const filtered = useMemo(() => conversations.filter((conversation) =>
    `${conversation.subject} ${conversation.student?.fullName ?? ""} ${conversation.student?.email ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()) &&
    (status === "All" || formatConversationStatus(conversation) === status)
  ), [conversations, search, status]);

  const openConversation = (conversationId: string) => {
    stickToBottomRef.current = true;
    setSelectedId(conversationId);
    setThreadOpen(true);
  };

  const closeConversation = () => {
    const session = getStoredStaffSession();
    if (session.token && selected) {
      void updateConversationTypingFromApi(session.token, selected.id, false);
    }
    setThreadOpen(false);
    setReply("");
  };

  const handleMessageScroll = () => {
    const messagesLog = messagesLogRef.current;
    if (!messagesLog) return;
    stickToBottomRef.current = messagesLog.scrollHeight - messagesLog.scrollTop - messagesLog.clientHeight < 120;
  };

  const focusLatestMessage = () => {
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      const messagesLog = messagesLogRef.current;
      if (messagesLog) messagesLog.scrollTop = messagesLog.scrollHeight;
    });
  };

  const sendTypingSignal = useCallback((conversationId: string, isTyping: boolean) => {
    const session = getStoredStaffSession();
    if (!session.token) return;
    void updateConversationTypingFromApi(session.token, conversationId, isTyping).catch(() => undefined);
  }, []);

  const handleReplyChange = (value: string) => {
    setReply(value);
    if (!selected) return;

    if (!value.trim()) {
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
      lastTypingSignalRef.current = 0;
      sendTypingSignal(selected.id, false);
      return;
    }

    const now = Date.now();
    if (now - lastTypingSignalRef.current > 1500) {
      lastTypingSignalRef.current = now;
      sendTypingSignal(selected.id, true);
    }

    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      lastTypingSignalRef.current = 0;
      sendTypingSignal(selected.id, false);
    }, 2500);
  };

  const sendReply = async () => {
    const session = getStoredStaffSession();
    if (!session.token || !selected || !reply.trim() || submitting) return;

    const message = reply.trim();
    setPendingAction({ conversationId: selected.id, type: "send" });
    setPendingReply(message);
    setError("");

    try {
      const result = await sendConversationMessageFromApi(session.token, selected.id, message);
      sendTypingSignal(selected.id, false);
      setConversations((current) => current.map((conversation) => conversation.id === selected.id
        ? {
            ...result.conversation,
            messages: mergeStaffMessages(
              conversation.messages,
              [result.message, ...(result.botMessage ? [result.botMessage] : [])]
            )
          }
        : conversation));
      setReply("");
      if (replyComposerRef.current) replyComposerRef.current.style.height = "auto";
      setNotice("Reply sent to student.");
    } catch (messageError) {
      setError(userFacingErrorMessage(messageError, "Unable to send the reply."));
    } finally {
      setPendingReply("");
      setPendingAction(null);
    }
  };

  const takeOverConversation = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || submitting) return;
    const replacingStaff = conversation.mode === "STAFF_ACTIVE" && conversation.assignedStaffId !== user?.id;
    const currentHandler = conversation.assignedStaff?.fullName || "the current Staff handler";
    const confirmed = await confirm({
      title: "Take over this conversation?",
      description: replacingStaff
        ? `You will replace ${currentHandler} as the current handler. Their reply box will be locked immediately.`
        : "WesBot will pause for this thread and you will become its current Staff handler until it is returned to the bot or resolved.",
      confirmLabel: "Take over",
      tone: "warning"
    });
    if (!confirmed) return;

    setPendingAction({ conversationId: conversation.id, type: "takeover" });
    setError("");

    try {
      const updatedConversation = await takeOverConversationFromApi(session.token, conversation.id);
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...updatedConversation, messages: item.messages }
        : item));
      void loadThreadMessages(conversation.id, latestMessageAtRef.current || undefined);
      focusLatestMessage();
      setNotice(`You are now handling ${conversation.student?.fullName || "this student"}'s concern.`);
    } catch (messageError) {
      setError(userFacingErrorMessage(messageError, "Unable to take over the conversation."));
      void loadConversations({ background: true });
    } finally {
      setPendingAction(null);
    }
  };

  const returnToWesBot = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || submitting) return;
    const confirmed = await confirm({
      title: "Return this conversation to WesBot?",
      description: "Your Staff ownership will end and WesBot can resume replying to the student in this thread.",
      confirmLabel: "Return to WesBot",
      tone: "warning"
    });
    if (!confirmed) return;

    setPendingAction({ conversationId: conversation.id, type: "return-to-bot" });
    setError("");

    try {
      const updatedConversation = await returnConversationToBotFromApi(session.token, conversation.id);
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...updatedConversation, messages: item.messages }
        : item));
      void loadThreadMessages(conversation.id, latestMessageAtRef.current || undefined);
      setReply("");
      setNotice("Conversation returned to WesBot.");
    } catch (messageError) {
      setError(userFacingErrorMessage(messageError, "Unable to return the conversation to WesBot."));
    } finally {
      setPendingAction(null);
    }
  };

  const updateStatus = async (conversation: BackendConversation, nextStatus: BackendConversationStatus) => {
    const session = getStoredStaffSession();
    if (!session.token || submitting) return;
    if (nextStatus === "RESOLVED") {
      const confirmed = await confirm({
        title: "Resolve this conversation?",
        description: "The thread will be marked resolved and the reply box will close. Staff can reopen it later if the student needs more help.",
        confirmLabel: "Resolve conversation",
        tone: "warning"
      });
      if (!confirmed) return;
    }

    setPendingAction({
      conversationId: conversation.id,
      type: nextStatus === "RESOLVED" ? "resolve" : "reopen"
    });
    setError("");

    try {
      const updatedConversation = await updateConversationStatusFromApi(session.token, conversation.id, nextStatus);
      setConversations((current) => conversationView === "ARCHIVED" && nextStatus === "OPEN"
        ? current.filter((item) => item.id !== conversation.id)
        : current.map((item) => item.id === conversation.id
          ? { ...updatedConversation, messages: item.messages }
          : item));
      setNotice(`${conversation.subject} marked as ${nextStatus === "RESOLVED" ? "resolved" : "open"}.`);
    } catch (messageError) {
      setError(userFacingErrorMessage(messageError, "Unable to update the conversation."));
    } finally {
      setPendingAction(null);
    }
  };

  const archiveConversation = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || conversation.status !== "RESOLVED" || submitting) return;
    setPendingAction({ conversationId: conversation.id, type: "archive" });
    setError("");
    try {
      await setConversationArchivedFromApi(session.token, conversation.id, conversationView === "ACTIVE");
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      setSelectedId("");
      setThreadOpen(false);
      setNotice(conversationView === "ACTIVE" ? "Conversation archived." : "Conversation restored to the active inbox.");
    } catch (archiveError) {
      setError(userFacingErrorMessage(archiveError, "Unable to update the conversation archive."));
    } finally {
      setPendingAction(null);
    }
  };

  const deleteConversationIntoRetention = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || !isAdmin || conversationView !== "ARCHIVED" || submitting) return;
    const confirmed = await confirm({
      title: "Move this conversation into retention?",
      description: "It will disappear for the student and Staff, remain recoverable by Admin for 90 days, and cannot be permanently purged before that period ends.",
      confirmLabel: "Move to Deleted",
      tone: "danger"
    });
    if (!confirmed) return;

    setPendingAction({ conversationId: conversation.id, type: "soft-delete" });
    setError("");
    try {
      await setConversationDeletedFromApi(session.token, conversation.id, true);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      setSelectedId("");
      setThreadOpen(false);
      setNotice("Conversation moved into 90-day retention.");
    } catch (deletionError) {
      setError(userFacingErrorMessage(deletionError, "Unable to move this conversation into retention."));
    } finally {
      setPendingAction(null);
    }
  };

  const restoreConversationFromRetention = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || !isAdmin || conversationView !== "DELETED" || submitting) return;
    const confirmed = await confirm({
      title: "Restore this conversation?",
      description: "The full thread will return to the operations archive. It will remain resolved and read-only until Staff explicitly reopens it.",
      confirmLabel: "Restore conversation"
    });
    if (!confirmed) return;

    setPendingAction({ conversationId: conversation.id, type: "retention-restore" });
    setError("");
    try {
      await setConversationDeletedFromApi(session.token, conversation.id, false);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      setSelectedId("");
      setThreadOpen(false);
      setNotice("Conversation restored to the operations archive.");
    } catch (restoreError) {
      setError(userFacingErrorMessage(restoreError, "Unable to restore this conversation."));
    } finally {
      setPendingAction(null);
    }
  };

  const requestPermanentPurge = async (conversation: BackendConversation) => {
    const session = getStoredStaffSession();
    if (!session.token || !isAdmin || conversationView !== "DELETED" || submitting) return;
    setPendingAction({ conversationId: conversation.id, type: "purge-preview" });
    setError("");
    try {
      const preview = await getConversationPurgePreviewFromApi(session.token, conversation.id);
      if (!preview.eligible) {
        setError(`Permanent purge is locked until ${new Date(preview.purgeEligibleAt).toLocaleString()}. You can still restore this conversation.`);
        return;
      }
      setPurgePhrase("");
      setPurgeDialog({ conversation, preview });
    } catch (previewError) {
      setError(userFacingErrorMessage(previewError, "Unable to verify permanent purge eligibility."));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmPermanentPurge = async () => {
    const session = getStoredStaffSession();
    if (!session.token || !purgeDialog || submitting) return;
    const { conversation, preview } = purgeDialog;
    if (purgePhrase !== preview.confirmationPhrase) return;

    setPendingAction({ conversationId: conversation.id, type: "purge" });
    setError("");
    try {
      await permanentlyPurgeConversationFromApi(session.token, conversation.id, {
        confirmationPhrase: purgePhrase,
        previewFingerprint: preview.previewFingerprint,
        idempotencyKey: crypto.randomUUID()
      });
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      setSelectedId("");
      setThreadOpen(false);
      setPurgeDialog(null);
      setPurgePhrase("");
      setNotice("Conversation evidence permanently purged. A non-content audit tombstone was retained.");
    } catch (purgeError) {
      setError(userFacingErrorMessage(purgeError, "Unable to permanently purge this conversation."));
      setPurgeDialog(null);
      setPurgePhrase("");
    } finally {
      setPendingAction(null);
    }
  };

  const saveMessageEdit = async (conversation: BackendConversation, message: BackendConversationMessage) => {
    const session = getStoredStaffSession();
    const nextMessage = editDraft.trim();
    if (!session.token || !nextMessage || savingEdit) return;
    setSavingEdit(true);
    setError("");
    try {
      const updated = await editConversationMessageFromApi(
        session.token,
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

  return (
    <div className="space-y-5">
      <div className="hidden lg:block">
        <PageHeading
          eyebrow="Student messaging"
          title="Message center"
          detail="Monitor WesBot, take over any active thread, and keep every Staff reply under one clear handler."
          action={(
            <Button variant="secondary" onClick={() => void loadConversations()} disabled={loading || submitting} aria-busy={loading}>
              <RefreshCw className={`size-4 ${loading ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          )}
        />
      </div>
      <h1 className="sr-only lg:hidden">Message center</h1>
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <section
        aria-label="WESCOMM staff messenger"
        className="grid h-[calc(100dvh-7.375rem)] min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#dce5dd] bg-white shadow-[0_16px_48px_rgba(16,24,32,0.08)] lg:h-[calc(100dvh-15.5rem)] lg:grid-cols-[320px_minmax(0,1fr)]"
      >
        <aside className={cn(
          "h-full min-h-0 min-w-0 flex-col border-[#e5ebe6] bg-[#fbfcfb] lg:flex lg:border-r",
          threadOpen ? "hidden" : "flex"
        )}>
          <div className="flex min-h-[68px] items-center gap-3 border-b border-[#edf1ed] px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eaf6eb] text-primary" aria-hidden="true">
              <AssetIcon src="/assets/messages.svg" className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#17211b]">Messages</p>
              <p className="text-xs text-[#68746d]">{filtered.length} conversation{filtered.length === 1 ? "" : "s"}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadConversations()}
              disabled={loading || submitting}
              aria-label="Refresh conversations"
              title="Refresh"
              className="ml-auto grid size-10 shrink-0 place-items-center rounded-full text-[#5d6962] transition hover:bg-[#edf4ee] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-[18px]", loading && "motion-safe:animate-spin")} aria-hidden="true" />
            </button>
          </div>

          <div className={cn("grid gap-1 border-b border-[#edf1ed] p-2", isAdmin ? "grid-cols-3" : "grid-cols-2")} aria-label="Conversation view">
            <button type="button" onClick={() => setConversationView("ACTIVE")} aria-pressed={conversationView === "ACTIVE"} className={cn("rounded-lg px-3 py-2 text-xs font-extrabold", conversationView === "ACTIVE" ? "bg-primary text-white" : "text-[#68746d] hover:bg-[#eef4ef]")}>Active</button>
            <button type="button" onClick={() => setConversationView("ARCHIVED")} aria-pressed={conversationView === "ARCHIVED"} className={cn("rounded-lg px-3 py-2 text-xs font-extrabold", conversationView === "ARCHIVED" ? "bg-primary text-white" : "text-[#68746d] hover:bg-[#eef4ef]")}>Archived</button>
            {isAdmin ? <button type="button" onClick={() => setConversationView("DELETED")} aria-pressed={conversationView === "DELETED"} className={cn("rounded-lg px-3 py-2 text-xs font-extrabold", conversationView === "DELETED" ? "bg-red-700 text-white" : "text-[#68746d] hover:bg-red-50 hover:text-red-700")}>Deleted</button> : null}
          </div>

          <div className="space-y-2 border-b border-[#edf1ed] p-3">
            <label className="flex h-10 items-center rounded-full border border-[#d7e1d8] bg-white px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
              <Search className="mr-2 size-4 shrink-0 text-[#68746d]" aria-hidden="true" />
              <span className="sr-only">Search conversations</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </label>
            <label className="flex h-9 items-center gap-2 rounded-full border border-[#d7e1d8] bg-white px-3 text-xs">
              <Filter className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="sr-only">Filter conversation status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="min-w-0 flex-1 bg-transparent font-bold outline-none">
                {["All", "WesBot active", "Waiting for Staff", "Staff active", "Resolved"].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {loading ? (
            <div className="grid min-h-48 place-items-center px-5 text-center">
              <div>
                <LoaderCircle className="mx-auto size-6 motion-safe:animate-spin text-primary" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-[#68746d]">Loading conversations...</p>
              </div>
            </div>
          ) : filtered.length ? filtered.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => openConversation(conversation.id)}
              disabled={submitting}
              aria-current={selected?.id === conversation.id ? "true" : undefined}
              className={cn(
                "mb-1 flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-[#f0f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70",
                selected?.id === conversation.id && "bg-[#e8f3e9]"
              )}
            >
              <StaffConversationAvatar kind="STUDENT" name={conversation.student?.fullName || conversation.student?.email || "Student"} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#17211b]">{conversation.student?.fullName || conversation.student?.email || "Student"}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-[#879089]">{formatConversationTime(conversation.deletedAt || conversation.updatedAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-[#3f4a44]">{conversation.subject}</span>
                <span className="mt-1 block truncate text-xs text-[#68746d]">{conversationPreview(conversation)}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-[#68746d]">
                  <span className={cn(
                    "size-1.5 rounded-full",
                    conversation.mode === "BOT_ACTIVE" ? "bg-emerald-500" : conversation.mode === "WAITING_FOR_STAFF" ? "bg-amber-500" : conversation.mode === "STAFF_ACTIVE" ? "bg-sky-500" : "bg-slate-400"
                  )} />
                  {conversationView === "DELETED"
                    ? "Deleted · in retention"
                    : conversation.mode === "STAFF_ACTIVE"
                    ? `Handled by ${conversation.assignedStaffId === user?.id ? "you" : conversation.assignedStaff?.fullName || "Staff"}`
                    : formatConversationStatus(conversation)}
                </span>
              </span>
            </button>
          )) : (
            <div className="grid h-full min-h-56 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#eaf6eb] text-primary"><Search className="size-6" /></span>
                <p className="mt-3 font-extrabold text-[#17211b]">No matching messages</p>
                <p className="mt-1 text-sm leading-5 text-[#68746d]">Try another student name, topic, or status.</p>
              </div>
            </div>
          )}
          </div>
        </aside>
        {selected ? (
          <div
            data-testid="staff-conversation-thread"
            className={cn("h-full min-h-0 min-w-0 flex-col lg:flex", threadOpen ? "flex" : "hidden")}
          >
            <header className="flex min-h-[68px] shrink-0 items-center gap-2 border-b border-[#e5ebe6] bg-white px-3 py-2.5 sm:gap-3 sm:px-5" aria-busy={Boolean(activeAction)}>
              <button
                type="button"
                onClick={closeConversation}
                disabled={submitting}
                className="grid size-10 shrink-0 place-items-center rounded-full text-primary transition hover:bg-[#eef6ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50 lg:hidden"
                aria-label="Back to message inbox"
              >
                <ArrowLeft className="size-5" aria-hidden="true" />
              </button>
              <StaffConversationAvatar kind="STUDENT" name={selected.student?.fullName || selected.student?.email || "Student"} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-extrabold text-[#17211b] sm:text-base">{selected.student?.fullName || selected.student?.email || "Student"}</h2>
                <p className="truncate text-[11px] font-semibold text-[#68746d] sm:text-xs">{selected.subject}</p>
              </div>
              <span className="hidden shrink-0 md:inline-flex">
                {deletedView ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-800">Deleted</span> : <StatusBadge status={formatConversationStatus(selected)} />}
              </span>
              {!deletedView && selected.status === "RESOLVED" ? (
                <button
                  type="button"
                  onClick={() => void archiveConversation(selected)}
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
                onClick={() => void loadConversations({ background: true })}
                disabled={submitting}
                aria-label="Refresh conversations"
                title="Refresh"
                className="grid size-10 shrink-0 place-items-center rounded-full text-[#5d6962] transition hover:bg-[#f0f5f1] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <RefreshCw className="size-[18px]" aria-hidden="true" />
              </button>
            </header>
            {pendingActionLabel ? <p className="sr-only" role="status" aria-live="polite">{pendingActionLabel}</p> : null}

            <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-[#e5ebe6] bg-[#fbfcfb] px-3 py-2 sm:px-5">
              <span className="shrink-0 md:hidden">
                {deletedView ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-800">Deleted</span> : <StatusBadge status={formatConversationStatus(selected)} />}
              </span>
              {deletedView ? (
                <>
                  <Button variant="secondary" className="min-h-10 shrink-0 rounded-full px-3" disabled={submitting} aria-busy={activeAction === "retention-restore"} onClick={() => void restoreConversationFromRetention(selected)}>
                    {activeAction === "retention-restore" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                    {activeAction === "retention-restore" ? "Restoring..." : "Restore"}
                  </Button>
                  <Button variant="destructive" className="min-h-10 shrink-0 rounded-full px-3" disabled={submitting} aria-busy={activeAction === "purge-preview" || activeAction === "purge"} onClick={() => void requestPermanentPurge(selected)}>
                    {activeAction === "purge-preview" || activeAction === "purge" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <ShieldAlert className="size-4" aria-hidden="true" />}
                    {activeAction === "purge-preview" ? "Checking..." : activeAction === "purge" ? "Purging..." : "Permanently Purge"}
                  </Button>
                </>
              ) : (
                <>
                  {canTakeOver ? (
                    <Button className="min-h-10 shrink-0 rounded-full px-3" disabled={submitting} aria-busy={activeAction === "takeover"} onClick={() => void takeOverConversation(selected)}>
                      {activeAction === "takeover" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Headphones className="size-4" aria-hidden="true" />}
                      {activeAction === "takeover" ? "Taking over..." : "Take Over"}
                    </Button>
                  ) : null}
                  {selected.mode === "STAFF_ACTIVE" && selected.assignedStaffId === user?.id ? (
                    <Button variant="secondary" className="h-9 shrink-0 rounded-full px-3" disabled={submitting} aria-busy={activeAction === "return-to-bot"} onClick={() => void returnToWesBot(selected)}>
                      {activeAction === "return-to-bot" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
                      {activeAction === "return-to-bot" ? "Returning..." : "Return to WesBot"}
                    </Button>
                  ) : null}
                  <Button
                    variant={selected.status === "RESOLVED" ? "secondary" : "ghost"}
                    className="min-h-10 shrink-0 rounded-full border border-[#d7e1d8] px-3"
                    disabled={submitting || (selected.status !== "RESOLVED" && !ownsConversation)}
                    aria-busy={activeAction === "resolve" || activeAction === "reopen"}
                    onClick={() => void updateStatus(selected, selected.status === "RESOLVED" ? "OPEN" : "RESOLVED")}
                  >
                    {activeAction === "resolve" || activeAction === "reopen" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                    {activeAction === "resolve" ? "Resolving..." : activeAction === "reopen" ? "Reopening..." : selected.status === "RESOLVED" ? "Reopen" : "Resolve"}
                  </Button>
                  {isAdmin && conversationView === "ARCHIVED" ? (
                    <Button variant="destructive" className="min-h-10 shrink-0 rounded-full px-3" disabled={submitting} aria-busy={activeAction === "soft-delete"} onClick={() => void deleteConversationIntoRetention(selected)}>
                      {activeAction === "soft-delete" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                      {activeAction === "soft-delete" ? "Deleting..." : "Delete"}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {deletedView ? (
              <div className="border-b border-red-200 bg-red-50 px-3 py-3 text-sm text-red-950 sm:px-5">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
                  <p>
                    <span className="font-extrabold">Retention copy — read only.</span>{" "}
                    Deleted {selected.deletedAt ? new Date(selected.deletedAt).toLocaleString() : "recently"}.
                    {selected.purgeEligibleAt ? ` Permanent purge unlocks ${new Date(selected.purgeEligibleAt).toLocaleString()}.` : ""}
                  </p>
                </div>
              </div>
            ) : null}
            {!deletedView && selected.mode === "WAITING_FOR_STAFF" ? (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
                <div className="flex items-start gap-2">
                  <Headphones className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="font-extrabold">Student requested human support</p>
                    <p className="mt-1 leading-5">{selected.escalationReason || "No escalation reason was provided."}</p>
                    {selected.botSummary ? <p className="mt-2 whitespace-pre-wrap rounded-md bg-white/70 p-3 leading-5"><span className="font-extrabold">WesBot summary:</span> {selected.botSummary}</p> : null}
                  </div>
                </div>
              </div>
            ) : null}
            {!deletedView && selected.mode === "STAFF_ACTIVE" && selected.assignedStaffId !== user?.id ? (
              <div className="border-b border-sky-200 bg-sky-50 px-3 py-3 text-sm font-semibold text-sky-900 sm:px-5">
                <span className="font-extrabold">Handled by: {handlerName}.</span> Your reply box is locked until ownership is transferred with Take Over.
              </div>
            ) : null}
            {!deletedView && ownsConversation ? (
              <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900 sm:px-5">
                Handled by: You{user?.fullName ? ` (${user.fullName})` : ""}. Other Staff cannot reply unless they take over.
              </div>
            ) : null}
            {!deletedView && selected.mode === "BOT_ACTIVE" ? (
              <div className="flex items-start gap-2 border-b border-[#cfe0d0] bg-[#f3f9f3] px-3 py-3 text-sm text-[#445149] sm:px-5">
                <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
                <p><span className="font-extrabold text-[#17211b]">Handled by: WesBot.</span> Staff can take over now; the bot is paused as soon as ownership changes.</p>
              </div>
            ) : null}
            <div ref={messagesLogRef} onScroll={handleMessageScroll} role="log" aria-live="polite" aria-relevant="additions" className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain bg-[#f4f7f4] px-3 py-4 scroll-smooth sm:px-5 sm:py-5">
              {selected.messages.map((message, index, messages) => {
                const mine = message.senderType === "STAFF" && message.senderId === user?.id;
                const day = formatConversationDay(message.createdAt);
                const showDay = index === 0 || formatConversationDay(messages[index - 1].createdAt) !== day;
                const canEdit = mine
                  && !deletedView
                  && messages.at(-1)?.id === message.id
                  && selected.status === "OPEN"
                  && selected.mode === "STAFF_ACTIVE"
                  && selected.assignedStaffId === user?.id
                  && Date.now() - new Date(message.createdAt).getTime() <= 30 * 60_000;
                if (message.senderType === "SYSTEM") {
                  return (
                    <div key={message.id}>
                      {showDay ? <p className="mb-3 text-center text-[11px] font-bold text-[#879089]">{day}</p> : null}
                      <div className="flex justify-center py-1">
                        <p className="max-w-[92%] rounded-full bg-[#e3e9e4] px-3 py-1.5 text-center text-[11px] font-semibold leading-4 text-[#667169]">{message.message}</p>
                      </div>
                    </div>
                  );
                }

                const botMessage = message.senderType === "BOT";
                const staffMessage = message.senderType === "STAFF";
                const senderName = botMessage
                  ? "WesBot"
                  : staffMessage
                    ? message.sender?.fullName || "Commissary staff"
                    : selected.student?.fullName || "Student";
                const senderKind = botMessage ? "BOT" : staffMessage ? "STAFF" : "STUDENT";
                return (
                  <div key={message.id}>
                    {showDay ? <p className="mb-3 text-center text-[11px] font-bold text-[#879089]">{day}</p> : null}
                    <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                      {!mine ? <StaffConversationAvatar kind={senderKind} name={senderName} size="sm" /> : null}
                      <div className={cn("flex min-w-0 max-w-[82%] flex-col sm:max-w-[72%]", mine ? "items-end" : "items-start")}>
                      {!mine ? <p className={cn("mb-1 px-1 text-[11px] font-bold", botMessage ? "text-primary" : staffMessage ? "text-sky-800" : "text-[#526058]")}>{senderName}</p> : null}
                      <div className={cn(
                        "rounded-[20px] px-4 py-2.5 text-sm shadow-sm",
                        mine
                          ? "rounded-br-md bg-primary text-white"
                          : botMessage
                            ? "rounded-bl-md bg-white text-[#17211b] ring-1 ring-[#dfe8e0]"
                            : staffMessage
                              ? "rounded-bl-md bg-white text-[#17211b] ring-1 ring-sky-200"
                              : "rounded-bl-md bg-white text-[#17211b] ring-1 ring-[#dce5dd]"
                      )}>
                        {editingMessageId === message.id ? (
                          <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} maxLength={2000} rows={3} className="min-w-[220px] resize-y rounded-lg border border-white/50 bg-white/95 p-2 text-[#17211b] outline-none focus:ring-2 focus:ring-white" aria-label="Edit message" />
                        ) : <p className="whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{message.message}</p>}
                      </div>
                      {message.editedAt ? <span className="px-1 text-[10px] font-semibold text-[#7b867f]">Edited</span> : null}
                      {editingMessageId === message.id ? (
                        <div className="mt-1 flex gap-1">
                          <button type="button" disabled={savingEdit || !editDraft.trim()} onClick={() => void saveMessageEdit(selected, message)} className="grid size-8 place-items-center rounded-full bg-primary text-white disabled:opacity-50" aria-label="Save edited message"><Check className="size-4" /></button>
                          <button type="button" disabled={savingEdit} onClick={() => { setEditingMessageId(null); setEditDraft(""); }} className="grid size-8 place-items-center rounded-full border bg-white text-muted-foreground" aria-label="Cancel editing"><X className="size-4" /></button>
                        </div>
                      ) : canEdit ? (
                        <button type="button" onClick={() => { setEditingMessageId(message.id); setEditDraft(message.message); }} className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-primary hover:bg-primary/10" aria-label="Edit your latest reply"><Pencil className="size-3" />Edit</button>
                      ) : null}
                      <p className="mt-1 px-1 text-[10px] font-semibold text-[#7b867f]">{mine ? "You" : senderName} · {formatConversationTime(message.createdAt)}</p>
                    </div>
                    </div>
                  </div>
                );
              })}
              {pendingReply ? (
                <div className="flex justify-end">
                  <div className="flex max-w-[82%] flex-col items-end sm:max-w-[72%]">
                    <div className="rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-sm text-white opacity-80 shadow-sm">
                      <p className="whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{pendingReply}</p>
                    </div>
                    <p className="mt-1 px-1 text-[10px] font-semibold text-[#718078]">Sending...</p>
                  </div>
                </div>
              ) : null}
              {selected.typingUsers?.length ? (
                <div className="flex items-end gap-2">
                  <StaffConversationAvatar kind="STUDENT" name={selected.typingUsers[0].fullName || selected.typingUsers[0].email || "Student"} size="sm" />
                  <div className="rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-xs font-semibold text-[#68746d] shadow-sm ring-1 ring-[#dce5dd]">
                    {selected.typingUsers[0].fullName || selected.typingUsers[0].email || "Student"} is typing<span className="animate-pulse">...</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-[#e5ebe6] bg-white px-3 pt-2.5 pb-[calc(.625rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
              <p id="staff-composer-status" role="status" className={cn(
                "mb-2 rounded-xl px-3 py-2 text-xs font-bold ring-1 ring-inset",
                canReply ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200"
              )}>{composerStatus}</p>
            <form
              className="flex min-w-0 items-end gap-1.5 rounded-[24px] border border-[#d7e1d8] bg-[#f6f8f6] p-1.5 transition focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15"
              aria-busy={activeAction === "send"}
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <label htmlFor="staff-message-reply" className="sr-only">Reply to student</label>
              <textarea
                ref={replyComposerRef}
                id="staff-message-reply"
                value={reply}
                onChange={(event) => {
                  handleReplyChange(event.target.value);
                  event.currentTarget.style.height = "auto";
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
                }}
                onBlur={() => selected ? sendTypingSignal(selected.id, false) : undefined}
                onFocus={focusLatestMessage}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
                maxLength={2000}
                rows={1}
                placeholder={
                  activeAction === "send"
                    ? "Sending reply..."
                    : deletedView
                      ? "Restore this conversation before making changes..."
                    : selected.mode === "WAITING_FOR_STAFF"
                    ? "Take over this conversation before replying..."
                    : selected.mode === "BOT_ACTIVE"
                      ? "Take over from WesBot before replying..."
                      : selected.status === "RESOLVED"
                        ? "Reopen this conversation before replying..."
                        : selected.assignedStaffId !== user?.id
                          ? `Handled by ${handlerName}. Take over to reply...`
                          : "Write a reply..."
                }
                disabled={!canReply || submitting}
                aria-describedby="staff-composer-status"
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-6 text-[#17211b] outline-none placeholder:text-[#8a948e] disabled:cursor-not-allowed disabled:text-[#69746e] sm:text-sm"
              />
              <Button
                type="submit"
                className="size-11 shrink-0 rounded-full p-0"
                disabled={submitting || !canReply || !reply.trim()}
                aria-busy={activeAction === "send"}
                aria-label={activeAction === "send" ? "Sending reply" : "Send reply"}
              >
                {activeAction === "send" ? <LoaderCircle className="size-[18px] motion-safe:animate-spin" aria-hidden="true" /> : <Send className="size-[18px]" aria-hidden="true" />}
              </Button>
            </form>
              <p className="mt-2 hidden px-1 text-[11px] text-[#88918b] sm:block">Press Enter to send, Shift+Enter for a new line.</p>
            </div>
          </div>
        ) : (
          <div className="hidden h-full place-items-center bg-[#f4f7f4] p-6 text-center lg:grid">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-white shadow-sm ring-1 ring-[#dce5dd]"><AssetIcon src="/assets/messages.svg" className="size-9" /></span>
              <p className="mt-3 font-extrabold text-[#17211b]">No conversation selected</p>
              <p className="mt-1 text-sm text-[#68746d]">Choose a student message from the inbox.</p>
            </div>
          </div>
        )}
      </section>
      {purgeDialog ? (
        <div
          className="fixed inset-0 z-[13000] grid place-items-center overflow-y-auto bg-[#101820]/60 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closePurgeDialog();
          }}
        >
          <section
            ref={purgeDialogA11y.dialogRef}
            {...purgeDialogA11y.dialogProps}
            role="alertdialog"
            aria-describedby={purgeDescriptionId}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl outline-none"
          >
            <div className="flex items-start gap-4 p-5 sm:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-700" aria-hidden="true">
                <ShieldAlert className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={purgeDialogA11y.titleId} className="text-lg font-extrabold leading-6 text-[#17211b]">Permanently purge this evidence?</h2>
                <div id={purgeDescriptionId} className="mt-2 space-y-3 text-sm leading-6 text-[#59655d]">
                  <p>This cannot be undone. The conversation, {purgeDialog.preview.messageCount} message{purgeDialog.preview.messageCount === 1 ? "" : "s"}, and {purgeDialog.preview.revisionCount} edit revision{purgeDialog.preview.revisionCount === 1 ? "" : "s"} will be removed.</p>
                  <p>A minimal audit tombstone will remain, without the subject, student identity, or message content.</p>
                  <p>Type <code className="select-all rounded bg-red-50 px-1.5 py-1 font-mono font-extrabold text-red-800">{purgeDialog.preview.confirmationPhrase}</code> exactly to continue.</p>
                </div>
                <label className="mt-4 block text-xs font-extrabold uppercase tracking-[0.12em] text-[#59655d]" htmlFor="permanent-purge-phrase">Confirmation phrase</label>
                <input
                  id="permanent-purge-phrase"
                  data-dialog-autofocus
                  autoComplete="off"
                  spellCheck={false}
                  value={purgePhrase}
                  onChange={(event) => setPurgePhrase(event.target.value)}
                  disabled={pendingAction?.type === "purge"}
                  className="mt-2 h-11 w-full rounded-lg border border-red-200 bg-white px-3 font-mono text-sm font-bold text-[#17211b] outline-none focus:border-red-600 focus:ring-2 focus:ring-red-200 disabled:opacity-60"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-red-100 bg-red-50/40 p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={pendingAction?.type === "purge"} onClick={closePurgeDialog}>Cancel</Button>
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-auto"
                disabled={pendingAction?.type === "purge" || purgePhrase !== purgeDialog.preview.confirmationPhrase}
                aria-busy={pendingAction?.type === "purge"}
                onClick={() => void confirmPermanentPurge()}
              >
                {pendingAction?.type === "purge" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                {pendingAction?.type === "purge" ? "Purging..." : "Permanently Purge"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
