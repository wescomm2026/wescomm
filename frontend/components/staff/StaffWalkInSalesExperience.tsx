"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import { getOperationalStudentsFromApi, isRequestAbortError, type BackendOperationalStudent } from "@/lib/api";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  getStaffProductsPage,
  getStoredStaffSession,
  listWalkInSales,
  recordWalkInSale,
  voidWalkInSale,
  type StaffProduct,
  type WalkInReceipt
} from "@/lib/staff-api";
import {
  backendReceiptStatusFilter,
  mergeUniqueById,
  Notice,
  PageHeading,
  Toolbar,
  formatStaffReceiptDate
} from "@/components/staff/StaffOperationsShared";

type CartRow = {
  key: string;
  product: StaffProduct;
  skuId: string;
  variantId: string;
  quantity: string;
};

let cartRowSequence = 0;
function nextCartRowKey() {
  cartRowSequence += 1;
  return `cart-${Date.now()}-${cartRowSequence}`;
}

function createClientSaleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatPeso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parsePeso(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function rowStock(row: CartRow) {
  if (row.product.skuInventoryEnabled) {
    const sku = row.product.skus?.find((entry) => entry.id === row.skuId);
    return sku ? sku.stock : null;
  }
  if (row.product.variants?.length) {
    const variant = row.product.variants.find((entry) => entry.id === row.variantId);
    return variant ? variant.stock : null;
  }
  return row.product.stock;
}

function rowLineTotal(row: CartRow) {
  const quantity = Number.parseInt(row.quantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(Number(row.product.price) * quantity * 100) / 100;
}

function VoidWalkInSaleModal({
  receipt,
  submitting,
  reason,
  onReasonChange,
  onClose,
  onConfirm
}: {
  receipt: WalkInReceipt | null;
  submitting: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(Boolean(receipt), onClose);
  if (!receipt) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 id={titleId} className="text-xl font-extrabold text-foreground">Void walk-in sale</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-subtle">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Voiding <span className="font-bold text-foreground">{receipt.receiptCode}</span> returns every item back to inventory
          and marks the receipt voided. This cannot be undone.
        </p>
        <label className="mt-4 grid gap-1.5 text-sm font-semibold">
          Reason (required)
          <textarea
            data-dialog-autofocus
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="e.g. Wrong item handed, payment did not push through"
            className="rounded-md border border-border-strong px-3 py-2 outline-none focus:border-primary"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting || reason.trim().length < 5}
            loading={submitting}
            onClick={onConfirm}
          >
            Void & restore stock
          </Button>
        </div>
      </div>
    </div>
  );
}

function SaleSuccessModal({
  receipt,
  cashReceived,
  onClose
}: {
  receipt: WalkInReceipt | null;
  cashReceived: number | null;
  onClose: () => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(Boolean(receipt), onClose);
  if (!receipt) return null;
  const total = Number(receipt.totalAmount);
  const change = cashReceived !== null ? Math.round((cashReceived - total) * 100) / 100 : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Check className="size-6" />
          </span>
          <div>
            <h2 id={titleId} className="text-xl font-extrabold text-foreground">Sale recorded</h2>
            <p className="text-sm text-muted-foreground">Stock has been deducted and the receipt is verified.</p>
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Receipt code</span>
            <span className="font-extrabold">{receipt.receiptCode}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Student</span>
            <span className="font-bold">{receipt.student.fullName}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-extrabold text-primary">{formatPeso(total)}</span>
          </div>
          {cashReceived !== null ? (
            <>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash received</span>
                <span className="font-bold">{formatPeso(cashReceived)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Change</span>
                <span className="font-extrabold">{formatPeso(change ?? 0)}</span>
              </div>
            </>
          ) : null}
        </div>
        <div className="mt-5">
          <Button type="button" className="w-full" data-dialog-autofocus onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StaffWalkInSalesExperience() {
  const [token, setToken] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<StaffProduct[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<BackendOperationalStudent[]>([]);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<BackendOperationalStudent | null>(null);
  const [receiptCode, setReceiptCode] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [successReceipt, setSuccessReceipt] = useState<WalkInReceipt | null>(null);
  const [successCashReceived, setSuccessCashReceived] = useState<number | null>(null);

  const [history, setHistory] = useState<WalkInReceipt[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("All");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<WalkInReceipt | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState("");

  const deferredHistorySearch = useDeferredValue(historySearch);
  const historyRequestRef = useRef(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const productRequestRef = useRef(0);
  const productAbortRef = useRef<AbortController | null>(null);
  const studentRequestRef = useRef(0);
  const studentAbortRef = useRef<AbortController | null>(null);
  const clientSaleIdRef = useRef(createClientSaleId());
  const { ready } = useStudentAuth();

  useEffect(() => {
    if (!ready) return;
    const session = getStoredStaffSession();
    setToken(session.token);
  }, [ready]);

  const loadHistory = async (options: { cursor?: string | null; background?: boolean } = {}) => {
    const session = getStoredStaffSession();
    if (!session.token) {
      setHistoryLoading(false);
      return;
    }
    const requestId = ++historyRequestRef.current;
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    if (options.cursor) setHistoryLoadingMore(true);
    else if (!options.background) {
      setHistoryLoading(true);
      setHistoryError("");
    }
    try {
      const page = await listWalkInSales(session.token, {
        limit: 20,
        cursor: options.cursor,
        query: deferredHistorySearch,
        status: backendReceiptStatusFilter(historyStatus),
        signal: controller.signal
      });
      if (requestId !== historyRequestRef.current) return;
      setHistory((current) => {
        const source = options.cursor ? [...current, ...page.items] : page.items;
        return mergeUniqueById(source);
      });
      setHistoryNextCursor(page.nextCursor);
    } catch (loadError) {
      if (requestId !== historyRequestRef.current || isRequestAbortError(loadError)) return;
      setHistoryError(userFacingErrorMessage(loadError, "Unable to load walk-in sales."));
    } finally {
      if (requestId === historyRequestRef.current) {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    }
  };

  useRealtimeRefresh(["receipts", "inventory"], () => {
    void loadHistory({ background: true });
  });

  useEffect(() => {
    if (!ready) return;
    void loadHistory();
    return () => historyAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, deferredHistorySearch, historyStatus]);

  useEffect(() => {
    if (!productSearch.trim()) {
      productRequestRef.current += 1;
      productAbortRef.current?.abort();
      setProductResults([]);
      return;
    }
    const session = getStoredStaffSession();
    if (!session.token) return;
    const requestId = ++productRequestRef.current;
    productAbortRef.current?.abort();
    const controller = new AbortController();
    productAbortRef.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const page = await getStaffProductsPage(session.token, {
          limit: 8,
          query: productSearch,
          signal: controller.signal
        });
        if (requestId !== productRequestRef.current) return;
        setProductResults(page.products);
        setProductPickerOpen(true);
      } catch (searchError) {
        if (!isRequestAbortError(searchError)) setProductResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [productSearch]);

  useEffect(() => {
    if (!studentSearch.trim()) {
      studentRequestRef.current += 1;
      studentAbortRef.current?.abort();
      setStudentResults([]);
      return;
    }
    const session = getStoredStaffSession();
    if (!session.token) return;
    const requestId = ++studentRequestRef.current;
    studentAbortRef.current?.abort();
    const controller = new AbortController();
    studentAbortRef.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const page = await getOperationalStudentsFromApi(session.token, {
          limit: 8,
          query: studentSearch,
          signal: controller.signal
        });
        if (requestId !== studentRequestRef.current) return;
        setStudentResults(page.items);
        setStudentPickerOpen(true);
      } catch (searchError) {
        if (!isRequestAbortError(searchError)) setStudentResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [studentSearch]);

  const addProduct = (product: StaffProduct) => {
    setCart((current) => [...current, {
      key: nextCartRowKey(),
      product,
      skuId: "",
      variantId: "",
      quantity: "1"
    }]);
    setProductSearch("");
    setProductResults([]);
    setProductPickerOpen(false);
  };

  const updateCartRow = (key: string, update: Partial<Omit<CartRow, "key" | "product">>) => {
    setCart((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
  };

  const removeCartRow = (key: string) => {
    setCart((current) => current.filter((row) => row.key !== key));
  };

  const cartValid = cart.length > 0
    && cart.every((row) => {
      const quantity = Number.parseInt(row.quantity, 10);
      if (!Number.isFinite(quantity) || quantity <= 0) return false;
      if (row.product.skuInventoryEnabled) return Boolean(row.skuId);
      if (row.product.variants?.length) return Boolean(row.variantId);
      return true;
    });

  const cartTotal = Math.round(cart.reduce((total, row) => total + rowLineTotal(row), 0) * 100) / 100;
  const cashReceivedValue = parsePeso(cashReceived);
  const cashValid = cashReceivedValue !== null && cashReceivedValue >= cartTotal;
  const changeDue = cashReceivedValue !== null && cashValid
    ? Math.round((cashReceivedValue - cartTotal) * 100) / 100
    : null;

  const recordSale = async () => {
    if (!cartValid || !selectedStudent || !cashValid) {
      setSaleError("Complete every item and enter the cash received before saving.");
      return;
    }
    setSubmitting(true);
    setSaleError("");
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setSaleError("Your staff session has expired. Refresh the page and sign in again.");
      setSubmitting(false);
      return;
    }
    try {
      const receipt = await recordWalkInSale(sessionToken, {
        items: cart.map((row) => ({
          productId: row.product.id,
          skuId: row.skuId || undefined,
          variantId: row.variantId || undefined,
          quantity: Number.parseInt(row.quantity, 10)
        })),
        studentId: selectedStudent.id,
        receiptCode: receiptCode.trim() || undefined,
        cashReceived: cashReceivedValue ?? 0,
        clientSaleId: clientSaleIdRef.current
      });
      setSuccessCashReceived(cashReceivedValue);
      setSuccessReceipt(receipt);
      setCart([]);
      setSelectedStudent(null);
      setStudentSearch("");
      setReceiptCode("");
      setCashReceived("");
      clientSaleIdRef.current = createClientSaleId();
      setNotice(`${receipt.receiptCode} recorded for ${receipt.student.fullName}.`);
      void loadHistory({ background: true });
    } catch (submitError) {
      setSaleError(userFacingErrorMessage(submitError, "Unable to record the walk-in sale."));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setSaleError("");
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setSaleError("Your staff session has expired. Refresh the page and sign in again.");
      setVoiding(false);
      return;
    }
    try {
      const updated = await voidWalkInSale(sessionToken, voidTarget.id, voidReason);
      setHistory((current) => current.map((receipt) => receipt.id === updated.id ? updated : receipt));
      setNotice(`${updated.receiptCode} voided and stock restored.`);
      setVoidTarget(null);
      setVoidReason("");
    } catch (voidError) {
      setSaleError(userFacingErrorMessage(voidError, "Unable to void the walk-in sale."));
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Walk-in sales"
        title="Record physical-store purchases"
        detail="Sell products over the counter, deduct stock immediately, and issue a cash receipt."
        action={<Button variant="secondary" onClick={() => void loadHistory()} disabled={historyLoading}>Refresh</Button>}
      />

      <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
          <Plus className="size-5 text-primary" /> New walk-in sale
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Cash payments only. Every item below is deducted from inventory when the sale is saved.</p>

        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            {cart.map((row) => {
              const stock = rowStock(row);
              const lineTotal = rowLineTotal(row);
              return (
                <div key={row.key} className="rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold">{row.product.name}</p>
                      <p className="text-xs text-muted-foreground">{formatPeso(Number(row.product.price))} each</p>
                      {stock !== null ? <p className="mt-1 text-xs font-semibold text-muted-foreground">Available: {stock} pc(s)</p> : null}
                    </div>
                    <button type="button" onClick={() => removeCartRow(row.key)} aria-label={`Remove ${row.product.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="size-5" />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_110px]">
                    {row.product.skuInventoryEnabled ? (
                      <label className="grid gap-1.5 text-xs font-semibold">
                        Combination
                        <select
                          value={row.skuId}
                          onChange={(event) => updateCartRow(row.key, { skuId: event.target.value })}
                          className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 font-normal outline-none focus:border-primary"
                        >
                          <option value="">Choose a combination</option>
                          {(row.product.skus ?? []).map((sku) => (
                            <option key={sku.id} value={sku.id} disabled={sku.stock <= 0}>
                              {sku.options.map((option) => option.optionValue).join(" / ")} — {sku.stock} pc(s)
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {!row.product.skuInventoryEnabled && (row.product.variants?.length ?? 0) > 0 ? (
                      <label className="grid gap-1.5 text-xs font-semibold">
                        Option
                        <select
                          value={row.variantId}
                          onChange={(event) => updateCartRow(row.key, { variantId: event.target.value })}
                          className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 font-normal outline-none focus:border-primary"
                        >
                          <option value="">Choose an option</option>
                          {(row.product.variants ?? []).map((variant) => (
                            <option key={variant.id} value={variant.id} disabled={variant.stock <= 0}>
                              {variant.optionValue} — {variant.stock} pc(s)
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="grid gap-1.5 text-xs font-semibold">
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max="10000000"
                        step="1"
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(event) => updateCartRow(row.key, { quantity: event.target.value })}
                        className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-center font-normal outline-none focus:border-primary"
                      />
                    </label>
                    <div className="flex items-end justify-end pb-1 text-sm font-extrabold text-primary">
                      {formatPeso(lineTotal)}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="relative">
              <label className="flex h-11 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
                <Search className="mr-2 size-5 text-[#68746d]" />
                <input
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  onFocus={() => productResults.length && setProductPickerOpen(true)}
                  placeholder="Search product to add..."
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              {productPickerOpen && productResults.length ? (
                <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-[#d7e1d8] bg-white shadow-lg">
                  {productResults.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => addProduct(product)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#eef6ee]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{product.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatPeso(Number(product.price))} · {product.stock} pc(s) available
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-primary" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {!cart.length ? <p className="text-sm text-muted-foreground">No items yet. Search and add the products the student bought at the booth.</p> : null}
          </div>

          <aside className="space-y-4 rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
            <div className="relative">
              <label className="grid gap-1.5 text-xs font-semibold">
                Student (search by name or student number)
                <input
                  value={selectedStudent ? `${selectedStudent.fullName}${selectedStudent.studentNumber ? ` — ${selectedStudent.studentNumber}` : ""}` : studentSearch}
                  onChange={(event) => {
                    setSelectedStudent(null);
                    setStudentSearch(event.target.value);
                  }}
                  onFocus={() => studentResults.length && setStudentPickerOpen(true)}
                  placeholder="Type to search students"
                  className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 font-normal outline-none focus:border-primary"
                />
              </label>
              {studentPickerOpen && studentResults.length ? (
                <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-[#d7e1d8] bg-white shadow-lg">
                  {studentResults.map((student) => (
                    <li key={student.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStudent(student);
                          setStudentSearch("");
                          setStudentResults([]);
                          setStudentPickerOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#eef6ee]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{student.fullName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {student.studentNumber ?? "No student number"}{student.department ? ` · ${student.department}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <label className="grid gap-1.5 text-xs font-semibold">
              Receipt code (optional — auto-generated if blank)
              <input
                value={receiptCode}
                onChange={(event) => setReceiptCode(event.target.value.toUpperCase())}
                maxLength={64}
                placeholder="e.g. RCT-2026-00001"
                className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 font-normal uppercase outline-none focus:border-primary"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold">
              Cash received (PHP)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
                placeholder="0.00"
                className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 font-normal outline-none focus:border-primary"
              />
            </label>

            <dl className="grid grid-cols-[1fr_auto] gap-y-2 border-t border-[#e5ebe6] pt-3 text-sm">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-extrabold text-foreground">{formatPeso(cartTotal)}</dd>
              {cashValid && changeDue !== null ? (
                <>
                  <dt className="text-muted-foreground">Change</dt>
                  <dd className="font-extrabold text-primary">{formatPeso(changeDue)}</dd>
                </>
              ) : null}
            </dl>
            {!cashValid && cashReceived.trim() ? (
              <p className="text-xs font-semibold text-red-700">Cash received must cover the total.</p>
            ) : null}

            {saleError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{saleError}</p> : null}

            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={!cartValid || !selectedStudent || !cashValid || submitting}
              loading={submitting}
              onClick={() => void recordSale()}
            >
              Save sale & deduct stock
            </Button>
          </aside>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold text-foreground">Recent walk-in sales</h2>
        <Toolbar
          search={historySearch}
          onSearch={setHistorySearch}
          status={historyStatus}
          onStatus={setHistoryStatus}
          placeholder="Search receipt code, student, or item"
          statuses={["Verified", "Voided"]}
        />
        {historyError ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{historyError}</p> : null}
        {historyLoading ? (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading walk-in sales...</div>
        ) : history.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {history.map((receipt) => (
              <article key={receipt.id} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div>
                    <p className="font-extrabold">{receipt.receiptCode}</p>
                    <p className="text-xs text-[#68746d]">{formatStaffReceiptDate(receipt.issuedAt)}</p>
                  </div>
                  <span className="ml-auto"><StatusBadge statusKey={receipt.status} /></span>
                </div>
                <dl className="mt-5 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                  <dt className="text-[#68746d]">Student</dt>
                  <dd className="font-bold">{receipt.student.fullName}</dd>
                  <dt className="text-[#68746d]">Items</dt>
                  <dd className="text-right font-bold">
                    {receipt.items.length > 1
                      ? `${receipt.items[0].productName} + ${receipt.items.length - 1} more`
                      : receipt.items[0]?.productName ?? "Walk-in item"}
                  </dd>
                  <dt className="text-[#68746d]">Payment</dt>
                  <dd className="font-bold">Cash</dd>
                  <dt className="text-[#68746d]">Total</dt>
                  <dd className="font-extrabold text-primary">{formatPeso(Number(receipt.totalAmount))}</dd>
                </dl>
                {receipt.items.length ? (
                  <div className="mt-4 rounded-md bg-[#fbfdfb] p-3">
                    {receipt.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                        <span className="min-w-0 truncate font-semibold">
                          {item.quantity}× {item.productName}
                          {item.options.length ? ` (${item.options.map((option) => option.optionValue).join(" / ")})` : ""}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{formatPeso(Number(item.subtotal))}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {receipt.status !== "VOIDED" ? (
                  <div className="mt-5">
                    <Button
                      variant="ghost"
                      disabled={voiding}
                      className="w-full border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      onClick={() => {
                        setVoidReason("");
                        setVoidTarget(receipt);
                      }}
                    >
                      <Trash2 className="size-4" />
                      Void & restore stock
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
            No walk-in sales recorded yet.
          </div>
        )}
        {historyNextCursor ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              disabled={historyLoadingMore}
              onClick={() => void loadHistory({ cursor: historyNextCursor })}
            >
              {historyLoadingMore ? "Loading more..." : "Load more sales"}
            </Button>
          </div>
        ) : null}
      </section>

      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      <SaleSuccessModal
        receipt={successReceipt}
        cashReceived={successCashReceived}
        onClose={() => {
          setSuccessReceipt(null);
          setSuccessCashReceived(null);
        }}
      />
      <VoidWalkInSaleModal
        receipt={voidTarget}
        submitting={voiding}
        reason={voidReason}
        onReasonChange={setVoidReason}
        onClose={() => {
          setVoidTarget(null);
          setVoidReason("");
        }}
        onConfirm={() => void confirmVoid()}
      />
    </div>
  );
}
