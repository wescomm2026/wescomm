"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getProductsFromApi } from "@/lib/api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";

export type DashboardProducts = Awaited<ReturnType<typeof getProductsFromApi>>;
type DashboardProductsStatus = "loading" | "success" | "error";

type DashboardProductsContextValue = {
  products: DashboardProducts;
  status: DashboardProductsStatus;
};

const DashboardProductsContext = createContext<DashboardProductsContextValue | null>(null);
let pendingProductsRequest: Promise<DashboardProducts> | null = null;

function loadDashboardProducts() {
  if (!pendingProductsRequest) {
    pendingProductsRequest = getProductsFromApi().finally(() => {
      pendingProductsRequest = null;
    });
  }

  return pendingProductsRequest;
}

export function DashboardProductsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<DashboardProducts>([]);
  const [status, setStatus] = useState<DashboardProductsStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    loadDashboardProducts()
      .then((nextProducts) => {
        if (cancelled) return;
        setProducts(nextProducts);
        setStatus("success");
      })
      .catch(() => {
        if (cancelled) return;
        setProducts([]);
        setStatus("error");
      })
      .finally(() => {
        if (!cancelled) markWelcomeContentReady(window.location.pathname);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardProductsContext.Provider value={{ products, status }}>
      {children}
    </DashboardProductsContext.Provider>
  );
}

export function useDashboardProducts() {
  const value = useContext(DashboardProductsContext);
  if (!value) throw new Error("useDashboardProducts must be used within DashboardProductsProvider.");
  return value;
}
