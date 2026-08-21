import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalList, LegalNote, LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Contact Us | WESCOMM",
  description: "Contact WESCOMM for reservation, payment, refund, account, and privacy support."
};

export default function ContactPage() {
  return (
    <LegalDocument
      eyebrow="WESCOMM support"
      title="Contact Us"
      summary="Reach the WESCOMM team for help with reservations, GCash payments, receipts, account access, or privacy concerns."
    >
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-[#cfe0d1] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.035)] sm:p-8">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Email support</p>
          <h2 className="mt-3 text-xl font-extrabold text-[#152019]">Send us an email</h2>
          <a
            href="mailto:wescomm2026@gmail.com"
            className="mt-4 inline-flex break-all rounded-md bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#075528] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            wescomm2026@gmail.com
          </a>
          <p className="mt-4 text-sm leading-6 text-[#59655e]">Use the email address connected to your WESCOMM account whenever possible.</p>
        </div>

        <div className="rounded-2xl border border-[#cfe0d1] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.035)] sm:p-8">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Campus location</p>
          <h2 className="mt-3 text-xl font-extrabold text-[#152019]">Wesleyan University-Philippines</h2>
          <address className="mt-4 text-sm not-italic leading-7 text-[#59655e]">
            Mabini Extension<br />
            Cabanatuan City, Nueva Ecija 3100<br />
            Philippines
          </address>
        </div>
      </section>

      <LegalSection title="For faster assistance">
        <p>Include only the information needed to identify and investigate your concern:</p>
        <LegalList>
          <li>Your full name and Wesleyan email address.</li>
          <li>Your reservation, receipt, or payment reference number.</li>
          <li>The date, amount, and status shown in WESCOMM for a payment concern.</li>
          <li>A short description of what happened and the result you are requesting.</li>
        </LegalList>
        <LegalNote>
          Never send your email verification code, password, GCash PIN, GCash OTP, API key, or full payment credentials. WESCOMM staff will not ask for them.
        </LegalNote>
      </LegalSection>

      <LegalSection title="Choose the right support path">
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Reservation%20Support" className="rounded-xl border border-[#d9e5da] p-4 font-bold text-primary transition-colors hover:bg-[#f3f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Reservation or pickup concern</a>
          <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Payment%20Support" className="rounded-xl border border-[#d9e5da] p-4 font-bold text-primary transition-colors hover:bg-[#f3f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">GCash payment concern</a>
          <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Refund%20or%20Cancellation%20Request" className="rounded-xl border border-[#d9e5da] p-4 font-bold text-primary transition-colors hover:bg-[#f3f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Refund or cancellation request</a>
          <a href="mailto:wescomm2026@gmail.com?subject=WESCOMM%20Privacy%20Request" className="rounded-xl border border-[#d9e5da] p-4 font-bold text-primary transition-colors hover:bg-[#f3f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Privacy or account-data request</a>
        </div>
        <p>
          Signed-in students may also open the <Link href="/student/support" className="font-bold text-primary hover:underline">Support page</Link> to keep the concern connected to their WESCOMM account.
        </p>
      </LegalSection>

      <LegalSection title="Policies">
        <p>
          Before submitting a transaction concern, you may review the <Link href="/terms" className="font-bold text-primary hover:underline">Terms & Conditions</Link>, <Link href="/privacy" className="font-bold text-primary hover:underline">Privacy Policy</Link>, and <Link href="/refund-policy" className="font-bold text-primary hover:underline">Refund & Cancellation Policy</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
