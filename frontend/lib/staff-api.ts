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
  lowStockThreshold: number;
};

export type StaffProductSku = {
  id: string;
  code?: string | null;
  stock: number;
  lowStockThreshold: number;
  isActive?: boolean;
  variantIds: string[];
  options: Array<{ optionName: string; optionValue: string }>;
};

export type ProductSaleMode = "SIMPLE" | "CLOTH_ONLY" | "OPTIONS";
export type StaffProductVisibility = "ACTIVE" | "ARCHIVED";

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
  saleMode: ProductSaleMode;
  skuInventoryEnabled?: boolean;
  inventoryReconciledAt?: string | null;
  category?: StaffCategory | null;
  variants?: StaffProductVariant[];
  skus?: StaffProductSku[];
};

export type StaffProductPayload = {
  name: string;
  categoryName: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  oldPrice?: number | null;
  saleMode?: ProductSaleMode;
  stock?: number;
  lowStockThreshold?: number;
  variants?: Array<{
    optionName: string;
    optionValue: string;
    stock: number;
    lowStockThreshold?: number;
  }>;
  notes?: string;
};


export type StaffVariantDefinition = {
  id?: string;
  optionValue: string;
  lowStockThreshold: number;
};

export type StaffProductImageUpload = {
  path: string;
  url: string;
};

export type StaffProductPage = {
  products: StaffProduct[];
  nextCursor: string | null;
  categories?: StaffCategory[];
};

export type StaffProductListOptions = {
  limit?: number;
  cursor?: string | null;
  query?: string;
  categoryId?: string;
  productId?: string;
  status?: StaffProduct["status"];
  visibility?: StaffProductVisibility;
  includeCategories?: boolean;
  signal?: AbortSignal;
};

const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_DIMENSION = 1600;

async function optimizeProductImage(file: File) {
  if (file.size <= 350 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PRODUCT_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.82);
    });
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "product-image";
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified
    });
  } catch {
    return file;
  }
}

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

export async function getStaffProductsPage(token: string, options: StaffProductListOptions = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.categoryId) params.set("categoryId", options.categoryId);
  if (options.productId) params.set("productId", options.productId);
  if (options.status) params.set("status", options.status);
  if (options.visibility) params.set("visibility", options.visibility);
  if (options.includeCategories) params.set("includeCategories", "1");
  const suffix = params.size ? `?${params.toString()}` : "";
  const data = await staffFetch<{
    products: StaffProduct[];
    nextCursor?: string | null;
    categories?: StaffCategory[];
  }>(`/staff/products${suffix}`, token, { signal: options.signal });
  return {
    products: data.products,
    nextCursor: data.nextCursor ?? null,
    categories: data.categories
  } satisfies StaffProductPage;
}

export async function getStaffProducts(token: string) {
  const page = await getStaffProductsPage(token);
  return page.products;
}

export async function getStaffCategories(token: string) {
  const data = await staffFetch<{ categories: StaffCategory[] }>("/staff/products/categories", token);
  return data.categories;
}

export async function restoreStaffProduct(token: string, productId: string) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/restore`, token, {
    method: "POST"
  });
  return data.product;
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

export async function updateStaffProductSaleMode(token: string, productId: string, saleMode: ProductSaleMode) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/sale-mode`, token, {
    method: "PUT",
    body: JSON.stringify({ saleMode })
  });
  return data.product;
}

export async function syncStaffProductVariants(
  token: string,
  productId: string,
  optionName: string,
  variants: StaffVariantDefinition[]
) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/variants`, token, {
    method: "PUT",
    body: JSON.stringify({ optionName, variants })
  });
  return data.product;
}

export async function restockStaffProduct(
  token: string,
  productId: string,
  payload: {
    mode: "add" | "set";
    quantity: number;
    variantQuantities?: Array<{ variantId: string; quantity: number }>;
    notes?: string;
  }
) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/restock`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.product;
}


export type StaffSkuDefinition = {
  variantIds?: string[];
  optionValueKeys?: string[];
  stock: number;
  lowStockThreshold?: number;
};

export type StaffSkuOptionGroupDefinition = {
  key: string;
  optionName: string;
  values: Array<{
    key: string;
    id?: string;
    optionValue: string;
    lowStockThreshold?: number;
  }>;
};

export async function reconcileStaffProductSkuInventory(
  token: string,
  productId: string,
  skus: StaffSkuDefinition[],
  notes?: string,
  optionGroups?: StaffSkuOptionGroupDefinition[]
) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/sku-inventory`, token, {
    method: "PUT",
    body: JSON.stringify({ skus, notes, optionGroups })
  });
  return data.product;
}

export async function restockStaffProductSkus(
  token: string,
  productId: string,
  payload: {
    mode: "add" | "set";
    quantities: Array<{ skuId: string; quantity: number }>;
    notes?: string;
  }
) {
  const data = await staffFetch<{ product: StaffProduct }>(`/staff/products/${productId}/skus/restock`, token, {
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

  if (file.size > MAX_PRODUCT_IMAGE_SOURCE_BYTES) {
    throw new Error("Choose a product image that is 8 MB or smaller.");
  }

  const optimizedFile = await optimizeProductImage(file);
  if (optimizedFile.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("This image is still over 2 MB after optimization. Choose a smaller image.");
  }

  const base64 = await fileToBase64(optimizedFile);
  const data = await staffFetch<{ image: StaffProductImageUpload }>("/staff/uploads/product-image", token, {
    method: "POST",
    body: JSON.stringify({
      fileName: optimizedFile.name,
      contentType: optimizedFile.type,
      base64
    })
  });

  return data.image;
}
