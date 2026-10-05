export const studentNav = [
  { href: "/student/dashboard", label: "Home", iconSrc: "/assets/home.svg" },
  { href: "/student/shop", label: "Shop", iconSrc: "/assets/shop.svg" },
  { href: "/student/reservations", label: "Reservations", iconSrc: "/assets/reservations.svg" },
  { href: "/student/receipts", label: "Receipts", iconSrc: "/assets/receipts.svg" },
  { href: "/student/faq", label: "FAQ", iconSrc: "/assets/faq.svg" },
  { href: "/student/support", label: "Support", iconSrc: "/assets/chat-with-wesbot.svg" }
];

export type WorkspaceNavGroup = "Overview" | "Daily operations" | "Catalog & students" | "Insights" | "Team & settings" | "Administration";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  iconSrc: string;
  group: WorkspaceNavGroup;
  adminOnly?: boolean;
};

export const staffNav: WorkspaceNavItem[] = [
  { href: "/staff", label: "Dashboard", iconSrc: "/assets/home.svg", group: "Overview" },
  { href: "/staff/reservations", label: "Reservations", iconSrc: "/assets/reservations.svg", group: "Daily operations" },
  { href: "/staff/walk-in-sales", label: "Walk-in Sales", iconSrc: "/assets/receipts.svg", group: "Daily operations" },
  { href: "/staff/receipt-verification", label: "Receipt Verification", iconSrc: "/assets/scan-receipt.svg", group: "Daily operations" },
  { href: "/staff/pickup-schedule", label: "Pickup Schedule", iconSrc: "/assets/pick-up.svg", group: "Daily operations" },
  { href: "/staff/messages", label: "Messages", iconSrc: "/assets/messages.svg", group: "Daily operations" },
  { href: "/staff/inventory", label: "Inventory", iconSrc: "/assets/all-items.svg", group: "Catalog & students" },
  { href: "/staff/students", label: "Students", iconSrc: "/assets/my-profile.svg", group: "Catalog & students" },
  { href: "/staff/faq-management", label: "FAQ Management", iconSrc: "/assets/faq.svg", group: "Catalog & students" },
  { href: "/staff/reports", label: "Reports", iconSrc: "/assets/orders.svg", group: "Insights" },
  { href: "/staff/users", label: "Team Access", iconSrc: "/assets/privacy.svg", group: "Team & settings" },
  { href: "/staff/settings", label: "Settings", iconSrc: "/assets/settings.svg", group: "Team & settings" }
];

export const adminNav: WorkspaceNavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", iconSrc: "/assets/home.svg", group: "Overview" },
  { href: "/admin/reservations", label: "Reservations", iconSrc: "/assets/reservations.svg", group: "Daily operations" },
  { href: "/admin/walk-in-sales", label: "Walk-in Sales", iconSrc: "/assets/receipts.svg", group: "Daily operations" },
  { href: "/admin/receipt-verification", label: "Receipt Verification", iconSrc: "/assets/scan-receipt.svg", group: "Daily operations" },
  { href: "/admin/pickup-schedule", label: "Pickup Schedule", iconSrc: "/assets/pick-up.svg", group: "Daily operations" },
  { href: "/admin/messages", label: "Messages", iconSrc: "/assets/messages.svg", group: "Daily operations" },
  { href: "/admin/inventory", label: "Inventory", iconSrc: "/assets/all-items.svg", group: "Catalog & students" },
  { href: "/admin/students", label: "Students", iconSrc: "/assets/my-profile.svg", group: "Catalog & students" },
  { href: "/admin/faq-management", label: "FAQ Management", iconSrc: "/assets/faq.svg", group: "Catalog & students" },
  { href: "/admin/reports", label: "Reports", iconSrc: "/assets/orders.svg", group: "Insights" },
  { href: "/admin/users", label: "Team Access", iconSrc: "/assets/privacy.svg", group: "Administration", adminOnly: true },
  { href: "/admin/audit-logs", label: "Audit Logs", iconSrc: "/assets/verified.svg", group: "Administration", adminOnly: true },
  { href: "/admin/settings", label: "Settings", iconSrc: "/assets/settings.svg", group: "Administration" }
];
