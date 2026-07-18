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

    const refreshProducts = (background = false) => {
      if (!navigator.onLine) {
        if (!background) {
          setStatus("error");
          markWelcomeContentReady(window.location.pathname);
        }
        return;
      }

      void loadDashboardProducts()
        .then((nextProducts) => {
          if (cancelled) return;
          setProducts(nextProducts);
          setStatus("success");
        })
        .catch(() => {
          if (cancelled || background) return;
          setProducts([]);
          setStatus("error");
        })
        .finally(() => {
          if (!cancelled && !background) markWelcomeContentReady(window.location.pathname);
        });
    };

    const onProductsRefresh = () => refreshProducts(true);
    refreshProducts();
    window.addEventListener("wescomm:products-refresh", onProductsRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("wescomm:products-refresh", onProductsRefresh);
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
