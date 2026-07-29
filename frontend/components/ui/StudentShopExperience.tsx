"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, ShoppingBag, X } from "lucide-react";
import { AddToCartModal } from "@/components/cart/AddToCartModal";
import { useStudentCart, type CartProduct } from "@/components/cart/StudentCartProvider";
import { StudentCheckoutModal } from "@/components/checkout/StudentCheckoutModal";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { getProductsFromApi } from "@/lib/api";
import { isUniformClothOnly, uniformClothGroupKey } from "@/lib/product-display";
import { emitShopSearch, readShopSearchFromUrl, SHOP_SEARCH_EVENT, writeShopSearchToUrl } from "@/lib/shop-search";

type Product = CartProduct;

const allCategory = { label: "All Items", image: "/assets/all-items.svg", href: "/student/shop" };
const statusFilters = ["In Stock", "Restock Soon", "Out of Stock", "On Sale"];
const categoryIconByName = new Map([
  ["Uniforms", "/assets/uniforms.svg"],
  ["ID Accessories", "/assets/id-accessories.svg"],
  ["School Supplies", "/assets/school-supplies.svg"],
  ["Textbooks", "/assets/textbooks.svg"],
  ["Others", "/assets/others.svg"]
]);

function parsePrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function availabilityText(product: Product) {
  const count = Number(product.count);
  if (!Number.isFinite(count) || count <= 0 || product.status === "Out of Stock") {
    return "No available items";
  }

  return `${count} available item${count === 1 ? "" : "s"}`;
}

function ProductCard({
  product,
  onBuyNow,
  onAddToCart,
  onViewImage
}: {
  product: Product;
  onBuyNow: (product: Product) => void;
  onAddToCart: (product: Product) => void;
  onViewImage: (product: Product) => void;
}) {
  const disabled = product.status === "Out of Stock";
  const clothOnly = isUniformClothOnly(product);
  const tone =
    product.status === "In Stock"
      ? "bg-[#dff3df] text-primary"
      : product.status === "Out of Stock"
        ? "bg-[#ffe3b0] text-[#d97706]"
        : "bg-[#fff0bf] text-[#d97706]";

  return (
    <article aria-label={product.name} className="wes-card flex h-full min-w-0 flex-col overflow-hidden p-2.5 sm:p-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#f7faf7]">
        <button
          type="button"
          onClick={() => onViewImage(product)}
          aria-label={`View full image of ${product.name}`}
          className="absolute inset-0 cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 639px) 44vw, (max-width: 1279px) 30vw, 22vw"
            className="object-contain p-2 sm:p-3"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full border border-[#d8e4d9] bg-white/95 text-primary shadow-sm sm:bottom-2 sm:right-2 sm:size-8"
          >
            <Maximize2 className="size-3.5 sm:size-4" />
          </span>
        </button>
        <span className={`pointer-events-none absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded-full px-2 py-1 text-[9px] font-extrabold leading-none sm:left-2 sm:top-2 sm:px-3 sm:text-xs ${tone}`}>
          {product.status}
        </span>
      </div>
      <h3 className="mt-2 line-clamp-2 min-h-9 text-xs font-extrabold leading-[1.125rem] text-[#17211b] sm:mt-3 sm:min-h-12 sm:text-base sm:leading-6">{product.name}</h3>
      <p className="hidden line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground sm:block">{product.detail}</p>
      <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-primary sm:text-xs">{product.category}</p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 sm:mt-2 sm:gap-2">
        <p className="truncate text-xs font-extrabold text-primary sm:text-base">{product.price}</p>
        {product.oldPrice ? <p className="truncate text-[10px] text-muted-foreground line-through sm:text-sm">{product.oldPrice}</p> : null}
      </div>
      <p className="mt-1.5 truncate text-[10px] font-semibold text-[#506059] sm:mt-2 sm:text-sm">{availabilityText(product)}</p>
      {clothOnly ? (
        <p className="mt-2 hidden rounded-md border border-[#cfe2d1] bg-[#f5faf5] px-3 py-2 text-xs font-medium leading-5 text-[#4e6255] sm:block">
          Tela/material lang. Preview lang ang uniform image.
        </p>
      ) : null}
      {disabled ? (
        <Button variant="secondary" disabled className="mt-auto h-10 w-full min-w-0 px-1 text-[10px] text-primary sm:h-11 sm:px-3 sm:text-sm">
          <AssetIcon src="/assets/out-of-stock.svg" className="hidden size-4 sm:block sm:size-5" />
          <span className="truncate">Out of Stock</span>
        </Button>
      ) : (
        <div className="mt-auto grid grid-cols-2 gap-1.5 pt-2.5 sm:gap-2 sm:pt-3">
          <Button
            type="button"
            variant="secondary"
            aria-label={`Add to Cart: ${product.name}`}
            className="h-10 min-w-0 px-1 text-[10px] sm:h-11 sm:px-2 sm:text-sm"
            onClick={() => onAddToCart(product)}
          >
            <AssetIcon src="/assets/cart.svg" className="hidden size-4 sm:block sm:size-5" />
            <span className="truncate sm:hidden">Cart</span>
            <span className="hidden truncate sm:inline">Add to Cart</span>
          </Button>
          <Button
            type="button"
            aria-label={`Buy Now: ${product.name}`}
            className="h-10 min-w-0 px-1 text-[10px] sm:h-11 sm:px-2 sm:text-sm"
            onClick={() => onBuyNow(product)}
          >
            <ShoppingBag className="hidden size-4 sm:block" aria-hidden="true" />
            <span className="truncate">Buy Now</span>
          </Button>
        </div>
      )}
    </article>
  );
}

function ProductImageDialog({
  product,
  onClose
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!product) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [product, onClose]);

  if (!mounted || !product) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9200] grid place-items-center overflow-y-auto bg-[#101820]/70 p-2 backdrop-blur-[3px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-image-preview-title"
        aria-describedby="shop-image-preview-description"
        className="relative flex max-h-[calc(100svh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/20 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.38)] sm:max-h-[calc(100vh-3rem)]"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Close full image of ${product.name}`}
          className="absolute right-3 top-3 z-20 grid size-11 place-items-center rounded-full border border-[#dce5dd] bg-white/95 text-[#17211b] shadow-md transition hover:bg-[#eef6ee] focus:outline-none focus:ring-2 focus:ring-primary sm:right-4 sm:top-4"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <header className="shrink-0 border-b border-[#e5ebe6] px-4 pb-3 pt-4 pr-16 sm:px-6 sm:pb-4 sm:pt-5 sm:pr-20">
          <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Product image</p>
          <h2 id="shop-image-preview-title" className="mt-1 line-clamp-2 text-lg font-extrabold text-[#17211b] sm:text-2xl">
            {product.name}
          </h2>
          <p id="shop-image-preview-description" className="sr-only">
            Full product image preview. Press Escape or use the close button to return to the shop.
          </p>
        </header>

        <div className="relative h-[70svh] min-h-[280px] w-full bg-[#f7faf7] sm:h-[72vh]">
          <Image
            src={product.image}
            alt={`Full image of ${product.name}`}
            fill
            sizes="(max-width: 640px) 96vw, 80vw"
            className="object-contain p-3 sm:p-6"
          />
        </div>
      </section>
    </div>,
    document.body
  );
}

function AddedToCartToast({
  productName,
  itemDetails,
  onClose,
  onViewCart
}: {
  productName: string;
  itemDetails: string;
  onClose: () => void;
  onViewCart: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed bottom-4 left-3 right-3 z-[9500] mx-auto flex max-w-md items-start gap-3 rounded-lg border border-[#bdd5bf] bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0">
      <AssetIcon src="/assets/confirmed.svg" className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-[#17211b]">Added to your cart</p>
        <p className="mt-0.5 truncate text-sm text-[#59665e]">{productName}</p>
        {itemDetails ? <p className="mt-0.5 truncate text-xs font-semibold text-primary">{itemDetails}</p> : null}
        <button type="button" onClick={onViewCart} className="mt-2 text-sm font-bold text-primary hover:underline">
          View Cart
        </button>
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss notification" className="grid size-8 place-items-center rounded-md hover:bg-[#eef6ee]">
        <X className="size-4" />
      </button>
    </div>,
    document.body
  );
}

export function StudentShopExperience() {
  const { addItem, openCart } = useStudentCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Items");
  const [statuses, setStatuses] = useState<string[]>(statusFilters);
  const [sort, setSort] = useState("featured");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imagePreviewProduct, setImagePreviewProduct] = useState<Product | null>(null);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [cartProduct, setCartProduct] = useState<Product | null>(null);
  const [addedNotice, setAddedNotice] = useState<{ productName: string; itemDetails: string } | null>(null);

  const loadProducts = useCallback(({ background = false }: { background?: boolean } = {}) => {
    let cancelled = false;

    if (!background) {
      setLoading(true);
      setError("");
    }

    getProductsFromApi()
      .then((apiProducts) => {
        if (!cancelled) setProducts(apiProducts);
      })
      .catch((productsError) => {
        if (!cancelled) {
          if (!background) {
            setProducts([]);
            setError(productsError instanceof Error ? productsError.message : "Unable to load shop items.");
          }
        }
      })
      .finally(() => {
        if (!cancelled && !background) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    const refreshProducts = () => {
      if (!navigator.onLine) return;
      loadProducts({ background: true });
    };

    window.addEventListener("wescomm:products-refresh", refreshProducts);
    return () => window.removeEventListener("wescomm:products-refresh", refreshProducts);
  }, [loadProducts]);

  useEffect(() => {
    setQuery(readShopSearchFromUrl());

    const handleShopSearch = (event: Event) => {
      setQuery((event as CustomEvent<string>).detail ?? "");
    };

    window.addEventListener(SHOP_SEARCH_EVENT, handleShopSearch);
    return () => window.removeEventListener(SHOP_SEARCH_EVENT, handleShopSearch);
  }, []);

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    writeShopSearchToUrl(value);
    emitShopSearch(value);
  }, []);

  const filteredProducts = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();

    return products
      .filter((product) => {
        const matchesSearch = !lowerQuery || `${product.name} ${product.category} ${product.detail} ${product.status}`.toLowerCase().includes(lowerQuery);
        const matchesCategory = category === "All Items" || product.category === category;
        const matchesStatus = statuses.length === 0 || statuses.includes(product.status);
        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((a, b) => {
        if (sort === "price-low") return parsePrice(a.price) - parsePrice(b.price);
        if (sort === "price-high") return parsePrice(b.price) - parsePrice(a.price);
        if (sort === "name") return a.name.localeCompare(b.name);
        return 0;
      });
  }, [category, products, query, sort, statuses]);

  const toggleStatus = (status: string) => {
    setStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  };
  const closeImagePreview = useCallback(() => setImagePreviewProduct(null), []);
  const closeCheckout = useCallback(() => setCheckoutProduct(null), []);
  const closeCartSelector = useCallback(() => setCartProduct(null), []);
  const closeAddedNotice = useCallback(() => setAddedNotice(null), []);

  const confirmAddToCart = useCallback(
    (product: CartProduct, selectedOptions: Record<string, string>, quantity: number) => {
      addItem(product, selectedOptions, quantity);
      setCartProduct(null);
      setAddedNotice({
        productName: `${quantity}x ${product.name}`,
        itemDetails: Object.entries(selectedOptions).map(([name, value]) => `${name}: ${value}`).join(", ")
      });
    },
    [addItem]
  );

  const viewCartFromNotice = useCallback(() => {
    setAddedNotice(null);
    openCart();
  }, [openCart]);

  const relatedClothProducts = useCallback(
    (product: Product | null) => {
      if (!product) return [];
      const groupKey = uniformClothGroupKey(product);
      if (!groupKey) return [];

      return products.filter((item) => item.id !== product.id && uniformClothGroupKey(item) === groupKey).slice(0, 6);
    },
    [products]
  );

  const categories = useMemo(() => {
    const productCategories = Array.from(new Set(products.map((product) => product.category))).sort((left, right) => left.localeCompare(right));
    return [
      allCategory,
      ...productCategories.map((label) => ({
        label,
        image: categoryIconByName.get(label) ?? "/assets/all-items.svg",
        href: `/student/shop?category=${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      }))
    ];
  }, [products]);

  return (
    <div className="grid w-full max-w-full min-w-0 gap-6 overflow-hidden lg:grid-cols-[250px_1fr]">
      <aside className="hidden space-y-5 lg:block">
        <section className="wes-card p-5">
          <h2 className="mb-4 text-xl font-bold">Categories</h2>
          <div className="space-y-2">
            {categories.map((item) => (
              <button
                key={item.label}
                onClick={() => setCategory(item.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold hover:bg-[#f4faf4] ${category === item.label ? "bg-[#e8f4e8] text-primary" : "text-[#26312b]"}`}
              >
                <Image src={item.image} alt="" width={28} height={28} className="size-7 object-contain" />
                {item.label}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="min-w-0 space-y-5">
        <div className="min-w-0 space-y-4">
          <div className="flex h-12 items-center rounded-xl border border-[#d8e3d8] bg-white px-4 shadow-sm">
            <AssetIcon src="/assets/search.svg" className="mr-3 size-6" />
            <input value={query} onChange={(event) => updateQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#7d887f]" placeholder="Search campus items" />
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 lg:hidden">
            {categories.map((item) => (
              <button
                key={item.label}
                onClick={() => setCategory(item.label)}
                className={`flex min-h-[86px] min-w-[92px] flex-col items-center justify-center rounded-xl border border-[#dfe8df] p-2 text-center text-[11px] font-semibold leading-tight ${category === item.label ? "bg-[#e8f4e8] text-primary" : "bg-white"}`}
              >
                <Image src={item.image} alt="" width={34} height={34} className="mb-1 size-8 object-contain" />
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(5,max-content)]">
            {statusFilters.map((status) => (
              <button
                key={status}
                onClick={() => toggleStatus(status)}
                className={`h-10 rounded-xl border px-3 text-sm font-semibold ${statuses.includes(status) ? "border-primary bg-[#e8f4e8] text-primary" : "border-[#dfe8df] bg-white"}`}
              >
                {status}
              </button>
            ))}
            <select value={sort} onChange={(event) => setSort(event.target.value)} className="col-span-2 h-10 rounded-xl border border-[#dfe8df] bg-white px-3 text-sm font-semibold text-primary lg:col-span-1">
              <option value="featured">Featured</option>
              <option value="name">Name</option>
              <option value="price-low">Price Low</option>
              <option value="price-high">Price High</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[#3f4a44]">Showing {filteredProducts.length} of {products.length} items</p>
          <button
            onClick={() => {
              updateQuery("");
              setCategory("All Items");
              setStatuses(statusFilters);
              setSort("featured");
            }}
            className="text-sm font-semibold text-primary"
          >
            Reset
          </button>
        </div>

        {error ? (
          <div className="wes-card border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">Loading live shop items...</p>
            <p className="mt-1 text-sm text-muted-foreground">Checking the WESCOMM inventory database.</p>
          </div>
        ) : !error && filteredProducts.length ? (
          <div data-testid="shop-product-grid" className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id || product.name}
                product={product}
                onBuyNow={setCheckoutProduct}
                onAddToCart={setCartProduct}
                onViewImage={setImagePreviewProduct}
              />
            ))}
          </div>
        ) : !error ? (
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">No items found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another search, category, or stock filter.</p>
          </div>
        ) : null}
      </main>
      <ProductImageDialog product={imagePreviewProduct} onClose={closeImagePreview} />
      <AddToCartModal product={cartProduct} relatedProducts={relatedClothProducts(cartProduct)} onSwitchProduct={setCartProduct} onClose={closeCartSelector} onConfirm={confirmAddToCart} />
      <StudentCheckoutModal product={checkoutProduct} relatedProducts={relatedClothProducts(checkoutProduct)} onSwitchProduct={setCheckoutProduct} onClose={closeCheckout} />
      {addedNotice ? (
        <AddedToCartToast
          productName={addedNotice.productName}
          itemDetails={addedNotice.itemDetails}
          onClose={closeAddedNotice}
          onViewCart={viewCartFromNotice}
        />
      ) : null}
    </div>
  );
}
