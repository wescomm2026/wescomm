import { API_BASE_URL, BackendApiError, COOKIE_SESSION_TOKEN, onlineFetch } from "@/lib/api";

export type StaffInventoryBatchResult = {
  batches: Array<{
    id: string;
    batchCode: string;
    skuId: string | null;
    quantityReceived: number;
    quantityRemaining: number;
    unitCost: string | number;
    costVerified: boolean;
    receivedAt: string;
    supplierNote: string | null;
    sku: { code: string | null; optionSnapshot: Array<{ optionName: string; optionValue: string }> } | null;
  }>;
  summary: {
    latestCost: number | null;
    averageInventoryCost: number | null;
    inventoryValue: number;
    unverifiedQuantity: number;
  };
};

async function inventoryBatchFetch(path: string, token: string, init?: RequestInit) {
  const response = await onlineFetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token && token !== COOKIE_SESSION_TOKEN ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BackendApiError(
      response.status,
      payload?.error ?? "",
      payload?.code,
      payload?.details,
      payload?.requestId ?? response.headers.get("X-Request-Id") ?? undefined
    );
  }
  return payload as StaffInventoryBatchResult;
}

export function getStaffInventoryBatches(token: string, productId: string) {
  return inventoryBatchFetch(`/staff/products/${productId}/batches`, token);
}

export function verifyStaffOpeningBatchCost(token: string, productId: string, batchId: string, unitCost: number) {
  return inventoryBatchFetch(`/staff/products/${productId}/batches/${batchId}/cost`, token, {
    method: "PATCH",
    body: JSON.stringify({ unitCost })
  });
}
