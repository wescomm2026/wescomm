import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalList, LegalNote, LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | WESCOMM",
  description: "Cancellation, return, and refund rules for WESCOMM commissary reservations and GCash payments."
};

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Orders and payments"
      title="Refund & Cancellation Policy"
      summary="This policy explains how to request a cancellation, return, or refund for a WESCOMM commissary reservation."
    >
      <LegalSection title="1. Requesting a cancellation">
        <p>
          Contact WESCOMM as soon as possible and include your reservation reference. Cancellation depends on the reservation, payment, and fulfillment status and is not final until staff confirms it.
        </p>
        <LegalList>
          <li>Unpaid reservations may be cancelled by authorized staff before completion, subject to current processing and pickup status.</li>
          <li>A paid reservation requires refund review before it can be treated as cancelled.</li>
          <li>Leaving PayMongo, closing the checkout page, or returning through a cancel link does not by itself cancel a reservation or payment session.</li>
          <li>Completed reservations cannot be reopened. Any item concern after pickup follows the return review below.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. When a refund may be approved">
        <p>A full or partial refund may be considered when:</p>
        <LegalList>
          <li>WESCOMM cannot fulfill a paid reservation because an item is unavailable or the University cancels the transaction.</li>
          <li>A duplicate, incorrect, or mismatched payment is verified against PayMongo and WESCOMM records.</li>
          <li>A valid payment reaches WESCOMM after its reservation or checkout was already cancelled or expired.</li>
          <li>An item released at pickup is materially defective, damaged, or different from the confirmed item.</li>
          <li>A paid cancellation is otherwise approved under University policy or applicable law.</li>
        </LegalList>
        <LegalNote>
          A status of “Refund review required” means staff must investigate. It does not mean that a refund request has already been sent to PayMongo.
        </LegalNote>
      </LegalSection>

      <LegalSection title="3. Return review for picked-up items">
        <p>
          Report an incorrect, damaged, or defective item within seven calendar days after pickup. Keep the receipt or reservation reference and, when reasonably possible, the item and its original packaging for inspection.
        </p>
        <p>
          Change-of-mind, size, color, or variant requests are subject to item condition, stock availability, and University approval. Used, washed, altered, personalized, or damaged-after-release items may be ineligible unless the concern is a verified defect or the law requires another remedy.
        </p>
      </LegalSection>

      <LegalSection title="4. No-shows and missed pickup">
        <p>
          WESCOMM currently provides a 24-hour grace period after the scheduled pickup window before staff may confirm a no-show. Repeated confirmed no-shows may affect reservation access.
        </p>
        <p>
          A paid no-show is not automatically refunded or forfeited. It must be reviewed by authorized WESCOMM staff or University finance personnel based on the item, transaction, and approved school procedure.
        </p>
      </LegalSection>

      <LegalSection title="5. How approved GCash refunds are processed">
        <LegalList>
          <li>Approved online refunds are returned through PayMongo to the original payment method whenever supported.</li>
          <li>WESCOMM does not use a screenshot or a browser success message as the sole basis for a refund.</li>
          <li>Provider processing time begins only after the refund is approved and submitted. Final posting time may depend on PayMongo and GCash.</li>
          <li>Do not send your GCash PIN, OTP, password, or other wallet credentials to WESCOMM.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. How to submit a request">
        <p>
          Use the signed-in <Link href="/student/support" className="font-bold text-primary hover:underline">WESCOMM Support page</Link> or email <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Refund%20or%20Cancellation%20Request" className="font-bold text-primary hover:underline">wescomm2026@gmail.com</a>. Include:
        </p>
        <LegalList>
          <li>Your name and Wesleyan email address.</li>
          <li>The WESCOMM reservation reference.</li>
          <li>The payment date and amount, if paid.</li>
          <li>A clear explanation of the requested cancellation, return, or refund.</li>
          <li>Photos of an item issue when relevant, without exposing wallet credentials or unrelated personal information.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="7. Fair application">
        <p>
          WESCOMM reviews requests using the application record, PayMongo record when applicable, item condition, University policy, and applicable Philippine law. Nothing in this policy removes rights or remedies that cannot lawfully be waived.
        </p>
        <p>
          Questions may be sent through the <Link href="/contact" className="font-bold text-primary hover:underline">Contact page</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
