export type CollectionChannel = "COMMISSARY" | "TREASURER";

export const COLLECTION_CHANNEL_LABELS: Record<CollectionChannel, string> = {
  COMMISSARY: "Commissary",
  TREASURER: "Treasury"
};

export function collectionChannelLabel(value: CollectionChannel | null | undefined) {
  return value ? COLLECTION_CHANNEL_LABELS[value] : "Not recorded";
}
