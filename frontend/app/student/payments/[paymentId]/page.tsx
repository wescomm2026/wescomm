import { StudentPaymentReturnExperience } from "@/components/payments/StudentPaymentReturnExperience";

export default function Page({ params }: { params: { paymentId: string } }) {
  return <StudentPaymentReturnExperience paymentId={params.paymentId} />;
}
