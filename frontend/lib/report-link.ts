import type { ReportRangePreset } from "@/lib/api";

const presets = new Set<ReportRangePreset>(["TODAY", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH", "CUSTOM", "ALL_TIME"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type ReportLinkFilters = {
  preset: ReportRangePreset;
  collectionChannel: "ALL" | "COMMISSARY" | "TREASURER";
  basis: "COLLECTION" | "COMPLETION";
  from: string;
  to: string;
};

export function readReportLinkFilters(search: string): ReportLinkFilters {
  const params = new URLSearchParams(search);
  const presetValue = params.get("preset") as ReportRangePreset | null;
  const channelValue = params.get("collectionChannel");
  const basisValue = params.get("basis");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    preset: presetValue && presets.has(presetValue) ? presetValue : "LAST_30_DAYS",
    collectionChannel: channelValue === "COMMISSARY" || channelValue === "TREASURER" ? channelValue : "ALL",
    basis: basisValue === "COMPLETION" ? "COMPLETION" : "COLLECTION",
    from: datePattern.test(from) ? from : "",
    to: datePattern.test(to) ? to : ""
  };
}

export function buildReportShareUrl(input: {
  currentUrl: string;
  preset: ReportRangePreset;
  from: string;
  to: string;
  collectionChannel: "ALL" | "COMMISSARY" | "TREASURER";
  basis: "COLLECTION" | "COMPLETION";
}) {
  const url = new URL(input.currentUrl);
  url.search = "";
  url.searchParams.set("preset", input.preset);
  if (input.preset === "CUSTOM" && input.from && input.to) {
    url.searchParams.set("from", input.from);
    url.searchParams.set("to", input.to);
  }
  if (input.collectionChannel !== "ALL") url.searchParams.set("collectionChannel", input.collectionChannel);
  url.searchParams.set("basis", input.basis);
  return url;
}
