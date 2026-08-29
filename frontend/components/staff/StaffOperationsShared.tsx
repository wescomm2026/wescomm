"use client";

import Image from "next/image";
import { Check, Filter, Headphones, Search, Trash2, X } from "lucide-react";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  type BackendConversation,
  type BackendConversationMessage,
  type BackendReceipt,
  type BackendReceiptStatus,
  type BackendPaymentMethod,
  type BackendReservation,
  type BackendReservationStatus
} from "@/lib/api";
import { type ProductSaleMode, type StaffProduct } from "@/lib/staff-api";
import { resolveShopProductAsset } from "@/lib/shop-assets";
import { cn } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-method";

export function mergeUniqueById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  items.forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return Array.from(byId.values());
}

export type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  imageStoragePath: string | null;
  stock: number;
  minimum: number;
  price: number;
  oldPrice: number | null;
  status: string;
  saleMode: ProductSaleMode;
  skuInventoryEnabled: boolean;
  inventoryReconciledAt: string | null;
  skus: Array<{
    id: string;
    code?: string | null;
    stock: number;
    lowStockThreshold: number;
    variantIds: string[];
    options: Array<{ optionName: string; optionValue: string }>;
  }>;
  variants: Array<{
    id: string;
    optionName: string;
    optionValue: string;
    stock: number;
    lowStockThreshold: number;
  }>;
};

export const stockStatusOptions = ["Available", "Needs Restock", "Out of Stock", "On Sale"];
export const DEFAULT_SIZE_VARIANTS = ["Small", "Medium", "Large", "XL", "2XL"] as const;
export const SIZE_SORT_ORDER = ["xxs", "xs", "small", "s", "medium", "m", "large", "l", "xl", "2xl", "xxl", "3xl", "xxxl", "4xl", "xxxxl", "5xl"] as const;

export type SizeVariantDraft = {
  key: string;
  id?: string;
  value: string;
  stock: string;
  lowStockThreshold: string;
};

export type ManageSection = "menu" | "details" | "image" | "selling" | "sizes" | "options";

export function variantDraftKey(value: string) {
  return `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSizeVariantDrafts(): SizeVariantDraft[] {
  return DEFAULT_SIZE_VARIANTS.map((value) => ({
    key: variantDraftKey(value),
    value,
    stock: "0",
    lowStockThreshold: "2"
  }));
}

export function sizeSortRank(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const index = SIZE_SORT_ORDER.indexOf(normalized as typeof SIZE_SORT_ORDER[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function sortSizeVariants<T extends { optionValue: string }>(variants: T[]) {
  return [...variants].sort((left, right) => {
    const rank = sizeSortRank(left.optionValue) - sizeSortRank(right.optionValue);
    return rank || left.optionValue.localeCompare(right.optionValue, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function preferredSizeOptionName(variants: Product["variants"]) {
  return variants.find((variant) => variant.optionName.trim().toLowerCase() === "size")?.optionName
    ?? variants.find((variant) => variant.optionName.toLowerCase().includes("size"))?.optionName
    ?? "Size";
}

export type StaffReservationRow = {
  id: string;
  reference: string;
  student: string;
  item: string;
  quantity: number;
  pickup: string;
  payment: string;
  onlineGcash: boolean;
  paymentStatus: string;
  paymentConfirmed: boolean;
  total: number;
  status: string;
  backendStatus: BackendReservationStatus;
  pickupEnd: string | null;
  pickupReviewStatus: BackendReservation["pickupReviewStatus"];
  pickupReviewReason: string | null;
  scheduleRevision: number;
  reservation: BackendReservation;
};

export type StaffReceiptRow = {
  id: string;
  code: string;
  student: string;
  date: string;
  reference: string;
  payment: string;
  items: string;
  itemCount: number;
  total: number;
  status: string;
  backendStatus: BackendReceiptStatus;
  verifiedBy: string;
  receipt: BackendReceipt;
};

export function numericValue(value: StaffProduct["price"]) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function staffStatusLabel(product: StaffProduct) {
  if (product.status === "OUT_OF_STOCK") return "Out of Stock";
  if (product.status === "ON_SALE") return "On Sale";
  if (product.status === "RESTOCK_SOON" || product.stock <= product.lowStockThreshold) return "Needs Restock";
  return "Available";
}

export function stockStatusFromQuery(value: string | null) {
  if (value === "low-stock" || value === "needs-restock") return "Needs Restock";
  if (value === "in-stock" || value === "available") return "Available";
  if (value === "out-of-stock") return "Out of Stock";
  if (value === "on-sale") return "On Sale";
  return "All";
}

export function stockStatusForApi(value: string): StaffProduct["status"] | undefined {
  if (value === "Available") return "IN_STOCK";
  if (value === "Needs Restock") return "RESTOCK_SOON";
  if (value === "Out of Stock") return "OUT_OF_STOCK";
  if (value === "On Sale") return "ON_SALE";
  return undefined;
}

export function mapStaffProduct(product: StaffProduct): Product {
  const categoryName = product.category?.name ?? "Uncategorized";
  const asset = resolveShopProductAsset(product.name, product.imageUrl, categoryName);

  return {
    id: product.id,
    name: asset.name,
    category: categoryName,
    description: product.description ?? "",
    imageUrl: asset.image,
    imageStoragePath: product.imageStoragePath ?? null,
    stock: product.stock,
    minimum: product.lowStockThreshold,
    price: numericValue(product.price),
    oldPrice: product.oldPrice === null || product.oldPrice === undefined ? null : numericValue(product.oldPrice),
    status: staffStatusLabel(product),
    saleMode: product.saleMode ?? "SIMPLE",
    skuInventoryEnabled: Boolean(product.skuInventoryEnabled),
    inventoryReconciledAt: product.inventoryReconciledAt ?? null,
    skus: (product.skus ?? []).map((sku) => ({
      id: sku.id,
      code: sku.code,
      stock: sku.stock,
      lowStockThreshold: sku.lowStockThreshold,
      variantIds: sku.variantIds ?? [],
      options: sku.options ?? []
    })),
    variants: (product.variants ?? []).flatMap((variant) => variant.id ? [{
      id: variant.id,
      optionName: variant.optionName,
      optionValue: variant.optionValue,
      stock: variant.stock,
      lowStockThreshold: variant.lowStockThreshold
    }] : []).sort((left, right) => {
      if (left.optionName.toLowerCase() !== right.optionName.toLowerCase()) return left.optionName.localeCompare(right.optionName);
      return sizeSortRank(left.optionValue) - sizeSortRank(right.optionValue)
        || left.optionValue.localeCompare(right.optionValue, undefined, { numeric: true, sensitivity: "base" });
    })
  };
}

export function formatReservationStatus(status: BackendReservationStatus) {
  const labels: Record<BackendReservationStatus, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    READY_FOR_PICKUP: "Ready for Pick-up",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show"
  };

  return labels[status];
}

export function backendReservationStatusFilter(status: string) {
  const statuses: Record<string, BackendReservationStatus> = {
    Pending: "PENDING",
    Confirmed: "CONFIRMED",
    "Ready for Pick-up": "READY_FOR_PICKUP",
    Completed: "COMPLETED",
    Cancelled: "CANCELLED",
    "No-show": "NO_SHOW"
  };
  return statuses[status];
}

export function formatStaffPickup(startValue: string | null, endValue: string | null) {
  if (!startValue || !endValue) return "Pending schedule";

  const date = new Date(startValue).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
  });
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  };
  const start = new Date(startValue).toLocaleTimeString("en-PH", timeOptions);
  const end = new Date(endValue).toLocaleTimeString("en-PH", timeOptions);

  return `${date}, ${start} - ${end}`;
}

export function formatPaymentMethod(value: string) {
  return paymentMethodLabel(value as BackendPaymentMethod);
}

export function formatOnlinePaymentStatus(value?: string) {
  if (value === "PAID") return "Paid";
  if (value === "AWAITING_PAYMENT") return "Awaiting payment";
  if (value === "INITIALIZING") return "Initializing";
  if (value === "REFUND_REVIEW_REQUIRED") return "Refund review required";
  if (value === "PARTIALLY_REFUNDED") return "Partially refunded";
  if (value === "REFUNDED") return "Refunded";
  if (value === "EXPIRED") return "Expired";
  if (value === "CANCELLED") return "Cancelled";
  return "Awaiting payment details";
}

export function reservationMatchesStaffSearch(row: BackendReservation, value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return true;

  return [
    row.referenceCode,
    row.student?.fullName,
    row.student?.email,
    row.student?.studentNumber
  ].some((candidate) => candidate?.toLowerCase().includes(query));
}

export function mapStaffReservation(row: BackendReservation): StaffReservationRow {
  const items = row.items.map((item) => item.product?.name ?? "Campus Item");
  const quantity = row.items.reduce((total, item) => total + item.quantity, 0);

  return {
    id: row.id,
    reference: row.referenceCode,
    student: row.student?.fullName || row.student?.email || "Student",
    item: items.length > 1 ? `${items[0]} + ${items.length - 1} more` : items[0] ?? "Campus Item",
    quantity,
    pickup: formatStaffPickup(row.pickupStart, row.pickupEnd),
    payment: formatPaymentMethod(row.paymentMethod),
    onlineGcash: row.paymentMethod === "PAYMONGO_GCASH",
    paymentStatus: formatOnlinePaymentStatus(row.payment?.status),
    paymentConfirmed: row.paymentMethod !== "PAYMONGO_GCASH" || row.payment?.status === "PAID",
    total: Number(row.totalAmount),
    status: formatReservationStatus(row.status),
    backendStatus: row.status,
    pickupEnd: row.pickupEnd,
    pickupReviewStatus: row.pickupReviewStatus,
    pickupReviewReason: row.pickupReviewReason,
    scheduleRevision: row.scheduleRevision,
    reservation: row
  };
}

export function formatStaffReceiptStatus(status: BackendReceiptStatus) {
  if (status === "VERIFIED") return "Verified";
  if (status === "VOIDED") return "Voided";
  return "Pending";
}

export function backendReceiptStatusFilter(status: string) {
  const statuses: Record<string, BackendReceiptStatus> = {
    Pending: "PENDING",
    Verified: "VERIFIED",
    Voided: "VOIDED"
  };
  return statuses[status];
}

export function formatStaffReceiptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

export function mapStaffReceipt(row: BackendReceipt): StaffReceiptRow {
  const receiptItems = row.reservation?.items ?? [];
  const itemNames = receiptItems.map((item) => item.product?.name ?? "Campus Item");

  return {
    id: row.id,
    code: row.receiptCode,
    student: row.student?.fullName || row.student?.email || "Student",
    date: formatStaffReceiptDate(row.issuedAt || row.createdAt),
    reference: row.reservation?.referenceCode ?? "Manual receipt",
    payment: formatPaymentMethod(row.paymentMethod),
    items: itemNames.length > 1 ? `${itemNames[0]} + ${itemNames.length - 1} more` : itemNames[0] ?? "Manual transaction",
    itemCount: receiptItems.reduce((total, item) => total + item.quantity, 0),
    total: Number(row.totalAmount),
    status: formatStaffReceiptStatus(row.status),
    backendStatus: row.status,
    verifiedBy: row.issuedBy?.fullName ?? "",
    receipt: row
  };
}

export function formatConversationStatus(conversation: BackendConversation) {
  if (conversation.mode === "BOT_ACTIVE") return "WesBot active";
  if (conversation.mode === "WAITING_FOR_STAFF") return "Waiting for Staff";
  if (conversation.mode === "STAFF_ACTIVE") return "Staff active";
  return "Resolved";
}

export function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

export function formatConversationDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    timeZone: "Asia/Manila"
  });
}

export function conversationPreview(conversation: BackendConversation) {
  return conversation.messages.at(-1)?.message ?? "No messages yet";
}

export function mergeStaffMessages(
  current: BackendConversationMessage[],
  incoming: BackendConversationMessage[]
) {
  return Array.from(new Map([...current, ...incoming].map((message) => [message.id, message])).values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function StaffConversationAvatar({
  kind,
  name = "Student",
  size = "md"
}: {
  kind: "BOT" | "STAFF" | "STUDENT";
  name?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "sm" ? "size-8" : size === "lg" ? "size-16" : "size-11";

  if (kind === "BOT") {
    return (
      <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full", sizeClass)} aria-hidden="true">
        <Image src="/assets/chat-with-wesbot.svg" alt="" fill sizes={size === "sm" ? "32px" : size === "lg" ? "64px" : "44px"} className="object-contain" />
      </span>
    );
  }

  if (kind === "STAFF") {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center rounded-full bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200", sizeClass)} aria-hidden="true">
        <Headphones className={size === "sm" ? "size-4" : size === "lg" ? "size-7" : "size-5"} />
      </span>
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "ST";

  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-full bg-[#e8f3e9] font-extrabold text-primary ring-1 ring-inset ring-[#c8ddca]", sizeClass, size === "sm" ? "text-[10px]" : size === "lg" ? "text-lg" : "text-xs")} aria-hidden="true">
      {initials}
    </span>
  );
}

export function getNextReservationStatus(status: BackendReservationStatus): BackendReservationStatus | null {
  if (status === "PENDING") return "CONFIRMED";
  if (status === "CONFIRMED") return "READY_FOR_PICKUP";
  if (status === "READY_FOR_PICKUP") return "COMPLETED";
  return null;
}

export function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold uppercase text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">{title}</h1>
        <p className="mt-2 text-sm text-[#68746d]">{detail}</p>
      </div>
      {action}
    </header>
  );
}

export function Toolbar({ search, onSearch, status, onStatus, placeholder, statuses }: { search: string; onSearch: (value: string) => void; status: string; onStatus: (value: string) => void; placeholder: string; statuses: string[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#dce5dd] bg-white p-3 sm:flex-row">
      <label className="flex h-11 min-w-0 flex-1 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
        <Search className="mr-2 size-5 text-[#68746d]" />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <label className="flex h-11 items-center gap-2 rounded-md border border-[#d7e1d8] px-3 text-sm">
        <Filter className="size-4 text-primary" />
        <select value={status} onChange={(event) => onStatus(event.target.value)} className="bg-transparent font-semibold outline-none">
          <option value="All">All statuses</option>
          {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  );
}

export function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex max-w-sm items-center gap-3 rounded-lg bg-[#173d27] px-4 py-3 text-sm font-semibold text-white shadow-xl">
      <Check className="size-5" /> {text}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-2"><X className="size-4" /></button>
    </div>
  );
}

export function StaffReceiptPreviewModal({
  row,
  submitting,
  onClose,
  onAskVerify,
  onAskVoid
}: {
  row: StaffReceiptRow | null;
  submitting: boolean;
  onClose: () => void;
  onAskVerify: (row: StaffReceiptRow) => void;
  onAskVoid: (row: StaffReceiptRow) => void;
}) {
  const dialog = useAccessibleDialog(Boolean(row), onClose);
  if (!row) return null;

  const items = row.receipt.reservation?.items ?? [];

  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/50 p-4">
      <section ref={dialog.dialogRef} {...dialog.dialogProps} className="my-auto w-full max-w-3xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-start gap-4 border-b border-[#e3ebe4] p-5">
          <AssetIcon src="/assets/digital-receipts.svg" className="size-12" />
          <div>
            <p className="text-sm font-bold uppercase text-primary">Receipt preview</p>
            <h2 id={dialog.titleId} className="mt-1 text-2xl font-extrabold text-[#101820]">{row.code}</h2>
            <p className="mt-1 text-sm text-[#68746d]">Review details before verification or voiding.</p>
          </div>
          <button type="button" data-dialog-autofocus onClick={onClose} aria-label="Close receipt preview" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee]">
            <X className="size-5" />
          </button>
        </div>

        <div className="max-h-[calc(100svh-230px)] overflow-y-auto p-5">
          <div className="grid gap-3 rounded-lg border border-[#dce5dd] bg-[#f7fbf7] p-4 text-sm sm:grid-cols-2">
            <div><p className="text-[#68746d]">Student</p><p className="mt-1 font-extrabold">{row.student}</p></div>
            <div><p className="text-[#68746d]">Reservation</p><p className="mt-1 font-extrabold">{row.reference}</p></div>
            <div><p className="text-[#68746d]">Payment</p><p className="mt-1 font-extrabold">{row.payment}</p></div>
            <div><p className="text-[#68746d]">Issued</p><p className="mt-1 font-extrabold">{row.date}</p></div>
            <div><p className="text-[#68746d]">Status</p><span className="mt-1 inline-block"><StatusBadge status={row.status} /></span></div>
            <div><p className="text-[#68746d]">Verified by</p><p className="mt-1 font-extrabold">{row.verifiedBy || "Not verified yet"}</p></div>
          </div>

          <section className="mt-5 overflow-hidden rounded-lg border border-[#dce5dd]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-[#f6f9f6] px-4 py-3 text-xs font-bold uppercase text-[#59655d]">
              <span>Item</span>
              <span>Qty</span>
              <span>Amount</span>
            </div>
            <div className="divide-y divide-[#e7ece8]">
              {items.length ? items.map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-extrabold">{item.product?.name ?? "Campus Item"}</p>
                    <p className="mt-1 text-xs text-[#68746d]">{item.variantSummary || item.product?.description || "Reserved item"}</p>
                  </div>
                  <p className="font-bold">{item.quantity}</p>
                  <p className="font-extrabold text-primary">PHP {Number(item.subtotal).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              )) : (
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm">
                  <p className="font-extrabold">Manual commissary transaction</p>
                  <p className="font-bold">1</p>
                  <p className="font-extrabold text-primary">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              )}
            </div>
          </section>

          <div className="mt-5 rounded-lg bg-[#edf6ef] p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[#68746d]">Secure verification</p>
                <p className="mt-1 text-xs font-semibold text-[#405047]">{row.receipt.publicVerificationUrl ? "QR verification link issued" : "Secure QR is being prepared"}</p>
              </div>
              <p className="text-right text-2xl font-extrabold text-primary">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-[#e3ebe4] p-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          {row.backendStatus === "PENDING" ? (
            <Button type="button" disabled={submitting} onClick={() => onAskVerify(row)}>
              <Check className="size-4" />
              Verify receipt
            </Button>
          ) : null}
          {row.backendStatus !== "VOIDED" ? (
            <Button type="button" variant="ghost" disabled={submitting} className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100" onClick={() => onAskVoid(row)}>
              <Trash2 className="size-4" />
              Void receipt
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ReceiptActionModal({
  action,
  reason,
  submitting,
  onReasonChange,
  onClose,
  onConfirm
}: {
  action: { type: "verify" | "void"; row: StaffReceiptRow } | null;
  reason: string;
  submitting: boolean;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useAccessibleDialog(Boolean(action), onClose);
  if (!action) return null;

  const isVoid = action.type === "void";

  return (
    <div className="fixed inset-0 z-[10001] grid place-items-center bg-[#101820]/60 p-4">
      <section ref={dialog.dialogRef} {...dialog.dialogProps} className="relative w-full max-w-md overflow-hidden rounded-lg bg-white p-5 shadow-2xl">
        <ActionLoadingOverlay
          active={submitting}
          title={isVoid ? "Voiding receipt" : "Verifying receipt"}
          detail={isVoid ? "We are saving the reason and updating the receipt." : "We are saving the verification and updating the receipt."}
        />
        <div className="flex items-start gap-3">
          <div>
            <p className="text-sm font-bold uppercase text-primary">{isVoid ? "Void receipt" : "Verify receipt"}</p>
            <h2 id={dialog.titleId} className="mt-1 text-xl font-extrabold text-[#101820]">{action.row.code}</h2>
          </div>
          <button type="button" data-dialog-autofocus onClick={onClose} disabled={submitting} aria-label="Close confirmation" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-[#68746d]">
          {isVoid
            ? "This receipt will be marked as voided and the student will be notified."
            : "This receipt will be marked as officially verified and the student will be notified."}
        </p>
        {isVoid ? (
          <label className="mt-4 grid gap-1.5 text-sm font-semibold">
            Reason
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value.slice(0, 300))}
              placeholder="Example: wrong item quantity, duplicate receipt, or cancelled transaction"
              className="min-h-28 rounded-md border border-[#d7e1d8] p-3 text-sm font-normal leading-6 outline-none focus:border-primary"
            />
            <span className="text-right text-xs font-normal text-[#68746d]">{reason.length}/300</span>
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            type="button"
            disabled={submitting}
            className={isVoid ? "bg-red-700 hover:bg-red-800" : ""}
            onClick={onConfirm}
          >
            {submitting ? "Saving..." : isVoid ? "Void receipt" : "Verify receipt"}
          </Button>
        </div>
      </section>
    </div>
  );
}
