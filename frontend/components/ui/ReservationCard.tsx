import { AssetIcon } from "@/components/ui/AssetIcon";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Reservation = {
  item: string;
  student: string;
  ref: string;
  status: string;
  pickup: string;
};

export function ReservationCard({ reservation }: { reservation: Reservation }) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{reservation.item}</h3>
          <p className="text-sm text-muted-foreground">{reservation.student} · {reservation.ref}</p>
        </div>
        <StatusBadge status={reservation.status} />
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <AssetIcon src="/assets/pick-up.svg" className="size-6" />
        {reservation.pickup}
      </p>
    </article>
  );
}
