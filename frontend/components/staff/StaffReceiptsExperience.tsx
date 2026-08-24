"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Check, Eye, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
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
        setError(receiptError instanceof Error ? receiptError.message : "Unable to load receipts.");
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        if (cursor) setLoadingMore(false);
        if (!background) setLoading(false);
      }
    }
  }, [deferredSearch, status]);

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
      setError(receiptError instanceof Error ? receiptError.message : "Unable to verify receipt.");
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
      setError(receiptError instanceof Error ? receiptError.message : "Unable to void receipt.");
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

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Receipt verification"
        title="Verify digital receipts"
        detail="Review completed reservation receipts and record official verification."
        action={<Button variant="secondary" onClick={() => void loadReceipts()} disabled={loading}>Refresh</Button>}
      />
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search receipt, student, reservation, or item" statuses={["Pending", "Verified", "Voided"]} />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? (
        <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live receipt queue...</div>
      ) : filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <article key={row.id} className="content-visibility-auto rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <AssetIcon src="/assets/digital-receipts.svg" className="size-11" />
                <div>
                  <p className="font-extrabold">{row.code}</p>
                  <p className="text-xs text-[#68746d]">{row.date}</p>
                </div>
                <span className="ml-auto"><StatusBadge status={row.status} /></span>
              </div>
              <dl className="mt-5 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt className="text-[#68746d]">Student</dt>
                <dd className="font-bold">{row.student}</dd>
                <dt className="text-[#68746d]">Reservation</dt>
                <dd className="font-bold">{row.reference}</dd>
                <dt className="text-[#68746d]">Items</dt>
                <dd className="text-right font-bold">{row.items}</dd>
                <dt className="text-[#68746d]">Payment</dt>
                <dd className="font-bold">{row.payment}</dd>
                <dt className="text-[#68746d]">Total</dt>
                <dd className="font-extrabold text-primary">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </dl>
              <div className="mt-5 grid gap-2">
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
                {row.backendStatus !== "VOIDED" ? (
                  <Button
                    variant="ghost"
                    disabled={submittingId === row.id}
                    className="w-full border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
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
        <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
          No matching receipts found.
        </div>
      )}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
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
