import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { PublicReceiptVerification } from "@/components/receipts/PublicReceiptVerification";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Verify Receipt | WESCOMM",
  description: "Verify a WESCOMM digital receipt using masked public information."
};

export default function VerifyReceiptPage() {
  return (
    <LegalDocument
      eyebrow="WESCOMM Receipt Verification"
      title="Verify a Receipt"
      summary="Visitors may confirm whether a WESCOMM receipt exists while personal and detailed purchase information stays masked."
      meta="Official public lookup · Privacy-masked results"
      icon={<ReceiptText className="size-6" />}
      variant="tool"
    >
      <PublicReceiptVerification />
    </LegalDocument>
  );
}
