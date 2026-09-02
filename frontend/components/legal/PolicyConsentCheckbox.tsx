import Link from "next/link";
import type { ReactNode } from "react";

export function PolicyConsentCheckbox({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  context
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  context: "account" | "checkout";
}) {
  return (
    <div className="flex items-start gap-3 rounded-control border border-primary/20 bg-primary/5 px-3 py-3 text-sm leading-6 text-muted-foreground">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        disabled={disabled}
        required
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        {context === "account" ? (
          <>
            I agree to the <PolicyLink href="/terms">Terms &amp; Conditions</PolicyLink> and acknowledge that I have read the <PolicyLink href="/privacy">Privacy Policy</PolicyLink>.
          </>
        ) : (
          <>
            I agree to the <PolicyLink href="/terms">Terms &amp; Conditions</PolicyLink> and <PolicyLink href="/refund-policy">Refund &amp; Cancellation Policy</PolicyLink> for this reservation.
          </>
        )}
      </label>
    </div>
  );
}

function PolicyLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-extrabold text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </Link>
  );
}
