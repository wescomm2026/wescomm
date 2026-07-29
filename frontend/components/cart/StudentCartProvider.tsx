"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { StudentCartDrawer } from "@/components/cart/StudentCartDrawer";
import { getProductsFromApi } from "@/lib/api";
import { productPurchaseLimit } from "@/lib/product-display";

export type CartProduct = {
  id?: string;
  name: string;
  category: string;
  detail: string;
  price: string;
  oldPrice: string;
  status: string;
  count: string;
  image: string;
  options: Array<{
    name: string;
    values: string[];
  }>;
};

export type CartItem = {
  id: string;
  product: CartProduct;
  quantity: number;
  selectedOptions: Record<string, string>;
};

type StudentCartContextValue = {
  items: CartItem[];
  itemCount: number;
  open: boolean;
  openCart: () => void;
  closeCart: () => void;
  addItem: (product: CartProduct, selectedOptions: Record<string, string>, quantity?: number) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
};

const LEGACY_CART_KEY = "wescomm_student_cart";
const CART_KEY_PREFIX = "wescomm_student_cart:v2";
const EMPTY_CART_ITEMS: CartItem[] = [];
const StudentCartContext = createContext<StudentCartContextValue | null>(null);

function cartStorageKey(ownerId: string) {
  return `${CART_KEY_PREFIX}:${ownerId}`;
}

function createCartItemId(productName: string, selectedOptions: Record<string, string>, productId?: string) {
  const optionKey = Object.entries(selectedOptions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join("|");
  return `${productId || productName}::${optionKey}`;
}

export function StudentCartProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useStudentAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loadedOwnerId, setLoadedOwnerId] = useState("");
  const ownerId = authReady ? user?.id ?? "guest" : "";
  const visibleItems = loadedOwnerId === ownerId ? items : EMPTY_CART_ITEMS;

  useEffect(() => {
    setOpen(false);
    setItems([]);
    setLoadedOwnerId("");
    if (!ownerId) return;

    try {
      // The legacy global key could expose one student's cart to another
      // account on the same device, so it is deliberately not migrated.
      window.localStorage.removeItem(LEGACY_CART_KEY);
      const saved = window.localStorage.getItem(cartStorageKey(ownerId));
      if (saved) {
        const parsed = JSON.parse(saved) as Array<Partial<CartItem> & Pick<CartItem, "product" | "quantity">>;
        setItems(
          parsed.map((item) => {
            const selectedOptions = item.selectedOptions ?? {};
            return {
              id: item.id ?? createCartItemId(item.product.name, selectedOptions, item.product.id),
              product: {
                ...item.product,
                options: item.product.options ?? []
              },
              quantity: item.quantity,
              selectedOptions
            };
          })
        );
      }
    } catch {
      window.localStorage.removeItem(cartStorageKey(ownerId));
    }
    setLoadedOwnerId(ownerId);
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId || loadedOwnerId !== ownerId) return;
    try {
      window.localStorage.setItem(cartStorageKey(ownerId), JSON.stringify(items));
    } catch {
      // Storage can be unavailable or full; the active in-memory cart remains usable.
    }
  }, [items, loadedOwnerId, ownerId]);

  useEffect(() => {
    if (!open || !ownerId || loadedOwnerId !== ownerId || !navigator.onLine) return;
    let cancelled = false;

    getProductsFromApi()
      .then((products) => {
        if (cancelled) return;
        const productsById = new Map(
          products
            .filter((product): product is CartProduct & { id: string } => Boolean(product.id))
            .map((product) => [product.id, product])
        );

        setItems((current) =>
          current.map((item) => {
            if (!item.product.id) return item;
            const liveProduct = productsById.get(item.product.id);
            if (!liveProduct) {
              return {
                ...item,
                product: { ...item.product, status: "Out of Stock", count: "0" }
              };
            }
            return {
              ...item,
              product: {
                ...item.product,
                status: liveProduct.status,
                count: liveProduct.count,
                price: liveProduct.price,
                oldPrice: liveProduct.oldPrice
              }
            };
          })
        );
      })
      .catch(() => {
        // The server remains authoritative at checkout; keep the last known
        // cart snapshot when a live availability refresh cannot complete.
      });

    return () => {
      cancelled = true;
    };
  }, [loadedOwnerId, open, ownerId]);

  const openCart = useCallback(() => setOpen(true), []);
  const closeCart = useCallback(() => setOpen(false), []);

  const addItem = useCallback((product: CartProduct, selectedOptions: Record<string, string>, quantity = 1) => {
    if (!ownerId || loadedOwnerId !== ownerId) return;
    const limit = productPurchaseLimit(product);
    if (limit === 0) return;
    const safeQuantity = Math.max(1, Math.min(limit, Math.floor(Number(quantity) || 1)));
    const id = createCartItemId(product.name, selectedOptions, product.id);
    setItems((current) => {
      const existing = current.find((item) => item.id === id);
      if (!existing) return [...current, { id, product, quantity: safeQuantity, selectedOptions }];

      return current.map((item) =>
        item.id === id
          ? { ...item, quantity: Math.min(limit, item.quantity + safeQuantity) }
          : item
      );
    });
  }, [loadedOwnerId, ownerId]);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (!ownerId || loadedOwnerId !== ownerId) return;
    setItems((current) =>
      current.flatMap((item) => {
        if (item.id !== id) return item;
        const limit = productPurchaseLimit(item.product);
        if (limit === 0) return [];
        return [{ ...item, quantity: Math.max(1, Math.min(limit, Math.floor(Number(quantity) || 1))) }];
      })
    );
  }, [loadedOwnerId, ownerId]);

  const removeItem = useCallback((id: string) => {
    if (!ownerId || loadedOwnerId !== ownerId) return;
    setItems((current) => current.filter((item) => item.id !== id));
  }, [loadedOwnerId, ownerId]);

  const clearCart = useCallback(() => {
    if (!ownerId || loadedOwnerId !== ownerId) return;
    setItems([]);
  }, [loadedOwnerId, ownerId]);
  const itemCount = useMemo(() => visibleItems.reduce((total, item) => total + item.quantity, 0), [visibleItems]);

  const value = useMemo(
    () => ({ items: visibleItems, itemCount, open, openCart, closeCart, addItem, updateQuantity, removeItem, clearCart }),
    [visibleItems, itemCount, open, openCart, closeCart, addItem, updateQuantity, removeItem, clearCart]
  );

  return (
    <StudentCartContext.Provider value={value}>
      {children}
      <StudentCartDrawer />
    </StudentCartContext.Provider>
  );
}

export function useStudentCart() {
  const context = useContext(StudentCartContext);
  if (!context) throw new Error("useStudentCart must be used inside StudentCartProvider");
  return context;
}
