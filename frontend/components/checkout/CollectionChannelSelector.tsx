import { Landmark, Store } from "lucide-react";
import {
  COLLECTION_CHANNEL_LABELS,
  type CollectionChannel
} from "@/lib/collection-channel";

const channels = [
  {
    value: "COMMISSARY" as const,
    detail: "Pay and claim your items at the Commissary counter.",
    Icon: Store
  },
  {
    value: "TREASURER" as const,
    detail: "Pay at the school Treasury, then present the official receipt during pickup.",
    Icon: Landmark
  }
];

export function CollectionChannelSelector({
  value,
  onChange,
  name,
  disabled = false
}: {
  value: CollectionChannel | null;
  onChange: (value: CollectionChannel) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-lg font-extrabold text-foreground sm:text-xl">Where will you pay?</legend>
      <p className="mt-1 text-sm text-muted-foreground">Choose the school office that will collect your payment.</p>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {channels.map(({ value: channel, detail, Icon }) => (
          <label
            key={channel}
            className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition focus-within:ring-2 focus-within:ring-primary/25 ${
              value === channel ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-white hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={channel}
              checked={value === channel}
              onChange={() => onChange(channel)}
              disabled={disabled}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <Icon className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-extrabold text-foreground">{COLLECTION_CHANNEL_LABELS[channel]}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
            </span>
          </label>
        ))}
      </div>
      {value === "TREASURER" ? (
        <p className="mt-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Keep the Treasury official receipt. Staff will record its OR number before releasing your items.
        </p>
      ) : null}
    </fieldset>
  );
}
