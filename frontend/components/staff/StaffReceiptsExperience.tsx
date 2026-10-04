"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Check, Eye, RefreshCw, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getReceiptPageFromApi,
  markReceiptVerifiedFromApi,
  type BackendReceipt,
  voidReceiptFromApi
} from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import {
  mergeUniqueById,
  StaffReceiptRow,
  backendReceiptStatusFilter,
  mapStaffReceipt,
  PageHeading,
  Toolbar,
  Notice,
  StaffReceiptPreviewModal,
  ReceiptActionModal
} from "@/components/staff/StaffOperationsShared";

export function StaffReceiptsExperience() {
  const [rows, setRows] = useState<StaffReceiptRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [paymentChannel, setPaymentChannel] = useState<"ALL" | "ONLINE_GCASH" | "AT_COMMISSARY">("ALL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<StaffReceiptRow | null>(null);
  const [receiptAction, setReceiptAction] = useState<{ type: "verify" | "void"; row: StaffReceiptRow } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const deferredSearch = useDeferredValue(search);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadReceipts = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    const session = getStoredStaffSession();
    if (!session.token) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (cursor) setLoadingMore(true);
    else if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const page = await getReceiptPageFromApi(session.token, {
        limit: 25,
        cursor,
        status: backendReceiptStatusFilter(status),
        query: deferredSearch,
        paymentChannel: paymentChannel === "ALL" ? undefined : paymentChannel,
        signal: requestController.signal
      });
      if (requestId !== requestSequenceRef.current) return;
      const mappedReceipts = page.items.map(mapStaffReceipt);
      setRows((current) => {
        if (!cursor && !background) return mappedReceipts;
        const source = cursor ? [...current, ...mappedReceipts] : [...mappedReceipts, ...current];
        return mergeUniqueById(source);
      });
      setNextCursor(page.nextCursor);
      const receiptId = new URL(window.location.href).searchParams.get("receiptId");
      const targetedReceipt = mappedReceipts.find((receipt) => receipt.id === receiptId);
      if (targetedReceipt) {
        setSearch(targetedReceipt.code);
        setSelectedReceipt(targetedReceipt);
      }
    } catch (receiptError) {
      if (requestId === requestSequenceRef.current && !background) {
        setError(userFacingErrorMessage(receiptError, "Unable to load receipts."));
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        if (cursor) setLoadingMore(false);
        if (!background) setLoading(false);
      }
    }
  }, [deferredSearch, paymentChannel, status]);

  useRealtimeRefresh(["receipts"], () => {
    void loadReceipts({ background: true });
  });

  useEffect(() => {
    void loadReceipts();
    return () => requestAbortRef.current?.abort();
  }, [loadReceipts]);

  useEffect(() => {
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReceipts({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 5 * 60_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadReceipts]);

  const filtered = rows;

  const applyReceiptUpdate = (receipt: BackendReceipt) => {
    const mappedReceipt = mapStaffReceipt(receipt);
    setRows((current) => current.map((item) => item.id === mappedReceipt.id ? mappedReceipt : item));
    setSelectedReceipt((current) => current?.id === mappedReceipt.id ? mappedReceipt : current);
    setReceiptAction(null);
    setVoidReason("");
    return mappedReceipt;
  };

  const verifyReceipt = async (row: StaffReceiptRow) => {
    const session = getStoredStaffSession();
    if (!session.token) return;

    setSubmittingId(row.id);
    setError("");

    try {
      const updatedReceipt = await markReceiptVerifiedFromApi(session.token, row.id);
      applyReceiptUpdate(updatedReceipt);
      setNotice(`${row.code} verified.`);
    } catch (receiptError) {
      setError(userFacingErrorMessage(receiptError, "Unable to verify the receipt."));
    } finally {
      setSubmittingId("");
    }
  };

  const voidSelectedReceipt = async (row: StaffReceiptRow) => {
    const session = getStoredStaffSession();
    if (!session.token) return;

    setSubmittingId(row.id);
    setError("");

    try {
      const updatedReceipt = await voidReceiptFromApi(session.token, row.id, voidReason);
      applyReceiptUpdate(updatedReceipt);
      setNotice(`${row.code} voided.`);
    } catch (receiptError) {
      setError(userFacingErrorMessage(receiptError, "Unable to void the receipt."));
    } finally {
      setSubmittingId("");
    }
  };

  const askVerify = (row: StaffReceiptRow) => {
    setVoidReason("");
    setReceiptAction({ type: "verify", row });
  };

  const askVoid = (row: StaffReceiptRow) => {
    setVoidReason("");
    setReceiptAction({ type: "void", row });
  };

  const confirmReceiptAction = () => {
    if (!receiptAction) return;
    if (receiptAction.type === "verify") {
      void verifyReceipt(receiptAction.row);
      return;
    }
    void voidSelectedReceipt(receiptAction.row);
  };

  const filtersActive = Boolean(search.trim()) || status !== "All" || paymentChannel !== "ALL";

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Receipt verification"
        title="Verify digital receipts"
        detail="Review completed reservation receipts and record official verification."
        action={(
          <Button variant="secondary" onClick={() => void loadReceipts()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" /> Refresh
          </Button>
        )}
      />
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search receipt, student, reservation, or item" statuses={["Pending", "Verified", "Voided"]}>
        <label className="flex h-11 items-center gap-2 rounded-control border border-border-strong bg-white px-3 text-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <span className="shrink-0 text-xs font-bold text-muted-foreground">Payment</span>
          <select
            value={paymentChannel}
            onChange={(event) => setPaymentChannel(event.target.value as typeof paymentChannel)}
            aria-label="Filter by payment method"
            className="h-full min-w-0 flex-1 cursor-pointer bg-transparent font-semibold text-foreground outline-none focus-visible:outline-none"
          >
            <option value="ALL">All Payments</option>
            <option value="ONLINE_GCASH">Legacy GCash – Online</option>
            <option value="AT_COMMISSARY">In-person payments</option>
          </select>
        </label>
      </Toolbar>
      {error ? <InlineAlert onDismiss={() => setError("")}>{error}</InlineAlert> : null}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-busy="true">
          <span className="sr-only">Loading live receipt queue...</span>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-4 rounded-xl border bg-card p-5 shadow-soft" aria-hidden="true">
              <div className="flex items-center gap-3"><Skeleton className="size-10 rounded-lg" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <article key={row.id} className="content-visibility-auto flex flex-col rounded-xl border bg-card shadow-soft">
              <header className="flex items-start gap-3 border-b px-5 py-4">
                <AssetIcon src="/assets/digital-receipts.svg" className="size-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono font-extrabold text-foreground">{row.code}</p>
                  <p className="text-xs text-muted-foreground">{row.date}</p>
                </div>
                <StatusBadge status={row.status} />
              </header>
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm">
                <dt className="text-muted-foreground">Buyer</dt>
                <dd className="min-w-0 truncate text-right font-bold text-foreground">{row.student}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="min-w-0 truncate text-right font-bold text-foreground">{row.reference}</dd>
                <dt className="text-muted-foreground">Items</dt>
                <dd className="min-w-0 text-right font-bold text-foreground">{row.items}</dd>
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="min-w-0 truncate text-right font-bold text-foreground">{row.payment}</dd>
                <div className="col-span-2 my-1 border-t" aria-hidden="true" />
                <dt className="self-center font-bold text-foreground">Total</dt>
                <dd className="text-right text-lg font-extrabold tabular-nums text-primary">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </dl>
              <div className="grid gap-2 border-t bg-surface-subtle px-5 py-4">
                <div className={row.backendStatus === "PENDING" ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
                  <Button variant="secondary" className="w-full" onClick={() => setSelectedReceipt(row)}>
                    <Eye className="size-4" />
                    Preview details
                  </Button>
                  {row.backendStatus === "PENDING" ? (
                    <Button disabled={submittingId === row.id} className="w-full" onClick={() => askVerify(row)}>
                      <Check className="size-4" />
                      {submittingId === row.id ? "Verifying..." : "Verify receipt"}
                    </Button>
                  ) : null}
                </div>
                {row.backendStatus !== "VOIDED" ? (
                  <Button
                    variant="ghost"
                    disabled={submittingId === row.id}
                    className="w-full text-danger hover:bg-danger/5"
                    onClick={() => askVoid(row)}
                  >
                    <Trash2 className="size-4" />
                    {submittingId === row.id ? "Saving..." : "Void receipt"}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <FeedbackState
          kind="empty"
          title="No matching receipts found"
          description={filtersActive ? "Try another search, status, or payment filter." : "Receipts appear here after reservations and walk-in sales are completed."}
          action={filtersActive ? <Button variant="secondary" size="sm" onClick={() => { setSearch(""); setStatus("All"); setPaymentChannel("ALL"); }}>Clear filters</Button> : undefined}
        />
      )}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            loading={loadingMore}
            onClick={() => void loadReceipts({ cursor: nextCursor })}
          >
            {loadingMore ? "Loading more..." : "Load more receipts"}
          </Button>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      <StaffReceiptPreviewModal
        row={selectedReceipt}
        submitting={Boolean(submittingId)}
        onClose={() => setSelectedReceipt(null)}
        onAskVerify={askVerify}
        onAskVoid={askVoid}
      />
      <ReceiptActionModal
        action={receiptAction}
        reason={voidReason}
        submitting={Boolean(submittingId)}
        onReasonChange={setVoidReason}
        onClose={() => {
          setReceiptAction(null);
          setVoidReason("");
        }}
        onConfirm={confirmReceiptAction}
      />
    </div>
  );
}
