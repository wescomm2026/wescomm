"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ChevronRight, Edit3, Filter, Plus, RefreshCw, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import { isRequestAbortError } from "@/lib/api";
import {
  archiveStaffProduct,
  clearStaffSession,
  createStaffProduct,
  getStaffProductsPage,
  getStoredStaffSession,
  restockStaffProduct,
  restoreStaffProduct,
  syncStaffProductVariants,
  updateStaffProduct,
  updateStaffProductSaleMode,
  uploadStaffProductImage,
  type ProductSaleMode,
  type StaffCategory,
  type StaffProductVisibility
} from "@/lib/staff-api";
import { isUniformClothOnly } from "@/lib/product-display";
import { WUP_DEFAULT_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";
import { cn } from "@/lib/utils";
import {
  mergeUniqueById,
  Product,
  stockStatusOptions,
  SizeVariantDraft,
  ManageSection,
  variantDraftKey,
  defaultSizeVariantDrafts,
  sortSizeVariants,
  preferredSizeOptionName,
  stockStatusFromQuery,
  stockStatusForApi,
  mapStaffProduct,
  PageHeading,
  Toolbar,
  Notice
} from "@/components/staff/StaffOperationsShared";

const ProductOptionsManager = dynamic(
  () => import("@/components/staff/ProductOptionsManager").then((module) => module.ProductOptionsManager),
  { ssr: false }
);
const SkuInventoryDialog = dynamic(
  () => import("@/components/staff/SkuInventoryDialog").then((module) => module.SkuInventoryDialog),
  { ssr: false }
);

function inventoryVisibilityFromQuery(value: string | null): StaffProductVisibility {
  return value?.trim().toUpperCase() === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
}

export function StaffInventoryExperience() {
  const confirm = useConfirmationDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<StaffCategory[]>([]);
  const [token, setToken] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [visibility, setVisibility] = useState<StaffProductVisibility>("ACTIVE");
  const deferredInventorySearch = useDeferredValue(search);
  const [nextProductCursor, setNextProductCursor] = useState<string | null>(null);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [archivingProductId, setArchivingProductId] = useState("");
  const [restoringProductId, setRestoringProductId] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [manageSection, setManageSection] = useState<ManageSection>("menu");
  const [restockingProduct, setRestockingProduct] = useState<Product | null>(null);
  const [skuInventoryProduct, setSkuInventoryProduct] = useState<Product | null>(null);
  const [activeRestockOptionName, setActiveRestockOptionName] = useState("");
  const [restockMode, setRestockMode] = useState<"add" | "set">("add");
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockVariantQuantities, setRestockVariantQuantities] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [addImageFile, setAddImageFile] = useState<File | null>(null);
  const [addImagePreview, setAddImagePreview] = useState("");
  const [addSaleMode, setAddSaleMode] = useState<ProductSaleMode>("SIMPLE");
  const [addSizeVariants, setAddSizeVariants] = useState<SizeVariantDraft[]>(defaultSizeVariantDrafts);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState("");
  const [editSizeVariants, setEditSizeVariants] = useState<SizeVariantDraft[]>([]);
  const [editSizeOptionName, setEditSizeOptionName] = useState("Size");
  const [savingVariants, setSavingVariants] = useState(false);
  const inventoryFilterReadyRef = useRef(false);
  const inventoryRequestRef = useRef(0);
  const inventoryAbortRef = useRef<AbortController | null>(null);
  const skuInventoryReturnFocusRef = useRef<HTMLElement | null>(null);
  const { user, ready, openAuth, logout } = useStudentAuth();

  const loadProducts = async (authToken = token, options: {
    cursor?: string | null;
    append?: boolean;
    query?: string;
    status?: string;
    productId?: string;
    visibility?: StaffProductVisibility;
  } = {}) => {
    if (!authToken) {
      inventoryRequestRef.current += 1;
      inventoryAbortRef.current?.abort();
      setLoading(false);
      return;
    }

    const requestId = ++inventoryRequestRef.current;
    inventoryAbortRef.current?.abort();
    const requestController = new AbortController();
    inventoryAbortRef.current = requestController;
    const append = Boolean(options.append && options.cursor);
    if (append) setLoadingMoreProducts(true);
    else setLoading(true);
    setError("");

    try {
      const productPage = await getStaffProductsPage(authToken, {
        limit: 25,
        cursor: options.cursor,
        query: options.query ?? deferredInventorySearch,
        productId: options.productId,
        status: stockStatusForApi(options.status ?? status),
        visibility: options.visibility ?? visibility,
        includeCategories: !append,
        signal: requestController.signal
      });
      if (requestId !== inventoryRequestRef.current) return;
      const mappedProducts = productPage.products.map(mapStaffProduct);
      setProducts((current) => append
        ? mergeUniqueById([...current, ...mappedProducts])
        : mappedProducts);
      setNextProductCursor(productPage.nextCursor);
      if (productPage.categories) setCategories(productPage.categories);
      const productId = options.productId ?? new URL(window.location.href).searchParams.get("productId");
      const targetedProduct = mappedProducts.find((product) => product.id === productId);
      if (targetedProduct) setSearch(targetedProduct.name);
    } catch (loadError) {
      if (requestId !== inventoryRequestRef.current || isRequestAbortError(loadError)) return;
      const message = loadError instanceof Error ? loadError.message : "Unable to load staff inventory.";
      setError(message);
      if (message.toLowerCase().includes("token") || message.toLowerCase().includes("access")) {
        clearStaffSession();
        setToken("");
        void logout();
        openAuth();
      }
    } finally {
      if (requestId === inventoryRequestRef.current) {
        setLoading(false);
        setLoadingMoreProducts(false);
      }
    }
  };

  useRealtimeRefresh(["inventory"], () => {
    if (token) void loadProducts(token, { query: deferredInventorySearch, status, visibility });
  });

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const initialVisibility = inventoryVisibilityFromQuery(params.get("visibility"));
    setSearch(params.get("query") ?? "");
    setStatus(stockStatusFromQuery(params.get("status")));
    setVisibility(initialVisibility);
    if (!ready) return;

    const session = getStoredStaffSession();
    const authToken = session.token || user?.accessToken || "";
    const email = session.email || user?.email || "";

    setToken(authToken);
    setStaffEmail(email);
    void loadProducts(authToken, {
      query: params.get("query") ?? "",
      status: stockStatusFromQuery(params.get("status")),
      visibility: initialVisibility,
      productId: params.get("productId") ?? undefined
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.accessToken, user?.email]);

  useEffect(() => () => inventoryAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!token) return;
    if (!inventoryFilterReadyRef.current) {
      inventoryFilterReadyRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadProducts(token, { query: deferredInventorySearch, status, visibility });
    }, 200);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredInventorySearch, status, token, visibility]);

  const filtered = products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase()) &&
    (status === "All" || product.status === status)
  );
  const selectedTemplate = WUP_DEFAULT_PRODUCT_TEMPLATES.find((item) => item.id === selectedTemplateId) ?? null;
  const assetTemplates = WUP_DEFAULT_PRODUCT_TEMPLATES.filter((item) => item.source === "asset");
  const priceListTemplates = WUP_DEFAULT_PRODUCT_TEMPLATES.filter((item) => item.source === "price-list");
  const selectedTemplateDescription = selectedTemplate?.description ?? "";
  const addHasSizeVariants = addSaleMode === "OPTIONS";
  const addSizeStockTotal = addSizeVariants.reduce(
    (total, variant) => total + Math.max(0, Number(variant.stock) || 0),
    0
  );
  const editingVariantStructureUnlocked = Boolean(
    editingProduct
    && (
      editingProduct.skuInventoryEnabled
      || (editingProduct.stock === 0 && editingProduct.variants.every((variant) => variant.stock === 0))
    )
  );

  const changeVisibility = (nextVisibility: StaffProductVisibility) => {
    if (nextVisibility === visibility) return;
    setVisibility(nextVisibility);
    setStatus("All");
    const url = new URL(window.location.href);
    url.searchParams.delete("status");
    if (nextVisibility === "ARCHIVED") url.searchParams.set("visibility", "archived");
    else url.searchParams.delete("visibility");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const openAddProduct = () => {
    setSelectedTemplateId("");
    setAddImageFile(null);
    setAddImagePreview("");
    setAddSaleMode("SIMPLE");
    setAddSizeVariants(defaultSizeVariantDrafts());
    setAdding(true);
  };

  const closeAddProduct = () => {
    setSelectedTemplateId("");
    setAddImageFile(null);
    setAddImagePreview("");
    setAddSaleMode("SIMPLE");
    setAddSizeVariants(defaultSizeVariantDrafts());
    setAdding(false);
  };

  const selectAddTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setAddImageFile(null);
    setAddSizeVariants(defaultSizeVariantDrafts());

    const template = WUP_DEFAULT_PRODUCT_TEMPLATES.find((item) => item.id === templateId);
    const suggestedMode: ProductSaleMode = template?.categoryName === "Uniforms"
      ? (isUniformClothOnly({ name: template.name, category: template.categoryName }) ? "CLOTH_ONLY" : "OPTIONS")
      : "SIMPLE";
    setAddSaleMode(template ? suggestedMode : "SIMPLE");
    setAddImagePreview(template?.imageUrl ?? "");
  };

  const openEditor = (product: Product) => {
    setManageSection("menu");
    setEditImageFile(null);
    setEditImagePreview(product.imageUrl);
    const sizeOptionName = preferredSizeOptionName(product.variants);
    setEditSizeOptionName(sizeOptionName);
    setEditSizeVariants(sortSizeVariants(product.variants.filter(
      (variant) => variant.optionName.trim().toLowerCase() === sizeOptionName.trim().toLowerCase()
    )).map((variant) => ({
      key: variant.id,
      id: variant.id,
      value: variant.optionValue,
      stock: String(variant.stock),
      lowStockThreshold: String(variant.lowStockThreshold)
    })));
    setEditingProduct(product);
  };

  const closeEditor = () => {
    setManageSection("menu");
    setEditImageFile(null);
    setEditImagePreview("");
    setEditSizeVariants([]);
    setEditSizeOptionName("Size");
    setEditingProduct(null);
  };

  const saveVariantSettings = async () => {
    if (!editingProduct) return;
    setSavingVariants(true);
    setError("");

    try {
      const variants = editSizeVariants.map((variant) => {
        const optionValue = variant.value.trim();
        const lowStockThreshold = Number(variant.lowStockThreshold);
        if (!optionValue) throw new Error("Every size must have a name.");
        if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
          throw new Error(`${optionValue} low-stock alert must be a whole number of zero or more.`);
        }
        return {
          ...(variant.id ? { id: variant.id } : {}),
          optionValue,
          lowStockThreshold
        };
      });
      const duplicate = variants.find((variant, index) =>
        variants.findIndex((candidate) => candidate.optionValue.toLowerCase() === variant.optionValue.toLowerCase()) !== index
      );
      if (duplicate) throw new Error(`${duplicate.optionValue} is listed more than once.`);

      const confirmed = await confirm({
        title: "Save these size settings?",
        description: `${editingProduct.name} will use the ${variants.length} size value${variants.length === 1 ? "" : "s"} shown here for student selection and inventory tracking.`,
        confirmLabel: "Save size settings",
        tone: "warning"
      });
      if (!confirmed) return;

      const updated = await syncStaffProductVariants(token, editingProduct.id, editSizeOptionName, variants);
      const mapped = mapStaffProduct(updated);
      setProducts((current) => current.map((product) => product.id === mapped.id ? mapped : product));
      setEditingProduct(mapped);
      const sizeOptionName = preferredSizeOptionName(mapped.variants);
      setEditSizeOptionName(sizeOptionName);
      setEditSizeVariants(sortSizeVariants(mapped.variants.filter(
        (variant) => variant.optionName.trim().toLowerCase() === sizeOptionName.trim().toLowerCase()
      )).map((variant) => ({
        key: variant.id,
        id: variant.id,
        value: variant.optionValue,
        stock: String(variant.stock),
        lowStockThreshold: String(variant.lowStockThreshold)
      })));
      setNotice(`${mapped.name} size settings updated.`);
    } catch (variantError) {
      setError(variantError instanceof Error ? variantError.message : "Unable to update size settings.");
    } finally {
      setSavingVariants(false);
    }
  };

  const chooseAddImage = (fileList: FileList | null) => {
    const file = fileList?.[0] ?? null;
    setAddImageFile(file);
    setAddImagePreview(file ? URL.createObjectURL(file) : "");
  };

  const chooseEditImage = (fileList: FileList | null) => {
    const file = fileList?.[0] ?? null;
    setEditImageFile(file);
    setEditImagePreview(file ? URL.createObjectURL(file) : editingProduct?.imageUrl ?? "");
  };

  const openRestock = (product: Product) => {
    setError("");
    if (product.saleMode === "OPTIONS") {
      if (product.variants.length === 0) {
        openEditor(product);
        setManageSection("options");
        return;
      }
      skuInventoryReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setSkuInventoryProduct(product);
      return;
    }
    const preferredOption = preferredSizeOptionName(product.variants);
    const optionNames = Array.from(new Set(product.variants.map((variant) => variant.optionName)));
    setActiveRestockOptionName(optionNames.includes(preferredOption) ? preferredOption : optionNames[0] ?? "");
    setRestockingProduct(product);
    setRestockMode("add");
    setRestockQuantity("");
    setRestockVariantQuantities(Object.fromEntries(product.variants.map((variant) => [variant.id, "0"])));
  };

  const changeRestockMode = (mode: "add" | "set") => {
    if (!restockingProduct) return;
    setError("");
    setRestockMode(mode);
    setRestockQuantity(mode === "set" ? String(restockingProduct.stock) : "");
    setRestockVariantQuantities(Object.fromEntries(restockingProduct.variants.map((variant) => [
      variant.id,
      mode === "set" ? String(variant.stock) : "0"
    ])));
  };

  const saveRestock = async () => {
    if (!restockingProduct) return;

    const restockVariants = restockingProduct.saleMode === "OPTIONS" ? restockingProduct.variants : [];
    const variantGroups = Array.from(restockVariants.reduce((groups, variant) => {
      const values = groups.get(variant.optionName) ?? [];
      values.push(variant);
      groups.set(variant.optionName, values);
      return groups;
    }, new Map<string, Product["variants"]>()).values());
    const automaticallySynchronized = variantGroups.length > 0 && variantGroups.every((group) => group.length === 1);
    const enteredVariantQuantities = new Map(restockVariants.map((variant) => [
      variant.id,
      Number(restockVariantQuantities[variant.id])
    ]));
    const invalidVariant = restockVariants.find((variant) => {
      const quantity = enteredVariantQuantities.get(variant.id);
      return !Number.isSafeInteger(quantity) || quantity! < 0 || quantity! > 10_000_000;
    });
    if (invalidVariant) {
      setError(`${invalidVariant.optionName}: ${invalidVariant.optionValue} must be a whole number from 0 to 10,000,000.`);
      return;
    }
    const enteredTotals = variantGroups.map((group) => group.reduce(
      (total, variant) => total + (enteredVariantQuantities.get(variant.id) ?? 0),
      0
    ));
    const usesVariantEntry = variantGroups.length > 0 && !automaticallySynchronized;
    const quantity = usesVariantEntry ? (enteredTotals[0] ?? 0) : Number(restockQuantity);

    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 10_000_000 || (restockMode === "add" && quantity === 0)) {
      setError(restockMode === "add"
        ? "Enter a whole-number quantity from 1 to 10,000,000."
        : "Enter a whole-number available stock count from 0 to 10,000,000.");
      return;
    }

    const hasInvalidVariantAllocation = usesVariantEntry && variantGroups.some((group, index) => {
      const currentTotal = group.reduce((total, variant) => total + variant.stock, 0);
      return enteredTotals[index] !== quantity || (restockMode === "add" && currentTotal !== restockingProduct.stock);
    });
    if (hasInvalidVariantAllocation) {
      setError(
        restockMode === "add"
          ? "The saved size totals do not match the product total. Use Correct stock count first so the size counts and total stock match."
          : "Every option group must have the same total before saving the corrected stock count."
      );
      return;
    }

    const confirmed = await confirm({
      title: restockMode === "add" ? "Add this inventory stock?" : "Save this corrected stock count?",
      description: restockMode === "add"
        ? `${quantity} new item${quantity === 1 ? "" : "s"} will be added to ${restockingProduct.name}, bringing its available total to ${restockingProduct.stock + quantity}.`
        : `${restockingProduct.name}'s available stock will be replaced with the exact count of ${quantity}.`,
      confirmLabel: restockMode === "add" ? "Add stock" : "Save corrected count",
      tone: restockMode === "add" ? "default" : "warning"
    });
    if (!confirmed) return;

    setSubmitting(true);
    setError("");

    try {
      const updatedProduct = await restockStaffProduct(token, restockingProduct.id, {
        mode: restockMode,
        quantity,
        ...(usesVariantEntry ? {
          variantQuantities: restockVariants.map((variant) => ({
            variantId: variant.id,
            quantity: enteredVariantQuantities.get(variant.id)!
          }))
        } : {}),
        notes: restockMode === "add" ? "Stock added from staff inventory page." : "Exact stock set from staff inventory page."
      });
      const mappedProduct = mapStaffProduct(updatedProduct);
      setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
      setRestockingProduct(null);
      setActiveRestockOptionName("");
      setRestockQuantity("");
      setRestockVariantQuantities({});
      setNotice(
        restockMode === "add"
          ? `${quantity} pcs added to ${mappedProduct.name}.`
          : `${mappedProduct.name} stock corrected to ${mappedProduct.stock} pcs.`
      );
    } catch (restockError) {
      setError(restockError instanceof Error ? restockError.message : "Unable to update stock.");
    } finally {
      setSubmitting(false);
    }
  };

  const archiveProduct = async (product: Product) => {
    const confirmed = await confirm({
      title: "Archive this product?",
      description: `${product.name} will be hidden from the student shop. Existing reservation records will be kept.`,
      confirmLabel: "Archive product",
      tone: "danger"
    });
    if (!confirmed) return;
    setSubmitting(true);
    setArchivingProductId(product.id);
    setError("");

    try {
      await archiveStaffProduct(token, product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      if (editingProduct?.id === product.id) closeEditor();
      setNotice(`${product.name} archived.`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive product.");
    } finally {
      setArchivingProductId("");
      setSubmitting(false);
    }
  };

  const restoreProduct = async (product: Product) => {
    const confirmed = await confirm({
      title: "Restore this product?",
      description: `${product.name} will return to active inventory with its existing stock, options, and reservation history. Its current availability will determine how it appears in the student shop.`,
      confirmLabel: "Restore product",
      tone: "default"
    });
    if (!confirmed) return;

    setSubmitting(true);
    setRestoringProductId(product.id);
    setError("");

    try {
      await restoreStaffProduct(token, product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      setNotice(`${product.name} restored to active inventory.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Unable to restore product.");
    } finally {
      setRestoringProductId("");
      setSubmitting(false);
    }
  };

  const categoryOptions = categories.map((category) => category.name);

  const restockVariantGroups = restockingProduct?.saleMode === "OPTIONS"
    ? Array.from(restockingProduct.variants.reduce((groups, variant) => {
        const values = groups.get(variant.optionName) ?? [];
        values.push(variant);
        groups.set(variant.optionName, values);
        return groups;
      }, new Map<string, Product["variants"]>()).entries())
    : [];
  const activeRestockGroup = restockVariantGroups.find(([optionName]) => optionName === activeRestockOptionName)
    ?? restockVariantGroups[0]
    ?? null;
  const activeRestockGroupIndex = activeRestockGroup
    ? restockVariantGroups.findIndex(([optionName]) => optionName === activeRestockGroup[0])
    : -1;
  const automaticallySynchronizedVariants = restockVariantGroups.length > 0
    && restockVariantGroups.every(([, variants]) => variants.length === 1);
  const usesVariantRestockEntry = restockVariantGroups.length > 0 && !automaticallySynchronizedVariants;
  const restockEnteredTotals = restockVariantGroups.map(([, variants]) => variants.reduce(
    (total, variant) => total + (Number(restockVariantQuantities[variant.id]) || 0),
    0
  ));
  const preferredRestockOptionName = restockingProduct ? preferredSizeOptionName(restockingProduct.variants) : "";
  const primaryRestockGroupIndex = restockVariantGroups.findIndex(([optionName]) => optionName === preferredRestockOptionName);
  const effectivePrimaryRestockGroupIndex = primaryRestockGroupIndex >= 0 ? primaryRestockGroupIndex : 0;
  const restockEnteredQuantity = usesVariantRestockEntry
    ? (restockEnteredTotals[effectivePrimaryRestockGroupIndex] ?? 0)
    : Math.max(0, Number(restockQuantity) || 0);
  const resultingStock = restockingProduct
    ? restockMode === "add"
      ? restockingProduct.stock + restockEnteredQuantity
      : restockEnteredQuantity
    : 0;
  const variantAllocationValid = automaticallySynchronizedVariants || restockVariantGroups.every(([, variants], index) => {
    const currentTotal = variants.reduce((total, variant) => total + variant.stock, 0);
    return restockEnteredTotals[index] === restockEnteredQuantity
      && (restockMode === "set" || currentTotal === restockingProduct?.stock);
  });
  const restockHasLegacyMismatch = Boolean(restockingProduct && restockMode === "add" && restockVariantGroups.some(([, variants]) =>
    variants.reduce((total, variant) => total + variant.stock, 0) !== restockingProduct.stock
  ));
  const restockCanSubmit = restockingProduct
    ? variantAllocationValid
      && Number.isInteger(restockEnteredQuantity)
      && restockEnteredQuantity >= 0
      && (restockMode === "set" || restockEnteredQuantity > 0)
      && (usesVariantRestockEntry || Boolean(restockQuantity))
    : false;
  const closeRestockDialog = () => {
    setRestockingProduct(null);
    setActiveRestockOptionName("");
  };
  const closeSkuInventoryDialog = () => {
    const returnFocus = skuInventoryReturnFocusRef.current;
    setSkuInventoryProduct(null);
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    });
  };
  const addDialog = useAccessibleDialog<HTMLFormElement>(adding, closeAddProduct);
  const editorDialog = useAccessibleDialog<HTMLElement>(Boolean(editingProduct), closeEditor);
  const restockDialog = useAccessibleDialog<HTMLFormElement>(Boolean(restockingProduct), closeRestockDialog);

  if (!ready) {
    return (
      <div className="space-y-5">
        <PageHeading eyebrow="Inventory" title="Loading staff account" detail="Checking your WESCOMM session before loading inventory tools." />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-5">
        <PageHeading eyebrow="Inventory" title="Staff sign in required" detail="Use the main WESCOMM login once to access staff inventory tools." />
        <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="max-w-xl text-sm leading-6 text-[#5f6d64]">
            Your staff session is missing or expired. Sign in again with your Wesleyan account, then staff inventory will open automatically.
          </p>
          {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
          <Button type="button" onClick={openAuth} className="mt-5 h-11">Sign in with WESCOMM account</Button>
        </section>
        {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      </div>
    );
  }

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Inventory"
        title={visibility === "ARCHIVED" ? "Archived inventory" : "Centralized stock management"}
        detail={visibility === "ARCHIVED"
          ? `Connected as ${staffEmail || "staff"}. Restore archived products without losing their stock, options, or reservation history.`
          : `Connected as ${staffEmail || "staff"}. Track products in one place and keep stock levels up to date.`}
        action={visibility === "ACTIVE" ? (
          <Button onClick={openAddProduct} disabled={loading || submitting}><Plus className="size-5" /> Add product</Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => changeVisibility("ACTIVE")} disabled={loading || submitting}>
            <ArrowLeft className="size-4" /> Active inventory
          </Button>
        )}
      />
      <div className="flex w-full flex-col gap-2 rounded-lg border border-[#dce5dd] bg-white p-2 shadow-sm sm:w-fit sm:flex-row" role="group" aria-label="Inventory view">
        <Button
          type="button"
          variant={visibility === "ACTIVE" ? "primary" : "ghost"}
          className="justify-center sm:min-w-40"
          aria-pressed={visibility === "ACTIVE"}
          onClick={() => changeVisibility("ACTIVE")}
          disabled={loading || submitting}
        >
          <RefreshCw className="size-4" /> Active items
        </Button>
        <Button
          type="button"
          variant={visibility === "ARCHIVED" ? "primary" : "ghost"}
          className="justify-center sm:min-w-40"
          aria-pressed={visibility === "ARCHIVED"}
          onClick={() => changeVisibility("ARCHIVED")}
          disabled={loading || submitting}
        >
          <Archive className="size-4" /> Archived items
        </Button>
      </div>
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search product or category" statuses={stockStatusOptions} />
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <section id="inventory-product-list" aria-label={visibility === "ARCHIVED" ? "Archived inventory products" : "Active inventory products"} className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <div className="hidden grid-cols-[2fr_.8fr_.65fr_.7fr_1.25fr_.75fr_auto] gap-4 bg-[#f6f9f6] px-4 py-3 text-xs font-bold uppercase tracking-wide text-[#59655d] lg:grid">
          <span>Product</span><span>Category</span><span>Total stock</span><span>Low-stock alert</span><span>Stock breakdown</span><span>Status</span><span>Actions</span>
        </div>
        <div className="divide-y divide-[#e7ece8]">
          {loading ? (
            <div className="p-6 text-sm font-semibold text-[#68746d]">Loading live inventory...</div>
          ) : filtered.length ? filtered.map((product) => {
            const compactSkus = product.skus.map((sku) => ({
              ...sku,
              shortLabel: sku.options.length ? sku.options.map((option) => option.optionValue).join(" · ") : "Standard",
              fullLabel: sku.options.length ? sku.options.map((option) => `${option.optionName}: ${option.optionValue}`).join(" / ") : "Standard item"
            }));
            return (
              <article key={product.id} className="content-visibility-auto relative grid gap-4 px-4 py-4 lg:grid-cols-[2fr_.8fr_.65fr_.7fr_1.25fr_.75fr_auto] lg:items-center">
                <ActionLoadingOverlay
                  active={archivingProductId === product.id || restoringProductId === product.id}
                  title={restoringProductId === product.id ? "Restoring product" : "Archiving product"}
                  detail={restoringProductId === product.id
                    ? "We are returning this item to active inventory."
                    : "We are removing this item from the student shop."}
                />
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#dce5dd] bg-[#f8fbf8]">
                    <Image src={product.imageUrl} alt={product.name} fill sizes="64px" unoptimized className="object-contain p-1" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold leading-5 text-[#17211b]">{product.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-extrabold", product.saleMode === "CLOTH_ONLY" ? "bg-[#eef6ef] text-primary" : product.saleMode === "OPTIONS" ? "bg-blue-50 text-blue-700" : "bg-[#f2f4f2] text-[#667169]")}>
                        {product.saleMode === "CLOTH_ONLY" ? "Cloth only" : product.saleMode === "OPTIONS" ? "Sizes / options" : "Simple item"}
                      </span>
                      {visibility === "ARCHIVED" ? <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-700">Archived</span> : null}
                      {product.saleMode === "OPTIONS" && !product.skuInventoryEnabled ? <span className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">Inventory setup needed</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[#68746d] lg:hidden">{product.category}</p>
                    <div className="mt-2 flex flex-wrap gap-1 lg:hidden">
                      {product.saleMode === "OPTIONS" && product.skuInventoryEnabled ? compactSkus.slice(0, 3).map((sku) => (
                        <span key={sku.id} title={sku.fullLabel} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", sku.stock <= sku.lowStockThreshold ? "bg-amber-50 text-amber-800" : "bg-[#f2f7f2] text-[#59655d]")}>
                          {sku.shortLabel} · {sku.stock}
                        </span>
                      )) : product.saleMode === "OPTIONS" ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Set up physical combinations</span> : null}
                    </div>
                  </div>
                </div>
                <p className="hidden text-sm text-[#59655d] lg:block">{product.category}</p>
                <div className="text-sm">
                  <span className="text-[#68746d] lg:hidden">Total stock: </span>
                  <span className="text-lg font-extrabold text-primary">{product.stock}</span>
                  <span className="ml-1 text-xs text-[#68746d]">items</span>
                </div>
                <div className="text-sm">
                  <span className="text-[#68746d] lg:hidden">Low-stock alert: </span>
                  <span className="font-bold">{product.minimum}</span>
                  <span className="ml-1 text-xs text-[#68746d]">items</span>
                </div>
                <div className="hidden flex-wrap gap-1 lg:flex">
                  {product.saleMode === "OPTIONS" && product.skuInventoryEnabled ? (
                    compactSkus.length ? <>
                      {compactSkus.slice(0, 3).map((sku) => (
                        <span key={sku.id} title={`${sku.fullLabel}: ${sku.stock} pcs`} className={cn("max-w-[190px] truncate rounded-md px-2 py-1 text-[11px] font-bold", sku.stock <= sku.lowStockThreshold ? "bg-amber-50 text-amber-800" : "bg-[#f2f7f2] text-[#59655d]")}>
                          {sku.shortLabel} · {sku.stock}
                        </span>
                      ))}
                      {compactSkus.length > 3 ? <span className="px-1 py-1 text-[11px] font-bold text-[#68746d]">+{compactSkus.length - 3} combinations</span> : null}
                    </> : <span className="text-xs text-[#8a958e]">No combinations</span>
                  ) : product.saleMode === "OPTIONS" ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">Physical setup required</span>
                  ) : product.saleMode === "CLOTH_ONLY" ? <span className="text-xs font-semibold text-primary">Cloth quantity only</span> : <span className="text-xs text-[#8a958e]">Single stock count</span>}
                </div>
                <StatusBadge status={product.status} />
                <div className="flex flex-wrap gap-2 lg:w-[140px] lg:flex-col">
                  {visibility === "ARCHIVED" ? (
                    <Button className="h-9 flex-1 px-3 lg:w-full" onClick={() => void restoreProduct(product)} disabled={submitting}>
                      <RotateCcw className="size-4" /> Restore item
                    </Button>
                  ) : (<>
                    <Button className="h-9 flex-1 px-3 lg:w-full" onClick={() => openRestock(product)} disabled={submitting}>
                      <Plus className="size-4" />
                      {product.saleMode === "OPTIONS" && !product.skuInventoryEnabled ? "Set up inventory" : "Update stock"}
                    </Button>
                    <Button variant="secondary" className="h-9 flex-1 px-3 lg:w-full" onClick={() => openEditor(product)} disabled={submitting}>
                      <Edit3 className="size-4" />
                      Manage
                    </Button>
                  </>)}
                </div>
              </article>
            );
          }) : (
            <div className="p-6 text-sm font-semibold text-[#68746d]">
              {visibility === "ARCHIVED" ? "No matching archived products found." : "No matching active products found."}
            </div>
          )}
        </div>
      </section>
      {nextProductCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMoreProducts || loading || submitting}
            onClick={() => void loadProducts(token, {
              cursor: nextProductCursor,
              append: true,
              query: deferredInventorySearch,
              status,
              visibility
            })}
          >
            {loadingMoreProducts ? "Loading more..." : "Load more products"}
          </Button>
        </div>
      ) : null}
      {adding ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#101820]/50 p-4">
          <form ref={addDialog.dialogRef} {...addDialog.dialogProps} key={selectedTemplateId || "blank-product-form"} className="relative my-auto max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setSubmitting(true);
            setError("");

            try {
              let imageUrl = String(form.get("imageUrl") ?? "").trim() || null;
              if (addImageFile) {
                const uploadedImage = await uploadStaffProductImage(token, addImageFile);
                imageUrl = uploadedImage.url;
              }

              const sizeVariants = addHasSizeVariants
                ? addSizeVariants.map((variant) => {
                    const optionValue = variant.value.trim();
                    const stock = Number(variant.stock);
                    const lowStockThreshold = Number(variant.lowStockThreshold);
                    if (!optionValue) throw new Error("Every size must have a name.");
                    if (!Number.isInteger(stock) || stock < 0) {
                      throw new Error(`${optionValue} stock must be a whole number of zero or more.`);
                    }
                    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
                      throw new Error(`${optionValue} low-stock alert must be a whole number of zero or more.`);
                    }
                    return { optionName: "Size", optionValue, stock, lowStockThreshold };
                  })
                : [];

              if (addHasSizeVariants && !sizeVariants.length) {
                throw new Error("Add at least one size before saving the product.");
              }
              const duplicateSize = sizeVariants.find((variant, index) =>
                sizeVariants.findIndex((candidate) => candidate.optionValue.trim().toLowerCase() === variant.optionValue.trim().toLowerCase()) !== index
              );
              if (duplicateSize) throw new Error(`${duplicateSize.optionValue} is listed more than once.`);
              const openingStock = addHasSizeVariants
                ? sizeVariants.reduce((total, variant) => total + variant.stock, 0)
                : Number(form.get("stock"));

              if (!Number.isInteger(openingStock) || openingStock < 0) {
                throw new Error("Opening stock must be a whole number of zero or more.");
              }

              const createdProduct = await createStaffProduct(token, {
                name: String(form.get("name")).trim(),
                categoryName: String(form.get("category")).trim(),
                description: String(form.get("description") ?? "").trim() || null,
                imageUrl,
                price: Number(form.get("price")),
                oldPrice: String(form.get("oldPrice") ?? "").trim() ? Number(form.get("oldPrice")) : null,
                saleMode: addSaleMode,
                stock: openingStock,
                lowStockThreshold: Number(form.get("minimum")),
                ...(sizeVariants.length ? { variants: sizeVariants } : {})
              });
              // Single-group variants such as Size are converted to physical
              // SKUs atomically by the backend during product creation. Keeping
              // this as one request prevents a half-created product if the
              // browser loses connection after the first save.
              const finalProduct = createdProduct;
              setProducts((current) => [...current, mapStaffProduct(finalProduct)].sort((left, right) => left.name.localeCompare(right.name)));
              closeAddProduct();
              setNotice(`${finalProduct.name} added.`);
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : "Unable to add product.");
            } finally {
              setSubmitting(false);
            }
          }}>
            <ActionLoadingOverlay
              active={submitting}
              title="Saving new product"
              detail="We are saving the product and uploading its image if needed."
            />
            <div className="flex items-start gap-3"><div><h2 id={addDialog.titleId} className="text-xl font-extrabold">Add product</h2><p className="mt-1 text-sm text-[#68746d]">Enter the basic product details and starting stock.</p></div><button type="button" data-dialog-autofocus onClick={closeAddProduct} disabled={submitting} aria-label="Close product form" className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button></div>
            <div className="mt-5 grid gap-5">
              <section className="grid gap-3 rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
                <div>
                  <h3 className="font-extrabold text-[#17211b]">Product details</h3>
                  <p className="mt-1 text-xs leading-5 text-[#68746d]">Choose a template to fill common WUP details automatically, or leave it blank for a new item.</p>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Start from a WUP template <span className="font-normal text-[#68746d]">(optional)</span>
                  <select value={selectedTemplateId} onChange={(event) => selectAddTemplate(event.target.value)} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary">
                    <option value="">No template — enter details manually</option>
                    <optgroup label="Shop-ready items">
                      {assetTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Price-list items">
                      {priceListTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Product name
                  <input name="name" required defaultValue={selectedTemplate?.name ?? ""} placeholder="Example: Senior High Men's Polo" className="h-11 rounded-md border px-3 font-normal" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Category
                    <input name="category" required list="staff-category-options" defaultValue={selectedTemplate?.categoryName ?? ""} placeholder="Example: Uniforms" className="h-11 rounded-md border px-3 font-normal" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Price
                    <input name="price" required type="number" min="0" step="0.01" defaultValue={selectedTemplate?.price ?? ""} placeholder="0.00" className="h-11 rounded-md border px-3 font-normal" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Short description <span className="font-normal text-[#68746d]">(optional)</span>
                  <input name="description" defaultValue={selectedTemplateDescription} placeholder="Short description shown with the product" className="h-11 rounded-md border px-3 font-normal" />
                </label>
              </section>

              <section className="grid gap-3 rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
                <div>
                  <h3 className="font-extrabold text-[#17211b]">Product image</h3>
                  <p className="mt-1 text-xs leading-5 text-[#68746d]">Upload an image if the selected template does not already have one.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-[#dce5dd] bg-white">
                    {addImagePreview ? <Image src={addImagePreview} alt="Product preview" width={80} height={80} unoptimized className="size-full object-contain" /> : <Upload className="size-7 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#b9cbbb] bg-white px-3 text-sm font-bold text-primary hover:bg-[#eef6ef]">
                      <Upload className="size-4" />
                      Choose image
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseAddImage(event.target.files)} />
                    </label>
                    <p className="mt-2 text-xs text-[#68746d]">PNG, JPG, or WEBP up to 2 MB.</p>
                  </div>
                </div>
                <details className="text-xs text-[#68746d]">
                  <summary className="cursor-pointer font-semibold text-primary">Use an image URL instead</summary>
                  <input name="imageUrl" defaultValue={selectedTemplate?.imageUrl ?? ""} placeholder="https://..." onChange={(event) => { if (!addImageFile) setAddImagePreview(event.target.value); }} className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm text-[#253029]" />
                </details>
              </section>

              <section className="grid gap-4 rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
                <div>
                  <h3 className="font-extrabold text-[#17211b]">Stock setup</h3>
                  <p className="mt-1 text-xs leading-5 text-[#68746d]">Choose how staff will track this product. Uniforms normally use sizes.</p>
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold">How is this item sold?</p>
                  <div className="grid gap-2">
                    {[
                      { value: "SIMPLE", title: "Simple item", detail: "One total stock count. Students do not choose a size or option." },
                      { value: "CLOTH_ONLY", title: "Cloth only", detail: "Uniform material only. The product image is a finished-uniform preview; no sizes are shown to students." },
                      { value: "OPTIONS", title: "With sizes/options", detail: "Ready-made items such as PE uniforms. Students choose a size or another configured option." }
                    ].map((mode) => (
                      <label key={mode.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${addSaleMode === mode.value ? "border-primary bg-[#eef7ef]" : "border-[#dce5dd] bg-white"}`}>
                        <input type="radio" name="saleModeChoice" value={mode.value} checked={addSaleMode === mode.value} onChange={() => setAddSaleMode(mode.value as ProductSaleMode)} className="mt-1" />
                        <span><span className="block text-sm font-extrabold text-[#253029]">{mode.title}</span><span className="mt-0.5 block text-xs leading-5 text-[#68746d]">{mode.detail}</span></span>
                      </label>
                    ))}
                  </div>
                </div>

                {addSaleMode === "CLOTH_ONLY" ? (
                  <div className="rounded-md border border-[#bdd8c0] bg-[#f3faf4] px-3 py-2 text-xs leading-5 text-[#4e6255]">
                    <span className="font-extrabold text-primary">Student view:</span> Uniform cloth only. Students reserve by quantity only; Size, Waist, and Length are not shown.
                  </div>
                ) : null}

                {addHasSizeVariants ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_110px_36px] gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[#718078]">
                      <span>Size</span><span>Starting stock</span><span />
                    </div>
                    {addSizeVariants.map((variant, index) => (
                      <div key={variant.key} className="grid grid-cols-[1fr_110px_36px] gap-2">
                        <input
                          value={variant.value}
                          onChange={(event) => setAddSizeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, value: event.target.value } : item))}
                          placeholder="Example: 3XL"
                          aria-label={`Size ${index + 1} name`}
                          className="h-10 min-w-0 rounded-md border bg-white px-3 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={variant.stock}
                          onChange={(event) => setAddSizeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, stock: event.target.value } : item))}
                          aria-label={`${variant.value || `Size ${index + 1}`} opening stock`}
                          className="h-10 min-w-0 rounded-md border bg-white px-3 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setAddSizeVariants((current) => current.filter((item) => item.key !== variant.key))}
                          aria-label={`Remove ${variant.value || `size ${index + 1}`}`}
                          className="grid size-10 place-items-center rounded-md text-red-600 hover:bg-red-50"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-3"
                        onClick={() => setAddSizeVariants((current) => [...current, { key: variantDraftKey("size"), value: "", stock: "0", lowStockThreshold: "2" }])}
                      >
                        <Plus className="size-4" /> Add another size
                      </Button>
                      <p className="text-sm"><span className="text-[#68746d]">Total stock: </span><span className="font-extrabold text-primary">{addSizeStockTotal} pcs</span></p>
                    </div>
                    <p className="text-xs leading-5 text-[#68746d]">Each size gets a default low-stock warning at 2 pcs. You can change that later from Manage.</p>
                  </div>
                ) : (
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Starting stock
                    <input name="stock" required type="number" min="0" step="1" defaultValue={selectedTemplate?.stock ?? 0} placeholder="0" className="h-11 rounded-md border px-3 font-normal" />
                  </label>
                )}

                <label className="grid gap-1.5 text-sm font-semibold">
                  Warn staff when total stock reaches
                  <input name="minimum" required type="number" min="0" step="1" defaultValue={selectedTemplate?.lowStockThreshold ?? 10} className="h-11 rounded-md border px-3 font-normal" />
                  <span className="text-xs font-normal leading-5 text-[#68746d]">Example: enter 10 to show a restock warning when 10 or fewer items remain.</span>
                </label>
              </section>

              <details className="rounded-lg border border-[#dce5dd] bg-white px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold text-[#59655d]">Optional pricing</summary>
                <label className="mt-3 grid gap-1.5 text-sm font-semibold">
                  Old price <span className="font-normal text-[#68746d]">(only for sale/discount display)</span>
                  <input name="oldPrice" type="number" min="0" step="0.01" placeholder="Leave blank if not on sale" className="h-11 rounded-md border px-3 font-normal" />
                </label>
              </details>

              <datalist id="staff-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={closeAddProduct} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add product"}</Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
      {editingProduct ? (
        <div className="fixed inset-0 z-[10000] bg-[#101820]/45" role="presentation">
          <button
            type="button"
            aria-label="Close product manager"
            className="absolute inset-0 cursor-default"
            onClick={closeEditor}
            disabled={submitting || savingVariants}
          />
          <aside ref={editorDialog.dialogRef} {...editorDialog.dialogProps} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
            <ActionLoadingOverlay
              active={submitting || savingVariants}
              title={savingVariants ? "Saving size settings" : "Saving product changes"}
              detail="We are updating this item and syncing the student shop."
            />
            <header className="border-b border-[#e1e8e2] p-5">
              <div className="flex items-start gap-3">
                {manageSection !== "menu" ? (
                  <button
                    type="button"
                    onClick={() => { setError(""); setManageSection("menu"); }}
                    disabled={submitting || savingVariants}
                    aria-label="Back to manage product"
                    className="grid size-9 shrink-0 place-items-center rounded-md border border-[#dce5dd] text-primary hover:bg-[#eef6ef] disabled:opacity-50"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 id={editorDialog.titleId} className="text-xl font-extrabold text-[#17211b]">
                    {manageSection === "menu" ? "Manage product" : manageSection === "details" ? "Edit details" : manageSection === "image" ? "Manage image" : manageSection === "selling" ? "Selling setup" : manageSection === "options" ? "Product options" : "Size settings"}
                  </h2>
                  <p className="mt-1 text-sm text-[#68746d]">
                    {manageSection === "menu"
                      ? "Choose what you want to update."
                      : manageSection === "details"
                        ? "Update the product information shown in WESCOMM."
                        : manageSection === "image"
                          ? "Preview the current image or upload a replacement."
                          : manageSection === "selling"
                            ? "Choose whether students buy by quantity only or select sizes/options."
                            : manageSection === "options"
                              ? "Manage Size, Waist, Length, Color, and other option labels without mixing them with stock counts."
                              : "Manage size labels and low-stock warning levels."}
                  </p>
                </div>
                <button type="button" data-dialog-autofocus onClick={closeEditor} disabled={submitting || savingVariants} aria-label="Close product manager" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              {error ? (
                <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-700">{error}</p>
              ) : null}

              {manageSection === "menu" ? (
                <div className="space-y-4">
                  <section className="flex items-center gap-4 rounded-lg border border-[#dce5dd] bg-[#f8fbf8] p-4">
                    <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#dce5dd] bg-white">
                      <Image src={editingProduct.imageUrl} alt={editingProduct.name} fill sizes="96px" unoptimized className="object-contain p-2" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold leading-5 text-[#17211b]">{editingProduct.name}</p>
                      <p className="mt-1 text-xs text-[#68746d]">{editingProduct.category}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-white px-2 py-1 font-bold text-primary">{editingProduct.stock} items</span>
                        <StatusBadge status={editingProduct.status} />
                      </div>
                    </div>
                  </section>

                  <div className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white">
                    <button type="button" onClick={() => { setError(""); setManageSection("details"); }} className="flex w-full items-center gap-3 border-b border-[#e7ece8] px-4 py-4 text-left hover:bg-[#f8fbf8]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef6ef] text-primary"><Edit3 className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-[#253029]">Edit details</span><span className="mt-0.5 block text-xs text-[#68746d]">Name, category, description, price, and total-stock warning.</span></span>
                      <ChevronRight className="size-4 text-[#829087]" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setEditImageFile(null); setEditImagePreview(editingProduct.imageUrl); setManageSection("image"); }} className="flex w-full items-center gap-3 border-b border-[#e7ece8] px-4 py-4 text-left hover:bg-[#f8fbf8]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef6ef] text-primary"><Upload className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-[#253029]">Manage image</span><span className="mt-0.5 block text-xs text-[#68746d]">Preview, upload, or replace the product image.</span></span>
                      <ChevronRight className="size-4 text-[#829087]" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setManageSection("selling"); }} className="flex w-full items-center gap-3 border-b border-[#e7ece8] px-4 py-4 text-left hover:bg-[#f8fbf8]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef6ef] text-primary"><Filter className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-[#253029]">Selling setup</span><span className="mt-0.5 block text-xs text-[#68746d]">{editingProduct.saleMode === "CLOTH_ONLY" ? "Cloth only — quantity only" : editingProduct.saleMode === "OPTIONS" ? "Students choose sizes/options" : "Simple item — one stock count"}</span></span>
                      <ChevronRight className="size-4 text-[#829087]" />
                    </button>
                    {editingProduct.saleMode === "OPTIONS" ? <>
                    <button type="button" onClick={(event) => { setError(""); skuInventoryReturnFocusRef.current = event.currentTarget; setSkuInventoryProduct(editingProduct); }} className="flex w-full items-center gap-3 border-b border-[#e7ece8] px-4 py-4 text-left hover:bg-[#f8fbf8]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef6ef] text-primary"><RefreshCw className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-[#253029]">Inventory combinations</span><span className="mt-0.5 block text-xs text-[#68746d]">{editingProduct.skuInventoryEnabled ? `${editingProduct.skus.length} physical combinations configured` : "Setup required before reliable size/waist/length stock tracking"}.</span></span>
                      <ChevronRight className="size-4 text-[#829087]" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setManageSection("options"); }} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-[#f8fbf8]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef6ef] text-primary"><Filter className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-[#253029]">Product options</span><span className="mt-0.5 block text-xs text-[#68746d]">Manage Size, Waist, Length, Color, Clip Type, and other option labels. Stock remains under Inventory combinations.</span></span>
                      <ChevronRight className="size-4 text-[#829087]" />
                    </button>
                    </> : null}
                  </div>

                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border border-red-100 px-4 py-3 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={submitting || savingVariants}
                    onClick={() => void archiveProduct(editingProduct)}
                  >
                    <Trash2 className="size-4" />
                    <span><span className="block text-sm font-bold">Archive product</span><span className="block text-xs text-red-500">Hide this product from the student shop.</span></span>
                  </button>
                </div>
              ) : null}

              {manageSection === "selling" ? (
                <form className="space-y-4" onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const nextMode = String(form.get("saleMode")) as ProductSaleMode;
                  setSubmitting(true);
                  setError("");
                  try {
                    const updatedProduct = await updateStaffProductSaleMode(token, editingProduct.id, nextMode);
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
                    setEditingProduct(mappedProduct);
                    setNotice(`${mappedProduct.name} selling setup updated.`);
                    setManageSection("menu");
                  } catch (modeError) {
                    setError(modeError instanceof Error ? modeError.message : "Unable to update selling setup.");
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="rounded-lg border border-[#dce5dd] bg-[#f8fbf8] p-4">
                    <p className="text-sm font-extrabold text-[#253029]">Choose what students are actually buying</p>
                    <p className="mt-1 text-xs leading-5 text-[#68746d]">This controls whether students see size/options. Existing stock is never guessed or redistributed automatically.</p>
                  </div>
                  {[
                    { value: "SIMPLE", title: "Simple item", detail: "One total stock count. Best for books, supplies, and items with no selectable options." },
                    { value: "CLOTH_ONLY", title: "Cloth only", detail: "Uniform tela/material only. The image is a reference preview and students reserve by quantity only." },
                    { value: "OPTIONS", title: "With sizes/options", detail: "Ready-made items. Students choose Size, Waist, Length, Color, Clip Type, or other configured options." }
                  ].map((mode) => (
                    <label key={mode.value} className="flex cursor-pointer gap-3 rounded-lg border border-[#dce5dd] bg-white p-4 has-[:checked]:border-primary has-[:checked]:bg-[#eef7ef]">
                      <input type="radio" name="saleMode" value={mode.value} defaultChecked={editingProduct.saleMode === mode.value} className="mt-1" />
                      <span><span className="block text-sm font-extrabold text-[#253029]">{mode.title}</span><span className="mt-1 block text-xs leading-5 text-[#68746d]">{mode.detail}</span></span>
                    </label>
                  ))}
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    Switching to <b>With sizes/options</b> pauses student ordering until physical combinations are configured. Switching away from options is blocked while active reservations or unsettled payments exist.
                  </div>
                  <div className="flex justify-end gap-2 border-t border-[#e1e8e2] pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save selling setup"}</Button></div>
                </form>
              ) : null}

              {manageSection === "details" ? (
                <form className="space-y-4" onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setSubmitting(true);
                  setError("");
                  try {
                    const updatedProduct = await updateStaffProduct(token, editingProduct.id, {
                      name: String(form.get("name")).trim(),
                      categoryName: String(form.get("category")).trim(),
                      description: String(form.get("description") ?? "").trim() || null,
                      price: Number(form.get("price")),
                      oldPrice: String(form.get("oldPrice") ?? "").trim() ? Number(form.get("oldPrice")) : null,
                      lowStockThreshold: Number(form.get("minimum")),
                      notes: "Product details updated from staff inventory page."
                    });
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product).sort((left, right) => left.name.localeCompare(right.name)));
                    setEditingProduct(mappedProduct);
                    setNotice(`${mappedProduct.name} updated.`);
                    setManageSection("menu");
                  } catch (updateError) {
                    setError(updateError instanceof Error ? updateError.message : "Unable to update product details.");
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="flex items-center gap-3 rounded-lg border border-[#dce5dd] bg-[#f8fbf8] p-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-[#dce5dd] bg-white"><Image src={editingProduct.imageUrl} alt={editingProduct.name} fill sizes="64px" unoptimized className="object-contain p-1" /></div>
                    <div><p className="text-sm font-bold text-[#253029]">Current stock: {editingProduct.stock} items</p><p className="mt-1 text-xs text-[#68746d]">Use Update stock from the inventory list to change quantities.</p></div>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold">Product name<input name="name" required defaultValue={editingProduct.name} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">Category<input name="category" required list="staff-edit-category-options" defaultValue={editingProduct.category} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">Description<textarea name="description" rows={3} defaultValue={editingProduct.description} className="rounded-md border px-3 py-2 font-normal outline-none focus:border-primary" /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold">Selling price<input name="price" required type="number" min="0" step="0.01" defaultValue={editingProduct.price} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                    <label className="grid gap-1.5 text-sm font-semibold">Old price <span className="text-xs font-normal text-[#68746d]">Optional</span><input name="oldPrice" type="number" min="0" step="0.01" defaultValue={editingProduct.oldPrice ?? ""} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold">Low-stock alert<input name="minimum" required type="number" min="0" step="1" defaultValue={editingProduct.minimum} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /><span className="text-xs font-normal text-[#68746d]">WESCOMM warns staff when total stock reaches this number or lower.</span></label>
                  <datalist id="staff-edit-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
                  <div className="flex justify-end gap-2 border-t border-[#e1e8e2] pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save details"}</Button></div>
                </form>
              ) : null}

              {manageSection === "image" ? (
                <form className="space-y-4" onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setSubmitting(true);
                  setError("");
                  try {
                    let imageUrl = String(form.get("imageUrl") ?? "").trim() || null;
                    if (editImageFile) {
                      const uploadedImage = await uploadStaffProductImage(token, editImageFile);
                      imageUrl = uploadedImage.url;
                    }
                    const updatedProduct = await updateStaffProduct(token, editingProduct.id, { imageUrl, notes: "Product image updated from staff inventory page." });
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
                    setEditingProduct(mappedProduct);
                    setEditImageFile(null);
                    setEditImagePreview(mappedProduct.imageUrl);
                    setNotice(`${mappedProduct.name} image updated.`);
                    setManageSection("menu");
                  } catch (updateError) {
                    setError(updateError instanceof Error ? updateError.message : "Unable to update product image.");
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="grid place-items-center rounded-xl border border-[#dce5dd] bg-[#f8fbf8] p-5">
                    <div className="relative size-52 overflow-hidden rounded-xl border border-[#dce5dd] bg-white shadow-sm">
                      {editImagePreview ? <Image src={editImagePreview} alt={`${editingProduct.name} preview`} fill sizes="208px" unoptimized className="object-contain p-3" /> : <div className="grid size-full place-items-center"><Upload className="size-9 text-primary" /></div>}
                    </div>
                    <p className="mt-3 text-sm font-bold text-[#253029]">{editingProduct.name}</p>
                    <p className="mt-1 text-xs text-[#68746d]">Preview before saving</p>
                  </div>
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#b9cbbb] bg-white px-3 text-sm font-bold text-primary hover:bg-[#eef6ef]">
                    <Upload className="size-4" /> Choose new image
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseEditImage(event.target.files)} />
                  </label>
                  <details className="rounded-lg border border-[#dce5dd] bg-white px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-[#59655d]">Use an image URL instead</summary>
                    <input name="imageUrl" defaultValue={editingProduct.imageUrl} onChange={(event) => { if (!editImageFile) setEditImagePreview(event.target.value); }} placeholder="https://..." className="mt-3 h-11 w-full rounded-md border px-3 font-normal outline-none focus:border-primary" />
                  </details>
                  <p className="text-xs leading-5 text-[#68746d]">PNG, JPG, or WEBP up to 2 MB. The preview shown above is what staff will see before saving.</p>
                  <div className="flex justify-end gap-2 border-t border-[#e1e8e2] pt-4"><Button type="button" variant="secondary" onClick={() => { setEditImageFile(null); setEditImagePreview(editingProduct.imageUrl); setManageSection("menu"); }} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save image"}</Button></div>
                </form>
              ) : null}

              {manageSection === "options" ? (
                <ProductOptionsManager
                  token={token}
                  product={{
                    id: editingProduct.id,
                    stock: editingProduct.stock,
                    skuInventoryEnabled: editingProduct.skuInventoryEnabled,
                    variants: editingProduct.variants.map((variant) => ({ ...variant })),
                    skus: editingProduct.skus.map((sku) => ({ variantIds: [...sku.variantIds] }))
                  }}
                  onSaved={(updated) => {
                    const mapped = mapStaffProduct(updated);
                    setProducts((current) => current.map((product) => product.id === mapped.id ? mapped : product));
                    setEditingProduct(mapped);
                    setNotice(`${mapped.name} options updated.`);
                  }}
                  onDone={() => setManageSection("menu")}
                />
              ) : null}

              {manageSection === "sizes" ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-lg border border-[#dce5dd] bg-[#f8fbf8] p-3">
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-md border border-[#dce5dd] bg-white"><Image src={editingProduct.imageUrl} alt={editingProduct.name} fill sizes="56px" unoptimized className="object-contain p-1" /></div>
                    <div><p className="text-sm font-bold text-[#253029]">{editSizeVariants.length ? `${editSizeVariants.length} sizes configured` : "No sizes configured"}</p><p className="mt-1 text-xs text-[#68746d]">Stock quantities are changed from Update stock.</p></div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-5 text-[#68746d]">{editingProduct.skuInventoryEnabled ? "Add or rename size labels here. Stock and low-stock alerts are managed under Inventory combinations." : "Set the size label and when staff should receive a low-stock warning."}</p>
                    <Button type="button" variant="secondary" className="h-9 shrink-0 px-3" disabled={!editingVariantStructureUnlocked || savingVariants || submitting} onClick={() => setEditSizeVariants((current) => [...current, { key: variantDraftKey("size"), value: "", stock: "0", lowStockThreshold: "2" }])}><Plus className="size-4" /> Add size</Button>
                  </div>
                  {!editingVariantStructureUnlocked ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">Size names can only be added, removed, or renamed when this product has zero stock and no active reservations. Warning levels can still be changed now.</p> : null}
                  <div className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white">
                    <div className="grid grid-cols-[1fr_64px_86px_36px] gap-2 bg-[#f6f9f6] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#718078]"><span>Size</span><span>Stock</span><span>Warn at</span><span /></div>
                    <div className="divide-y divide-[#e7ece8]">
                      {editSizeVariants.length ? editSizeVariants.map((variant, index) => (
                        <div key={variant.key} className="grid grid-cols-[1fr_64px_86px_36px] gap-2 p-3">
                          <input value={variant.value} disabled={Boolean(variant.id) && !editingVariantStructureUnlocked} onChange={(event) => setEditSizeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, value: event.target.value } : item))} placeholder="Size" aria-label={`Size ${index + 1} name`} className="h-10 min-w-0 rounded-md border bg-white px-2 text-sm disabled:bg-[#f2f5f2] disabled:text-[#68746d]" />
                          <div className={cn("flex h-10 items-center justify-center rounded-md border bg-white px-2 text-sm font-bold", Number(variant.stock) <= Number(variant.lowStockThreshold) ? "border-amber-200 text-amber-800" : "text-[#253029]")}>{variant.id ? variant.stock : "New"}</div>
                          <input type="number" min="0" step="1" inputMode="numeric" value={variant.lowStockThreshold} disabled={editingProduct.skuInventoryEnabled} title={editingProduct.skuInventoryEnabled ? "Set alerts under Inventory combinations." : undefined} onChange={(event) => setEditSizeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, lowStockThreshold: event.target.value } : item))} aria-label={`${variant.value || `Size ${index + 1}`} low stock warning`} className="h-10 min-w-0 rounded-md border bg-white px-2 text-sm disabled:bg-[#f2f5f2] disabled:text-[#829087]" />
                          <button type="button" disabled={!editingVariantStructureUnlocked || savingVariants || submitting || Boolean(variant.id && editingProduct.skus.some((sku) => sku.variantIds.includes(variant.id!)))} title={variant.id && editingProduct.skus.some((sku) => sku.variantIds.includes(variant.id!)) ? "This size is used by an inventory combination. Rebuild combinations before removing it." : undefined} onClick={() => setEditSizeVariants((current) => current.filter((item) => item.key !== variant.key))} aria-label={`Remove ${variant.value || `size ${index + 1}`}`} className="grid size-10 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><X className="size-4" /></button>
                        </div>
                      )) : <p className="px-4 py-5 text-sm text-[#68746d]">This product does not have sizes yet.</p>}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 border-t border-[#e1e8e2] pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={savingVariants}>Cancel</Button><Button type="button" onClick={() => void saveVariantSettings()} disabled={savingVariants || submitting}>{savingVariants ? "Saving..." : "Save size settings"}</Button></div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
      {skuInventoryProduct ? (
        <SkuInventoryDialog
          token={token}
          product={skuInventoryProduct}
          returnFocus={skuInventoryReturnFocusRef.current}
          onClose={closeSkuInventoryDialog}
          onSaved={(updated) => {
            const mapped = mapStaffProduct(updated);
            setProducts((current) => current.map((product) => product.id === mapped.id ? mapped : product));
            setEditingProduct((current) => current?.id === mapped.id ? mapped : current);
            closeSkuInventoryDialog();
            setNotice(`${mapped.name} inventory updated.`);
          }}
        />
      ) : null}
      {restockingProduct ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#101820]/50 p-4">
          <form
            ref={restockDialog.dialogRef}
            {...restockDialog.dialogProps}
            className="relative my-auto w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
            onSubmit={(event) => { event.preventDefault(); saveRestock(); }}
          >
            <ActionLoadingOverlay active={submitting} title="Updating stock" detail="We are saving the stock count and refreshing its status." />
            <header className="border-b border-[#e1e8e2] p-5">
              <div className="flex items-start gap-3">
                <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#dce5dd] bg-[#f8fbf8]">
                  <Image src={restockingProduct.imageUrl} alt={restockingProduct.name} fill sizes="64px" unoptimized className="object-contain p-1" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id={restockDialog.titleId} className="text-xl font-extrabold text-[#17211b]">Update stock</h2>
                  <p className="mt-1 truncate text-sm font-bold text-[#253029]">{restockingProduct.name}</p>
                  <p className="mt-0.5 text-xs text-[#68746d]">Current total: {restockingProduct.stock} items</p>
                </div>
                <button type="button" data-dialog-autofocus onClick={closeRestockDialog} disabled={submitting} aria-label="Close stock editor" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button>
              </div>
            </header>

            <div className="max-h-[calc(100svh-11rem)] overflow-y-auto p-5">
              {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-700">{error}</p> : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-extrabold text-[#253029]">{restockMode === "add" ? "Add newly received stock" : "Correct stock count"}</p>
                  <p className="mt-1 text-xs text-[#68746d]">{restockMode === "add" ? "Enter only the new items that arrived." : "Enter the exact stock still available for new reservations. Exact correction is blocked while this product has active reservations."}</p>
                </div>
                <button type="button" onClick={() => changeRestockMode(restockMode === "add" ? "set" : "add")} className="text-xs font-bold text-primary hover:underline">
                  {restockMode === "add" ? "Need to correct the count?" : "Back to adding stock"}
                </button>
              </div>

              {restockHasLegacyMismatch ? (
                <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                  Some saved option totals do not match the product total of {restockingProduct.stock}. Use “Need to correct the count?” once before adding new stock.
                </p>
              ) : null}

              {usesVariantRestockEntry ? (
                <section className="mt-5">
                  {restockVariantGroups.length > 1 ? (
                    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Stock option groups">
                      {restockVariantGroups.map(([optionName, variants], index) => {
                        const enteredTotal = restockEnteredTotals[index] ?? 0;
                        const currentTotal = variants.reduce((total, variant) => total + variant.stock, 0);
                        const targetMatches = enteredTotal === restockEnteredQuantity && (restockMode === "set" || currentTotal === restockingProduct.stock);
                        const active = activeRestockGroup?.[0] === optionName;
                        return (
                          <button
                            key={optionName}
                            type="button"
                            onClick={() => setActiveRestockOptionName(optionName)}
                            className={cn(
                              "shrink-0 rounded-md border px-3 py-2 text-left text-xs font-bold transition",
                              active ? "border-primary bg-[#eef6ef] text-primary" : "border-[#dce5dd] bg-white text-[#59655d] hover:bg-[#f8fbf8]"
                            )}
                          >
                            <span>{optionName}</span>
                            <span className={cn("ml-2", targetMatches && restockEnteredQuantity > 0 ? "text-primary" : "text-[#8a958e]")}>{targetMatches && restockEnteredQuantity > 0 ? "✓" : enteredTotal}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {activeRestockGroup ? (
                    <div className="rounded-lg border border-[#dce5dd] bg-[#fbfdfb] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-extrabold text-[#17211b]">{activeRestockGroup[0]}</h3>
                          <p className="mt-1 text-xs text-[#68746d]">{restockMode === "add" ? "How many new pieces arrived for each option?" : "What is the exact count for each option?"}</p>
                        </div>
                        <span className="rounded-md bg-[#eef6ef] px-2 py-1 text-xs font-extrabold text-primary">Total: {restockEnteredTotals[activeRestockGroupIndex] ?? 0}</span>
                      </div>
                      <div className={cn("mt-4 grid gap-3", activeRestockGroup[1].length <= 5 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3")}>
                        {sortSizeVariants(activeRestockGroup[1]).map((variant) => (
                          <label key={variant.id} className="grid gap-1.5 text-xs font-bold text-[#4f5c54]">
                            <span className="truncate text-center">{variant.optionValue}</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={restockVariantQuantities[variant.id] ?? "0"}
                              onChange={(event) => setRestockVariantQuantities((current) => ({ ...current, [variant.id]: event.target.value }))}
                              aria-label={`${activeRestockGroup[0]} ${variant.optionValue} ${restockMode === "add" ? "new quantity" : "exact quantity"}`}
                              className="h-11 min-w-0 rounded-md border border-[#d3ddd4] px-2 text-center text-base font-normal outline-none focus:border-primary"
                            />
                            <span className="text-center text-[10px] font-normal text-[#829087]">Current {variant.stock}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {restockVariantGroups.length > 1 ? (
                    <p className="mt-3 text-xs leading-5 text-[#68746d]">Each option group represents the same physical items. Complete every tab with the same total before confirming.</p>
                  ) : null}
                </section>
              ) : (
                <label className="mt-5 grid gap-1.5 text-sm font-semibold">
                  {restockMode === "add" ? "New items received" : "Exact available stock"}
                  <input autoFocus required type="number" min={restockMode === "add" ? 1 : 0} step="1" inputMode="numeric" value={restockQuantity} onChange={(event) => setRestockQuantity(event.target.value)} placeholder={restockMode === "add" ? "Example: 12" : "Enter exact count"} className="h-12 rounded-md border px-3 text-base font-normal outline-none focus:border-primary" />
                </label>
              )}

              <div className="mt-5 flex items-center gap-3 rounded-lg bg-[#eef6ef] px-4 py-3">
                <Plus className="size-6 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-[#17211b]">{restockMode === "add" ? `Total items to add: ${restockEnteredQuantity}` : `Corrected total: ${restockEnteredQuantity}`}</p>
                  <p className="mt-0.5 text-xs text-[#68746d]">{restockMode === "add" ? `After saving: ${resultingStock} items` : "This will replace the current stock count."}</p>
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-[#e1e8e2] bg-white p-4">
              <Button type="button" variant="secondary" onClick={closeRestockDialog} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting || !restockCanSubmit || restockHasLegacyMismatch}>
                {submitting ? "Saving..." : restockMode === "add" ? "Confirm & add" : "Save corrected stock"}
              </Button>
            </footer>
          </form>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
