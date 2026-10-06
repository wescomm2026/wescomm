"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ChevronRight, ClipboardCheck, Edit3, Filter, Package, Plus, Printer, RefreshCw, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { InventoryReportPreview } from "@/components/staff/InventoryReportPreview";
import { StockCountWorkspace } from "@/components/staff/StockCountWorkspace";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { ActionLoadingOverlay } from "@/components/ui/ActionLoadingOverlay";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import { getDepartmentsFromApi, isRequestAbortError, type BackendDepartment } from "@/lib/api";
import {
  archiveStaffProduct,
  clearStaffSession,
  createStaffProduct,
  getStaffProductsPage,
  getStaffProductDeletionEligibility,
  getStoredStaffSession,
  restockStaffProduct,
  restoreStaffProduct,
  permanentlyDeleteStaffProduct,
  syncStaffProductVariants,
  updateStaffProduct,
  updateStaffProductSaleMode,
  uploadStaffProductImage,
  type ProductSaleMode,
  type StaffCategory,
  type StaffInventoryAttention,
  type StaffProductVisibility
} from "@/lib/staff-api";
import { getStaffInventoryBatches, verifyStaffOpeningBatchCost, type StaffInventoryBatchResult } from "@/lib/inventory-batch-api";
import { isUniformClothOnly } from "@/lib/product-display";
import { optimizeShopProductImage, shopProductCardImage } from "@/lib/shop-assets";
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
import {
  ADJUSTMENT_REASONS,
  AdjustmentReasonFields,
  CostHistory,
  MarginNote,
  MoneyInput,
  ReorderAlertSelect,
  SellingPriceFields,
  StockActionIntro,
  StockActionTabs,
  SubmitHint,
  SummaryPanel,
  UnitCostNeeded,
  Variance,
  adjustmentNote,
  formatPhp,
  isMoneyInput,
  todayInManila,
  type StockAction
} from "@/components/staff/stock-dialog-parts";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { SkeletonList } from "@/components/ui/Skeleton";

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

// Count-sheet follow-up: items imported or counted without a price, cost, or photo.
const ATTENTION_FILTERS: Record<string, StaffInventoryAttention | undefined> = {
  "Needs price": "PRICE",
  "Needs cost": "COST",
  "No photo": "PHOTO"
};

// Size runs used on the WUP count sheets; one click replaces the size list in Add product.
const SIZE_PRESETS = [
  { label: "Kids #8–#20", sizes: ["#8", "#10", "#12", "#14", "#16", "#18", "#20"] },
  { label: "XS–3XL", sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL"] },
  { label: "S–5XL", sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] }
];

function needsAttention(product: Product, attention: StaffInventoryAttention) {
  if (attention === "PRICE") return Boolean(product.needsPrice);
  if (attention === "COST") return Boolean(product.unverifiedCostQuantity);
  return product.hasPhoto === false;
}

export function StaffInventoryExperience() {
  const confirm = useConfirmationDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<StaffCategory[]>([]);
  const [showInventoryReport, setShowInventoryReport] = useState(false);
  const [showStockCount, setShowStockCount] = useState(false);
  const [departments, setDepartments] = useState<BackendDepartment[]>([]);
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
  const [permanentDeleteProduct, setPermanentDeleteProduct] = useState<Product | null>(null);
  const [permanentDeleteConfirmation, setPermanentDeleteConfirmation] = useState("");
  const [permanentDeleteReason, setPermanentDeleteReason] = useState("");
  const [deletingProductId, setDeletingProductId] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [manageSection, setManageSection] = useState<ManageSection>("menu");
  const [restockingProduct, setRestockingProduct] = useState<Product | null>(null);
  const [skuInventoryProduct, setSkuInventoryProduct] = useState<Product | null>(null);
  const [skuInventoryInitialAction, setSkuInventoryInitialAction] = useState<StockAction>("receive");
  const [activeRestockOptionName, setActiveRestockOptionName] = useState("");
  const [stockAction, setStockAction] = useState<StockAction>("receive");
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockUnitCost, setRestockUnitCost] = useState("");
  const [restockNewPrice, setRestockNewPrice] = useState("");
  const [restockReceivedAt, setRestockReceivedAt] = useState(() => todayInManila());
  const [restockSupplierNote, setRestockSupplierNote] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [adjustmentRemarks, setAdjustmentRemarks] = useState("");
  const [batchResult, setBatchResult] = useState<StaffInventoryBatchResult | null>(null);
  const [openingCostDrafts, setOpeningCostDrafts] = useState<Record<string, string>>({});
  const [restockVariantQuantities, setRestockVariantQuantities] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [addImageFile, setAddImageFile] = useState<File | null>(null);
  const [addImagePreview, setAddImagePreview] = useState("");
  const [addSaleMode, setAddSaleMode] = useState<ProductSaleMode>("SIMPLE");
  const [addAudienceScope, setAddAudienceScope] = useState<"ALL_STUDENTS" | "SPECIFIC_DEPARTMENTS">("ALL_STUDENTS");
  const [addAudienceDepartmentIds, setAddAudienceDepartmentIds] = useState<string[]>([]);
  const [editAudienceScope, setEditAudienceScope] = useState<"ALL_STUDENTS" | "SPECIFIC_DEPARTMENTS">("ALL_STUDENTS");
  const [addSizeVariants, setAddSizeVariants] = useState<SizeVariantDraft[]>(defaultSizeVariantDrafts);
  const [addSimpleStock, setAddSimpleStock] = useState(0);
  const [addLowStockPercent, setAddLowStockPercent] = useState(25);
  const [editLowStockPercent, setEditLowStockPercent] = useState(25);
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
      const selectedStatus = options.status ?? status;
      const productPage = await getStaffProductsPage(authToken, {
        limit: 25,
        cursor: options.cursor,
        query: options.query ?? deferredInventorySearch,
        productId: options.productId,
        status: stockStatusForApi(selectedStatus),
        needs: ATTENTION_FILTERS[selectedStatus],
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
      const message = userFacingErrorMessage(loadError, "Unable to load inventory.");
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
    if (authToken) {
      void getDepartmentsFromApi(authToken)
        .then(setDepartments)
        .catch(() => setDepartments([]));
    }
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
    (status === "All" || (ATTENTION_FILTERS[status] ? needsAttention(product, ATTENTION_FILTERS[status]) : status === "On Sale" ? product.isOnSale : product.status === status))
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
  const addOpeningStock = addHasSizeVariants ? addSizeStockTotal : addSimpleStock;
  const addLowStockThreshold = addOpeningStock === 0 ? 0 : Math.ceil(addOpeningStock * addLowStockPercent / 100);
  const editLowStockThreshold = editingProduct
    ? (editingProduct.stockTarget === 0 ? 0 : Math.ceil(editingProduct.stockTarget * editLowStockPercent / 100))
    : 0;
  const automaticEditVariantThreshold = (variantId: string | undefined, stock: string) => {
    const persisted = variantId
      ? editingProduct?.variants.find((variant) => variant.id === variantId)
      : undefined;
    const target = Math.max(persisted?.stockTarget ?? 0, Number(stock) || 0);
    return target === 0 ? 0 : Math.ceil(target * (editingProduct?.lowStockPercent ?? 25) / 100);
  };
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
    setAddAudienceScope("ALL_STUDENTS");
    setAddAudienceDepartmentIds([]);
    setAddSizeVariants(defaultSizeVariantDrafts());
    setAddSimpleStock(0);
    setAddLowStockPercent(25);
    setAdding(true);
  };

  const closeAddProduct = () => {
    setSelectedTemplateId("");
    setAddImageFile(null);
    setAddImagePreview("");
    setAddSaleMode("SIMPLE");
    setAddAudienceScope("ALL_STUDENTS");
    setAddAudienceDepartmentIds([]);
    setAddSizeVariants(defaultSizeVariantDrafts());
    setAddSimpleStock(0);
    setAddLowStockPercent(25);
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
    setAddSimpleStock(template?.stock ?? 0);
    setAddLowStockPercent(25);
    setAddImagePreview(template?.imageUrl ?? "");
  };

  const openEditor = (product: Product) => {
    setError("");
    setManageSection("menu");
    setEditImageFile(null);
    setEditImagePreview(product.imageUrl);
    setEditAudienceScope(product.audienceScope);
    setEditLowStockPercent(product.lowStockPercent);
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
    setBatchResult(null);
    void getStaffInventoryBatches(token, product.id).then((result) => {
      setBatchResult(result);
    }).catch((batchError) => {
      setError(userFacingErrorMessage(batchError, "Unable to load the product cost history."));
    });
    setEditingProduct(product);
  };

  const closeEditor = () => {
    setManageSection("menu");
    setEditImageFile(null);
    setEditImagePreview("");
    setEditSizeVariants([]);
    setEditSizeOptionName("Size");
    setBatchResult(null);
    setEditingProduct(null);
  };

  const saveVariantSettings = async () => {
    if (!editingProduct) return;
    setSavingVariants(true);
    setError("");

    try {
      const variants = editSizeVariants.map((variant) => {
        const optionValue = variant.value.trim();
        if (!optionValue) throw new Error("Every size must have a name.");
        const currentVariant = variant.id
          ? editingProduct.variants.find((entry) => entry.id === variant.id)
          : undefined;
        const stockTarget = Math.max(currentVariant?.stockTarget ?? 0, currentVariant?.stock ?? 0);
        const lowStockThreshold = stockTarget === 0
          ? 0
          : Math.ceil(stockTarget * editingProduct.lowStockPercent / 100);
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
      setError(userFacingErrorMessage(variantError, "Unable to update size settings."));
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

  const openRestock = (product: Product, initialAction: StockAction = "receive") => {
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
      setSkuInventoryInitialAction(initialAction);
      setSkuInventoryProduct(product);
      return;
    }
    const preferredOption = preferredSizeOptionName(product.variants);
    const optionNames = Array.from(new Set(product.variants.map((variant) => variant.optionName)));
    setActiveRestockOptionName(optionNames.includes(preferredOption) ? preferredOption : optionNames[0] ?? "");
    setRestockingProduct(product);
    setStockAction(initialAction);
    setRestockQuantity(initialAction === "adjust" ? String(product.stock) : "");
    setRestockUnitCost("");
    setRestockNewPrice(product.price > 0 ? product.price.toFixed(2) : "");
    setRestockReceivedAt(todayInManila());
    setRestockSupplierNote("");
    setAdjustmentReason(ADJUSTMENT_REASONS[0]);
    setAdjustmentRemarks("");
    setBatchResult(null);
    setOpeningCostDrafts({});
    void getStaffInventoryBatches(token, product.id).then((result) => {
      setBatchResult(result);
      setOpeningCostDrafts(Object.fromEntries(result.batches.filter((batch) => !batch.costVerified).map((batch) => [batch.id, ""])));
    }).catch(() => undefined);
    setRestockVariantQuantities(Object.fromEntries(product.variants.map((variant) => [
      variant.id,
      initialAction === "adjust" ? String(variant.stock) : "0"
    ])));
  };

  const saveOpeningBatchCost = async (batchId: string) => {
    if (!restockingProduct) return;
    const unitCost = Number(openingCostDrafts[batchId]);
    if (!isMoneyInput(openingCostDrafts[batchId] ?? "")) {
      setError("Enter the unit cost with up to two decimal places.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await verifyStaffOpeningBatchCost(token, restockingProduct.id, batchId, unitCost);
      setBatchResult(result);
      const productId = restockingProduct.id;
      setProducts((current) => current.map((product) => product.id === productId
        ? { ...product, unverifiedCostQuantity: result.summary.unverifiedQuantity }
        : product));
      setNotice("Unit cost saved. These units can now be sold.");
    } catch (batchError) {
      setError(userFacingErrorMessage(batchError, "Unable to save the unit cost."));
    } finally {
      setSubmitting(false);
    }
  };

  const changeStockAction = (action: StockAction) => {
    if (!restockingProduct) return;
    setError("");
    setStockAction(action);
    setRestockQuantity(action === "adjust" ? String(restockingProduct.stock) : "");
    setRestockVariantQuantities(Object.fromEntries(restockingProduct.variants.map((variant) => [
      variant.id,
      action === "adjust" ? String(variant.stock) : "0"
    ])));
  };

  const saveSellingPrice = async () => {
    if (!restockingProduct) return;
    if (!isMoneyInput(restockNewPrice) || Number(restockNewPrice) <= 0) {
      setError("Enter a selling price above PHP 0.00 with up to two decimal places.");
      return;
    }
    const price = Number(restockNewPrice);
    if (price === restockingProduct.price) {
      setError("The new selling price is the same as the current price.");
      return;
    }
    const confirmed = await confirm({
      title: "Update the selling price?",
      description: `${restockingProduct.name}: ${restockingProduct.price > 0 ? formatPhp(restockingProduct.price) : "no price"} → ${formatPhp(price)}. Applies to all future reservations and walk-in sales.`,
      confirmLabel: "Update price",
      tone: "warning"
    });
    if (!confirmed) return;

    setSubmitting(true);
    setError("");
    try {
      const updatedProduct = await updateStaffProduct(token, restockingProduct.id, {
        price,
        notes: "Selling price updated from Update stock."
      });
      const mappedProduct = mapStaffProduct(updatedProduct);
      setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
      setRestockingProduct(null);
      setActiveRestockOptionName("");
      setNotice(`${mappedProduct.name} selling price updated to ${formatPhp(mappedProduct.price)}.`);
    } catch (priceError) {
      setError(userFacingErrorMessage(priceError, "Unable to update the selling price."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveRestock = async () => {
    if (!restockingProduct) return;
    if (stockAction === "price") {
      await saveSellingPrice();
      return;
    }
    const restockMode = stockAction === "receive" ? "add" : "set";

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
        ? "Enter a quantity received from 1 to 10,000,000."
        : "Enter a physical count from 0 to 10,000,000.");
      return;
    }
    const unitCost = Number(restockUnitCost);
    if (restockMode === "add" && !isMoneyInput(restockUnitCost)) {
      setError("Enter the unit cost with up to two decimal places.");
      return;
    }
    if (restockMode === "add" && !restockReceivedAt) {
      setError("Choose the date the stock was received.");
      return;
    }

    const hasInvalidVariantAllocation = usesVariantEntry && variantGroups.some((group, index) => {
      const currentTotal = group.reduce((total, variant) => total + variant.stock, 0);
      return enteredTotals[index] !== quantity || (restockMode === "add" && currentTotal !== restockingProduct.stock);
    });
    if (hasInvalidVariantAllocation) {
      setError(
        restockMode === "add"
          ? "The size totals do not match the product total. Use Adjust stock count first so they match."
          : "Every option group must have the same total before saving the count."
      );
      return;
    }

    const variance = quantity - restockingProduct.stock;
    if (restockMode === "set" && variance === 0) {
      setError("The physical count matches the system stock. There is nothing to adjust.");
      return;
    }
    const confirmed = await confirm({
      title: restockMode === "add" ? "Receive this stock?" : "Post this stock adjustment?",
      description: restockMode === "add"
        ? `Receive ${quantity} unit${quantity === 1 ? "" : "s"} of ${restockingProduct.name} at ${formatPhp(unitCost)} per unit. Stock on hand: ${restockingProduct.stock} → ${restockingProduct.stock + quantity}.`
        : `${restockingProduct.name}: system stock ${restockingProduct.stock} → physical count ${quantity} (variance ${variance > 0 ? "+" : "−"}${Math.abs(variance)}). Reason: ${adjustmentReason}.`,
      confirmLabel: restockMode === "add" ? "Receive stock" : "Post adjustment",
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
        notes: restockMode === "add" ? "Stock received from staff inventory page." : adjustmentNote(adjustmentReason, adjustmentRemarks),
        lowStockPercent: restockingProduct.lowStockPercent,
        ...(restockMode === "add" ? {
          unitCost,
          receivedAt: `${restockReceivedAt}T00:00:00+08:00`,
          supplierNote: restockSupplierNote.trim() || undefined
        } : {})
      });
      const mappedProduct = mapStaffProduct(updatedProduct);
      setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
      setRestockingProduct(null);
      setActiveRestockOptionName("");
      setRestockQuantity("");
      setRestockUnitCost("");
      setRestockSupplierNote("");
      setRestockVariantQuantities({});
      setNotice(
        restockMode === "add"
          ? `Received ${quantity} units of ${mappedProduct.name}. Stock on hand: ${mappedProduct.stock}.`
          : `${mappedProduct.name} adjusted to ${mappedProduct.stock} units (${adjustmentReason.toLowerCase()}).`
      );
    } catch (restockError) {
      setError(userFacingErrorMessage(restockError, "Unable to update stock."));
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
      setError(userFacingErrorMessage(archiveError, "Unable to archive the product."));
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
      setError(userFacingErrorMessage(restoreError, "Unable to restore the product."));
    } finally {
      setRestoringProductId("");
      setSubmitting(false);
    }
  };

  const reviewPermanentDelete = async (product: Product) => {
    setError("");
    setDeletingProductId(product.id);
    try {
      const eligibility = await getStaffProductDeletionEligibility(token, product.id);
      if (!eligibility.eligible) {
        setError(`${product.name} must remain archived. ${eligibility.reasons.join(" ")}`);
        return;
      }
      setPermanentDeleteProduct(product);
      setPermanentDeleteConfirmation("");
      setPermanentDeleteReason("");
    } catch (deleteError) {
      setError(userFacingErrorMessage(deleteError, "Unable to check whether this product can be deleted."));
    } finally {
      setDeletingProductId("");
    }
  };

  const deleteProductPermanently = async () => {
    if (!permanentDeleteProduct) return;
    setSubmitting(true);
    setDeletingProductId(permanentDeleteProduct.id);
    setError("");
    try {
      const deleted = await permanentlyDeleteStaffProduct(token, permanentDeleteProduct.id, {
        confirmation: permanentDeleteConfirmation,
        reason: permanentDeleteReason.trim()
      });
      setProducts((current) => current.filter((item) => item.id !== deleted.id));
      setPermanentDeleteProduct(null);
      setNotice(`${deleted.name} permanently deleted.${deleted.imageCleanupQueued ? " Its managed image was queued for secure storage cleanup." : ""}`);
    } catch (deleteError) {
      setError(userFacingErrorMessage(deleteError, "Unable to permanently delete this product."));
    } finally {
      setDeletingProductId("");
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
    ? stockAction === "receive"
      ? restockingProduct.stock + restockEnteredQuantity
      : restockEnteredQuantity
    : 0;
  const restockVariance = restockingProduct ? resultingStock - restockingProduct.stock : 0;
  const enteredRestockUnitCost = isMoneyInput(restockUnitCost) ? Number(restockUnitCost) : null;
  const variantAllocationValid = automaticallySynchronizedVariants || restockVariantGroups.every(([, variants], index) => {
    const currentTotal = variants.reduce((total, variant) => total + variant.stock, 0);
    return restockEnteredTotals[index] === restockEnteredQuantity
      && (stockAction === "adjust" || currentTotal === restockingProduct?.stock);
  });
  const restockHasLegacyMismatch = Boolean(restockingProduct && stockAction === "receive" && restockVariantGroups.some(([, variants]) =>
    variants.reduce((total, variant) => total + variant.stock, 0) !== restockingProduct.stock
  ));
  // The first missing input, shown beside the disabled save button so staff know what is left.
  const restockMissingInput = !restockingProduct
    ? ""
    : stockAction === "price"
      ? (!isMoneyInput(restockNewPrice) || Number(restockNewPrice) <= 0
        ? "Enter the new selling price."
        : Number(restockNewPrice) === restockingProduct.price ? "Enter a price different from the current one." : "")
      : restockHasLegacyMismatch
        ? "Adjust the stock count first so the size totals match."
        : !usesVariantRestockEntry && !restockQuantity.trim()
          ? (stockAction === "receive" ? "Enter the quantity received." : "Enter the physical count.")
          : !variantAllocationValid
            ? "Every option group must have the same total."
            : stockAction === "receive"
              ? (restockEnteredQuantity <= 0
                ? "Enter the quantity received."
                : enteredRestockUnitCost === null
                  ? "Enter the unit cost."
                  : !restockReceivedAt ? "Choose the date received." : "")
              : restockVariance === 0 ? "No variance yet — the count matches the system." : "";
  const restockCanSubmit = Boolean(restockingProduct) && !restockMissingInput;
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
        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setShowInventoryReport(false); setShowStockCount(true); }} aria-pressed={showStockCount} disabled={loading || submitting}><ClipboardCheck className="size-4" /> Stock count</Button>
            <Button variant="secondary" onClick={() => { setShowStockCount(false); setShowInventoryReport(true); }} aria-pressed={showInventoryReport}><Printer className="size-4" /> Print inventory</Button>
            <Button onClick={openAddProduct} disabled={loading || submitting}><Plus className="size-5" /> Add product</Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => changeVisibility("ACTIVE")} disabled={loading || submitting}>
            <ArrowLeft className="size-4" /> Active inventory
          </Button>
        )}
      />
      {showInventoryReport && visibility === "ACTIVE" ? (
        <InventoryReportPreview token={token} categories={categories} onClose={() => setShowInventoryReport(false)} />
      ) : null}
      {showStockCount && visibility === "ACTIVE" ? (
        <StockCountWorkspace
          token={token}
          categories={categories}
          onClose={() => setShowStockCount(false)}
          onProductUpdated={(updated) => {
            const mapped = mapStaffProduct(updated);
            setProducts((current) => current.map((product) => product.id === mapped.id ? mapped : product));
          }}
        />
      ) : null}
      {showStockCount ? null : <>
      <div className="grid w-full grid-cols-2 gap-1 rounded-xl border bg-card p-1 shadow-soft sm:inline-grid sm:w-auto" role="group" aria-label="Inventory view">
        <Button
          type="button"
          variant={visibility === "ACTIVE" ? "primary" : "ghost"}
          className="h-9 justify-center px-4 sm:min-w-36"
          aria-pressed={visibility === "ACTIVE"}
          onClick={() => changeVisibility("ACTIVE")}
          disabled={loading || submitting}
        >
          <Package className="size-4" aria-hidden="true" /> Active items
        </Button>
        <Button
          type="button"
          variant={visibility === "ARCHIVED" ? "primary" : "ghost"}
          className="h-9 justify-center px-4 sm:min-w-36"
          aria-pressed={visibility === "ARCHIVED"}
          onClick={() => changeVisibility("ARCHIVED")}
          disabled={loading || submitting}
        >
          <Archive className="size-4" aria-hidden="true" /> Archived items
        </Button>
      </div>
      <Toolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} placeholder="Search product, category, or count-sheet name" statuses={[...stockStatusOptions, ...Object.keys(ATTENTION_FILTERS)]} />
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <section id="inventory-product-list" aria-label={visibility === "ARCHIVED" ? "Archived inventory products" : "Active inventory products"} className="overflow-hidden rounded-xl border bg-card shadow-soft">
        <div className="hidden grid-cols-12 gap-4 border-b bg-surface-subtle px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground xl:grid">
          <span className="col-span-3">Product</span><span>Category</span><span>Total stock</span><span>Selling price</span><span>Reorder alert</span><span className="col-span-2">Stock breakdown</span><span>Status</span><span className="col-span-2">Actions</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <SkeletonList rows={5} label="Loading live inventory..." />
          ) : filtered.length ? filtered.map((product) => {
            const compactSkus = product.skus.map((sku) => ({
              ...sku,
              shortLabel: sku.options.length ? sku.options.map((option) => option.optionValue).join(" · ") : "Standard",
              fullLabel: sku.options.length ? sku.options.map((option) => `${option.optionName}: ${option.optionValue}`).join(" / ") : "Standard item"
            }));
            return (
              <article key={product.id} className="content-visibility-auto relative grid gap-4 px-4 py-4 transition-colors hover:bg-surface-subtle/60 sm:grid-cols-2 xl:grid-cols-12 xl:items-center">
                {visibility === "ACTIVE" && (product.status === "Out of Stock" || product.status === "Needs Restock") ? (
                  <span className={cn("absolute inset-y-0 left-0 w-1", product.status === "Out of Stock" ? "bg-danger" : "bg-warning")} aria-hidden="true" />
                ) : null}
                <ActionLoadingOverlay
                  active={archivingProductId === product.id || restoringProductId === product.id}
                  title={restoringProductId === product.id ? "Restoring product" : "Archiving product"}
                  detail={restoringProductId === product.id
                    ? "We are returning this item to active inventory."
                    : "We are removing this item from the student shop."}
                />
                <div className="flex min-w-0 items-center gap-3 sm:col-span-2 xl:col-span-3">
                  <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface-subtle">
                    <Image src={shopProductCardImage(product.imageUrl)} alt={product.name} fill sizes="64px" unoptimized className="object-contain p-1" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold leading-5 text-foreground">{product.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={cn("inline-flex rounded px-2 py-0.5 text-[10px] font-extrabold", product.saleMode === "CLOTH_ONLY" ? "bg-primary/10 text-primary" : product.saleMode === "OPTIONS" ? "bg-info/10 text-info" : "bg-surface-subtle text-muted-foreground")}>
                        {product.saleMode === "CLOTH_ONLY" ? "Cloth only" : product.saleMode === "OPTIONS" ? "Sizes / options" : "Simple item"}
                      </span>
                      {visibility === "ARCHIVED" ? <span className="inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-extrabold text-muted-foreground">Archived</span> : null}
                      {product.isOnSale ? <span className="inline-flex rounded bg-danger/10 px-2 py-0.5 text-[10px] font-extrabold text-danger">On Sale</span> : null}
                      {product.saleMode === "OPTIONS" && !product.skuInventoryEnabled ? <span className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">Inventory setup needed</span> : null}
                      {visibility === "ACTIVE" && product.needsPrice ? <span title="Hidden from students and not sellable until a selling price is set." className="inline-flex rounded bg-danger/10 px-2 py-0.5 text-[10px] font-extrabold text-danger">Needs price</span> : null}
                      {visibility === "ACTIVE" && product.unverifiedCostQuantity ? <span title={`${product.unverifiedCostQuantity} counted item(s) cannot be sold until their unit cost is verified.`} className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">Needs cost · {product.unverifiedCostQuantity}</span> : null}
                      {visibility === "ACTIVE" && product.hasPhoto === false ? <span className="inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-extrabold text-muted-foreground">No photo</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground xl:hidden">{product.category} · Selling price PHP {product.price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
                    <div className="mt-2 flex flex-wrap gap-1 xl:hidden">
                      {product.saleMode === "OPTIONS" && product.skuInventoryEnabled ? compactSkus.slice(0, 3).map((sku) => (
                        <span key={sku.id} title={sku.fullLabel} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", sku.stock <= sku.lowStockThreshold ? "bg-warning/10 text-warning" : "bg-surface-subtle text-muted-foreground")}>
                          {sku.shortLabel} · {sku.stock}
                        </span>
                      )) : product.saleMode === "OPTIONS" ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Set up physical combinations</span> : null}
                    </div>
                  </div>
                </div>
                <p className="hidden text-sm text-muted-foreground xl:block">{product.category}</p>
                <div className="text-sm">
                  <span className="text-muted-foreground xl:hidden">Total stock: </span>
                  <span className={cn(
                    "text-lg font-extrabold tabular-nums",
                    product.status === "Out of Stock" ? "text-danger" : product.status === "Needs Restock" ? "text-warning" : "text-primary"
                  )}>{product.stock}</span>
                  <span className="ml-1 text-xs text-muted-foreground">units</span>
                </div>
                <div className="hidden text-sm xl:block"><span className="font-extrabold text-primary">PHP {product.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="text-sm">
                  <span className="text-muted-foreground xl:hidden">Reorder alert: </span>
                  <span className="font-bold">≤ {product.minimum} units</span>
                  <span className="ml-1 text-xs text-muted-foreground">({product.lowStockPercent}%)</span>
                </div>
                <div className="hidden flex-wrap gap-1 xl:col-span-2 xl:flex">
                  {product.saleMode === "OPTIONS" && product.skuInventoryEnabled ? (
                    compactSkus.length ? <>
                      {compactSkus.slice(0, 3).map((sku) => (
                        <span key={sku.id} title={`${sku.fullLabel}: ${sku.stock} pcs`} className={cn("max-w-[190px] truncate rounded-md px-2 py-1 text-[11px] font-bold", sku.stock <= sku.lowStockThreshold ? "bg-warning/10 text-warning" : "bg-surface-subtle text-muted-foreground")}>
                          {sku.shortLabel} · {sku.stock}
                        </span>
                      ))}
                      {compactSkus.length > 3 ? <span className="px-1 py-1 text-[11px] font-bold text-muted-foreground">+{compactSkus.length - 3} combinations</span> : null}
                    </> : <span className="text-xs text-muted-foreground">No combinations</span>
                  ) : product.saleMode === "OPTIONS" ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">Physical setup required</span>
                  ) : product.saleMode === "CLOTH_ONLY" ? <span className="text-xs font-semibold text-primary">Cloth quantity only</span> : <span className="text-xs text-muted-foreground">Single stock count</span>}
                </div>
                <div className="flex flex-wrap gap-1"><StatusBadge status={product.status} />{product.isOnSale ? <StatusBadge status="On Sale" /> : null}</div>
                <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-2 xl:w-full xl:flex-col">
                  {visibility === "ARCHIVED" ? (
                    <>
                      <Button className="h-9 flex-1 px-3 xl:w-full xl:flex-none" onClick={() => void restoreProduct(product)} disabled={submitting}>
                        <RotateCcw className="size-4" /> Restore item
                      </Button>
                      {user?.role === "ADMIN" ? <Button variant="ghost" className="h-9 flex-1 border border-danger/30 px-3 text-danger hover:bg-danger/5 xl:w-full" onClick={() => void reviewPermanentDelete(product)} disabled={submitting || deletingProductId === product.id}><Trash2 className="size-4" />{deletingProductId === product.id ? "Checking..." : "Delete permanently"}</Button> : null}
                    </>
                  ) : (<>
                    <Button className="h-9 flex-1 px-3 xl:w-full xl:flex-none" onClick={() => openRestock(product)} disabled={submitting}>
                      <Plus className="size-4" />
                      {product.saleMode === "OPTIONS" && !product.skuInventoryEnabled ? "Set up inventory" : "Update stock"}
                    </Button>
                    <Button variant="secondary" className="h-9 flex-1 px-3 xl:w-full xl:flex-none" onClick={() => openEditor(product)} disabled={submitting}>
                      <Edit3 className="size-4" />
                      Manage
                    </Button>
                  </>)}
                </div>
              </article>
            );
          }) : (
            <FeedbackState
              kind="empty"
              plain
              title={visibility === "ARCHIVED" ? "No matching archived products found." : "No matching active products found."}
              description={search.trim() || status !== "All"
                ? "Try another search or stock status."
                : visibility === "ARCHIVED" ? "Archived products will appear here." : "Add your first product to start tracking stock."}
              action={search.trim() || status !== "All"
                ? <Button variant="secondary" size="sm" onClick={() => { setSearch(""); setStatus("All"); }}>Clear filters</Button>
                : visibility === "ACTIVE" ? <Button size="sm" onClick={openAddProduct} disabled={submitting}><Plus className="size-4" /> Add product</Button> : undefined}
            />
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
      </>}
      {adding ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-foreground/55 p-0 backdrop-blur-[1px] sm:p-4">
          <form ref={addDialog.dialogRef} {...addDialog.dialogProps} key={selectedTemplateId || "blank-product-form"} className="relative my-auto max-h-[100dvh] w-full max-w-2xl overflow-x-hidden overflow-y-auto bg-surface-subtle shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:rounded-xl" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setSubmitting(true);
            setError("");

            try {
              let imageUrl = String(form.get("imageUrl") ?? "").trim() || null;
              let imageStoragePath: string | null = null;
              if (addImageFile) {
                const uploadedImage = await uploadStaffProductImage(token, addImageFile);
                imageUrl = uploadedImage.url;
                imageStoragePath = uploadedImage.path;
              }

              const sizeVariants = addHasSizeVariants
                ? addSizeVariants.map((variant) => {
                    const optionValue = variant.value.trim();
                    const stock = Number(variant.stock);
                    if (!optionValue) throw new Error("Every size must have a name.");
                    if (!Number.isInteger(stock) || stock < 0) {
                      throw new Error(`${optionValue} stock must be a whole number of zero or more.`);
                    }
                    return { optionName: "Size", optionValue, stock };
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
              const initialUnitCostValue = String(form.get("initialUnitCost") ?? "").trim();
              const receivedAtValue = String(form.get("receivedAt") ?? "").trim();
              if (openingStock > 0 && (!initialUnitCostValue || !receivedAtValue)) {
                throw new Error("Enter the acquisition cost and date received for the opening stock.");
              }
              if (addAudienceScope === "SPECIFIC_DEPARTMENTS" && !addAudienceDepartmentIds.length) {
                throw new Error("Choose at least one department for this product.");
              }

              const createdProduct = await createStaffProduct(token, {
                name: String(form.get("name")).trim(),
                categoryName: String(form.get("category")).trim(),
                description: String(form.get("description") ?? "").trim() || null,
                imageUrl,
                imageStoragePath,
                price: Number(form.get("price")),
                oldPrice: String(form.get("oldPrice") ?? "").trim() ? Number(form.get("oldPrice")) : null,
                saleMode: addSaleMode,
                audienceScope: addAudienceScope,
                departmentIds: addAudienceScope === "SPECIFIC_DEPARTMENTS" ? addAudienceDepartmentIds : [],
                stock: openingStock,
                lowStockPercent: addLowStockPercent,
                ...(openingStock > 0 ? {
                  initialUnitCost: Number(initialUnitCostValue),
                  receivedAt: receivedAtValue,
                  supplierNote: String(form.get("supplierNote") ?? "").trim() || undefined
                } : {}),
                ...(sizeVariants.length ? { variants: sizeVariants } : {})
              });
              // Single-group variants such as Size are converted to physical
              // SKUs atomically by the backend during product creation. Keeping
              // this as one request prevents a half-created product if the
              // browser loses connection after the first save.
              const finalProduct = createdProduct;
              if (!finalProduct.id) throw new Error("The saved product response is missing its record ID. Refresh the inventory before trying again.");
              const mappedProduct = mapStaffProduct(finalProduct);
              setProducts((current) => mergeUniqueById([...current, mappedProduct]).sort((left, right) => left.name.localeCompare(right.name)));
              closeAddProduct();
              setNotice(`${finalProduct.name} added.`);
            } catch (createError) {
              setError(userFacingErrorMessage(createError, "Unable to add the product."));
            } finally {
              setSubmitting(false);
            }
          }}>
            <ActionLoadingOverlay
              key="add-product-loading-overlay"
              active={submitting}
              title="Saving new product"
              detail="We are saving the product and uploading its image if needed."
            />
            <div key="add-product-heading" className="sticky top-0 z-20 flex items-start gap-3 border-b border-border bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Inventory setup</p><h2 id={addDialog.titleId} className="mt-1 text-xl font-extrabold">Add inventory item</h2><p className="mt-1 text-sm text-muted-foreground">Enter the product details, selling price, and opening stock.</p></div><button type="button" data-dialog-autofocus onClick={closeAddProduct} disabled={submitting} aria-label="Close product form" className="ml-auto grid size-9 shrink-0 place-items-center rounded-md hover:bg-muted disabled:opacity-50"><X /></button></div>
            <div key="add-product-fields" className="grid min-w-0 gap-4 p-4 pb-5 sm:p-5">
              <section key="add-product-details" className="grid min-w-0 gap-3 overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-extrabold text-white">1</span><h3 className="font-extrabold text-foreground">Product details</h3></div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a template to fill common WUP details automatically, or leave it blank for a new item.</p>
                </div>
                <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
                  Start from a WUP template <span className="font-normal text-muted-foreground">(optional)</span>
                  <select value={selectedTemplateId} onChange={(event) => selectAddTemplate(event.target.value)} className="h-11 w-full min-w-0 rounded-md border px-3 font-normal outline-none focus:border-primary">
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
                  <input name="name" required defaultValue={selectedTemplate?.name ?? ""} placeholder="Example: Senior High Men's Polo" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Category
                    <input name="category" required list="staff-category-options" defaultValue={selectedTemplate?.categoryName ?? ""} placeholder="Example: Uniforms" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Selling price
                    <input name="price" required type="number" min="0" step="0.01" defaultValue={selectedTemplate?.price ?? ""} placeholder="0.00" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                  </label>
                </div>
                <div className="grid gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="text-sm font-extrabold text-primary">Opening stock cost</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Required only if you enter opening stock below. Recorded as the cost of the first delivery and used for profit reporting.</p>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold">Unit cost
                    <input name="initialUnitCost" type="number" min="0" step="0.01" placeholder="0.00" className="h-11 w-full min-w-0 rounded-md border bg-white px-3 font-normal" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">Date received
                    <input name="receivedAt" type="date" defaultValue={todayInManila()} className="h-11 w-full min-w-0 rounded-md border bg-white px-3 font-normal" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">Supplier / Reference no. <span className="font-normal text-muted-foreground">(optional)</span>
                    <input name="supplierNote" maxLength={500} placeholder="e.g. Supplier invoice SI-1024" className="h-11 w-full min-w-0 rounded-md border bg-white px-3 font-normal" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Short description <span className="font-normal text-muted-foreground">(optional)</span>
                  <input name="description" defaultValue={selectedTemplateDescription} placeholder="Short description shown with the product" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                </label>
              </section>

              <section key="add-product-image" className="grid min-w-0 gap-3 overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-extrabold text-white">2</span><h3 className="font-extrabold text-foreground">Product image</h3></div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Upload an image if the selected template does not already have one.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-white">
                    {addImagePreview ? <Image src={shopProductCardImage(addImagePreview)} alt="Product preview" width={80} height={80} unoptimized className="size-full object-contain" /> : <Upload className="size-7 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-white px-3 text-sm font-bold text-primary hover:bg-primary/10">
                      <Upload className="size-4" />
                      Choose image
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseAddImage(event.target.files)} />
                    </label>
                    <p className="mt-2 text-xs text-muted-foreground">PNG, JPG, or WEBP up to 2 MB.</p>
                  </div>
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-semibold text-primary">Use an image URL instead</summary>
                  <input name="imageUrl" defaultValue={selectedTemplate?.imageUrl ?? ""} placeholder="https://..." onChange={(event) => { if (!addImageFile) setAddImagePreview(event.target.value); }} className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground" />
                </details>
              </section>

              <section key="add-product-audience" className="grid min-w-0 gap-3 overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
                <div><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-extrabold text-white">3</span><h3 className="font-extrabold text-foreground">Featured audience</h3></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose who should see this item first. Every student can still find it through search.</p></div>
                <label className="flex gap-3 rounded-md border bg-white p-3"><input type="radio" checked={addAudienceScope === "ALL_STUDENTS"} onChange={() => { setAddAudienceScope("ALL_STUDENTS"); setAddAudienceDepartmentIds([]); }} /><span className="text-sm font-bold">All Students</span></label>
                <label className="flex gap-3 rounded-md border bg-white p-3"><input type="radio" checked={addAudienceScope === "SPECIFIC_DEPARTMENTS"} onChange={() => setAddAudienceScope("SPECIFIC_DEPARTMENTS")} /><span className="text-sm font-bold">Specific Department(s)</span></label>
                {addAudienceScope === "SPECIFIC_DEPARTMENTS" ? <div className="grid gap-2 sm:grid-cols-2">{departments.map((department) => <label key={department.id} className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm"><input type="checkbox" checked={addAudienceDepartmentIds.includes(department.id)} onChange={(event) => setAddAudienceDepartmentIds((current) => event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id))} />{department.code}</label>)}</div> : null}
              </section>

              <section key="add-product-inventory" className="grid min-w-0 gap-4 overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-extrabold text-white">4</span><h3 className="font-extrabold text-foreground">Stock setup</h3></div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose how this item is stocked and sold. Ready-made garments are usually tracked per size.</p>
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold">How is this item sold?</p>
                  <div className="grid gap-2">
                    {[
                      { value: "SIMPLE", title: "Simple item", detail: "One stock count. Students do not choose a size. Example: ID lace, pin, sash." },
                      { value: "CLOTH_ONLY", title: "Cloth only", detail: "Uniform fabric sold by quantity. The photo shows the finished uniform; students do not choose a size." },
                      { value: "OPTIONS", title: "With sizes/options", detail: "Ready-made garments such as PE uniforms. Stock is tracked per size and students choose one." }
                    ].map((mode) => (
                      <label key={mode.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${addSaleMode === mode.value ? "border-primary bg-[#eef7ef]" : "border-border bg-white"}`}>
                        <input type="radio" name="saleModeChoice" value={mode.value} checked={addSaleMode === mode.value} onChange={() => setAddSaleMode(mode.value as ProductSaleMode)} className="mt-1" />
                        <span><span className="block text-sm font-extrabold text-foreground">{mode.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{mode.detail}</span></span>
                      </label>
                    ))}
                  </div>
                </div>

                {addSaleMode === "CLOTH_ONLY" ? (
                  <div className="rounded-md border border-[#bdd8c0] bg-[#f3faf4] px-3 py-2 text-xs leading-5 text-foreground">
                    <span className="font-extrabold text-primary">Student view:</span> Uniform cloth only. Students reserve by quantity only; Size, Waist, and Length are not shown.
                  </div>
                ) : null}

                {addHasSizeVariants ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 pb-1" role="group" aria-label="Size presets">
                      <span className="text-xs font-bold text-muted-foreground">Quick fill:</span>
                      {SIZE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setAddSizeVariants(preset.sizes.map((value) => ({ key: variantDraftKey(value), value, stock: "0", lowStockThreshold: "2" })))}
                          className="rounded-full border border-border-strong bg-white px-3 py-1 text-xs font-bold text-primary hover:bg-primary/10"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_110px_36px] gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <span>Size</span><span>Opening stock</span><span />
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
                      <p className="text-sm"><span className="text-muted-foreground">Total stock: </span><span className="font-extrabold text-primary">{addSizeStockTotal} pcs</span></p>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">The reorder alert below is applied automatically to every size.</p>
                  </div>
                ) : (
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Opening stock
                    <input name="stock" required type="number" min="0" step="1" value={addSimpleStock} onChange={(event) => setAddSimpleStock(Number(event.target.value))} placeholder="0" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                  </label>
                )}

                <div className="grid gap-3 rounded-md border bg-white p-3 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-end">
                  <ReorderAlertSelect value={addLowStockPercent} onChange={setAddLowStockPercent} stockLevel={addOpeningStock} />
                  <p className="text-xs leading-5 text-muted-foreground">With {addOpeningStock} unit{addOpeningStock === 1 ? "" : "s"} of opening stock, staff are alerted at <strong className="text-foreground">{addLowStockThreshold} units or fewer</strong>. The same percentage applies to each size.</p>
                </div>

              </section>

              <details key="add-product-pricing" className="rounded-xl border bg-white px-4 py-3 text-sm shadow-sm">
                <summary className="cursor-pointer font-semibold text-muted-foreground">Optional pricing</summary>
                <label className="mt-3 grid gap-1.5 text-sm font-semibold">
                  Old price <span className="font-normal text-muted-foreground">(only for sale/discount display)</span>
                  <input name="oldPrice" type="number" min="0" step="0.01" placeholder="Leave blank if not on sale" className="h-11 w-full min-w-0 rounded-md border px-3 font-normal" />
                </label>
              </details>

              <datalist key="add-product-category-options" id="staff-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
              <div key="add-product-actions" className="sticky bottom-0 z-20 -mx-4 -mb-5 flex justify-end gap-2 border-t border-border bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
                <Button type="button" variant="secondary" className="min-w-24" onClick={closeAddProduct} disabled={submitting}>Cancel</Button>
                <Button type="submit" className="min-w-32" disabled={submitting}>{submitting ? "Saving..." : "Save product"}</Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
      {editingProduct ? (
        <div className="fixed inset-0 z-[10000] bg-foreground/45" role="presentation">
          <button
            type="button"
            aria-label="Close product manager"
            className="absolute inset-0 cursor-default"
            onClick={closeEditor}
            disabled={submitting || savingVariants}
          />
          <aside ref={editorDialog.dialogRef} {...editorDialog.dialogProps} className="absolute inset-y-0 right-0 flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
            <ActionLoadingOverlay
              active={submitting || savingVariants}
              title={savingVariants ? "Saving size settings" : "Saving product changes"}
              detail="We are updating this item and syncing the student shop."
            />
            <header className="shrink-0 border-b border-border p-5">
              <div className="flex items-start gap-3">
                {manageSection !== "menu" ? (
                  <button
                    type="button"
                    onClick={() => { setError(""); setManageSection("menu"); }}
                    disabled={submitting || savingVariants}
                    aria-label="Back to manage product"
                    className="grid size-9 shrink-0 place-items-center rounded-md border text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 id={editorDialog.titleId} className="text-xl font-extrabold text-foreground">
                    {manageSection === "menu" ? "Manage product" : manageSection === "details" ? "Edit details" : manageSection === "image" ? "Manage image" : manageSection === "selling" ? "Selling setup" : manageSection === "audience" ? "Product audience" : manageSection === "options" ? "Product options" : "Size settings"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {manageSection === "menu"
                      ? "Choose what you want to update."
                      : manageSection === "details"
                        ? "Update the product information shown in WESCOMM."
                        : manageSection === "image"
                          ? "Preview the current image or upload a replacement."
                           : manageSection === "selling"
                             ? "Choose whether students buy by quantity only or select sizes/options."
                             : manageSection === "audience"
                               ? "Choose which departments see this item first in Featured sorting."
                             : manageSection === "options"
                              ? "Manage Size, Waist, Length, Color, and other option labels without mixing them with stock counts."
                              : "Manage size labels; alert levels follow the product percentage automatically."}
                  </p>
                </div>
                <button type="button" data-dialog-autofocus onClick={closeEditor} disabled={submitting || savingVariants} aria-label="Close product manager" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-muted disabled:opacity-50"><X /></button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {error ? (
                <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-700">{error}</p>
              ) : null}

              {manageSection === "menu" ? (
                <div className="space-y-4">
                  <section className="flex items-center gap-4 rounded-lg border bg-surface-subtle p-4">
                    <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white">
                      <Image src={shopProductCardImage(editingProduct.imageUrl)} alt={editingProduct.name} fill sizes="96px" unoptimized className="object-contain p-2" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold leading-5 text-foreground">{editingProduct.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{editingProduct.category}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-white px-2 py-1 font-bold text-primary">{editingProduct.stock} items</span>
                        <StatusBadge status={editingProduct.status} />
                      </div>
                    </div>
                  </section>

                  <div className="overflow-hidden rounded-lg border bg-white">
                    <button type="button" onClick={() => { setError(""); setManageSection("details"); }} className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Edit3 className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Edit details</span><span className="mt-0.5 block text-xs text-muted-foreground">Name, category, description, selling price, and reorder alert.</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setEditImageFile(null); setEditImagePreview(editingProduct.imageUrl); setManageSection("image"); }} className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Upload className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Manage image</span><span className="mt-0.5 block text-xs text-muted-foreground">Preview, upload, or replace the product image.</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setManageSection("selling"); }} className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Filter className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Selling setup</span><span className="mt-0.5 block text-xs text-muted-foreground">{editingProduct.saleMode === "CLOTH_ONLY" ? "Cloth only — quantity only" : editingProduct.saleMode === "OPTIONS" ? "Students choose sizes/options" : "Simple item — one stock count"}</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setEditAudienceScope(editingProduct.audienceScope); setManageSection("audience"); }} className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Filter className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Product audience</span><span className="mt-0.5 block text-xs text-muted-foreground">{editingProduct.audienceScope === "ALL_STUDENTS" ? "All Students" : editingProduct.targetDepartments.map((department) => department.code).join(", ")}</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    {editingProduct.saleMode === "OPTIONS" ? <>
                    <button type="button" onClick={(event) => { setError(""); skuInventoryReturnFocusRef.current = event.currentTarget; setSkuInventoryInitialAction("receive"); setSkuInventoryProduct(editingProduct); }} className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><RefreshCw className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Inventory combinations</span><span className="mt-0.5 block text-xs text-muted-foreground">{editingProduct.skuInventoryEnabled ? `${editingProduct.skus.length} physical combinations configured` : "Setup required before reliable size/waist/length stock tracking"}.</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    <button type="button" onClick={() => { setError(""); setManageSection("options"); }} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-subtle">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Filter className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Product options</span><span className="mt-0.5 block text-xs text-muted-foreground">Manage Size, Waist, Length, Color, Clip Type, and other option labels. Stock remains under Inventory combinations.</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
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
                    setError(userFacingErrorMessage(modeError, "Unable to update the selling setup."));
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="rounded-lg border bg-surface-subtle p-4">
                    <p className="text-sm font-extrabold text-foreground">Choose what students are actually buying</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">This controls whether students see size/options. Existing stock is never guessed or redistributed automatically.</p>
                  </div>
                  {[
                    { value: "SIMPLE", title: "Simple item", detail: "One total stock count. Best for books, supplies, and items with no selectable options." },
                    { value: "CLOTH_ONLY", title: "Cloth only", detail: "Uniform tela/material only. The image is a reference preview and students reserve by quantity only." },
                    { value: "OPTIONS", title: "With sizes/options", detail: "Ready-made items. Students choose Size, Waist, Length, Color, Clip Type, or other configured options." }
                  ].map((mode) => (
                    <label key={mode.value} className="flex cursor-pointer gap-3 rounded-lg border bg-white p-4 has-[:checked]:border-primary has-[:checked]:bg-[#eef7ef]">
                      <input type="radio" name="saleMode" value={mode.value} defaultChecked={editingProduct.saleMode === mode.value} className="mt-1" />
                      <span><span className="block text-sm font-extrabold text-foreground">{mode.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{mode.detail}</span></span>
                    </label>
                  ))}
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    Switching to <b>With sizes/options</b> pauses student ordering until physical combinations are configured. Switching away from options is blocked while active reservations or unsettled payments exist.
                  </div>
                  <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save selling setup"}</Button></div>
                </form>
              ) : null}

              {manageSection === "audience" ? (
                <form className="space-y-4" onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const departmentIds = form.getAll("departmentIds").map(String);
                  if (editAudienceScope === "SPECIFIC_DEPARTMENTS" && !departmentIds.length) {
                    setError("Choose at least one department.");
                    return;
                  }
                  setSubmitting(true);
                  setError("");
                  try {
                    const updatedProduct = await updateStaffProduct(token, editingProduct.id, {
                      audienceScope: editAudienceScope,
                      departmentIds: editAudienceScope === "SPECIFIC_DEPARTMENTS" ? departmentIds : [],
                      notes: "Product audience updated from staff inventory page."
                    });
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
                    setEditingProduct(mappedProduct);
                    setNotice(`${mappedProduct.name} audience updated.`);
                    setManageSection("menu");
                  } catch (audienceError) {
                    setError(userFacingErrorMessage(audienceError, "Unable to update the product audience."));
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <label className="flex gap-3 rounded-md border bg-white p-4"><input type="radio" name="audienceScope" checked={editAudienceScope === "ALL_STUDENTS"} onChange={() => setEditAudienceScope("ALL_STUDENTS")} /><span><span className="block text-sm font-extrabold">All Students</span><span className="text-xs text-muted-foreground">General merchandise and campus-wide items.</span></span></label>
                  <label className="flex gap-3 rounded-md border bg-white p-4"><input type="radio" name="audienceScope" checked={editAudienceScope === "SPECIFIC_DEPARTMENTS"} onChange={() => setEditAudienceScope("SPECIFIC_DEPARTMENTS")} /><span><span className="block text-sm font-extrabold">Specific Department(s)</span><span className="text-xs text-muted-foreground">Prioritize this item for one or more departments.</span></span></label>
                  {editAudienceScope === "SPECIFIC_DEPARTMENTS" ? <div className="grid gap-2 sm:grid-cols-2">{departments.map((department) => <label key={department.id} className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm"><input type="checkbox" name="departmentIds" value={department.id} defaultChecked={editingProduct.targetDepartments.some((target) => target.id === department.id)} />{department.code}</label>)}</div> : null}
                  <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save audience"}</Button></div>
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
                      lowStockPercent: editLowStockPercent,
                      notes: "Product details updated from staff inventory page."
                    });
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product).sort((left, right) => left.name.localeCompare(right.name)));
                    setEditingProduct(mappedProduct);
                    setNotice(`${mappedProduct.name} updated.`);
                    setManageSection("menu");
                  } catch (updateError) {
                    setError(userFacingErrorMessage(updateError, "Unable to update the product details."));
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="flex items-center gap-3 rounded-lg border bg-surface-subtle p-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-md border bg-white"><Image src={shopProductCardImage(editingProduct.imageUrl)} alt={editingProduct.name} fill sizes="64px" unoptimized className="object-contain p-1" /></div>
                    <div><p className="text-sm font-bold text-foreground">Current stock: {editingProduct.stock} items</p><p className="mt-1 text-xs text-muted-foreground">Use Update stock from the inventory list to change quantities.</p></div>
                  </div>
                  <section className="rounded-lg border bg-muted/40 p-4">
                    <div className="grid gap-3">
                      <div><p className="text-xs font-bold uppercase text-muted-foreground">Selling price</p><p className="mt-1 text-lg font-extrabold text-primary">PHP {editingProduct.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
                      <div><p className="text-xs font-bold uppercase text-muted-foreground">Latest unit cost</p><p className="mt-1 text-lg font-extrabold">{!batchResult ? "Loading..." : batchResult.summary.latestCost === null ? "Not recorded" : formatPhp(batchResult.summary.latestCost)}</p></div>
                      <div><p className="text-xs font-bold uppercase text-muted-foreground">Margin per unit</p><p className="mt-1 text-lg font-extrabold text-primary">{!batchResult || batchResult.summary.latestCost === null ? "Not available" : `${formatPhp(editingProduct.price - batchResult.summary.latestCost)} per unit`}</p></div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">Margin uses the latest unit cost. Sales reports use the cost of the actual delivery each unit came from.</p>
                    {batchResult?.summary.unverifiedQuantity ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{batchResult.summary.unverifiedQuantity} unit(s) need a unit cost before they can be sold. Enter it from Update stock.</p> : null}
                    <CostHistory batchResult={batchResult} sellingPrice={editingProduct.price} />
                  </section>
                  <label className="grid gap-1.5 text-sm font-semibold">Product name<input name="name" required defaultValue={editingProduct.name} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">Category<input name="category" required list="staff-edit-category-options" defaultValue={editingProduct.category} className="h-11 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">Description<textarea name="description" rows={3} defaultValue={editingProduct.description} className="rounded-md border px-3 py-2 font-normal outline-none focus:border-primary" /></label>
                  <div className="grid min-w-0 gap-4">
                    <label className="grid min-w-0 gap-1.5 text-sm font-semibold"><span>Selling price</span><input name="price" required type="number" min="0" step="0.01" defaultValue={editingProduct.price} className="h-11 w-full min-w-0 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                    <label className="grid min-w-0 gap-1.5 text-sm font-semibold"><span>Old price <span className="text-xs font-normal text-muted-foreground">(optional)</span></span><input name="oldPrice" type="number" min="0" step="0.01" defaultValue={editingProduct.oldPrice ?? ""} className="h-11 w-full min-w-0 rounded-md border px-3 font-normal outline-none focus:border-primary" /></label>
                  </div>
                  <div className="grid gap-3 rounded-md border bg-surface-subtle p-3">
                    <ReorderAlertSelect value={editLowStockPercent} onChange={setEditLowStockPercent} stockLevel={editingProduct.stockTarget} />
                    <p className="text-xs leading-5 text-muted-foreground">Staff are alerted when stock falls to <strong className="text-foreground">{editLowStockThreshold} units or fewer</strong>. The stock level ({editingProduct.stockTarget}) is the highest recent stock on hand; it grows with larger deliveries and does not drop as units sell. The same percentage applies to each size.</p>
                  </div>
                  <datalist id="staff-edit-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
                  <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-white px-5 py-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save details"}</Button></div>
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
                    let imageStoragePath = imageUrl === editingProduct.imageUrl ? editingProduct.imageStoragePath : null;
                    if (editImageFile) {
                      const uploadedImage = await uploadStaffProductImage(token, editImageFile);
                      imageUrl = uploadedImage.url;
                      imageStoragePath = uploadedImage.path;
                    }
                    const updatedProduct = await updateStaffProduct(token, editingProduct.id, { imageUrl, imageStoragePath, notes: "Product image updated from staff inventory page." });
                    const mappedProduct = mapStaffProduct(updatedProduct);
                    setProducts((current) => current.map((product) => product.id === mappedProduct.id ? mappedProduct : product));
                    setEditingProduct(mappedProduct);
                    setEditImageFile(null);
                    setEditImagePreview(mappedProduct.imageUrl);
                    setNotice(`${mappedProduct.name} image updated.`);
                    setManageSection("menu");
                  } catch (updateError) {
                    setError(userFacingErrorMessage(updateError, "Unable to update the product image."));
                  } finally {
                    setSubmitting(false);
                  }
                }}>
                  <div className="grid place-items-center rounded-xl border bg-surface-subtle p-5">
                    <div className="relative size-52 overflow-hidden rounded-xl border bg-white shadow-sm">
                      {editImagePreview ? <Image src={optimizeShopProductImage(editImagePreview)} alt={`${editingProduct.name} preview`} fill sizes="208px" unoptimized className="object-contain p-3" /> : <div className="grid size-full place-items-center"><Upload className="size-9 text-primary" /></div>}
                    </div>
                    <p className="mt-3 text-sm font-bold text-foreground">{editingProduct.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Preview before saving</p>
                  </div>
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong bg-white px-3 text-sm font-bold text-primary hover:bg-primary/10">
                    <Upload className="size-4" /> Choose new image
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseEditImage(event.target.files)} />
                  </label>
                  <details className="rounded-lg border bg-white px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-muted-foreground">Use an image URL instead</summary>
                    <input name="imageUrl" defaultValue={editingProduct.imageUrl} onChange={(event) => { if (!editImageFile) setEditImagePreview(event.target.value); }} placeholder="https://..." className="mt-3 h-11 w-full rounded-md border px-3 font-normal outline-none focus:border-primary" />
                  </details>
                  <p className="text-xs leading-5 text-muted-foreground">PNG, JPG, or WEBP up to 2 MB. The preview shown above is what staff will see before saving.</p>
                  <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={() => { setEditImageFile(null); setEditImagePreview(editingProduct.imageUrl); setManageSection("menu"); }} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save image"}</Button></div>
                </form>
              ) : null}

              {manageSection === "options" ? (
                <ProductOptionsManager
                  token={token}
                  product={{
                    id: editingProduct.id,
                    stock: editingProduct.stock,
                    lowStockPercent: editingProduct.lowStockPercent,
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
                  <div className="flex items-center gap-3 rounded-lg border bg-surface-subtle p-3">
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-white"><Image src={shopProductCardImage(editingProduct.imageUrl)} alt={editingProduct.name} fill sizes="56px" unoptimized className="object-contain p-1" /></div>
                    <div><p className="text-sm font-bold text-foreground">{editSizeVariants.length ? `${editSizeVariants.length} sizes configured` : "No sizes configured"}</p><p className="mt-1 text-xs text-muted-foreground">Stock quantities are changed from Update stock.</p></div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-5 text-muted-foreground">Add or rename size labels here. Low-stock levels use the product’s automatic {editingProduct.lowStockPercent}% policy.</p>
                    <Button type="button" variant="secondary" className="h-9 shrink-0 px-3" disabled={!editingVariantStructureUnlocked || savingVariants || submitting} onClick={() => setEditSizeVariants((current) => [...current, { key: variantDraftKey("size"), value: "", stock: "0", lowStockThreshold: "2" }])}><Plus className="size-4" /> Add size</Button>
                  </div>
                  {!editingVariantStructureUnlocked ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">Size names can only be added, removed, or renamed when this product has zero stock and no active reservations. Warning levels can still be changed now.</p> : null}
                  <div className="overflow-hidden rounded-lg border bg-white">
                    <div className="grid grid-cols-[1fr_64px_86px_36px] gap-2 bg-surface-subtle px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><span>Size</span><span>Stock</span><span>Auto alert</span><span /></div>
                    <div className="divide-y divide-border">
                      {editSizeVariants.length ? editSizeVariants.map((variant, index) => (
                        <div key={variant.key} className="grid grid-cols-[1fr_64px_86px_36px] gap-2 p-3">
                          <input value={variant.value} disabled={Boolean(variant.id) && !editingVariantStructureUnlocked} onChange={(event) => setEditSizeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, value: event.target.value } : item))} placeholder="Size" aria-label={`Size ${index + 1} name`} className="h-10 min-w-0 rounded-md border bg-white px-2 text-sm disabled:bg-[#f2f5f2] disabled:text-muted-foreground" />
                          <div className={cn("flex h-10 items-center justify-center rounded-md border bg-white px-2 text-sm font-bold", Number(variant.stock) <= Number(variant.lowStockThreshold) ? "border-amber-200 text-amber-800" : "text-foreground")}>{variant.id ? variant.stock : "New"}</div>
                          <div aria-label={`${variant.value || `Size ${index + 1}`} automatic low stock alert`} className="flex h-10 min-w-0 items-center justify-center rounded-md border bg-surface-subtle px-2 text-xs font-bold text-muted-foreground">{editingProduct.skuInventoryEnabled ? "Per SKU" : `≤ ${automaticEditVariantThreshold(variant.id, variant.stock)}`}</div>
                          <button type="button" disabled={!editingVariantStructureUnlocked || savingVariants || submitting || Boolean(variant.id && editingProduct.skus.some((sku) => sku.variantIds.includes(variant.id!)))} title={variant.id && editingProduct.skus.some((sku) => sku.variantIds.includes(variant.id!)) ? "This size is used by an inventory combination. Rebuild combinations before removing it." : undefined} onClick={() => setEditSizeVariants((current) => current.filter((item) => item.key !== variant.key))} aria-label={`Remove ${variant.value || `size ${index + 1}`}`} className="grid size-10 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><X className="size-4" /></button>
                        </div>
                      )) : <p className="px-4 py-5 text-sm text-muted-foreground">This product does not have sizes yet.</p>}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={() => setManageSection("menu")} disabled={savingVariants}>Cancel</Button><Button type="button" onClick={() => void saveVariantSettings()} disabled={savingVariants || submitting}>{savingVariants ? "Saving..." : "Save size settings"}</Button></div>
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
          initialAction={skuInventoryInitialAction}
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
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-hidden bg-foreground/50 p-2 sm:p-4">
          <form
            ref={restockDialog.dialogRef}
            {...restockDialog.dialogProps}
            className="relative my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
            onSubmit={(event) => { event.preventDefault(); void saveRestock(); }}
          >
            <ActionLoadingOverlay active={submitting} title={stockAction === "price" ? "Updating price" : "Updating stock"} detail="Saving the change and refreshing the inventory." />
            <header className="shrink-0 border-b border-border p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface-subtle">
                  <Image src={shopProductCardImage(restockingProduct.imageUrl)} alt={restockingProduct.name} fill sizes="64px" unoptimized className="object-contain p-1" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id={restockDialog.titleId} className="text-xl font-extrabold text-foreground">Update stock</h2>
                  <p className="mt-1 truncate text-sm font-bold text-foreground">{restockingProduct.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Stock on hand: <strong className="text-foreground">{restockingProduct.stock}</strong> units · Selling price: <strong className="text-foreground">{restockingProduct.price > 0 ? formatPhp(restockingProduct.price) : "not set"}</strong></p>
                </div>
                <button type="button" data-dialog-autofocus onClick={closeRestockDialog} disabled={submitting} aria-label="Close stock editor" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-muted disabled:opacity-50"><X /></button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-700">{error}</p> : null}

              <StockActionTabs value={stockAction} onChange={changeStockAction} disabled={submitting} />
              <StockActionIntro action={stockAction} />

              {stockAction !== "price" && batchResult ? (
                <UnitCostNeeded
                  batches={batchResult.batches}
                  drafts={openingCostDrafts}
                  onDraft={(batchId, value) => setOpeningCostDrafts((current) => ({ ...current, [batchId]: value }))}
                  onSave={(batchId) => void saveOpeningBatchCost(batchId)}
                  submitting={submitting}
                />
              ) : null}

              {stockAction === "price" ? (
                <SellingPriceFields
                  currentPrice={restockingProduct.price}
                  oldPrice={restockingProduct.oldPrice}
                  value={restockNewPrice}
                  onChange={setRestockNewPrice}
                  latestCost={batchResult?.summary.latestCost ?? null}
                />
              ) : (
                <>
                  {restockHasLegacyMismatch ? (
                    <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                      The size totals do not match the product total of {restockingProduct.stock}. Post a stock count adjustment once before receiving new stock.
                    </p>
                  ) : null}

                  {usesVariantRestockEntry ? (
                    <section className="mt-5">
                      {restockVariantGroups.length > 1 ? (
                        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Stock option groups">
                          {restockVariantGroups.map(([optionName, variants], index) => {
                            const enteredTotal = restockEnteredTotals[index] ?? 0;
                            const currentTotal = variants.reduce((total, variant) => total + variant.stock, 0);
                            const targetMatches = enteredTotal === restockEnteredQuantity && (stockAction === "adjust" || currentTotal === restockingProduct.stock);
                            const active = activeRestockGroup?.[0] === optionName;
                            return (
                              <button
                                key={optionName}
                                type="button"
                                onClick={() => setActiveRestockOptionName(optionName)}
                                className={cn(
                                  "shrink-0 rounded-md border px-3 py-2 text-left text-xs font-bold transition",
                                  active ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-muted-foreground hover:bg-surface-subtle"
                                )}
                              >
                                <span>{optionName}</span>
                                <span className={cn("ml-2", targetMatches && restockEnteredQuantity > 0 ? "text-primary" : "text-muted-foreground")}>{targetMatches && restockEnteredQuantity > 0 ? "✓" : enteredTotal}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {activeRestockGroup ? (
                        <div className="overflow-hidden rounded-lg border">
                          <div className="grid grid-cols-[1fr_80px_110px_64px] items-center gap-2 bg-surface-subtle px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                            <span>{activeRestockGroup[0]}</span><span className="text-right">System</span><span className="text-center">{stockAction === "receive" ? "Qty received" : "Physical count"}</span><span className="text-center">{stockAction === "receive" ? "New total" : "Variance"}</span>
                          </div>
                          <div className="divide-y divide-border">
                            {sortSizeVariants(activeRestockGroup[1]).map((variant) => {
                              const entered = Math.max(0, Number(restockVariantQuantities[variant.id]) || 0);
                              return (
                                <div key={variant.id} className="grid grid-cols-[1fr_80px_110px_64px] items-center gap-2 px-3 py-2">
                                  <span className="truncate text-sm font-bold text-foreground">{variant.optionValue}</span>
                                  <span className="text-right text-sm tabular-nums text-muted-foreground">{variant.stock}</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    inputMode="numeric"
                                    value={restockVariantQuantities[variant.id] ?? "0"}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) => setRestockVariantQuantities((current) => ({ ...current, [variant.id]: event.target.value }))}
                                    aria-label={`${activeRestockGroup[0]} ${variant.optionValue} ${stockAction === "receive" ? "quantity received" : "physical count"}`}
                                    className="h-10 min-w-0 rounded-md border px-2 text-center text-base outline-none focus:border-primary"
                                  />
                                  <span className="text-center">
                                    {stockAction === "receive"
                                      ? <span className="text-sm font-bold tabular-nums">{variant.stock + entered}</span>
                                      : <Variance value={entered - variant.stock} />}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-end bg-surface-subtle px-3 py-2 text-xs font-extrabold text-primary">Total entered: {restockEnteredTotals[activeRestockGroupIndex] ?? 0}</div>
                        </div>
                      ) : null}

                      {restockVariantGroups.length > 1 ? (
                        <p className="mt-3 text-xs leading-5 text-muted-foreground">Each option group describes the same physical units. Every tab must reach the same total before saving.</p>
                      ) : null}
                    </section>
                  ) : (
                    <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-sm font-semibold">
                        {stockAction === "receive" ? "Quantity received" : "Physical count"}
                        <input autoFocus required type="number" min={stockAction === "receive" ? 1 : 0} step="1" inputMode="numeric" value={restockQuantity} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setRestockQuantity(event.target.value)} placeholder={stockAction === "receive" ? "e.g. 12" : "Units on hand"} className="h-12 rounded-md border px-3 text-base font-normal outline-none focus:border-primary" />
                      </label>
                      {stockAction === "receive" ? (
                        <MoneyInput label="Unit cost" value={restockUnitCost} onChange={setRestockUnitCost} hint="Amount paid per unit on the invoice or delivery receipt." />
                      ) : null}
                    </div>
                  )}

                  {stockAction === "receive" ? (
                    <>
                      {usesVariantRestockEntry ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <MoneyInput label="Unit cost" value={restockUnitCost} onChange={setRestockUnitCost} hint="Amount paid per unit on the invoice or delivery receipt." />
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-sm font-semibold">
                          Date received
                          <input required type="date" value={restockReceivedAt} onChange={(event) => setRestockReceivedAt(event.target.value)} className="h-12 rounded-md border bg-white px-3 text-base outline-none focus:border-primary" />
                        </label>
                        <label className="grid gap-1.5 text-sm font-semibold">
                          Supplier / Reference no. <span className="sr-only">(optional)</span>
                          <input type="text" maxLength={500} value={restockSupplierNote} onChange={(event) => setRestockSupplierNote(event.target.value)} placeholder="Optional, e.g. DR-1024" className="h-12 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary" />
                        </label>
                      </div>
                      <MarginNote price={restockingProduct.price} unitCost={enteredRestockUnitCost} />
                    </>
                  ) : (
                    <div className="mt-5">
                      <AdjustmentReasonFields reason={adjustmentReason} remarks={adjustmentRemarks} onReason={setAdjustmentReason} onRemarks={setAdjustmentRemarks} />
                      {restockVariance > 0 ? <p className="mt-3 text-xs leading-5 text-muted-foreground">The {restockVariance} extra unit{restockVariance === 1 ? "" : "s"} will need a unit cost before they can be sold.</p> : null}
                    </div>
                  )}

                  <SummaryPanel rows={stockAction === "receive" ? [
                    { label: "Stock on hand", value: restockingProduct.stock },
                    { label: "Quantity received", value: `+${restockEnteredQuantity}` },
                    { label: "New stock on hand", value: resultingStock, emphasis: true }
                  ] : [
                    { label: "System stock", value: restockingProduct.stock },
                    { label: "Physical count", value: restockEnteredQuantity },
                    { label: "Variance", value: <Variance value={restockVariance} className="text-base" />, emphasis: true }
                  ]} />
                  <p className="mt-3 text-xs text-muted-foreground">Reorder alert: {restockingProduct.minimum} units or fewer ({restockingProduct.lowStockPercent}% of stock level). Change it under Manage &gt; Edit details.</p>
                </>
              )}

              <CostHistory batchResult={batchResult} sellingPrice={restockingProduct.price} />
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <SubmitHint text={submitting ? "" : restockMissingInput} />
              <Button type="button" variant="secondary" onClick={closeRestockDialog} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting || !restockCanSubmit}>
                {submitting ? "Saving..." : stockAction === "receive" ? "Receive stock" : stockAction === "adjust" ? "Post adjustment" : "Update price"}
              </Button>
            </footer>
          </form>
        </div>
      ) : null}
      {permanentDeleteProduct ? (
        <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-foreground/60 p-3" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) setPermanentDeleteProduct(null); }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="permanent-product-delete-title" aria-describedby="permanent-product-delete-description" className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-md bg-red-50 text-red-700"><Trash2 className="size-6" /></span><div><p className="text-xs font-bold uppercase text-red-700">Admin only · irreversible</p><h2 id="permanent-product-delete-title" className="mt-1 text-xl font-extrabold text-foreground">Delete {permanentDeleteProduct.name} permanently?</h2></div><button type="button" autoFocus aria-label="Close permanent deletion dialog" onClick={() => setPermanentDeleteProduct(null)} disabled={submitting} className="ml-auto grid size-9 place-items-center rounded-md hover:bg-muted"><X className="size-5" /></button></div>
            <p id="permanent-product-delete-description" className="mt-4 text-sm leading-6 text-muted-foreground">WESCOMM confirmed that this archived product has no reservation or payment history that must be retained. Its uploaded image will also be removed.</p>
            <label className="mt-5 grid gap-1.5 text-sm font-bold">Deletion reason<textarea required minLength={10} maxLength={500} value={permanentDeleteReason} onChange={(event) => setPermanentDeleteReason(event.target.value)} placeholder="Document why this product and its files should be removed." className="min-h-24 rounded-md border border-[#dfc4c4] px-3 py-2 font-normal outline-none focus:border-red-600" /></label>
            <label className="mt-4 grid gap-1.5 text-sm font-bold">Type the exact product name to confirm<input value={permanentDeleteConfirmation} onChange={(event) => setPermanentDeleteConfirmation(event.target.value)} placeholder={permanentDeleteProduct.name} autoComplete="off" className="h-11 rounded-md border border-[#dfc4c4] px-3 font-normal outline-none focus:border-red-600" /></label>
            <div className="mt-6 grid grid-cols-2 gap-3"><Button variant="secondary" onClick={() => setPermanentDeleteProduct(null)} disabled={submitting}>Keep archived</Button><Button className="bg-red-700 hover:bg-red-800" onClick={() => void deleteProductPermanently()} disabled={submitting || permanentDeleteConfirmation !== permanentDeleteProduct.name || permanentDeleteReason.trim().length < 10}>{submitting ? "Deleting..." : "Delete permanently"}</Button></div>
          </section>
        </div>
      ) : null}
      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
    </div>
  );
}
