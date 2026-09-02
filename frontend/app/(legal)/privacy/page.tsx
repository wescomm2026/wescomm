import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Database, LockKeyhole, ShieldCheck } from "lucide-react";
import { LegalDocument, LegalList, LegalNote, LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy | WESCOMM",
  description: "How WESCOMM collects, uses, protects, and shares personal and transaction information."
};

const privacyNavigation = [
  { id: "information", label: "Information handled" },
  { id: "uses", label: "Why it is used" },
  { id: "providers", label: "Providers and access" },
  { id: "storage", label: "Cookies and storage" },
  { id: "retention", label: "Retention" },
  { id: "security", label: "Security" },
  { id: "choices", label: "Your choices" },
  { id: "contact", label: "Updates and contact" }
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Data privacy notice"
      title="Privacy Policy"
      summary="This notice explains what information WESCOMM handles, why it is needed, and the choices available to users."
      icon={<ShieldCheck className="size-6" />}
      navigation={privacyNavigation}
    >
      <section className="border-b py-6 sm:py-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { Icon: Database, title: "Operational use", detail: "Data supports accounts, reservations, payments, receipts, and support." },
            { Icon: LockKeyhole, title: "Restricted access", detail: "Authorized roles and providers receive only the access needed for their work." },
            { Icon: Bot, title: "AI privacy boundary", detail: "Recognized identifiers are removed before optional Gemini-assisted routing." }
          ].map(({ Icon, title, detail }) => (
            <article key={title} className="rounded-lg border bg-[#f7faf7] p-4">
              <Icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-extrabold text-foreground">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <LegalSection id="information" title="1. Information WESCOMM handles">
        <LegalList>
          <li>Account information such as name, Wesleyan email address, student number, department, phone number, address, and profile image when provided.</li>
          <li>Reservation and purchase information, including selected products, variants, quantities, pickup schedules, status, receipts, and support records.</li>
          <li>Online payment records such as internal references, PayMongo references, amount, fee, net amount, payment method, status, and timestamps.</li>
          <li>Security information such as sign-in activity, device or browser details, support reference numbers, activity records, notification preferences, and registered notification devices.</li>
          <li>Policy acceptance records, including the authenticated account, policy version, acceptance context, and acceptance time.</li>
          <li>Messages and other information you voluntarily provide when contacting WESCOMM Support.</li>
        </LegalList>
        <LegalNote>
          GCash credentials, GCash PINs, and wallet authorization codes are entered on provider-controlled pages. WESCOMM does not ask for or store them.
        </LegalNote>
      </LegalSection>

      <LegalSection id="uses" title="2. Why the information is used">
        <LegalList>
          <li>Verify identity and protect student, staff, and administrator access.</li>
          <li>Manage products, inventory, reservations, pickup, payments, receipts, and customer support.</li>
          <li>Send transactional emails, status notifications, and security messages.</li>
          <li>Prevent duplicate reservations or charges, detect misuse, reconcile payments, and maintain financial audit records.</li>
          <li>Improve availability, usability, security, reporting, and University commissary operations.</li>
          <li>Meet applicable University, accounting, regulatory, and legal obligations.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="providers" title="3. Service providers and authorized access">
        <p>
          Information is available only to authorized University personnel and service providers that need it to operate WESCOMM. Depending on the feature used, these providers include Supabase for authentication and data services, Vercel for application hosting, Brevo for verification email delivery, PayMongo for online payments, and Google Gemini for optional AI-assisted WesBot routing or wording.
        </p>
        <p>
          Before optional WesBot text is sent to Gemini, WESCOMM removes recognized email addresses, phone numbers, student-number-like values, reservation references, receipt codes, and system reference numbers. WesBot still uses verified WESCOMM information and business rules as the source of factual answers.
        </p>
        <p>
          Each provider handles information under its own terms, security controls, and privacy obligations. WESCOMM does not sell personal information or share it for unrelated advertising.
        </p>
      </LegalSection>

      <LegalSection id="storage" title="4. Cookies and local device storage">
        <p>
          WESCOMM uses essential cookies and browser storage for authentication sessions, remembered sign-in preferences, cart state, security controls, and progressive web app functions. Disabling required storage may prevent login, checkout, or other core functions from working correctly.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="5. Retention">
        <p>
          Account, reservation, payment, receipt, support, and audit records are retained only as long as reasonably necessary for the service, University recordkeeping, dispute handling, security, accounting, and applicable legal requirements. Retention periods may differ by record type.
        </p>
        <p>
          Financial and audit records may need to be preserved even after an account becomes inactive. When information is no longer required, it is deleted, anonymized, or securely archived according to the applicable retention process.
        </p>
        <p>
          A support conversation moved into deletion retention remains recoverable to an administrator for 90 days before permanent purge becomes available. A non-content purge record may remain for accountability. Policy acceptance records are retained with the related account or reservation so WESCOMM can identify which terms applied to the interaction.
        </p>
      </LegalSection>

      <LegalSection id="security" title="6. Security">
        <p>
          WESCOMM uses access controls, encrypted connections, server-side authorization, payment signature verification, audit records, and restricted secret handling. No online service can guarantee absolute security, so users should also protect their email account, verification codes, and devices.
        </p>
        <p>
          Report suspected unauthorized access promptly to <a href="mailto:wescomm2026@gmail.com" className="font-bold text-primary hover:underline">wescomm2026@gmail.com</a>.
        </p>
      </LegalSection>

      <LegalSection id="choices" title="7. Your privacy choices">
        <p>Subject to applicable University rules and law, you may request to:</p>
        <LegalList>
          <li>Access or correct personal information associated with your WESCOMM profile.</li>
          <li>Ask how your information is being used or shared.</li>
          <li>Withdraw optional notification permission or update communication preferences.</li>
          <li>Request deletion, restriction, or review of information when legally and operationally permitted.</li>
          <li>Raise a concern about inaccurate data, unauthorized access, or privacy handling.</li>
        </LegalList>
        <p>
          To protect your account, WESCOMM may verify your identity before acting on a request. Some records cannot be deleted immediately when retention is required for transactions, audits, disputes, or law.
        </p>
        <p>
          Required acceptance of the Terms is separate from optional browser push permission. You may disable browser notifications without losing access to reservation, receipt, or support records in WESCOMM.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="8. Updates and contact">
        <p>
          This notice may be updated when WESCOMM features, providers, University procedures, or legal requirements change. Material updates will be reflected by the effective date shown above.
        </p>
        <p>
          For privacy questions or requests, visit the <Link href="/contact" className="font-bold text-primary hover:underline">Contact page</Link> or email <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Privacy%20Request" className="font-bold text-primary hover:underline">wescomm2026@gmail.com</a> with the subject “WESCOMM Privacy Request.”
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
