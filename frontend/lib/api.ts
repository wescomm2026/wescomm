import type { CartProduct } from "@/components/cart/StudentCartProvider";
import { resolveShopProductAsset } from "@/lib/shop-assets";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/backend";
export const COOKIE_SESSION_TOKEN = "cookie-session";
export const AUTH_UNAUTHORIZED_EVENT = "wescomm:auth-unauthorized";

export type BackendAuthProfile = {
  id: string;
  role: "STUDENT" | "STAFF" | "ADMIN";
  studentNumber: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  department: string | null;
  address: string | null;
  avatarUrl: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateMyProfilePayload = {
  fullName: string;
  phone: string | null;
  department: string | null;
  address: string | null;
};

export type BackendCategory = {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string | null;
};

export type BackendVariant = {
  optionName: string;
  optionValue: string;
  stock: number;
};

export type BackendProduct = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: string | number;
  oldPrice?: string | number | null;
  status: "IN_STOCK" | "RESTOCK_SOON" | "OUT_OF_STOCK" | "ON_SALE";
  stock: number;
  category?: BackendCategory | null;
  variants?: BackendVariant[];
};

export type BackendFaq = {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  isPublished?: boolean;
  updatedById?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BackendReservationStatus = "PENDING" | "CONFIRMED" | "READY_FOR_PICKUP" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type BackendPaymentMethod = "PAY_AT_COMMISSARY" | "E_WALLET_AT_PICKUP" | "PAYMONGO_GCASH" | "CASH" | "GCASH";
export type BackendPaymentStatus =
  | "INITIALIZING"
  | "AWAITING_PAYMENT"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUND_REVIEW_REQUIRED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";
export type BackendReceiptStatus = "PENDING" | "VERIFIED" | "VOIDED";
export type BackendNotificationType =
  | "RESERVATION"
  | "RECEIPT"
  | "PAYMENT"
  | "LOW_STOCK"
  | "MESSAGE"
  | "SYSTEM"
  | "BACK_IN_STOCK";
export type BackendConversationStatus = "OPEN" | "RESOLVED";
export type BackendConversationMode = "BOT_ACTIVE" | "WAITING_FOR_STAFF" | "STAFF_ACTIVE" | "RESOLVED";
export type BackendConversationMessageSenderType = "STUDENT" | "BOT" | "STAFF" | "SYSTEM";

export type BackendProfileSummary = {
  id: string;
  fullName: string;
  email: string;
  studentNumber?: string | null;
};

export type BackendPaymentSummary = {
  id: string;
  reservationId: string;
  status: BackendPaymentStatus;
  amountMinor: number;
  currency: string;
  livemode: boolean;
  canResume: boolean;
  canRetry: boolean;
  providerReference?: string | null;
  paidAt?: string | null;
  checkoutExpiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BackendPaymentOptions = {
  paymongoGcash: {
    enabled: boolean;
    livemode: boolean;
  };
};

export type BackendReservation = {
  id: string;
  studentId: string;
  referenceCode: string;
  status: BackendReservationStatus;
  pickupStart: string | null;
  pickupEnd: string | null;
  paymentMethod: BackendPaymentMethod;
  totalAmount: string | number;
  staffNotes?: string | null;
  payment?: BackendPaymentSummary | null;
  createdAt: string;
  updatedAt: string;
  student?: BackendProfileSummary | null;
  items: Array<{
    id: string;
    productId: string;
    variantSummary?: string | null;
    quantity: number;
    unitPrice: string | number;
    subtotal: string | number;
    product?: BackendProduct | null;
  }>;
};

export type CreateReservationPayload = {
  paymentMethod: BackendPaymentMethod;
  pickupStart?: string;
  pickupEnd?: string;
  items: Array<{
    productId: string;
    variantSummary?: string;
    quantity: number;
  }>;
};

export type BackendReceipt = {
  id: string;
  receiptCode: string;
  studentId: string;
  reservationId: string | null;
  totalAmount: string | number;
  paymentMethod: BackendPaymentMethod;
  status: BackendReceiptStatus;
  verificationHash: string;
  receiptImageUrl?: string | null;
  receiptPdfUrl?: string | null;
  issuedById?: string | null;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  student?: BackendProfileSummary | null;
  issuedBy?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  reservation?: {
    id: string;
    referenceCode: string;
    status: BackendReservationStatus;
    pickupStart: string | null;
    pickupEnd: string | null;
    items: Array<{
      id: string;
      productId: string;
      variantSummary?: string | null;
      quantity: number;
      unitPrice: string | number;
      subtotal: string | number;
      product?: {
        id: string;
        name: string;
        description?: string | null;
        imageUrl?: string | null;
        price: string | number;
      } | null;
    }>;
  } | null;
};

export type BackendCursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type BackendCollectionOptions = {
  limit?: number;
  cursor?: string;
  status?: string;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type BackendPublicReceiptVerification = {
  receiptCode: string;
  totalAmount: string | number;
  paymentMethod: BackendPaymentMethod;
  status: BackendReceiptStatus;
  issuedAt: string;
  student: {
    displayName: string;
    studentNumber: string | null;
  };
  reservation: {
    referenceCode: string;
    status: BackendReservationStatus;
    itemCount: number;
    totalQuantity: number;
  } | null;
};

export type BackendNotification = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: BackendNotificationType;
  actionUrl?: string | null;
  readAt: string | null;
  createdAt: string;
};

export type BackendWishlistItem = {
  productId: string;
  createdAt: string;
};

export type BackendRestriction = {
  id: string;
  studentId: string;
  offenseId: string | null;
  level: number;
  source: "AUTOMATIC" | "MANUAL";
  status: "ACTIVE" | "EXPIRED" | "LIFTED";
  reason: string;
  startsAt: string;
  endsAt: string | null;
  permanent: boolean;
  createdById: string | null;
  liftedById: string | null;
  liftedAt: string | null;
  liftReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackendStudentOffense = {
  id: string;
  studentId: string;
  reservationId: string | null;
  reservationReference: string | null;
  type: "NO_SHOW" | "LATE_CANCELLATION" | "RESERVATION_SPAM";
  status: "ACTIVE" | "OVERTURNED";
  reason: string;
  occurredAt: string;
  confirmedById: string | null;
  overturnedById: string | null;
  overturnedAt: string | null;
  overturnReason: string | null;
  createdAt: string;
};

export type BackendRestrictionPolicy = {
  noShowGraceHours: number;
  firstRestrictionAt: number;
  firstRestrictionDays: number;
  secondRestrictionDays: number;
};

export type BackendRestrictionSummary = {
  policy: BackendRestrictionPolicy;
  activeRestriction: BackendRestriction | null;
  consecutiveOffenses: number;
  nextWarningAt: number;
  offenses: BackendStudentOffense[];
  restrictions: BackendRestriction[];
};

export type BackendRestrictionStudent = BackendProfileSummary & {
  department?: string | null;
  activeRestriction: BackendRestriction | null;
  consecutiveOffenses: number;
  offenses: BackendStudentOffense[];
};

export type BackendNoShowCandidate = {
  id: string;
  referenceCode: string;
  studentId: string;
  student: BackendProfileSummary;
  pickupEnd: string | null;
  eligibleSince: string | null;
  items: Array<{ name: string; quantity: number }>;
};

export type BackendRestrictionOverview = {
  policy: BackendRestrictionPolicy;
  students: BackendRestrictionStudent[];
  noShowCandidates: BackendNoShowCandidate[];
};

export type BackendPushPublicConfig = {
  enabled: boolean;
  publicKey: string;
};

export class BackendApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const OFFLINE_API_MESSAGE =
  "You are offline. Connect to the internet, then try again.";

export async function onlineFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new BackendApiError(0, OFFLINE_API_MESSAGE, "OFFLINE");
  }

  try {
    return await fetch(input, { ...init, cache: init?.cache ?? "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BackendApiError(
      0,
      typeof navigator !== "undefined" && !navigator.onLine
        ? OFFLINE_API_MESSAGE
        : "Unable to reach WESCOMM services. Check your connection and try again.",
      "NETWORK_UNAVAILABLE"
    );
  }
}

export type BackendConversationMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderType: BackendConversationMessageSenderType;
  message: string;
  intent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  sender?: BackendProfileSummary | null;
};

export type BackendTypingUser = {
  userId: string;
  fullName: string;
  email: string;
  role: BackendAppRole;
  updatedAt: string;
};

export type BackendConversation = {
  id: string;
  studentId: string;
  assignedStaffId: string | null;
  subject: string;
  status: BackendConversationStatus;
  mode: BackendConversationMode;
  category?: string | null;
  priority?: number;
  escalationReason?: string | null;
  escalatedAt?: string | null;
  acceptedAt?: string | null;
  resolvedAt?: string | null;
  botSummary?: string | null;
  lastIntent?: string | null;
  botReplyCount?: number;
  createdAt: string;
  updatedAt: string;
  student?: BackendProfileSummary | null;
  assignedStaff?: BackendProfileSummary | null;
  messages: BackendConversationMessage[];
  typingUsers?: BackendTypingUser[];
};

export type BackendAppRole = "STUDENT" | "STAFF" | "ADMIN";

export type BackendAdminUser = {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
  phone: string | null;
  department: string | null;
  role: BackendAppRole;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackendReportSummary = {
  totalSales: number;
  totalReservations: number;
  pendingReservations: number;
  lowStockItems: number;
  outOfStockItems: number;
  totalProducts: number;
  inventoryValue: number;
  activeUsers: number;
  roleCounts: {
    students: number;
    staff: number;
    admins: number;
  };
  receiptsToVerify: number;
  totalReceipts: number;
  activeConversations: number;
  salesTrend: Array<{
    key: string;
    day: string;
    sales: number;
    receipts: number;
  }>;
  categorySales: Array<{
    category: string;
    amount: number;
  }>;
  reservationStatusDistribution: Array<{
    status: string;
    label: string;
    value: number;
    percent: number;
  }>;
  inventoryInsights: Array<{
    insight: string;
    impact: string;
    recommendation: string;
  }>;
};

export type BackendDashboardProduct = {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: string | number;
  oldPrice?: string | number | null;
  status: "IN_STOCK" | "RESTOCK_SOON" | "OUT_OF_STOCK" | "ON_SALE";
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  category?: BackendCategory | null;
};

export type BackendStaffDashboard = {
  metrics: {
    totalProducts: number;
    itemsToRestock: number;
    pendingReservations: number;
    activeReservations: number;
    receiptsToVerify: number;
    openConversations: number;
  };
  products: BackendDashboardProduct[];
  reservations: BackendReservation[];
  receipts: BackendReceipt[];
};

export type BackendGlobalSearchResult = {
  id: string;
  type: "PRODUCT" | "RESERVATION" | "RECEIPT" | "CONVERSATION";
  title: string;
  subtitle: string;
  section: "inventory" | "reservations" | "receipt-verification" | "messages";
};

export type BackendAuditLog = {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: BackendProfileSummary & {
    role?: BackendAppRole;
  } | null;
};

function formatPrice(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return String(value);
  return `PHP ${numericValue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStatus(status: BackendProduct["status"]) {
  const labels = {
    IN_STOCK: "In Stock",
    RESTOCK_SOON: "Restock Soon",
    OUT_OF_STOCK: "Out of Stock",
    ON_SALE: "On Sale"
  };

  return labels[status];
}

function groupOptions(variants: BackendVariant[] = []) {
  const grouped = new Map<string, string[]>();

  variants.forEach((variant) => {
    const values = grouped.get(variant.optionName) ?? [];
    if (!values.includes(variant.optionValue)) values.push(variant.optionValue);
    grouped.set(variant.optionName, values);
  });

  return Array.from(grouped.entries()).map(([name, values]) => ({ name, values }));
}

export function mapBackendProduct(product: BackendProduct): CartProduct {
  const asset = resolveShopProductAsset(product.name, product.imageUrl);

  return {
    id: product.id,
    name: asset.name,
    category: product.category?.name ?? "Others",
    detail: product.description ?? "",
    price: formatPrice(product.price),
    oldPrice: formatPrice(product.oldPrice),
    status: formatStatus(product.status),
    count: String(product.stock),
    image: asset.image,
    options: groupOptions(product.variants)
  };
}

export async function apiFetch<T>(path: string, init?: RequestInit) {
  const response = await onlineFetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BackendApiError(response.status, payload?.error ?? `API request failed: ${response.status}`, payload?.code, payload?.details);
  }

  return payload as T;
}

export async function authApiFetch<T>(path: string, token: string, init?: RequestInit) {
  const response = await onlineFetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token && token !== COOKIE_SESSION_TOKEN ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    throw new BackendApiError(response.status, payload?.error ?? `API request failed: ${response.status}`, payload?.code, payload?.details);
  }

  return payload as T;
}

export async function updateMyProfileFromApi(token: string, payload: UpdateMyProfilePayload) {
  const data = await authApiFetch<{ profile: BackendAuthProfile }>("/auth/me", token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return data.profile;
}

const PRODUCT_CACHE_TTL_MS = 30_000;
const FAQ_CACHE_TTL_MS = 60_000;
type MappedProducts = ReturnType<typeof mapBackendProduct>[];

let cachedProducts: { value: MappedProducts; expiresAt: number } | null = null;
let pendingProducts: Promise<MappedProducts> | null = null;
let cachedFaqs: { value: BackendFaq[]; expiresAt: number } | null = null;
let pendingFaqs: Promise<BackendFaq[]> | null = null;

export async function getProductsFromApi(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cachedProducts && cachedProducts.expiresAt > Date.now()) {
    return cachedProducts.value;
  }
  if (pendingProducts) return pendingProducts;

  pendingProducts = apiFetch<{ products: BackendProduct[] }>("/products", { cache: "default" })
    .then((data) => {
      const value = data.products.map(mapBackendProduct);
      cachedProducts = { value, expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      pendingProducts = null;
    });
  return pendingProducts;
}

export async function getWishlistFromApi(token: string) {
  const data = await authApiFetch<{ wishlist: BackendWishlistItem[] }>("/wishlist", token);
  return data.wishlist;
}

export async function addWishlistItemFromApi(token: string, productId: string) {
  const data = await authApiFetch<{ wishlistItem: BackendWishlistItem }>(
    `/wishlist/${encodeURIComponent(productId)}`,
    token,
    { method: "POST" }
  );
  return data.wishlistItem;
}

export async function removeWishlistItemFromApi(token: string, productId: string) {
  await authApiFetch<null>(`/wishlist/${encodeURIComponent(productId)}`, token, {
    method: "DELETE"
  });
}

export async function getFaqsFromApi(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cachedFaqs && cachedFaqs.expiresAt > Date.now()) return cachedFaqs.value;
  if (pendingFaqs) return pendingFaqs;

  pendingFaqs = apiFetch<{ faqs: BackendFaq[] }>("/faqs", { cache: "default" })
    .then((data) => {
      cachedFaqs = { value: data.faqs, expiresAt: Date.now() + FAQ_CACHE_TTL_MS };
      return data.faqs;
    })
    .finally(() => {
      pendingFaqs = null;
    });
  return pendingFaqs;
}

export async function getManageFaqsFromApi(token: string) {
  const data = await authApiFetch<{ faqs: BackendFaq[] }>("/faqs/manage", token);
  return data.faqs;
}

export type FaqPayload = {
  question: string;
  answer: string;
  category?: string | null;
  isPublished?: boolean;
};

export async function createFaqFromApi(token: string, payload: FaqPayload) {
  const data = await authApiFetch<{ faq: BackendFaq }>("/faqs", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.faq;
}

export async function updateFaqFromApi(token: string, faqId: string, payload: Partial<FaqPayload>) {
  const data = await authApiFetch<{ faq: BackendFaq }>(`/faqs/${faqId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return data.faq;
}

export async function deleteFaqFromApi(token: string, faqId: string) {
  const data = await authApiFetch<{ faq: BackendFaq }>(`/faqs/${faqId}`, token, {
    method: "DELETE"
  });
  return data.faq;
}

export async function createReservationFromApi(token: string, payload: CreateReservationPayload, idempotencyKey: string) {
  const data = await authApiFetch<{ reservation: BackendReservation; idempotentReplay: boolean }>("/reservations", token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload)
  });
  return data.reservation;
}

export async function getPaymentOptionsFromApi(): Promise<BackendPaymentOptions> {
  const data = await apiFetch<BackendPaymentOptions | { options: BackendPaymentOptions }>("/payments/options");
  const options = "options" in data ? data.options : data;

  return {
    paymongoGcash: {
      enabled: options.paymongoGcash?.enabled === true,
      livemode: options.paymongoGcash?.livemode === true
    }
  };
}

export async function createGcashCheckoutFromApi(
  token: string,
  reservationId: string,
  idempotencyKey: string
) {
  return authApiFetch<{ payment: BackendPaymentSummary; checkoutUrl: string }>("/payments/gcash/checkout", token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ reservationId })
  });
}

export async function getPaymentFromApi(token: string, paymentId: string) {
  const data = await authApiFetch<{ payment: BackendPaymentSummary }>(
    `/payments/${encodeURIComponent(paymentId)}`,
    token
  );
  return data.payment;
}

export async function getReservationPageFromApi(token: string, options: BackendCollectionOptions = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.status) params.set("status", options.status);
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options.dateTo) params.set("dateTo", options.dateTo);
  const query = params.toString();
  const data = await authApiFetch<BackendCursorPage<BackendReservation> & { reservations?: BackendReservation[] }>(
    `/reservations${query ? `?${query}` : ""}`,
    token
  );
  return {
    items: Array.isArray(data.items) ? data.items : data.reservations ?? [],
    nextCursor: data.nextCursor ?? null
  };
}

export async function getReservationsFromApi(token: string) {
  return (await getReservationPageFromApi(token)).items;
}

export async function getReservationFromApi(token: string, reservationId: string) {
  const data = await authApiFetch<{ reservation: BackendReservation }>(
    `/reservations/${encodeURIComponent(reservationId)}`,
    token
  );
  return data.reservation;
}

export async function cancelMyReservationFromApi(token: string, reservationId: string) {
  const data = await authApiFetch<{
    reservation: BackendReservation;
    receipt: BackendReceipt | null;
  }>(`/reservations/${encodeURIComponent(reservationId)}/cancel`, token, {
    method: "POST"
  });
  return data.reservation;
}

export async function updateReservationStatusFromApi(
  token: string,
  reservationId: string,
  status: BackendReservationStatus
) {
  const data = await authApiFetch<{ reservation: BackendReservation; receipt: BackendReceipt | null }>(`/reservations/${reservationId}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return data;
}

export async function confirmReservationNoShowFromApi(token: string, reservationId: string) {
  return authApiFetch<{
    reservation: BackendReservation;
    receipt: BackendReceipt | null;
    policyOutcome: {
      studentId: string;
      offenseId: string;
      consecutiveOffenses: number;
      restriction: { id: string; level: number; endsAt: string | null } | null;
      notificationTitle: string;
      notificationMessage: string;
    } | null;
  }>(`/reservations/${reservationId}/no-show`, token, { method: "POST" });
}

export async function getMyRestrictionSummaryFromApi(token: string) {
  const data = await authApiFetch<{ restrictionSummary: BackendRestrictionSummary }>("/restrictions/me", token);
  return data.restrictionSummary;
}

export async function getRestrictionOverviewFromApi(
  token: string,
  filters: { query?: string; status?: "ALL" | "RESTRICTED" | "CLEAR" } = {}
) {
  const params = new URLSearchParams();
  if (filters.query?.trim()) params.set("query", filters.query.trim());
  if (filters.status) params.set("status", filters.status);
  const suffix = params.size ? `?${params.toString()}` : "";
  const data = await authApiFetch<{ overview: BackendRestrictionOverview }>(`/staff/restrictions${suffix}`, token);
  return data.overview;
}

export async function createStudentRestrictionFromApi(
  token: string,
  payload: { studentId: string; duration: "7_DAYS" | "30_DAYS" | "INDEFINITE"; reason: string }
) {
  const data = await authApiFetch<{ restriction: BackendRestriction }>("/staff/restrictions", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.restriction;
}

export async function liftStudentRestrictionFromApi(token: string, restrictionId: string, reason: string) {
  const data = await authApiFetch<{ restriction: BackendRestriction }>(`/staff/restrictions/${restrictionId}/lift`, token, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
  return data.restriction;
}

export async function overturnStudentOffenseFromApi(token: string, offenseId: string, reason: string) {
  const data = await authApiFetch<{ offense: BackendStudentOffense }>(`/staff/restrictions/offenses/${offenseId}/overturn`, token, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
  return data.offense;
}

export async function getReceiptPageFromApi(token: string, options: BackendCollectionOptions = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.status) params.set("status", options.status);
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options.dateTo) params.set("dateTo", options.dateTo);
  const query = params.toString();
  const data = await authApiFetch<BackendCursorPage<BackendReceipt> & { receipts?: BackendReceipt[] }>(
    `/receipts${query ? `?${query}` : ""}`,
    token
  );
  return {
    items: Array.isArray(data.items) ? data.items : data.receipts ?? [],
    nextCursor: data.nextCursor ?? null
  };
}

export async function getReceiptsFromApi(token: string) {
  return (await getReceiptPageFromApi(token)).items;
}

export async function getReceiptFromApi(token: string, receiptId: string) {
  const data = await authApiFetch<{ receipt: BackendReceipt }>(`/receipts/${encodeURIComponent(receiptId)}`, token);
  return data.receipt;
}

export async function verifyReceiptFromApi(receiptCode: string) {
  const data = await apiFetch<{ receipt: BackendPublicReceiptVerification }>(`/receipts/verify/${encodeURIComponent(receiptCode)}`);
  return data.receipt;
}

export async function markReceiptVerifiedFromApi(token: string, receiptId: string) {
  const data = await authApiFetch<{ receipt: BackendReceipt }>(`/receipts/${receiptId}/verify`, token, {
    method: "PATCH"
  });
  return data.receipt;
}

export async function voidReceiptFromApi(token: string, receiptId: string, reason?: string) {
  const data = await authApiFetch<{ receipt: BackendReceipt }>(`/receipts/${receiptId}/void`, token, {
    method: "PATCH",
    body: JSON.stringify({ reason: reason?.trim() || undefined })
  });
  return data.receipt;
}

export async function getNotificationsFromApi(token: string, options: { limit?: number; before?: string } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.before) params.set("before", options.before);
  const query = params.toString();
  return authApiFetch<{ notifications: BackendNotification[]; nextCursor: string | null }>(
    `/notifications${query ? `?${query}` : ""}`,
    token
  );
}

export async function getUnreadNotificationCountFromApi(token: string) {
  const data = await authApiFetch<{ unreadCount: number }>("/notifications/unread-count", token);
  return data.unreadCount;
}

export async function getPushPublicConfigFromApi() {
  return apiFetch<BackendPushPublicConfig>("/push/public-key");
}

export async function savePushSubscriptionToApi(token: string, subscription: PushSubscriptionJSON) {
  return authApiFetch<{ ok: true }>("/push/subscriptions", token, {
    method: "POST",
    body: JSON.stringify({ subscription })
  });
}

export async function removePushSubscriptionFromApi(token: string, endpoint: string) {
  return authApiFetch<{ ok: true }>("/push/subscriptions", token, {
    method: "DELETE",
    body: JSON.stringify({ endpoint })
  });
}

export async function sendPushTestFromApi(token: string) {
  const data = await authApiFetch<{ notification: BackendNotification }>("/push/test", token, {
    method: "POST"
  });
  return data.notification;
}

export async function markNotificationReadFromApi(token: string, notificationId: string) {
  const data = await authApiFetch<{ notification: BackendNotification | null }>(`/notifications/${notificationId}/read`, token, {
    method: "PATCH"
  });
  return data.notification;
}

export async function markAllNotificationsReadFromApi(token: string) {
  const data = await authApiFetch<{ updatedCount: number }>("/notifications/read-all", token, {
    method: "PATCH"
  });
  return data.updatedCount;
}

export async function getConversationsFromApi(token: string) {
  const data = await authApiFetch<{ conversations: BackendConversation[] }>("/conversations?limit=50", token);
  return data.conversations;
}

export async function getConversationMessagesFromApi(
  token: string,
  conversationId: string,
  options: { limit?: number; before?: string; after?: string } = {}
) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.before) params.set("before", options.before);
  if (options.after) params.set("after", options.after);
  const query = params.toString();
  return authApiFetch<{
    messages: BackendConversationMessage[];
    nextCursor: string | null;
    typingUsers: BackendTypingUser[];
  }>(`/conversations/${conversationId}/messages${query ? `?${query}` : ""}`, token);
}

export async function createConversationFromApi(token: string, payload: { subject: string; message: string }) {
  return authApiFetch<{
    conversation: BackendConversation;
    message: BackendConversationMessage;
    botReplyPending: boolean;
  }>("/conversations", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function sendConversationMessageFromApi(token: string, conversationId: string, message: string) {
  return authApiFetch<{
    message: BackendConversationMessage;
    botMessage: BackendConversationMessage | null;
    botReplyPending: boolean;
    conversation: BackendConversation;
  }>(`/conversations/${conversationId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export async function requestConversationBotReplyFromApi(token: string, conversationId: string, messageId: string) {
  const data = await authApiFetch<{ botMessage: BackendConversationMessage | null }>(
    `/conversations/${conversationId}/messages/${messageId}/bot-reply`,
    token,
    { method: "POST" }
  );
  return data.botMessage;
}

export async function requestConversationHandoffFromApi(token: string, conversationId: string, reason?: string) {
  const data = await authApiFetch<{ conversation: BackendConversation }>(`/conversations/${conversationId}/handoff`, token, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
  return data.conversation;
}

export async function acceptConversationFromApi(token: string, conversationId: string) {
  const data = await authApiFetch<{ conversation: BackendConversation }>(`/conversations/${conversationId}/accept`, token, {
    method: "POST"
  });
  return data.conversation;
}

export async function returnConversationToBotFromApi(token: string, conversationId: string) {
  const data = await authApiFetch<{ conversation: BackendConversation }>(`/conversations/${conversationId}/return-to-bot`, token, {
    method: "POST"
  });
  return data.conversation;
}

export async function updateConversationTypingFromApi(token: string, conversationId: string, isTyping: boolean) {
  const data = await authApiFetch<{ typingUsers: BackendTypingUser[] }>(`/conversations/${conversationId}/typing`, token, {
    method: "PATCH",
    body: JSON.stringify({ isTyping })
  });
  return data.typingUsers;
}

export async function updateConversationStatusFromApi(
  token: string,
  conversationId: string,
  status: BackendConversationStatus
) {
  const data = await authApiFetch<{ conversation: BackendConversation }>(`/conversations/${conversationId}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return data.conversation;
}

export async function getAdminReportSummaryFromApi(token: string) {
  const data = await authApiFetch<{ summary: BackendReportSummary }>("/admin/reports/summary", token);
  return data.summary;
}

export async function getStaffReportSummaryFromApi(token: string) {
  const data = await authApiFetch<{ summary: BackendReportSummary }>("/staff/reports/summary", token);
  return data.summary;
}

export async function getStaffDashboardSummaryFromApi(token: string) {
  const data = await authApiFetch<{ dashboard: BackendStaffDashboard }>("/staff/dashboard/summary", token);
  return data.dashboard;
}

export async function searchStaffWorkspaceFromApi(token: string, query: string, role: "STAFF" | "ADMIN") {
  const routeBase = role === "ADMIN" ? "/admin" : "/staff";
  const data = await authApiFetch<{ results: BackendGlobalSearchResult[] }>(
    `${routeBase}/search?query=${encodeURIComponent(query)}`,
    token
  );
  return data.results;
}

export async function getAdminUsersPageFromApi(
  token: string,
  options: BackendCollectionOptions & { role?: BackendAppRole } = {}
) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.role) params.set("role", options.role);
  const query = params.toString();
  const data = await authApiFetch<BackendCursorPage<BackendAdminUser> & {
    users?: BackendAdminUser[];
    roleCounts?: { students: number; staff: number; admins: number };
  }>(`/admin/users${query ? `?${query}` : ""}`, token);
  return {
    items: Array.isArray(data.items) ? data.items : data.users ?? [],
    nextCursor: data.nextCursor ?? null,
    roleCounts: data.roleCounts ?? { students: 0, staff: 0, admins: 0 }
  };
}

export async function getAdminUsersFromApi(token: string) {
  return (await getAdminUsersPageFromApi(token)).items;
}

export async function getStaffUsersFromApi(token: string) {
  const data = await authApiFetch<{ users: BackendAdminUser[] }>("/staff/users", token);
  return data.users;
}

export async function updateAdminUserRoleFromApi(token: string, userId: string, role: BackendAppRole) {
  const data = await authApiFetch<{ user: BackendAdminUser }>(`/admin/users/${userId}/role`, token, {
    method: "PATCH",
    body: JSON.stringify({ role })
  });
  return data.user;
}

export async function getAdminAuditLogsFromApi(
  token: string,
  filters: { action?: string; entityType?: string; query?: string; cursor?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.query?.trim()) params.set("query", filters.query.trim());
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  const data = await authApiFetch<BackendCursorPage<BackendAuditLog> & { auditLogs?: BackendAuditLog[] }>(
    `/admin/audit-logs${query ? `?${query}` : ""}`,
    token
  );
  return {
    items: Array.isArray(data.items) ? data.items : data.auditLogs ?? [],
    nextCursor: data.nextCursor ?? null
  };
}
