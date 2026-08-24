"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getProductsFromApi, PRODUCTS_REFRESH_EVENT } from "@/lib/api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";

export type DashboardProducts = Awaited<ReturnType<typeof getProductsFromApi>>;
type DashboardProductsStatus = "loading" | "success" | "error";

type DashboardProductsContextValue = {
  products: DashboardProducts;
  status: DashboardProductsStatus;
};

const DashboardProductsContext = createContext<DashboardProductsContextValue | null>(null);

export function DashboardProductsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<DashboardProducts>([]);
  const [status, setStatus] = useState<DashboardProductsStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    let requestSequence = 0;
    let latestAppliedSequence = 0;

    const refreshProducts = (background = false) => {
      if (!navigator.onLine) {
        if (!background) {
          setStatus("error");
          markWelcomeContentReady(window.location.pathname);
        }
        return;
      }

      const currentRequest = ++requestSequence;
      void getProductsFromApi({ fresh: background })
        .then((nextProducts) => {
          if (cancelled || currentRequest < latestAppliedSequence) return;
          latestAppliedSequence = currentRequest;
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
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshProducts(true);
    };
    refreshProducts();
    const fallbackRefresh = window.setInterval(refreshWhenVisible, 5 * 60_000);
    window.addEventListener(PRODUCTS_REFRESH_EVENT, onProductsRefresh);
    window.addEventListener("focus", onProductsRefresh);
    window.addEventListener("online", onProductsRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(fallbackRefresh);
      window.removeEventListener(PRODUCTS_REFRESH_EVENT, onProductsRefresh);
      window.removeEventListener("focus", onProductsRefresh);
      window.removeEventListener("online", onProductsRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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
