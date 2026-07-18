import { API_BASE_URL, COOKIE_SESSION_TOKEN, onlineFetch } from "@/lib/api";

const STAFF_TOKEN_KEY = "wescomm_staff_access_token";
const STAFF_EMAIL_KEY = "wescomm_staff_email";

export type StaffCategory = {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string | null;
  isActive?: boolean;
};

export type StaffProductVariant = {
  id?: string;
  optionName: string;
  optionValue: string;
  stock: number;
};

export type StaffProduct = {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: string | number;
  oldPrice?: string | number | null;
  status: "IN_STOCK" | "RESTOCK_SOON" | "OUT_OF_STOCK" | "ON_SALE";
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  category?: StaffCategory | null;
  variants?: StaffProductVariant[];
};

export type StaffProductPayload = {
  name: string;
  categoryName: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  oldPrice?: number | null;
  stock?: number;
  lowStockThreshold?: number;
  notes?: string;
};

export type StaffProductImageUpload = {
  path: string;
  url: string;
};

const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;

      if (!base64) {
        reject(new Error("Unable to read selected image."));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => reject(reader.error ?? new Error("Unable to read selected image."));
    reader.readAsDataURL(file);
  });
}

export function getStoredStaffSession() {
  if (typeof window === "undefined") return { token: "", email: "" };
  window.localStorage.removeItem(STAFF_TOKEN_KEY);
  window.localStorage.removeItem(STAFF_EMAIL_KEY);
  const storedToken = window.sessionStorage.getItem(STAFF_TOKEN_KEY) ?? "";
  if (storedToken && storedToken !== COOKIE_SESSION_TOKEN) {
    window.sessionStorage.removeItem(STAFF_TOKEN_KEY);
    window.sessionStorage.removeItem(STAFF_EMAIL_KEY);
    return { token: "", email: "" };
  }
  return {
    token: storedToken,
    email: window.sessionStorage.getItem(STAFF_EMAIL_KEY) ?? ""
  };
}

export function storeStaffSession(token: string, email: string) {
  window.localStorage.removeItem(STAFF_TOKEN_KEY);
  window.localStorage.removeItem(STAFF_EMAIL_KEY);
  window.sessionStorage.setItem(STAFF_TOKEN_KEY, token ? COOKIE_SESSION_TOKEN : "");
  window.sessionStorage.setItem(STAFF_EMAIL_KEY, email);
}

export function clearStaffSession() {
  window.localStorage.removeItem(STAFF_TOKEN_KEY);
  window.localStorage.removeItem(STAFF_EMAIL_KEY);
  window.sessionStorage.removeItem(STAFF_TOKEN_KEY);
  window.sessionStorage.removeItem(STAFF_EMAIL_KEY);
}

async function staffFetch<T>(path: string, token: string, init?: RequestInit) {
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
    const message = payload?.error ?? `Staff API request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getStaffProducts(token: string) {
  const data = await staffFetch<{ products: StaffProduct[] }>("/staff/products", token);
  return data.products;
}

export async function getStaffCategories(token: string) {
  const data = await staffFetch<{ categories: StaffCategory[] }>("/staff/products/categories", token);
  return data.categories;
}

export async function createStaffProduct(token: string, payload: StaffProductPayload) {
  const data = await staffFetch<{ product: StaffProduct }>("/staff/products", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.product;
}

export async function updateStaffProduct(token: string, productId: string, payload: Partial<StaffProductPayload>) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return data.product;
}

export async function restockStaffProduct(
  token: string,
  productId: string,
  payload: { mode: "add" | "set"; quantity: number; notes?: string }
) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/restock`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.product;
}

export async function archiveStaffProduct(token: string, productId: string) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}`, token, {
    method: "DELETE"
  });
  return data.product;
}

export async function uploadStaffProductImage(token: string, file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Use a PNG, JPG, or WEBP product image.");
  }

  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("Product image must be 2 MB or smaller.");
  }

  const base64 = await fileToBase64(file);
  const data = await staffFetch<{ image: StaffProductImageUpload }>("/staff/uploads/product-image", token, {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      base64
    })
  });

  return data.image;
}
