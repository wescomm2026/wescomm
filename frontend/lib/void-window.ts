// Commissary rule: a sale can be voided within 2 days (e.g. the wrong size was
// bought). The backend sets `voidableUntil` on each receipt and enforces it; staff
// are refused after it, admins may still void with a reason.

export const VOID_REASON_PRESETS = [
  "Wrong size — exchange",
  "Customer changed their mind",
  "Recorded by mistake",
  "Duplicate receipt"
] as const;

export type VoidWindowState = {
  /** Staff may still void. */
  open: boolean;
  /** The current user may press Void (open, or an admin override). */
  canVoid: boolean;
  /** Admin voiding after the window. */
  adminOverride: boolean;
  /** Short line for the receipt card, or "" when not applicable. */
  label: string;
};

function formatDeadline(value: Date) {
  return value.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function voidWindowState(voidableUntil: string | null | undefined, role: string | null | undefined, now = Date.now()): VoidWindowState {
  if (!voidableUntil) return { open: true, canVoid: true, adminOverride: false, label: "" };
  const deadline = new Date(voidableUntil);
  // voidableUntil is 11:59 PM; the window closes at the following midnight.
  const open = now < deadline.getTime() + 60_000;
  const isAdmin = role === "ADMIN";
  return {
    open,
    canVoid: open || isAdmin,
    adminOverride: !open && isAdmin,
    label: open ? `Void allowed until ${formatDeadline(deadline)}` : `Void period ended ${formatDeadline(deadline)}`
  };
}
