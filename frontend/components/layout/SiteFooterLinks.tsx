import Link from "next/link";

const footerLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/contact", label: "Contact Us" }
] as const;

export function SiteFooterLinks({ className = "" }: { className?: string }) {
  return (
    <nav
      aria-label="Policies and support"
      className={`flex flex-wrap gap-x-5 gap-y-3 text-xs ${className}`.trim()}
    >
      {footerLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-sm font-semibold text-inherit underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
