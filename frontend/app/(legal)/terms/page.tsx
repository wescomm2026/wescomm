import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalList, LegalNote, LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Terms & Conditions | WESCOMM",
  description: "Terms and conditions for using the WESCOMM commissary reservation and payment service."
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="WESCOMM policies"
      title="Terms & Conditions"
      summary="These terms explain the rules for accessing WESCOMM, reserving commissary items, making payments, and collecting orders."
    >
      <LegalSection title="1. About WESCOMM">
        <p>
          WESCOMM is the Integrated Commissary Management System of Wesleyan University-Philippines. By accessing or using WESCOMM, you agree to these terms and to applicable University policies.
        </p>
        <p>
          WESCOMM supports product browsing, stock visibility, reservations, pickup scheduling, payment tracking, receipts, notifications, and support communication. Available features may change as the service is improved.
        </p>
      </LegalSection>

      <LegalSection title="2. Account eligibility and security">
        <LegalList>
          <li>Use your own authorized Wesleyan account and provide accurate profile and reservation information.</li>
          <li>Keep verification codes, passwords, sessions, and devices secure. WESCOMM staff will never ask for your email OTP or GCash PIN.</li>
          <li>Notify WESCOMM promptly if you believe your account or a transaction was used without permission.</li>
          <li>Access may be limited or suspended for misuse, fraud, repeated unclaimed reservations, or violations of University policy.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. Products, prices, and availability">
        <p>
          Product prices are displayed in Philippine pesos. Stock, variants, images, descriptions, and pickup availability may change. Submitting a reservation does not guarantee fulfillment until WESCOMM staff confirms it.
        </p>
        <p>
          WESCOMM calculates the payable amount from its current product and price records. If a listing or total is clearly incorrect because of a display or pricing error, staff may pause the reservation and contact you before fulfillment.
        </p>
      </LegalSection>

      <LegalSection title="4. Reservations and pickup">
        <LegalList>
          <li>Select the correct item, quantity, variant, and pickup schedule before confirming.</li>
          <li>Monitor the reservation status and notifications for confirmation and pickup instructions.</li>
          <li>Students may directly cancel only their own pending reservation when no confirmed GCash payment or refund issue requires review.</li>
          <li>After confirmation, or when a pending reservation already has a confirmed online GCash payment, cancellation must be handled by authorized staff or an administrator under the refund rules.</li>
          <li>Bring any identification or transaction reference reasonably required for release.</li>
          <li>A reservation may be marked as a no-show only after its pickup window and the current 24-hour grace period have passed.</li>
          <li>Repeated confirmed no-shows may result in warnings or temporary reservation restrictions.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. Payments">
        <p>
          WESCOMM may offer payment at pickup and online GCash through PayMongo. The payment options presented at checkout depend on service availability and the reservation.
        </p>
        <LegalList>
          <li>Review the final amount before leaving WESCOMM for the PayMongo-hosted checkout page.</li>
          <li>A browser redirect, screenshot, or success message alone is not proof of payment.</li>
          <li>An online payment is confirmed only after WESCOMM receives and validates confirmation from the payment service.</li>
          <li>Do not pay again while a transaction is shown as processing or under review. Contact Support first.</li>
        </LegalList>
        <LegalNote>
          Payment confirmation and order fulfillment are separate. A paid status does not by itself mean that an item is confirmed, ready for pickup, released, or completed.
        </LegalNote>
      </LegalSection>

      <LegalSection title="6. Cancellations, returns, and refunds">
        <p>
          Cancellation and refund requests are reviewed according to the reservation status, payment status, item condition, University policy, and applicable law. A request is not effective until WESCOMM confirms it.
        </p>
        <p>
          Paid reservations cannot be treated as cancelled until the required refund review is completed. Full details, eligibility, and request instructions are available in the <Link href="/refund-policy" className="font-bold text-primary hover:underline">Refund and Cancellation Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Acceptable use">
        <p>You must not:</p>
        <LegalList>
          <li>Attempt to access another person&apos;s account, reservation, receipt, payment, or support conversation.</li>
          <li>Manipulate prices, stock, payment references, callback URLs, or transaction status.</li>
          <li>Automate abusive requests, interfere with service availability, or submit false payment evidence.</li>
          <li>Use WESCOMM for unlawful, misleading, or unauthorized activity.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="8. Service availability and changes">
        <p>
          WESCOMM may temporarily disable checkout, payment, or other functions for security, maintenance, provider outages, inventory review, or operational reasons. Existing payment confirmations and financial records will continue to be handled through approved reconciliation procedures.
        </p>
        <p>
          These terms may be updated when the service, University rules, or legal requirements change. The effective date at the top of this page identifies the current version.
        </p>
        <p>
          When WESCOMM presents an acceptance checkbox, you must actively select it before continuing. WESCOMM records the authenticated account, applicable policy version, and acceptance time. A material update may require acceptance of the updated version before a later sign-in or reservation.
        </p>
      </LegalSection>

      <LegalSection title="9. Privacy and contact">
        <p>
          Please review the <Link href="/privacy" className="font-bold text-primary hover:underline">Privacy Policy</Link> to understand how WESCOMM handles personal and transaction data.
        </p>
        <p>
          Questions about these terms may be sent through the <Link href="/contact" className="font-bold text-primary hover:underline">Contact page</Link> or by email to <a href="mailto:wescomm2026@gmail.com" className="font-bold text-primary hover:underline">wescomm2026@gmail.com</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
