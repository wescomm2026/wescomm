import { decryptSensitiveText } from "../utils/field-encryption.js";

export const APP_ROLES = ["STUDENT", "STAFF", "ADMIN"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const PRODUCT_STATUSES = ["IN_STOCK", "RESTOCK_SOON", "OUT_OF_STOCK", "ON_SALE"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PAYMENT_METHODS = ["PAY_AT_COMMISSARY", "E_WALLET_AT_PICKUP", "CASH", "GCASH", "PAYMONGO_GCASH"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ONLINE_PAYMENT_STATUSES = [
  "INITIALIZING",
  "AWAITING_PAYMENT",
  "PAID",
  "EXPIRED",
  "CANCELLED",
  "REFUND_REVIEW_REQUIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED"
] as const;
export type OnlinePaymentStatus = (typeof ONLINE_PAYMENT_STATUSES)[number];

export const ONLINE_PAYMENT_ATTEMPT_STATUSES = [
  "CREATING",
  "CREATE_UNKNOWN",
  "ACTIVE",
  "EXPIRY_REQUESTED",
  "EXPIRED",
  "PAID",
  "FAILED",
  "ABANDONED",
  "MANUAL_REVIEW_REQUIRED"
] as const;
export type OnlinePaymentAttemptStatus = (typeof ONLINE_PAYMENT_ATTEMPT_STATUSES)[number];

export const RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RECEIPT_STATUSES = ["PENDING", "VERIFIED", "VOIDED"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "RESERVATION",
  "RECEIPT",
  "PAYMENT",
  "LOW_STOCK",
  "BACK_IN_STOCK",
  "MESSAGE",
  "SYSTEM"
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CONVERSATION_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_MODES = ["BOT_ACTIVE", "WAITING_FOR_STAFF", "STAFF_ACTIVE", "RESOLVED"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const CONVERSATION_MESSAGE_SENDER_TYPES = ["STUDENT", "BOT", "STAFF", "SYSTEM"] as const;
export type ConversationMessageSenderType = (typeof CONVERSATION_MESSAGE_SENDER_TYPES)[number];

export type RawProfile = {
  id: string;
  full_name: string;
  email: string;
  student_number: string | null;
  phone: string | null;
  department: string | null;
  address: string | null;
  role: AppRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
  phone: string | null;
  department: string | null;
  address: string | null;
  role: AppRole;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RawProfileSummary = Pick<RawProfile, "id" | "full_name" | "email" | "student_number">;

export type ProfileSummary = {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string | null;
};

export function firstRow<T>(row: T | T[] | null | undefined) {
  return Array.isArray(row) ? (row[0] ?? null) : (row ?? null);
}

export function mapProfile(row: RawProfile | RawProfile[] | null | undefined): Profile | null {
  const profile = firstRow(row);
  if (!profile) return null;

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    studentNumber: profile.student_number,
    phone: decryptSensitiveText(profile.phone, "profile.phone"),
    department: profile.department,
    address: decryptSensitiveText(profile.address, "profile.address"),
    role: profile.role,
    avatarUrl: profile.avatar_url,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  };
}

export function mapProfileSummary(
  row: RawProfileSummary | RawProfileSummary[] | null | undefined
): ProfileSummary | null {
  const profile = firstRow(row);
  if (!profile) return null;

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    studentNumber: profile.student_number
  };
}
