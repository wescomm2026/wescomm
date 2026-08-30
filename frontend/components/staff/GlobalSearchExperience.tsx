"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, MessageCircleMore, PackageSearch, ReceiptText, Search } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  searchStaffWorkspaceFromApi,
  isRequestAbortError,
  type BackendGlobalSearchResult
} from "@/lib/api";

function resultHref(result: BackendGlobalSearchResult, routeBase: "/staff" | "/admin") {
  const parameter = result.type === "PRODUCT"
    ? "productId"
    : result.type === "RESERVATION"
      ? "reservationId"
      : result.type === "RECEIPT"
        ? "receiptId"
        : "conversationId";
  return `${routeBase}/${result.section}?${parameter}=${encodeURIComponent(result.id)}`;
}

function resultIcon(type: BackendGlobalSearchResult["type"]) {
  if (type === "PRODUCT") return PackageSearch;
  if (type === "RECEIPT") return ReceiptText;
  if (type === "CONVERSATION") return MessageCircleMore;
  return Search;
}

export function GlobalSearchExperience({ routeBase }: { routeBase: "/staff" | "/admin" }) {
  const { user, ready } = useStudentAuth();
  const searchParams = useSearchParams();
  const query = searchParams.get("query")?.trim() ?? "";
  const [results, setResults] = useState<BackendGlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequenceRef.current;
    if (!ready || !user?.accessToken || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const requestController = new AbortController();
    setLoading(true);
    setError("");
    void searchStaffWorkspaceFromApi(
      user.accessToken,
      query,
      routeBase === "/admin" ? "ADMIN" : "STAFF",
      requestController.signal
    )
      .then((rows) => {
        if (requestId === requestSequenceRef.current) setResults(rows);
      })
      .catch((searchError) => {
        if (requestId === requestSequenceRef.current && !isRequestAbortError(searchError)) {
          setError(userFacingErrorMessage(searchError, "Unable to search WESCOMM."));
        }
      })
      .finally(() => {
        if (requestId === requestSequenceRef.current) setLoading(false);
      });
    return () => {
      requestController.abort();
    };
  }, [query, ready, routeBase, user?.accessToken]);

  const groupedResults = useMemo(() => results.reduce<Record<string, BackendGlobalSearchResult[]>>((groups, result) => {
    (groups[result.type] ??= []).push(result);
    return groups;
  }, {}), [results]);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold uppercase text-primary">Workspace search</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Results for “{query}”</h1>
        <p className="mt-2 text-sm text-[#68746d]">Products, reservations, receipts, and student support conversations are searched together.</p>
      </header>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <p className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d]">Searching WESCOMM…</p> : null}
      {!loading && query.length < 2 ? <p className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d]">Enter at least two characters in the header search.</p> : null}
      {!loading && query.length >= 2 && !results.length && !error ? <p className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d]">No matching records were found.</p> : null}

      {Object.entries(groupedResults).map(([type, rows]) => (
        <section key={type} className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <h2 className="border-b border-[#e7eee8] bg-[#f6faf6] px-4 py-3 text-sm font-extrabold text-[#253129]">{type.replaceAll("_", " ")}</h2>
          <div className="divide-y divide-[#edf1ed]">
            {rows.map((result) => {
              const Icon = resultIcon(result.type);
              return (
                <Link key={`${result.type}-${result.id}`} href={resultHref(result, routeBase)} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-4 hover:bg-[#f4f8f4]">
                  <span className="grid size-10 place-items-center rounded-full bg-[#eaf4ea] text-primary"><Icon className="size-5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#253129]">{result.title}</span>
                    <span className="mt-1 block truncate text-xs text-[#68746d]">{result.subtitle}</span>
                  </span>
                  <ArrowRight className="size-4 text-primary" />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
