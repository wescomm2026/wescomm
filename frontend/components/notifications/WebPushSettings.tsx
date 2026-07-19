"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, Send } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  disableWebPushNotifications,
  enableWebPushNotifications,
  getWebPushState,
  isWebPushSupported,
  sendWebPushTest,
  syncExistingWebPushSubscription,
  type PushCapabilityState
} from "@/lib/push-notifications";

function statusText(state: PushCapabilityState) {
  if (state === "granted") return "Enabled on this browser";
  if (state === "denied") return "Blocked in browser settings";
  if (state === "not-configured") return "Waiting for backend push keys";
  if (state === "unsupported") return "Not supported on this browser";
  return "Not enabled yet";
}

function statusClass(state: PushCapabilityState) {
  if (state === "granted") return "bg-[#e5f6e8] text-primary";
  if (state === "denied") return "bg-[#fff0f0] text-red-700";
  if (state === "not-configured") return "bg-[#fff5d9] text-[#956100]";
  return "bg-[#eef2ef] text-[#526058]";
}

export function WebPushSettings({ compact = false }: { compact?: boolean }) {
  const { user } = useStudentAuth();
  const [state, setState] = useState<PushCapabilityState>("default");
  const [busyAction, setBusyAction] = useState<"enable" | "disable" | "test" | "">("");
  const [message, setMessage] = useState("");
  const [stateOwnerId, setStateOwnerId] = useState("");
  const syncSequenceRef = useRef(0);
  const accountId = user?.id ?? "";
  const activeOwnerRef = useRef(accountId);
  activeOwnerRef.current = accountId;
  const visibleState = stateOwnerId === accountId ? state : "default";

  const refreshState = useCallback(async () => {
    if (!user?.accessToken || !accountId) return;
    const ownerId = accountId;

    try {
      const nextState = await getWebPushState();
      if (activeOwnerRef.current !== ownerId) return;
      setState(nextState);
      setStateOwnerId(ownerId);
    } catch {
      if (activeOwnerRef.current !== ownerId) return;
      setState(isWebPushSupported() ? "default" : "unsupported");
      setStateOwnerId(ownerId);
    }
  }, [accountId, user?.accessToken]);

  useEffect(() => {
    const accessToken = user?.accessToken;
    const syncSequence = ++syncSequenceRef.current;
    setState("default");
    setStateOwnerId(accountId);
    setMessage("");
    setBusyAction("");
    if (!accessToken || !accountId) return undefined;

    void syncExistingWebPushSubscription(accessToken).then((nextState) => {
      if (syncSequence !== syncSequenceRef.current) return;
      setState(nextState);
      setStateOwnerId(accountId);
    }).catch(() => {
      if (syncSequence !== syncSequenceRef.current) return;
      setState(isWebPushSupported() ? "default" : "unsupported");
      setStateOwnerId(accountId);
    });

    return () => {
      syncSequenceRef.current += 1;
    };
  }, [accountId, user?.accessToken]);

  const enable = async () => {
    if (!user?.accessToken || busyAction) return;
    const ownerId = accountId;
    setBusyAction("enable");
    setMessage("");

    try {
      await enableWebPushNotifications(user.accessToken);
      if (activeOwnerRef.current !== ownerId) return;
      setState("granted");
      setStateOwnerId(ownerId);
      setMessage("Phone notifications are enabled. A test notification was sent.");
    } catch (error) {
      if (activeOwnerRef.current !== ownerId) return;
      await refreshState();
      if (activeOwnerRef.current !== ownerId) return;
      setMessage(error instanceof Error ? error.message : "Unable to enable phone notifications.");
    } finally {
      if (activeOwnerRef.current === ownerId) setBusyAction("");
    }
  };

  const disable = async () => {
    if (!user?.accessToken || busyAction) return;
    const ownerId = accountId;
    setBusyAction("disable");
    setMessage("");

    try {
      await disableWebPushNotifications(user.accessToken);
      if (activeOwnerRef.current !== ownerId) return;
      await refreshState();
      if (activeOwnerRef.current !== ownerId) return;
      setMessage("Phone notifications were disabled on this browser.");
    } catch (error) {
      if (activeOwnerRef.current !== ownerId) return;
      setMessage(error instanceof Error ? error.message : "Unable to disable phone notifications.");
    } finally {
      if (activeOwnerRef.current === ownerId) setBusyAction("");
    }
  };

  const sendTest = async () => {
    if (!user?.accessToken || busyAction) return;
    const ownerId = accountId;
    setBusyAction("test");
    setMessage("");

    try {
      await sendWebPushTest(user.accessToken);
      if (activeOwnerRef.current !== ownerId) return;
      setMessage("Test notification sent.");
    } catch (error) {
      if (activeOwnerRef.current !== ownerId) return;
      setMessage(error instanceof Error ? error.message : "Unable to send a test notification.");
    } finally {
      if (activeOwnerRef.current === ownerId) setBusyAction("");
    }
  };

  const busy = Boolean(busyAction);
  const loadingCopy = {
    enable: {
      title: "Enabling phone notifications",
      detail: "We are registering this browser and sending a test notification."
    },
    disable: {
      title: "Disabling phone notifications",
      detail: "We are removing this browser from your notification devices."
    },
    test: {
      title: "Sending test notification",
      detail: "We are sending a notification to this browser."
    }
  } as const;
  const activeLoadingCopy = busyAction ? loadingCopy[busyAction] : null;
  const canEnable = visibleState === "default";
  const canDisable = visibleState === "granted";
  const canSendTest = visibleState === "granted";

  return (
    <section className={compact ? "relative rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm" : "relative rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm"}>
      <ActionLoadingOverlay
        active={busy}
        title={activeLoadingCopy?.title ?? ""}
        detail={activeLoadingCopy?.detail ?? ""}
      />
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
          <AssetIcon src="/assets/notifications.svg" className="size-8" />
        </span>
        <div className="min-w-0">
          <h2 className="font-extrabold text-[#17211b]">Phone notifications</h2>
          <p className="mt-1 text-sm leading-6 text-[#68746d]">
            Get reservation, receipt, support, and stock updates even when WESCOMM is not open.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold ${statusClass(visibleState)}`}>
          {visibleState === "granted" ? <Check className="size-4" /> : <Bell className="size-4" />}
          {statusText(visibleState)}
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          {canSendTest ? (
            <Button type="button" variant="secondary" className="h-10" onClick={sendTest} disabled={busy}>
              <Send className="size-4" />
              Send test
            </Button>
          ) : null}
          {canDisable ? (
            <Button type="button" variant="secondary" className="h-10 border-red-200 text-red-700 hover:bg-red-50" onClick={disable} disabled={busy}>
              <BellOff className="size-4" />
              Disable
            </Button>
          ) : (
            <Button type="button" className="h-10" onClick={enable} disabled={busy || !canEnable}>
              <Bell className="size-4" />
              Enable
            </Button>
          )}
        </div>
      </div>

      {message ? <p className="mt-3 rounded-md bg-[#f4f8f5] px-3 py-2 text-xs font-semibold leading-5 text-[#526058]">{message}</p> : null}
      {visibleState === "unsupported" ? (
        <p className="mt-3 text-xs leading-5 text-[#68746d]">
          On iPhone, add WESCOMM to the Home Screen first, then open it from the Home Screen icon before enabling notifications.
        </p>
      ) : null}
    </section>
  );
}
