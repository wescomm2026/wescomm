/**
 * Plans how a physical inventory count sheet updates the catalog. Pure logic only:
 * the import service loads a snapshot of the catalog, this module decides what to
 * change, and the service applies each step through the regular inventory services.
 */

export const INVENTORY_COUNT_SALE_MODES = ["SIMPLE", "CLOTH_ONLY", "OPTIONS"] as const;
export type InventoryCountSaleMode = (typeof INVENTORY_COUNT_SALE_MODES)[number];

export type InventoryCountLine = {
  /** Item wording exactly as printed on the count sheet. */
  sheet: string;
  /** Size or option value; only for OPTIONS products. */
  option?: string;
  count: number;
};

export type InventoryCountProduct = {
  key: string;
  name: string;
  category: string;
  saleMode: InventoryCountSaleMode;
  optionName?: string;
  description?: string;
  /** Bundled catalog photo, used only when the product has no photo of its own. */
  imageUrl?: string;
  /** Existing catalog names that are this same item and should be renamed. */
  matchExisting?: string[];
  /** Existing names that might be this item; reported for review, never merged. */
  reviewCandidates?: string[];
  countMissingOnSheet?: boolean;
  lines: InventoryCountLine[];
};

export type InventoryCountCategory = { name: string; slug: string; iconUrl?: string };

export type InventoryCountDataset = {
  version: string;
  title: string;
  countedAt: string;
  sources: string[];
  notes?: string[];
  categories: InventoryCountCategory[];
  products: InventoryCountProduct[];
};

export type CatalogProductSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  saleMode: InventoryCountSaleMode;
  skuInventoryEnabled: boolean;
  stock: number;
  imageUrl: string | null;
  normalizedAliases: string[];
  variants: Array<{ id: string; optionName: string; optionValue: string }>;
  activeSkus: Array<{ id: string; stock: number; options: Array<{ optionName: string; optionValue: string }> }>;
  activeReservationCount: number;
};

export type ImportStep =
  | { type: "CREATE" }
  | { type: "RESTORE" }
  | { type: "RENAME"; from: string; to: string }
  | { type: "ZERO_STOCK"; previousStock: number }
  | { type: "CHANGE_SALE_MODE"; from: InventoryCountSaleMode; to: InventoryCountSaleMode }
  | { type: "SET_SIZES"; optionName: string; sizes: Array<{ option: string; count: number }> }
  | { type: "SET_SIZE_COUNTS"; changes: Array<{ option: string; from: number; to: number }> }
  | { type: "SET_STOCK"; from: number; to: number }
  | { type: "SET_IMAGE"; imageUrl: string }
  | { type: "ADD_ALIASES"; aliases: string[] };

export type ProductImportPlan = {
  key: string;
  name: string;
  category: string;
  saleMode: InventoryCountSaleMode;
  total: number;
  matched: { id: string; name: string } | null;
  steps: ImportStep[];
  /** Steps that change stock or structure; blocked while reservations are active. */
  blockedReason: string | null;
  reviewCandidatesFound: string[];
  warnings: string[];
};

export function normalizeCatalogName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function sameText(left: string, right: string) {
  return normalizeCatalogName(left) === normalizeCatalogName(right);
}

export function productTotal(product: InventoryCountProduct) {
  return product.lines.reduce((total, line) => total + line.count, 0);
}

export function validateInventoryDataset(dataset: InventoryCountDataset) {
  const errors: string[] = [];
  const categorySlugs = new Set(dataset.categories.map((category) => category.slug));
  const keys = new Set<string>();
  const names = new Set<string>();
  const claimedExisting = new Map<string, string>();

  if (!/^\d{4}-\d{2}$/.test(dataset.version)) errors.push("version must look like YYYY-MM.");
  if (!dataset.products.length) errors.push("The dataset has no products.");

  for (const product of dataset.products) {
    const label = product.key || product.name || "(unnamed product)";
    if (!/^[a-z0-9-]+$/.test(product.key)) errors.push(`${label}: key must be lowercase letters, digits and hyphens.`);
    if (keys.has(product.key)) errors.push(`${label}: duplicate key.`);
    keys.add(product.key);

    const normalizedName = normalizeCatalogName(product.name);
    if (!normalizedName || product.name.trim() !== product.name || product.name.length > 120) {
      errors.push(`${label}: name must be 1-120 characters without surrounding spaces.`);
    }
    if (names.has(normalizedName)) errors.push(`${label}: duplicate product name ${product.name}.`);
    names.add(normalizedName);

    if (!categorySlugs.has(product.category)) errors.push(`${label}: unknown category ${product.category}.`);
    if (!INVENTORY_COUNT_SALE_MODES.includes(product.saleMode)) errors.push(`${label}: unknown sale mode ${product.saleMode}.`);
    if (!product.lines.length) errors.push(`${label}: no count lines.`);

    for (const line of product.lines) {
      if (!Number.isSafeInteger(line.count) || line.count < 0 || line.count > 10_000_000) {
        errors.push(`${label}: count for ${line.sheet} must be a whole number from 0 to 10,000,000.`);
      }
      if (!line.sheet.trim()) errors.push(`${label}: every line needs its sheet wording.`);
    }

    if (product.saleMode === "OPTIONS") {
      if (!product.optionName?.trim()) errors.push(`${label}: products with sizes need an optionName.`);
      const options = new Set<string>();
      for (const line of product.lines) {
        const option = line.option?.trim();
        if (!option) {
          errors.push(`${label}: ${line.sheet} needs an option value.`);
          continue;
        }
        if (options.has(normalizeCatalogName(option))) errors.push(`${label}: option ${option} appears twice.`);
        options.add(normalizeCatalogName(option));
      }
    } else {
      if (product.lines.length !== 1) errors.push(`${label}: items without sizes must have exactly one count line.`);
      if (product.lines.some((line) => line.option)) errors.push(`${label}: items without sizes cannot have option values.`);
    }

    for (const existing of product.matchExisting ?? []) {
      const key = normalizeCatalogName(existing);
      const owner = claimedExisting.get(key);
      if (owner && owner !== product.key) errors.push(`${label}: ${existing} is already claimed by ${owner}.`);
      claimedExisting.set(key, product.key);
    }
  }

  return errors;
}

function hasPhoto(imageUrl: string | null) {
  const value = imageUrl?.trim();
  return Boolean(value) && !/^\/assets\/[a-z0-9-]+\.svg$/i.test(value!);
}

/**
 * Active SKUs match the count sheet exactly when every SKU has one value of the
 * sheet's option group and the set of values is the same as the sheet's sizes.
 */
function matchingSkuLayout(snapshot: CatalogProductSnapshot, product: InventoryCountProduct) {
  if (snapshot.saleMode !== "OPTIONS" || !snapshot.skuInventoryEnabled) return null;
  if (snapshot.activeSkus.length !== product.lines.length) return null;
  const skuByOption = new Map<string, CatalogProductSnapshot["activeSkus"][number]>();
  for (const sku of snapshot.activeSkus) {
    if (sku.options.length !== 1 || !sameText(sku.options[0].optionName, product.optionName ?? "")) return null;
    skuByOption.set(normalizeCatalogName(sku.options[0].optionValue), sku);
  }
  for (const line of product.lines) {
    if (!skuByOption.has(normalizeCatalogName(line.option ?? ""))) return null;
  }
  return skuByOption;
}

function findMatches(product: InventoryCountProduct, catalog: CatalogProductSnapshot[]) {
  const names = new Set([product.name, ...(product.matchExisting ?? [])].map(normalizeCatalogName));
  const sheetAliases = new Set(product.lines.map((line) => normalizeCatalogName(line.sheet)));
  const byName = catalog.filter((item) => names.has(normalizeCatalogName(item.name)));
  if (byName.length) return { matches: byName, viaAlias: false };
  // After a staff rename, a previous import's aliases (every sheet line) still identify the item.
  const byAlias = catalog.filter((item) => {
    const aliases = new Set(item.normalizedAliases);
    return Array.from(sheetAliases).every((alias) => aliases.has(alias));
  });
  return { matches: byAlias, viaAlias: true };
}

export function planProductImport(product: InventoryCountProduct, catalog: CatalogProductSnapshot[]): ProductImportPlan {
  const plan: ProductImportPlan = {
    key: product.key,
    name: product.name,
    category: product.category,
    saleMode: product.saleMode,
    total: productTotal(product),
    matched: null,
    steps: [],
    blockedReason: null,
    reviewCandidatesFound: catalog
      .filter((item) => (product.reviewCandidates ?? []).some((name) => sameText(name, item.name)))
      .map((item) => item.name),
    warnings: product.countMissingOnSheet ? ["No count on the sheet; imported as 0."] : []
  };

  const { matches, viaAlias } = findMatches(product, catalog);
  if (matches.length > 1) {
    plan.blockedReason = `Matches more than one existing product: ${matches.map((item) => item.name).join(", ")}. Merge or rename them first.`;
    return plan;
  }

  const sizes = product.lines.map((line) => ({ option: line.option ?? "", count: line.count }));
  const aliasesFor = (existing: CatalogProductSnapshot | null) => {
    const wanted = [...product.lines.map((line) => line.sheet)];
    if (existing && !viaAlias && !sameText(existing.name, product.name)) wanted.push(existing.name);
    const present = new Set(existing?.normalizedAliases ?? []);
    const unique = new Map<string, string>();
    for (const alias of wanted) {
      const key = normalizeCatalogName(alias);
      if (!key || key === normalizeCatalogName(product.name) || present.has(key)) continue;
      if (!unique.has(key)) unique.set(key, alias);
    }
    return Array.from(unique.values());
  };

  const existing = matches[0] ?? null;
  if (!existing) {
    const clash = catalog.find((item) => sameText(item.name, product.name));
    if (clash) {
      plan.blockedReason = `The name ${product.name} is already used by another product.`;
      return plan;
    }
    plan.steps.push({ type: "CREATE" });
    if (product.saleMode === "OPTIONS") plan.steps.push({ type: "SET_SIZES", optionName: product.optionName!, sizes });
    else if (plan.total > 0) plan.steps.push({ type: "SET_STOCK", from: 0, to: plan.total });
    const aliases = aliasesFor(null);
    if (aliases.length) plan.steps.push({ type: "ADD_ALIASES", aliases });
    return plan;
  }

  plan.matched = { id: existing.id, name: existing.name };
  if (!existing.isActive) plan.steps.push({ type: "RESTORE" });
  // Matched through stored aliases means staff renamed it after an earlier import: keep their name.
  if (!viaAlias && existing.name !== product.name) {
    const clash = catalog.find((item) => item.id !== existing.id && sameText(item.name, product.name));
    if (clash) {
      plan.blockedReason = `Cannot rename ${existing.name}: ${product.name} is already used by another product.`;
      return plan;
    }
    plan.steps.push({ type: "RENAME", from: existing.name, to: product.name });
  }

  const stockSteps: ImportStep[] = [];
  if (product.saleMode === "OPTIONS") {
    const layout = matchingSkuLayout(existing, product);
    if (layout) {
      const changes = product.lines
        .map((line) => ({ option: line.option!, from: layout.get(normalizeCatalogName(line.option!))!.stock, to: line.count }))
        .filter((change) => change.from !== change.to);
      if (changes.length) stockSteps.push({ type: "SET_SIZE_COUNTS", changes });
    } else {
      if (existing.stock > 0) stockSteps.push({ type: "ZERO_STOCK", previousStock: existing.stock });
      if (existing.saleMode !== "OPTIONS") stockSteps.push({ type: "CHANGE_SALE_MODE", from: existing.saleMode, to: "OPTIONS" });
      stockSteps.push({ type: "SET_SIZES", optionName: product.optionName!, sizes });
    }
  } else if (existing.saleMode === product.saleMode) {
    if (existing.skuInventoryEnabled) {
      plan.blockedReason = `${existing.name} still tracks stock by size or option. Update it in Inventory before importing a single count.`;
      return plan;
    }
    if (existing.stock !== plan.total) stockSteps.push({ type: "SET_STOCK", from: existing.stock, to: plan.total });
  } else {
    if (existing.stock > 0) stockSteps.push({ type: "ZERO_STOCK", previousStock: existing.stock });
    stockSteps.push({ type: "CHANGE_SALE_MODE", from: existing.saleMode, to: product.saleMode });
    if (plan.total > 0) stockSteps.push({ type: "SET_STOCK", from: 0, to: plan.total });
  }
  plan.steps.push(...stockSteps);

  if (product.imageUrl && !hasPhoto(existing.imageUrl)) plan.steps.push({ type: "SET_IMAGE", imageUrl: product.imageUrl });
  const aliases = aliasesFor(existing);
  if (aliases.length) plan.steps.push({ type: "ADD_ALIASES", aliases });

  if (stockSteps.length && existing.activeReservationCount > 0) {
    plan.blockedReason = `${existing.name} has ${existing.activeReservationCount} active reservation(s). Complete or cancel them before importing its count.`;
  }
  return plan;
}

export function planInventoryImport(dataset: InventoryCountDataset, catalog: CatalogProductSnapshot[]) {
  const plans = dataset.products.map((product) => planProductImport(product, catalog));
  const matchedIds = plans.flatMap((plan) => plan.matched ? [plan.matched.id] : []);
  const duplicateMatches = matchedIds.filter((id, index) => matchedIds.indexOf(id) !== index);
  for (const plan of plans) {
    if (plan.matched && duplicateMatches.includes(plan.matched.id)) {
      plan.blockedReason = `${plan.matched.name} is matched by more than one count-sheet item.`;
    }
  }
  return plans;
}

export type ImportTarget = { kind: "LOCAL" | "STAGING" | "PRODUCTION" | "OTHER"; label: string; projectRef: string | null };

/**
 * Identifies the database an import would write to. Writes are allowed on a local
 * database and on the declared Staging project; Production requires the operator to
 * repeat its project reference with --confirm-production.
 */
export function resolveImportTarget(input: {
  databaseUrl: string | undefined;
  stagingProjectRef?: string;
  productionProjectRef?: string;
}): ImportTarget {
  if (!input.databaseUrl?.trim()) throw new Error("DIRECT_URL or DATABASE_URL is required.");
  const url = new URL(input.databaseUrl);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) {
    return { kind: "LOCAL", label: `local database ${url.pathname.replace(/^\//, "")} on port ${url.port || "5432"}`, projectRef: null };
  }
  const username = decodeURIComponent(url.username);
  const projectRef = (username.match(/\.([a-z0-9]+)$/i)?.[1]
    ?? url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1]
    ?? null)?.toLowerCase() ?? null;
  const staging = input.stagingProjectRef?.trim().toLowerCase();
  const production = input.productionProjectRef?.trim().toLowerCase();
  if (projectRef && staging && projectRef === staging) return { kind: "STAGING", label: `Staging (${projectRef})`, projectRef };
  if (projectRef && production && projectRef === production) return { kind: "PRODUCTION", label: `PRODUCTION (${projectRef})`, projectRef };
  return { kind: "OTHER", label: projectRef ? `unrecognized project ${projectRef}` : `unrecognized host ${url.hostname}`, projectRef };
}

export function importWriteRefusal(target: ImportTarget, confirmProductionRef: string | undefined) {
  if (target.kind === "LOCAL" || target.kind === "STAGING") return null;
  if (target.kind === "PRODUCTION") {
    return confirmProductionRef?.trim().toLowerCase() === target.projectRef
      ? null
      : `Refusing to write to ${target.label}. Review the dry run, then repeat with --confirm-production ${target.projectRef}.`;
  }
  return `Refusing to write to ${target.label}. Set STAGING_SUPABASE_PROJECT_REF and PRODUCTION_SUPABASE_PROJECT_REF so the target can be identified.`;
}
