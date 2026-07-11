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
import { StudentCartDrawer } from "@/components/cart/StudentCartDrawer";

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

const CART_KEY = "wescomm_student_cart";
const StudentCartContext = createContext<StudentCartContextValue | null>(null);

function createCartItemId(productName: string, selectedOptions: Record<string, string>, productId?: string) {
  const optionKey = Object.entries(selectedOptions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join("|");
  return `${productId || productName}::${optionKey}`;
}

export function StudentCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_KEY);
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
      window.localStorage.removeItem(CART_KEY);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(CART_KEY, JSON.stringify(items));
  }, [items, ready]);

  const openCart = useCallback(() => setOpen(true), []);
  const closeCart = useCallback(() => setOpen(false), []);

  const addItem = useCallback((product: CartProduct, selectedOptions: Record<string, string>, quantity = 1) => {
    const id = createCartItemId(product.name, selectedOptions, product.id);
    setItems((current) => {
      const existing = current.find((item) => item.id === id);
      if (!existing) return [...current, { id, product, quantity, selectedOptions }];

      const limit = Math.max(1, Math.min(Number(product.count), 10));
      return current.map((item) =>
        item.id === id
          ? { ...item, quantity: Math.min(limit, item.quantity + quantity) }
          : item
      );
    });
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const limit = Math.max(1, Math.min(Number(item.product.count), 10));
        return { ...item, quantity: Math.max(1, Math.min(limit, quantity)) };
      })
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);
  const itemCount = useMemo(() => items.reduce((total, item) => total + item.quantity, 0), [items]);

  const value = useMemo(
    () => ({ items, itemCount, open, openCart, closeCart, addItem, updateQuantity, removeItem, clearCart }),
    [items, itemCount, open, openCart, closeCart, addItem, updateQuantity, removeItem, clearCart]
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
