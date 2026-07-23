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
export type BackendPaymentMethod = "PAY_AT_COMMISSARY" | "E_WALLET_AT_PICKUP" | "CASH" | "GCASH";
export type BackendReceiptStatus = "PENDING" | "VERIFIED" | "VOIDED";
export type BackendNotificationType = "RESERVATION" | "RECEIPT" | "LOW_STOCK" | "MESSAGE" | "SYSTEM" | "BACK_IN_STOCK";
export type BackendConversationStatus = "OPEN" | "RESOLVED";

export type BackendProfileSummary = {
  id: string;
  fullName: string;
  email: string;
  studentNumber?: string | null;
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
    items: Array<{
      name: string;
      variantSummary: string | null;
      quantity: number;
      unitPrice: string | number;
      subtotal: string | number;
    }>;
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
    return await fetch(input, { ...init, cache: "no-store" });
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
  senderId: string;
  message: string;
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

export async function getProductsFromApi() {
  const data = await apiFetch<{ products: BackendProduct[] }>("/products");
  return data.products.map(mapBackendProduct);
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

export async function getFaqsFromApi() {
  const data = await apiFetch<{ faqs: BackendFaq[] }>("/faqs");
  return data.faqs;
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

export async function getReservationsFromApi(token: string) {
  const data = await authApiFetch<{ reservations: BackendReservation[] }>("/reservations", token);
  return data.reservations;
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

export async function getReceiptsFromApi(token: string) {
  const data = await authApiFetch<{ receipts: BackendReceipt[] }>("/receipts", token);
  return data.receipts;
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

export async function getNotificationsFromApi(token: string) {
  const data = await authApiFetch<{ notifications: BackendNotification[] }>("/notifications", token);
  return data.notifications;
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
  const data = await authApiFetch<{ notifications: BackendNotification[] }>("/notifications/read-all", token, {
    method: "PATCH"
  });
  return data.notifications;
}

export async function getConversationsFromApi(token: string) {
  const data = await authApiFetch<{ conversations: BackendConversation[] }>("/conversations", token);
  return data.conversations;
}

export async function createConversationFromApi(token: string, payload: { subject: string; message: string }) {
  const data = await authApiFetch<{ conversation: BackendConversation }>("/conversations", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.conversation;
}

export async function sendConversationMessageFromApi(token: string, conversationId: string, message: string) {
  const data = await authApiFetch<{ message: BackendConversationMessage }>(`/conversations/${conversationId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ message })
  });
  return data.message;
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

export async function getAdminUsersFromApi(token: string) {
  const data = await authApiFetch<{ users: BackendAdminUser[] }>("/admin/users", token);
  return data.users;
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
  filters: { action?: string; entityType?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  const data = await authApiFetch<{ auditLogs: BackendAuditLog[] }>(`/admin/audit-logs${query ? `?${query}` : ""}`, token);
  return data.auditLogs;
}
