"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Ban, Check, Edit3, Eye, Filter, Plus, RefreshCw, Search, Send, Trash2, Upload, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { FaqManagementExperience } from "@/components/faq/FaqManagementExperience";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getConversationsFromApi,
  getReceiptsFromApi,
  getReservationsFromApi,
  getStaffUsersFromApi,
  markReceiptVerifiedFromApi,
  sendConversationMessageFromApi,
  type BackendAdminUser,
  type BackendConversation,
  type BackendConversationStatus,
  type BackendReceipt,
  type BackendReceiptStatus,
  updateConversationTypingFromApi,
  updateConversationStatusFromApi,
  updateReservationStatusFromApi,
  voidReceiptFromApi,
  type BackendReservation,
  type BackendReservationStatus
} from "@/lib/api";
import {
  archiveStaffProduct,
  clearStaffSession,
  createStaffProduct,
  getStaffCategories,
  getStaffProducts,
  getStoredStaffSession,
  restockStaffProduct,
  updateStaffProduct,
  uploadStaffProductImage,
  type StaffCategory,
  type StaffProduct
} from "@/lib/staff-api";
import { isUniformClothOnly } from "@/lib/product-display";
import { WUP_DEFAULT_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";

type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  stock: number;
  minimum: number;
  price: number;
  oldPrice: number | null;
  status: string;
};

const stockStatusOptions = ["Available", "Needs Restock", "Out of Stock", "On Sale"];

type StaffReservationRow = {
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
};

type StaffReceiptRow = {
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

function numericValue(value: StaffProduct["price"]) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function staffStatusLabel(product: StaffProduct) {
  if (product.status === "OUT_OF_STOCK") return "Out of Stock";
  if (product.status === "ON_SALE") return "On Sale";
  if (product.status === "RESTOCK_SOON" || product.stock <= product.lowStockThreshold) return "Needs Restock";
  return "Available";
}

function stockStatusFromQuery(value: string | null) {
  if (value === "low-stock" || value === "needs-restock") return "Needs Restock";
  if (value === "in-stock" || value === "available") return "Available";
  if (value === "out-of-stock") return "Out of Stock";
  if (value === "on-sale") return "On Sale";
  return "All";
}

function mapStaffProduct(product: StaffProduct): Product {
  return {
    id: product.id,
    name: product.name,
    category: product.category?.name ?? "Uncategorized",
    description: product.description ?? "",
    imageUrl: product.imageUrl ?? "",
    stock: product.stock,
    minimum: product.lowStockThreshold,
    price: numericValue(product.price),
    oldPrice: product.oldPrice === null || product.oldPrice === undefined ? null : numericValue(product.oldPrice),
    status: staffStatusLabel(product)
  };
}

function formatReservationStatus(status: BackendReservationStatus) {
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

function formatStaffPickup(startValue: string | null, endValue: string | null) {
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

function formatPaymentMethod(value: string) {
  if (value === "E_WALLET_AT_PICKUP") return "E-wallet at Pickup";
  if (value === "PAYMONGO_GCASH") return "GCash (Online)";
  if (value === "GCASH") return "GCash";
  if (value === "CASH") return "Cash";
  return "Pay at Commissary";
}

function formatOnlinePaymentStatus(value?: string) {
  if (value === "PAID") return "Paid";
  if (value === "AWAITING_PAYMENT") return "Awaiting payment";
  if (value === "INITIALIZING") return "Initializing";
  if (value === "PROCESSING") return "Processing";
  if (value === "REFUND_REVIEW_REQUIRED") return "Refund review required";
  if (value === "PARTIALLY_REFUNDED") return "Partially refunded";
  if (value === "REFUNDED") return "Refunded";
  if (value === "EXPIRED") return "Expired";
  if (value === "CANCELLED") return "Cancelled";
  if (value === "FAILED") return "Failed";
  return "Awaiting payment details";
}

function mapStaffReservation(row: BackendReservation): StaffReservationRow {
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
    pickupEnd: row.pickupEnd
  };
}

function formatStaffReceiptStatus(status: BackendReceiptStatus) {
  if (status === "VERIFIED") return "Verified";
  if (status === "VOIDED") return "Voided";
  return "Pending";
}

function formatStaffReceiptDate(value: string) {
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

function mapStaffReceipt(row: BackendReceipt): StaffReceiptRow {
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

function formatConversationStatus(status: BackendConversationStatus) {
  return status === "RESOLVED" ? "Resolved" : "Open";
}

function formatConversationTime(value: string) {
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

function conversationPreview(conversation: BackendConversation) {
  return conversation.messages.at(-1)?.message ?? "No messages yet";
}

function getNextReservationStatus(status: BackendReservationStatus): BackendReservationStatus | null {
  if (status === "PENDING") return "CONFIRMED";
  if (status === "CONFIRMED") return "READY_FOR_PICKUP";
  if (status === "READY_FOR_PICKUP") return "COMPLETED";
  return null;
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
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

function Toolbar({ search, onSearch, status, onStatus, placeholder, statuses }: { search: string; onSearch: (value: string) => void; status: string; onStatus: (value: string) => void; placeholder: string; statuses: string[] }) {
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

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex max-w-sm items-center gap-3 rounded-lg bg-[#173d27] px-4 py-3 text-sm font-semibold text-white shadow-xl">
      <Check className="size-5" /> {text}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-2"><X className="size-4" /></button>
    </div>
  );
}

function StaffReceiptPreviewModal({
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
  if (!row) return null;

  const items = row.receipt.reservation?.items ?? [];

  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/50 p-4">
      <section className="my-auto w-full max-w-3xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-start gap-4 border-b border-[#e3ebe4] p-5">
          <AssetIcon src="/assets/digital-receipts.svg" className="size-12" />
          <div>
            <p className="text-sm font-bold uppercase text-primary">Receipt preview</p>
            <h2 className="mt-1 text-2xl font-extrabold text-[#101820]">{row.code}</h2>
            <p className="mt-1 text-sm text-[#68746d]">Review details before verification or voiding.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close receipt preview" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee]">
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
                <p className="text-xs font-bold uppercase text-[#68746d]">Verification hash</p>
                <p className="mt-1 break-all text-xs font-semibold text-[#405047]">{row.receipt.verificationHash}</p>
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

function ReceiptActionModal({
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
  if (!action) return null;

  const isVoid = action.type === "void";

  return (
    <div className="fixed inset-0 z-[10001] grid place-items-center bg-[#101820]/60 p-4">
      <section className="relative w-full max-w-md overflow-hidden rounded-lg bg-white p-5 shadow-2xl">
        <ActionLoadingOverlay
          active={submitting}
          title={isVoid ? "Voiding receipt" : "Verifying receipt"}
          detail={isVoid ? "We are saving the reason and updating the receipt." : "We are saving the verification and updating the receipt."}
        />
        <div className="flex items-start gap-3">
          <div>
            <p className="text-sm font-bold uppercase text-primary">{isVoid ? "Void receipt" : "Verify receipt"}</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#101820]">{action.row.code}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close confirmation" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50">
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

export function StaffInventoryExperience() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<StaffCategory[]>([]);
  const [token, setToken] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [archivingProductId, setArchivingProductId] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [restockingProduct, setRestockingProduct] = useState<Product | null>(null);
  const [restockMode, setRestockMode] = useState<"add" | "set">("add");
  const [restockQuantity, setRestockQuantity] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [addImageFile, setAddImageFile] = useState<File | null>(null);
  const [addImagePreview, setAddImagePreview] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState("");
  const { user, ready, openAuth, logout } = useStudentAuth();

  const loadProducts = async (authToken = token) => {
    if (!authToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [productRows, categoryRows] = await Promise.all([
        getStaffProducts(authToken),
        getStaffCategories(authToken)
      ]);
      setProducts(productRows.map(mapStaffProduct));
      setCategories(categoryRows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load staff inventory.";
      setError(message);
      if (message.toLowerCase().includes("token") || message.toLowerCase().includes("access")) {
        clearStaffSession();
        setToken("");
        void logout();
        openAuth();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setSearch(params.get("query") ?? "");
    setStatus(stockStatusFromQuery(params.get("status")));
    if (!ready) return;

    const session = getStoredStaffSession();
    const authToken = session.token || user?.accessToken || "";
    const email = session.email || user?.email || "";

    setToken(authToken);
    setStaffEmail(email);
    void loadProducts(authToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.accessToken, user?.email]);

  const filtered = products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase()) &&
    (status === "All" || product.status === status)
  );
  const selectedTemplate = WUP_DEFAULT_PRODUCT_TEMPLATES.find((item) => item.id === selectedTemplateId) ?? null;
  const assetTemplates = WUP_DEFAULT_PRODUCT_TEMPLATES.filter((item) => item.source === "asset");
  const priceListTemplates = WUP_DEFAULT_PRODUCT_TEMPLATES.filter((item) => item.source === "price-list");
  const selectedTemplateDescription =
    selectedTemplate && isUniformClothOnly({ name: selectedTemplate.name, category: selectedTemplate.categoryName })
      ? `${selectedTemplate.description}. Sold as uniform cloth/material only; product image is a preview of the finished uniform.`
      : selectedTemplate?.description ?? "";

  const openAddProduct = () => {
    setSelectedTemplateId("");
    setAddImageFile(null);
    setAddImagePreview("");
    setAdding(true);
  };

  const closeAddProduct = () => {
    setSelectedTemplateId("");
    setAddImageFile(null);
    setAddImagePreview("");
    setAdding(false);
  };

  const selectAddTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setAddImageFile(null);

    const template = WUP_DEFAULT_PRODUCT_TEMPLATES.find((item) => item.id === templateId);
    setAddImagePreview(template?.imageUrl ?? "");
  };

  const openEditor = (product: Product) => {
    setEditImageFile(null);
    setEditImagePreview(product.imageUrl);
    setEditingProduct(product);
  };

  const closeEditor = () => {
    setEditImageFile(null);
    setEditImagePreview("");
    setEditingProduct(null);
  };

  const chooseAddImage = (fileList: FileList | null) => {
    const file = fileList?.[0] ?? null;
    setAddImageFile(file);
    setAddImagePreview(file ? URL.createObjectURL(file) : "");
  };

  const chooseEditImage = (fileList: FileList | null) => {
    const file = fileList?.[0] ?? null;
    setEditImageFile(file);
    setEditImagePreview(file ? URL.createObjectURL(file) : editingProduct?.imageUrl ?? "");
  };

  const openRestock = (product: Product) => {
    setRestockingProduct(product);
    setRestockMode("add");
    setRestockQuantity("");
  };

  const saveRestock = async () => {
    if (!restockingProduct) return;
    const quantity = Number(restockQuantity);
    if (!Number.isInteger(quantity) || quantity < 0 || (restockMode === "add" && quantity === 0)) return;

    setSubmitting(true);
    setError("");

    try {
      const updatedProduct = await restockStaffProduct(token, restockingProduct.id, {
        mode: restockMode,
        quantity,
        notes: restockMode === "add" ? "Stock added from staff inventory page." : "Exact stock set from staff inventory page."
      });
      const mappedProduct = mapStaffProduct(updatedProduct);
      setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
      setRestockingProduct(null);
      setRestockQuantity("");
      setNotice(
        restockMode === "add"
          ? `${quantity} pcs added to ${mappedProduct.name}.`
          : `${mappedProduct.name} stock set to ${mappedProduct.stock} pcs.`
      );
    } catch (restockError) {
      setError(restockError instanceof Error ? restockError.message : "Unable to update stock.");
    } finally {
      setSubmitting(false);
    }
  };

  const archiveProduct = async (product: Product) => {
    if (!window.confirm(`Archive ${product.name}? It will be hidden from student shop.`)) return;
    setSubmitting(true);
    setArchivingProductId(product.id);
    setError("");

    try {
      await archiveStaffProduct(token, product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      setNotice(`${product.name} archived.`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive product.");
    } finally {
      setArchivingProductId("");
      setSubmitting(false);
    }
  };

  const categoryOptions = categories.map((category) => category.name);

  const resultingStock = restockingProduct
    ? restockMode === "add"
      ? restockingProduct.stock + Math.max(0, Number(restockQuantity) || 0)
      : Math.max(0, Number(restockQuantity) || 0)
    : 0;

  if (!ready) {
    return (
      <div className="space-y-5">
        <PageHeading eyebrow="Inventory" title="Loading staff account" detail="Checking your WESCOMM session before loading inventory tools." />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-5">
        <PageHeading eyebrow="Inventory" title="Staff sign in required" detail="Use the main WESCOMM login once to access staff inventory tools." />
        <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="max-w-xl text-sm leading-6 text-[#5f6d64]">
            Your staff session is missing or expired. Sign in again with your Wesleyan account, then staff inventory will open automatically.
          </p>
          {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
          <Button type="button" onClick={openAuth} className="mt-5 h-11">Sign in with WESCOMM account</Button>
        </section>
        {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      </div>
    );
  }

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Inventory"
        title="Centralized stock management"
        detail={`Connected as ${staffEmail || "staff"}. Search products, update prices, and set when WESCOMM should alert staff to restock.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void loadProducts()} disabled={loading || submitting}>Refresh</Button>
            <Button onClick={openAddProduct} disabled={loading || submitting}><Plus className="size-5" /> Add product</Button>
          </div>
        }
      />
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search product or category" statuses={stockStatusOptions} />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <div className="hidden grid-cols-[1.35fr_1fr_.7fr_.75fr_.6fr_.85fr_auto] gap-4 bg-[#f6f9f6] px-4 py-3 text-xs font-bold text-[#59655d] md:grid">
          <span>Product</span><span>Category</span><span>Current Stock</span><span>Restock Alert At</span><span>Price</span><span>Stock Status</span><span>Actions</span>
        </div>
        <div className="divide-y divide-[#e7ece8]">
          {loading ? (
            <div className="p-6 text-sm font-semibold text-[#68746d]">Loading live inventory...</div>
          ) : filtered.length ? filtered.map((product) => (
            <article key={product.id} className="relative grid gap-3 overflow-hidden px-4 py-4 md:grid-cols-[1.35fr_1fr_.7fr_.75fr_.6fr_.85fr_auto] md:items-center">
              <ActionLoadingOverlay
                active={archivingProductId === product.id}
                title="Archiving product"
                detail="We are removing this item from the student shop."
              />
              <div><p className="font-bold">{product.name}</p><p className="text-xs text-[#68746d]">{product.id}</p></div>
              <p className="text-sm">{product.category}</p>
              <p className="text-sm"><span className="text-[#68746d] md:hidden">Current Stock: </span><span className="font-extrabold">{product.stock} pcs</span></p>
              <p className="text-sm"><span className="text-[#68746d] md:hidden">Restock Alert At: </span>{product.minimum} pcs</p>
              <p className="text-sm"><span className="text-[#68746d] md:hidden">Price: </span>PHP {product.price.toLocaleString()}</p>
              <StatusBadge status={product.status} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="h-9 px-3" onClick={() => openEditor(product)} disabled={submitting}>
                  <Edit3 className="size-4" />
                  Edit
                </Button>
                <Button className="h-9 px-3" onClick={() => openRestock(product)} disabled={submitting}>
                  <Plus className="size-4" />
                  Restock
                </Button>
                <Button variant="ghost" className="h-9 px-3 text-red-600" onClick={() => void archiveProduct(product)} disabled={submitting}>
                  <Trash2 className="size-4" />
                  Archive
                </Button>
              </div>
            </article>
          )) : (
            <div className="p-6 text-sm font-semibold text-[#68746d]">No matching products found.</div>
          )}
        </div>
      </section>
      {adding ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#101820]/50 p-4">
          <form key={selectedTemplateId || "blank-product-form"} className="relative my-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-2xl" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setSubmitting(true);
            setError("");

            try {
              let imageUrl = String(form.get("imageUrl") ?? "").trim() || null;
              if (addImageFile) {
                const uploadedImage = await uploadStaffProductImage(token, addImageFile);
                imageUrl = uploadedImage.url;
              }

              const createdProduct = await createStaffProduct(token, {
                name: String(form.get("name")).trim(),
                categoryName: String(form.get("category")).trim(),
                description: String(form.get("description") ?? "").trim() || null,
                imageUrl,
                price: Number(form.get("price")),
                oldPrice: String(form.get("oldPrice") ?? "").trim() ? Number(form.get("oldPrice")) : null,
                stock: Number(form.get("stock")),
                lowStockThreshold: Number(form.get("minimum"))
              });
              setProducts((current) => [...current, mapStaffProduct(createdProduct)].sort((left, right) => left.name.localeCompare(right.name)));
              closeAddProduct();
              setNotice(`${createdProduct.name} added.`);
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : "Unable to add product.");
            } finally {
              setSubmitting(false);
            }
          }}>
            <ActionLoadingOverlay
              active={submitting}
              title="Saving new product"
              detail="We are saving the product and uploading its image if needed."
            />
            <div className="flex items-center"><h2 className="text-xl font-extrabold">Add product</h2><button type="button" onClick={closeAddProduct} disabled={submitting} aria-label="Close product form" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button></div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5 text-sm font-semibold">
                WUP product template
                <select value={selectedTemplateId} onChange={(event) => selectAddTemplate(event.target.value)} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary">
                  <option value="">Blank product</option>
                  <optgroup label="Default shop items with assets">
                    {assetTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Price list only">
                    {priceListTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              {selectedTemplate ? (
                <div className="rounded-lg border border-[#dce5dd] bg-[#f7fbf7] px-3 py-2 text-xs text-[#68746d]">
                  <span className="font-bold text-primary">{selectedTemplate.source === "asset" ? "Shop-ready default:" : "Price-list template:"}</span>{" "}
                  {selectedTemplate.source === "asset"
                    ? "This has an item image and can be published after saving."
                    : "This has no item image yet. Add an image and stock before publishing it to students."}
                </div>
              ) : null}
              <input name="name" required defaultValue={selectedTemplate?.name ?? ""} placeholder="Product name" className="h-11 rounded-md border px-3" />
              <input name="category" required list="staff-category-options" defaultValue={selectedTemplate?.categoryName ?? ""} placeholder="Category" className="h-11 rounded-md border px-3" />
              <input name="description" defaultValue={selectedTemplateDescription} placeholder="Description" className="h-11 rounded-md border px-3" />
              <div className="grid gap-3 rounded-lg border border-dashed border-[#cddbd0] bg-[#f8fbf8] p-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-[#dce5dd] bg-white">
                    {addImagePreview ? <Image src={addImagePreview} alt="Product preview" width={80} height={80} unoptimized className="size-full object-contain" /> : <Upload className="size-7 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#b9cbbb] bg-white px-3 text-sm font-bold text-primary hover:bg-[#eef6ef]">
                      <Upload className="size-4" />
                      Upload image
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseAddImage(event.target.files)} />
                    </label>
                    <p className="mt-2 text-xs text-[#68746d]">PNG, JPG, or WEBP up to 2 MB. This will be saved to Supabase Storage.</p>
                  </div>
                </div>
                <input name="imageUrl" defaultValue={selectedTemplate?.imageUrl ?? ""} placeholder="Or paste an image URL" onChange={(event) => { if (!addImageFile) setAddImagePreview(event.target.value); }} className="h-11 rounded-md border px-3" />
              </div>
              <div className="grid grid-cols-2 gap-3"><input name="stock" required type="number" min="0" defaultValue={selectedTemplate?.stock ?? ""} placeholder="Opening stock" className="h-11 rounded-md border px-3" /><input name="minimum" required type="number" min="0" defaultValue={selectedTemplate?.lowStockThreshold ?? ""} placeholder="Restock alert at" className="h-11 rounded-md border px-3" /></div>
              <div className="grid grid-cols-2 gap-3"><input name="price" required type="number" min="0" step="0.01" defaultValue={selectedTemplate?.price ?? ""} placeholder="Price" className="h-11 rounded-md border px-3" /><input name="oldPrice" type="number" min="0" step="0.01" placeholder="Old price optional" className="h-11 rounded-md border px-3" /></div>
              <datalist id="staff-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
              <Button type="submit" disabled={submitting} className="mt-2 h-11">{submitting ? "Saving..." : "Save product"}</Button>
            </div>
          </form>
        </div>
      ) : null}
      {editingProduct ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/50 p-4">
          <form
            className="relative my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setSubmitting(true);
              setError("");

              try {
                let imageUrl = String(form.get("imageUrl") ?? "").trim() || null;
                if (editImageFile) {
                  const uploadedImage = await uploadStaffProductImage(token, editImageFile);
                  imageUrl = uploadedImage.url;
                }

                const updatedProduct = await updateStaffProduct(token, editingProduct.id, {
                  name: String(form.get("name")).trim(),
                  categoryName: String(form.get("category")).trim(),
                  description: String(form.get("description") ?? "").trim() || null,
                  imageUrl,
                  price: Number(form.get("price")),
                  oldPrice: String(form.get("oldPrice") ?? "").trim() ? Number(form.get("oldPrice")) : null,
                  stock: Number(form.get("stock")),
                  lowStockThreshold: Number(form.get("minimum")),
                  notes: "Updated from staff inventory page."
                });
                const mappedProduct = mapStaffProduct(updatedProduct);
                setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product).sort((left, right) => left.name.localeCompare(right.name)));
                closeEditor();
                setNotice(`${mappedProduct.name} updated.`);
              } catch (updateError) {
                setError(updateError instanceof Error ? updateError.message : "Unable to update product.");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <ActionLoadingOverlay
              active={submitting}
              title="Saving product changes"
              detail="We are updating this item and syncing the student shop."
            />
            <div className="flex items-start gap-3">
              <div>
                <h2 className="text-xl font-extrabold">Edit product</h2>
                <p className="mt-1 text-sm text-[#68746d]">{editingProduct.id}</p>
              </div>
              <button type="button" onClick={closeEditor} disabled={submitting} aria-label="Close editor" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold">Product name<input name="name" required defaultValue={editingProduct.name} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
              <label className="grid gap-1.5 text-sm font-semibold">Category<input name="category" required list="staff-edit-category-options" defaultValue={editingProduct.category} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
              <label className="grid gap-1.5 text-sm font-semibold">Description<input name="description" defaultValue={editingProduct.description} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
              <div className="grid gap-3 rounded-lg border border-dashed border-[#cddbd0] bg-[#f8fbf8] p-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-[#dce5dd] bg-white">
                    {editImagePreview ? <Image src={editImagePreview} alt="Product preview" width={80} height={80} unoptimized className="size-full object-contain" /> : <Upload className="size-7 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#b9cbbb] bg-white px-3 text-sm font-bold text-primary hover:bg-[#eef6ef]">
                      <Upload className="size-4" />
                      Replace image
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseEditImage(event.target.files)} />
                    </label>
                    <p className="mt-2 text-xs text-[#68746d]">Upload a new product image or keep the current URL below.</p>
                  </div>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Image URL
                  <input name="imageUrl" defaultValue={editingProduct.imageUrl} onChange={(event) => { if (!editImageFile) setEditImagePreview(event.target.value); }} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold">Current stock<input name="stock" required type="number" min="0" defaultValue={editingProduct.stock} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                <label className="grid gap-1.5 text-sm font-semibold">Restock alert at<input name="minimum" required type="number" min="0" defaultValue={editingProduct.minimum} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold">Unit price<input name="price" required type="number" min="0" step="0.01" defaultValue={editingProduct.price} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                <label className="grid gap-1.5 text-sm font-semibold">Old price<input name="oldPrice" type="number" min="0" step="0.01" defaultValue={editingProduct.oldPrice ?? ""} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
              </div>
              <datalist id="staff-edit-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
              <div className="mt-1 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={closeEditor} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save changes"}</Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
      {restockingProduct ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/50 p-4">
          <form
            className="relative my-auto w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              saveRestock();
            }}
          >
            <ActionLoadingOverlay
              active={submitting}
              title="Updating stock"
              detail="We are saving the stock count and refreshing its status."
            />
            <div className="flex items-start gap-3">
              <div>
                <h2 className="text-xl font-extrabold">Update stock</h2>
                <p className="mt-1 text-sm text-[#68746d]">{restockingProduct.name}</p>
              </div>
              <button type="button" onClick={() => setRestockingProduct(null)} disabled={submitting} aria-label="Close stock editor" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-md bg-[#f2f7f2] p-1">
              <button type="button" onClick={() => { setRestockMode("add"); setRestockQuantity(""); }} className={restockMode === "add" ? "h-10 rounded-md bg-white text-sm font-bold text-primary shadow-sm" : "h-10 rounded-md text-sm font-semibold text-[#59655d]"}>Add stock</button>
              <button type="button" onClick={() => { setRestockMode("set"); setRestockQuantity(String(restockingProduct.stock)); }} className={restockMode === "set" ? "h-10 rounded-md bg-white text-sm font-bold text-primary shadow-sm" : "h-10 rounded-md text-sm font-semibold text-[#59655d]"}>Set exact stock</button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border border-[#dce5dd] p-4 text-sm">
              <div><p className="text-[#68746d]">Current stock</p><p className="mt-1 text-2xl font-extrabold">{restockingProduct.stock}</p></div>
              <div><p className="text-[#68746d]">Resulting stock</p><p className="mt-1 text-2xl font-extrabold text-primary">{resultingStock}</p></div>
            </div>

            <label className="mt-5 grid gap-1.5 text-sm font-semibold">
              {restockMode === "add" ? "Quantity to add" : "New stock quantity"}
              <input
                autoFocus
                required
                type="number"
                min={restockMode === "add" ? 1 : 0}
                step="1"
                value={restockQuantity}
                onChange={(event) => setRestockQuantity(event.target.value)}
                placeholder={restockMode === "add" ? "Enter received quantity" : "Enter exact stock count"}
                className="h-12 rounded-md border px-3 text-base font-normal outline-none focus:border-primary"
              />
            </label>

            <p className="mt-3 text-xs leading-5 text-[#68746d]">When stock is {restockingProduct.minimum} pcs or lower, WESCOMM marks this item as Needs Restock.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRestockingProduct(null)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting || !restockQuantity || (restockMode === "add" && Number(restockQuantity) < 1)}>
                {submitting ? "Saving..." : "Save stock"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}

export function StaffReservationsExperience() {
  const { user } = useStudentAuth();
  const [rows, setRows] = useState<StaffReservationRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");

  const loadReservations = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const session = getStoredStaffSession();
    if (!session.token) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const reservations = await getReservationsFromApi(session.token);
      setRows(reservations.map(mapStaffReservation));
    } catch (reservationError) {
      if (!background) {
        setError(reservationError instanceof Error ? reservationError.message : "Unable to load reservations.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  useEffect(() => {
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReservations({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 12000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadReservations]);

  const filtered = rows.filter((row) =>
    `${row.reference} ${row.student} ${row.item}`.toLowerCase().includes(search.toLowerCase()) &&
    (status === "All" || row.status === status)
  );

  const updateStatus = async (row: StaffReservationRow, nextStatus: BackendReservationStatus) => {
    const session = getStoredStaffSession();
    if (!session.token) return;

    setSubmittingId(row.id);
    setError("");

    try {
      const result = await updateReservationStatusFromApi(session.token, row.id, nextStatus);
      const mappedReservation = mapStaffReservation(result.reservation);
      setRows((current) => current.map((item) => item.id === row.id ? mappedReservation : item));
      setNotice(result.receipt
        ? `${row.reference} completed. Receipt ${result.receipt.receiptCode} was generated for verification.`
        : `${row.reference} updated to ${mappedReservation.status}.`);
    } catch (reservationError) {
      setError(reservationError instanceof Error ? reservationError.message : "Unable to update reservation.");
    } finally {
      setSubmittingId("");
    }
  };

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Reservations"
        title="Reservation queue"
        detail="Confirm requests and prepare scheduled pickups from live student checkout data."
        action={<Button variant="secondary" onClick={() => void loadReservations()} disabled={loading || Boolean(submittingId)}>Refresh</Button>}
      />
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search reference, student, or item" statuses={["Pending", "Confirmed", "Ready for Pick-up", "Completed", "Cancelled", "No-show"]} />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live reservations...</div>
        ) : filtered.length ? filtered.map((row) => {
          const nextStatus = getNextReservationStatus(row.backendStatus);
          const paymentBlocksProgress = row.onlineGcash && !row.paymentConfirmed;
          const noShowEligible = row.backendStatus === "READY_FOR_PICKUP" && Boolean(row.pickupEnd) && Date.now() >= new Date(row.pickupEnd!).getTime() + 24 * 60 * 60 * 1000;
          return (
            <article key={row.id} className="relative grid gap-4 overflow-hidden rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm lg:grid-cols-[1fr_1.2fr_1.2fr_1fr_auto_auto] lg:items-center">
              <ActionLoadingOverlay
                active={submittingId === row.id}
                title="Updating reservation"
                detail="We are saving the status and updating the reservation timeline."
              />
              <div><p className="font-extrabold">{row.reference}</p><p className="text-xs text-[#68746d]">{row.student}</p></div>
              <div><p className="text-sm font-bold">{row.item}</p><p className="text-xs text-[#68746d]">Quantity: {row.quantity}</p></div>
              <p className="text-sm"><span className="font-bold text-primary">Pickup:</span> {row.pickup}</p>
              <div className="text-sm">
                <p><span className="font-bold text-primary">Payment:</span> {row.payment}</p>
                {row.onlineGcash ? <span className="mt-1 inline-flex"><StatusBadge status={row.paymentStatus} /></span> : null}
                <span className="mt-1 block font-extrabold text-[#17211b]">PHP {row.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <StatusBadge status={row.status} />
              <div className="flex flex-wrap gap-2">
                {nextStatus ? (
                  <Button
                    className="h-10"
                    disabled={Boolean(submittingId) || paymentBlocksProgress}
                    title={paymentBlocksProgress ? "Wait for secure PayMongo payment confirmation before processing this reservation." : undefined}
                    onClick={() => void updateStatus(row, nextStatus)}
                  >
                    {submittingId === row.id
                      ? "Saving..."
                      : row.backendStatus === "PENDING"
                        ? "Confirm"
                        : row.backendStatus === "CONFIRMED"
                          ? "Mark ready"
                          : "Complete"}
                  </Button>
                ) : null}
                {paymentBlocksProgress ? (
                  <p className="max-w-48 text-xs font-semibold leading-5 text-amber-800">
                    Await secure payment confirmation. Do not use a screenshot as proof.
                  </p>
                ) : null}
                {noShowEligible ? (
                  <Link href={user?.role === "ADMIN" ? "/admin/student-access" : "/staff/student-access"}>
                    <Button variant="secondary" className="h-10 border-amber-300 text-amber-800 hover:bg-amber-50">
                      <Ban className="size-4" /> Review no-show
                    </Button>
                  </Link>
                ) : null}
                {row.backendStatus !== "COMPLETED" && row.backendStatus !== "CANCELLED" && row.backendStatus !== "NO_SHOW" ? (
                  <Button variant="ghost" className="h-10 text-red-600" disabled={Boolean(submittingId)} onClick={() => void updateStatus(row, "CANCELLED")}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">No matching reservations found.</div>
        )}
      </div>
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}

export function StaffReceiptsExperience() {
  const [rows, setRows] = useState<StaffReceiptRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<StaffReceiptRow | null>(null);
  const [receiptAction, setReceiptAction] = useState<{ type: "verify" | "void"; row: StaffReceiptRow } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const loadReceipts = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const session = getStoredStaffSession();
    if (!session.token) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const receipts = await getReceiptsFromApi(session.token);
      setRows(receipts.map(mapStaffReceipt));
    } catch (receiptError) {
      if (!background) {
        setError(receiptError instanceof Error ? receiptError.message : "Unable to load receipts.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void loadReceipts({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 15000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [loadReceipts]);

  const filtered = rows.filter((row) =>
    `${row.code} ${row.reference} ${row.student} ${row.items}`.toLowerCase().includes(search.toLowerCase()) &&
    (status === "All" || row.status === status)
  );

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
            <article key={row.id} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
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

export function StaffMessagesExperience() {
  const { user } = useStudentAuth();
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const [threadOpen, setThreadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef(0);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null;

  const loadConversations = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const session = getStoredStaffSession();
    if (!session.token) {
      setConversations([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getConversationsFromApi(session.token);
      setConversations(rows);
      setSelectedId((current) =>
        rows.some((conversation) => conversation.id === current) ? current : rows[0]?.id || ""
      );
    } catch (messageError) {
      if (!background) {
        setError(messageError instanceof Error ? messageError.message : "Unable to load student messages.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
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
  }, [loadConversations, threadOpen]);

  useEffect(() => {
    if (!threadOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [threadOpen, selected?.messages.length]);

  const filtered = conversations.filter((conversation) =>
    `${conversation.subject} ${conversation.student?.fullName ?? ""} ${conversation.student?.email ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()) &&
    (status === "All" || formatConversationStatus(conversation.status) === status)
  );

  const openConversation = (conversationId: string) => {
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
    if (!session.token || !selected || !reply.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const message = await sendConversationMessageFromApi(session.token, selected.id, reply.trim());
      sendTypingSignal(selected.id, false);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selected.id
            ? {
                ...conversation,
                status: "OPEN",
                assignedStaffId: conversation.assignedStaffId ?? user?.id ?? null,
                updatedAt: message.createdAt,
                messages: [...conversation.messages, message]
              }
            : conversation
        )
      );
      setReply("");
      setNotice("Reply sent to student.");
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "Unable to send reply.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (conversation: BackendConversation, nextStatus: BackendConversationStatus) => {
    const session = getStoredStaffSession();
    if (!session.token) return;

    setSubmitting(true);
    setError("");

    try {
      const updatedConversation = await updateConversationStatusFromApi(session.token, conversation.id, nextStatus);
      setConversations((current) => current.map((item) => item.id === conversation.id ? updatedConversation : item));
      setNotice(`${conversation.subject} marked as ${formatConversationStatus(nextStatus).toLowerCase()}.`);
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "Unable to update conversation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Student messaging"
        title="Message center"
        detail="Read student inquiries, reply from one workspace, and resolve completed conversations."
        action={<Button variant="secondary" onClick={() => void loadConversations()} disabled={loading || submitting}>Refresh</Button>}
      />
      <div className={threadOpen ? "hidden lg:block" : ""}>
        <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search student, topic, or message" statuses={["Open", "Resolved"]} />
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <div className="grid min-h-[calc(100dvh-230px)] overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm lg:min-h-[620px] lg:grid-cols-[360px_1fr]">
        <aside className={`${threadOpen ? "hidden lg:block" : "block"} border-b border-[#e5ebe6] lg:border-b-0 lg:border-r`}>
          <div className="flex items-center gap-3 border-b border-[#edf1ed] bg-white px-4 py-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/messages.svg" className="size-8" />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-[#17211b]">Message inbox</p>
              <p className="text-xs text-[#68746d]">{filtered.length} conversation{filtered.length === 1 ? "" : "s"} shown</p>
            </div>
          </div>
          {loading ? (
            <p className="p-5 text-sm font-semibold text-[#68746d]">Loading conversations...</p>
          ) : filtered.length ? filtered.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => openConversation(conversation.id)}
              className={`w-full border-b border-[#edf1ed] p-4 text-left transition hover:bg-[#f4f8f4] ${selected?.id === conversation.id ? "bg-[#eef6ee]" : ""}`}
            >
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 truncate font-extrabold">{conversation.student?.fullName || conversation.student?.email || "Student"}</p>
                <StatusBadge status={formatConversationStatus(conversation.status)} />
              </div>
              <p className="mt-1 truncate text-sm font-semibold">{conversation.subject}</p>
              <p className="mt-1 truncate text-xs text-[#68746d]">{conversationPreview(conversation)}</p>
              <p className="mt-2 text-xs font-semibold text-[#79837d]">{formatConversationTime(conversation.updatedAt)}</p>
            </button>
          )) : (
            <p className="p-5 text-sm font-semibold text-[#68746d]">No matching student messages found.</p>
          )}
        </aside>
        {selected ? (
          <section className={`${threadOpen ? "flex" : "hidden"} min-h-[calc(100dvh-230px)] flex-col lg:flex lg:min-h-[500px]`}>
            <header className="flex flex-wrap items-start gap-3 border-b border-[#e5ebe6] px-5 py-4">
              <button
                type="button"
                onClick={closeConversation}
                className="grid size-10 place-items-center rounded-md border border-[#d7e1d8] text-primary lg:hidden"
                aria-label="Back to message inbox"
              >
                <ArrowLeft className="size-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-extrabold">{selected.subject}</h2>
                <p className="text-xs text-[#68746d]">{selected.student?.fullName || selected.student?.email || "Student"}</p>
              </div>
              <StatusBadge status={formatConversationStatus(selected.status)} />
              <Button
                variant={selected.status === "RESOLVED" ? "secondary" : "ghost"}
                className="h-9"
                disabled={submitting}
                onClick={() => void updateStatus(selected, selected.status === "RESOLVED" ? "OPEN" : "RESOLVED")}
              >
                {selected.status === "RESOLVED" ? "Reopen" : "Resolve"}
              </Button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafcfb] p-4 sm:p-5">
              {selected.messages.map((message) => {
                const mine = message.senderId === user?.id;
                return (
                  <div key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                    <div className={mine ? "ml-auto max-w-[82%] rounded-lg bg-primary p-3 text-sm leading-6 text-white shadow-sm" : "max-w-[82%] rounded-lg border border-[#dce5dd] bg-white p-3 text-sm leading-6 shadow-sm"}>
                      <p>{message.message}</p>
                      <p className={mine ? "mt-2 text-[11px] font-semibold text-white/75" : "mt-2 text-[11px] font-semibold text-[#79837d]"}>
                        {mine ? "You" : message.sender?.fullName || selected.student?.fullName || "Student"} - {formatConversationTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {selected.typingUsers?.length ? (
                <div className="flex justify-start">
                  <div className="max-w-[82%] rounded-lg border border-[#dce5dd] bg-white px-3 py-2 text-sm font-semibold text-[#68746d] shadow-sm">
                    {selected.typingUsers[0].fullName || selected.typingUsers[0].email || "Student"} is typing...
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
            <form
              className="flex gap-2 border-t border-[#e5ebe6] bg-white p-3 sm:p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <input
                value={reply}
                onChange={(event) => handleReplyChange(event.target.value)}
                onBlur={() => selected ? sendTypingSignal(selected.id, false) : undefined}
                placeholder="Write a reply..."
                className="h-11 min-w-0 flex-1 rounded-md border border-[#d7e1d8] px-3 outline-none focus:border-primary"
              />
              <Button type="submit" className="h-11 px-3 sm:px-4" disabled={submitting || !reply.trim()}>
                <Send className="size-4" />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </section>
        ) : (
          <section className="hidden min-h-[500px] place-items-center bg-[#fafcfb] p-6 text-center lg:grid">
            <div>
              <AssetIcon src="/assets/messages.svg" className="mx-auto size-12" />
              <p className="mt-3 font-extrabold text-[#17211b]">No conversation selected</p>
              <p className="mt-1 text-sm text-[#68746d]">Choose a student message from the inbox.</p>
            </div>
          </section>
        )}
      </div>
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}

export function StaffFaqExperience() {
  return <FaqManagementExperience />;
}

export function StaffUsersExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [users, setUsers] = useState<BackendAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) {
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getStaffUsersFromApi(user.accessToken);
      setUsers(rows);
    } catch (usersError) {
      if (!background) {
        setError(usersError instanceof Error ? usersError.message : "Unable to load staff accounts.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [ready, user?.accessToken, user?.role]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadUsers({ background: true });
    };

    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadUsers, user?.accessToken, user?.role]);

  if (!ready) {
    return <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading account...</div>;
  }

  if (!user) {
    return (
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Staff sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use a staff or admin account to view live account access.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  if (user.role !== "STAFF" && user.role !== "ADMIN") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  const staffCount = users.filter((row) => row.role === "STAFF").length;
  const adminCount = users.filter((row) => row.role === "ADMIN").length;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Staff accounts"
        title="User access overview"
        detail="Review real staff and admin accounts connected to the WESCOMM database."
        action={<Button variant="secondary" onClick={() => void loadUsers()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[#26322b]">Staff accounts</p>
          <p className="mt-1 text-3xl font-extrabold text-primary">{staffCount}</p>
          <p className="mt-1 text-xs text-[#68746d]">Operations users</p>
        </article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[#26322b]">Admin accounts</p>
          <p className="mt-1 text-3xl font-extrabold text-primary">{adminCount}</p>
          <p className="mt-1 text-xs text-[#68746d]">Decision makers</p>
        </article>
      </section>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live account data...</div> : null}
      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        {users.length ? users.map((row) => (
          <article key={row.id} className="grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 sm:grid-cols-[1fr_1.2fr_auto] sm:items-center">
            <div>
              <p className="font-extrabold text-[#17211b]">{row.fullName || row.email}</p>
              <p className="mt-1 break-all text-xs text-[#68746d]">{row.id}</p>
            </div>
            <div>
              <p className="break-all text-sm font-semibold text-[#26322b]">{row.email}</p>
              <p className="mt-1 text-xs text-[#68746d]">{row.department || "No department set"}</p>
            </div>
            <StatusBadge status={row.role === "ADMIN" ? "Admin" : "Staff"} />
          </article>
        )) : (
          <div className="p-6 text-sm font-semibold text-[#68746d]">No staff or admin accounts found in the database.</div>
        )}
      </section>
    </div>
  );
}

export function StaffSettingsExperience() {
  const { user, logout } = useStudentAuth();
  const [lowStock, setLowStock] = useState(true);
  const [reservations, setReservations] = useState(true);
  const [receipts, setReceipts] = useState(true);
  const [rules, setRules] = useState("Reservations are held until the selected pickup schedule. Unclaimed items are released after one business day.");
  const [notice, setNotice] = useState("");
  const roleLabel = user?.role === "ADMIN" ? "Admin" : "Staff";
  const initials = (user?.fullName || user?.email || roleLabel)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || (user?.role === "ADMIN" ? "AD" : "ST");
  const notificationOptions: Array<[string, string, boolean, React.Dispatch<React.SetStateAction<boolean>>]> = [
    ["Restock alerts", "Notify this account when products reach the restock alert count.", lowStock, setLowStock],
    ["Reservation reminders", "Notify this account when reservations need staff action.", reservations, setReservations],
    ["Receipt verification queue", "Notify this account when receipts are waiting for verification.", receipts, setReceipts]
  ];
  const signOut = async () => {
    const signedOut = await logout();
    if (!signedOut) return;
    clearStaffSession();
    window.location.assign("/");
  };

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow={`${roleLabel} settings`}
        title="Account settings"
        detail="Manage account details, notification preferences, and pickup guidance from one place."
        action={<Button className="w-full sm:w-auto" onClick={() => setNotice("Account settings saved.")}>Save changes</Button>}
      />

      <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <span className="mx-auto grid size-20 shrink-0 place-items-center rounded-full bg-[#dcebdd] text-2xl font-extrabold text-primary lg:mx-0">
            {initials}
          </span>
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-bold uppercase text-primary">{roleLabel} account</p>
            <h2 className="mt-1 truncate text-2xl font-extrabold text-[#101820]">{user?.fullName || user?.email || `${roleLabel} User`}</h2>
            <p className="mt-1 truncate text-sm text-[#68746d]">{user?.email || "No email loaded"}</p>
          </div>
          <Button variant="secondary" className="w-full border-red-200 text-red-700 hover:bg-red-50 lg:w-auto" onClick={signOut}>
            <AssetIcon src="/assets/logout.svg" className="size-6" />
            Sign out
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/notifications.svg" className="size-8" />
            </span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">Notification preferences</h2>
              <p className="mt-1 text-sm leading-6 text-[#68746d]">Choose which operational events should create alerts for this account.</p>
            </div>
          </div>
          <div className="mt-5 divide-y divide-[#edf1ed]">
            {notificationOptions.map(([label, description, checked, setter]) => (
              <div key={label} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <p className="text-sm font-extrabold text-[#253029]">{label}</p>
                  <p className="mt-1 text-xs leading-5 text-[#68746d]">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  onClick={() => setter((value) => !value)}
                  className={checked ? "relative h-8 w-14 rounded-full bg-primary transition" : "relative h-8 w-14 rounded-full bg-[#cdd6cf] transition"}
                >
                  <span className={checked ? "absolute left-7 top-1 size-6 rounded-full bg-white shadow-sm transition" : "absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition"} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <WebPushSettings compact />

        <section className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/pick-up.svg" className="size-8" />
            </span>
            <div>
              <h2 className="font-extrabold text-[#17211b]">Pickup guidance</h2>
              <p className="mt-1 text-sm leading-6 text-[#68746d]">This guidance is shown during reservation processing.</p>
            </div>
          </div>
          <textarea
            value={rules}
            onChange={(event) => setRules(event.target.value.slice(0, 300))}
            className="mt-5 min-h-40 w-full rounded-md border border-[#d7e1d8] p-3 text-sm leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
          <p className="mt-2 text-right text-xs text-[#68746d]">{rules.length}/300</p>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm">
          <AssetIcon src="/assets/verified.svg" className="size-9" />
          <h3 className="mt-3 font-extrabold text-[#17211b]">Role access</h3>
          <p className="mt-1 text-sm text-[#68746d]">{roleLabel} permissions are controlled by the backend account role.</p>
        </article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm">
          <AssetIcon src="/assets/privacy.svg" className="size-9" />
          <h3 className="mt-3 font-extrabold text-[#17211b]">School email</h3>
          <p className="mt-1 text-sm text-[#68746d]">Login is verified through the account email used in WESCOMM.</p>
        </article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-4 shadow-sm">
          <AssetIcon src="/assets/settings.svg" className="size-9" />
          <h3 className="mt-3 font-extrabold text-[#17211b]">Local preferences</h3>
          <p className="mt-1 text-sm text-[#68746d]">These UI preferences are ready to connect to persistent backend settings.</p>
        </article>
      </section>
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
