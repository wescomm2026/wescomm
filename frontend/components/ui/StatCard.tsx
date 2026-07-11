import { AssetIcon } from "@/components/ui/AssetIcon";

type StatCardProps = {
  title: string;
  value: string;
  detail?: string;
  iconSrc?: string;
};

export function StatCard({ title, value, detail, iconSrc }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </div>
        {iconSrc ? (
          <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            <AssetIcon src={iconSrc} className="size-8" />
          </span>
        ) : null}
      </div>
      {detail ? <p className="mt-3 text-sm text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
