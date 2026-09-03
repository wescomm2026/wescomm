import { StudentPaymentReturnExperience } from "@/components/payments/StudentPaymentReturnExperience";

export default async function Page(props: { params: Promise<{ paymentId: string }> }) {
  const params = await props.params;
  return <StudentPaymentReturnExperience paymentId={params.paymentId} />;
}
