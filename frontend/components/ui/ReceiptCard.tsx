import { AssetIcon } from "@/components/ui/AssetIcon";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Receipt = {
  code: string;
  student: string;
  total: string;
  status: string;
  date: string;
};

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{receipt.code}</h3>
          <p className="text-sm text-muted-foreground">{receipt.student} · {receipt.date}</p>
        </div>
        <StatusBadge status={receipt.status} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="font-semibold">{receipt.total}</p>
        <AssetIcon src="/assets/scan-receipt.svg" className="size-9" />
      </div>
    </article>
  );
}
