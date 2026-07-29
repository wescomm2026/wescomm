"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, LoaderCircle, Maximize2, ShoppingBag, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AddToCartModal } from "@/components/cart/AddToCartModal";
import { useStudentCart, type CartProduct } from "@/components/cart/StudentCartProvider";
import { StudentCheckoutModal } from "@/components/checkout/StudentCheckoutModal";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { getProductsFromApi } from "@/lib/api";
import {
  isProductUnavailable,
  isUniformClothOnly,
  productStockCount,
  uniformClothGroupKey
} from "@/lib/product-display";
import { emitShopSearch, SHOP_SEARCH_EVENT, writeShopSearchToUrl } from "@/lib/shop-search";
import { useStudentWishlist } from "@/components/wishlist/useStudentWishlist";

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
  const count = productStockCount(product);
  if (isProductUnavailable(product)) {
    return "No available items";
  }

  return `${count} available item${count === 1 ? "" : "s"}`;
}

function ProductCard({
  product,
  onBuyNow,
  onAddToCart,
  onViewImage,
  onToggleWishlist,
  wishlisted,
  wishlistPending,
  wishlistDisabled,
  highlighted
}: {
  product: Product;
  onBuyNow: (product: Product) => void;
  onAddToCart: (product: Product) => void;
  onViewImage: (product: Product) => void;
  onToggleWishlist: (product: Product) => void;
  wishlisted: boolean;
  wishlistPending: boolean;
  wishlistDisabled: boolean;
  highlighted: boolean;
}) {
  const disabled = isProductUnavailable(product);
  const clothOnly = isUniformClothOnly(product);
  const tone =
    product.status === "In Stock"
      ? "bg-[#dff3df] text-primary"
      : product.status === "Out of Stock"
        ? "bg-[#ffe3b0] text-[#d97706]"
        : "bg-[#fff0bf] text-[#d97706]";

  return (
    <article
      aria-label={product.name}
      data-product-id={product.id}
      className={`wes-card flex h-full min-w-0 flex-col overflow-hidden p-2.5 transition sm:p-4 ${
        highlighted ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
    >
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
        <span className={`pointer-events-none absolute left-1.5 top-1.5 z-10 max-w-[calc(100%-52px)] truncate rounded-full px-2 py-1 text-[9px] font-extrabold leading-none sm:left-2 sm:top-2 sm:px-3 sm:text-xs ${tone}`}>
          {product.status}
        </span>
        {!disabled ? (
          <button
            type="button"
            onClick={() => onToggleWishlist(product)}
            disabled={!product.id || wishlistDisabled || wishlistPending}
            aria-pressed={wishlisted}
            aria-busy={wishlistPending}
            aria-label={`${wishlisted ? "Remove" : "Add"} ${product.name} ${wishlisted ? "from" : "to"} wishlist`}
            className="absolute right-1.5 top-1.5 z-20 grid size-10 place-items-center rounded-full border border-[#d8e4d9] bg-white/95 text-primary shadow-sm transition hover:scale-105 hover:bg-[#eef7ef] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 sm:right-2 sm:top-2 sm:size-11"
          >
            {wishlistPending || wishlistDisabled ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Heart className={`size-5 ${wishlisted ? "fill-primary" : ""}`} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
        ) : null}
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
        <p className="mt-1.5 rounded-md border border-[#cfe2d1] bg-[#f5faf5] px-2 py-1 text-[9px] font-semibold leading-4 text-[#4e6255] sm:mt-2 sm:px-3 sm:py-2 sm:text-xs sm:font-medium sm:leading-5">
          <span className="sm:hidden">Cloth only · image is a preview</span>
          <span className="hidden sm:inline">Tela/material lang. Preview lang ang uniform image.</span>
        </p>
      ) : null}
      {disabled ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!product.id || wishlistDisabled || wishlistPending}
          aria-pressed={wishlisted}
          aria-busy={wishlistPending}
          aria-label={`${wishlisted ? "Stop" : "Notify me about"} ${product.name} restock`}
          className="mt-auto h-10 w-full px-1.5 pt-0 text-[10px] sm:h-11 sm:px-3 sm:text-sm"
          onClick={() => onToggleWishlist(product)}
        >
          {wishlistPending || wishlistDisabled ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <Heart className={`size-4 shrink-0 ${wishlisted ? "fill-primary" : ""}`} aria-hidden="true" />
          )}
          <span className="truncate">
            {wishlistDisabled ? "Loading wishlist" : wishlisted ? "Watching stock" : "Notify me"}
          </span>
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
    <div role="status" aria-live="polite" className="fixed bottom-4 left-3 right-3 z-[9500] mx-auto flex max-w-md items-start gap-3 rounded-lg border border-[#bdd5bf] bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0">
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

function ShopNoticeToast({
  title,
  message,
  error = false,
  onClose
}: {
  title: string;
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={`fixed bottom-4 left-3 right-3 z-[9600] mx-auto flex max-w-md items-start gap-3 rounded-lg border bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0 ${
        error ? "border-red-200" : "border-[#bdd5bf]"
      }`}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${error ? "bg-red-50 text-red-700" : "bg-[#eaf6eb] text-primary"}`}>
        <Heart className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-extrabold ${error ? "text-red-800" : "text-[#17211b]"}`}>{title}</p>
        <p className="mt-0.5 text-sm leading-5 text-[#59665e]">{message}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss message" className="grid size-8 place-items-center rounded-md hover:bg-[#eef6ee]">
        <X className="size-4" />
      </button>
    </div>,
    document.body
  );
}

export function StudentShopExperience() {
  const { addItem, openCart } = useStudentCart();
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const wishlist = useStudentWishlist();
  const searchParams = useSearchParams();
  const routeQuery = searchParams.get("query") ?? "";
  const wishlistRequested = searchParams.get("wishlist") === "1";
  const productFromNotification = searchParams.get("product") ?? "";
  const highlightedProductId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productFromNotification)
    ? productFromNotification
    : "";
  const processedRestockLinkRef = useRef("");
  const productRequestSequenceRef = useRef(0);
  const wishlistFilterRef = useRef<HTMLButtonElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Items");
  const [statuses, setStatuses] = useState<string[]>(statusFilters);
  const [sort, setSort] = useState("featured");
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imagePreviewProduct, setImagePreviewProduct] = useState<Product | null>(null);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [cartProduct, setCartProduct] = useState<Product | null>(null);
  const [addedNotice, setAddedNotice] = useState<{ productName: string; itemDetails: string } | null>(null);
  const [shopNotice, setShopNotice] = useState<{ title: string; message: string; error?: boolean } | null>(null);

  const loadProducts = useCallback(({ background = false }: { background?: boolean } = {}) => {
    const requestSequence = ++productRequestSequenceRef.current;
    let cancelled = false;

    if (!background) {
      setLoading(true);
      setError("");
    }

    getProductsFromApi()
      .then((apiProducts) => {
        if (!cancelled && requestSequence === productRequestSequenceRef.current) {
          setProducts(apiProducts);
          setError("");
        }
      })
      .catch((productsError) => {
        if (!cancelled && requestSequence === productRequestSequenceRef.current) {
          if (!background) {
            setProducts([]);
            setError(productsError instanceof Error ? productsError.message : "Unable to load shop items.");
          }
        }
      })
      .finally(() => {
        if (!cancelled && !background && requestSequence === productRequestSequenceRef.current) {
          setLoading(false);
        }
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
      if (!navigator.onLine || loading) return;
      loadProducts({ background: true });
    };

    window.addEventListener("wescomm:products-refresh", refreshProducts);
    return () => window.removeEventListener("wescomm:products-refresh", refreshProducts);
  }, [loadProducts, loading]);

  useEffect(() => {
    const handleShopSearch = (event: Event) => {
      setQuery((event as CustomEvent<string>).detail ?? "");
    };

    window.addEventListener(SHOP_SEARCH_EVENT, handleShopSearch);
    return () => window.removeEventListener(SHOP_SEARCH_EVENT, handleShopSearch);
  }, []);

  useEffect(() => {
    setQuery(routeQuery);
    setWishlistOnly(wishlistRequested);
    if (wishlistRequested && highlightedProductId) {
      setCategory("All Items");
      setStatuses(statusFilters);
    }
  }, [highlightedProductId, routeQuery, wishlistRequested]);

  useEffect(() => {
    if (!wishlistRequested || !highlightedProductId || loading || !navigator.onLine) return;
    const restockLinkKey = `${highlightedProductId}:${searchParams.toString()}`;
    if (processedRestockLinkRef.current === restockLinkKey) return;
    processedRestockLinkRef.current = restockLinkKey;
    loadProducts({ background: true });
  }, [highlightedProductId, loadProducts, loading, searchParams, wishlistRequested]);

  useEffect(() => {
    if (!highlightedProductId || loading || (wishlistOnly && !wishlist.ready)) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-product-id="${highlightedProductId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedProductId, loading, products, wishlist.productIds, wishlist.ready, wishlistOnly]);

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
        const matchesWishlist = !wishlistOnly || Boolean(product.id && wishlist.productIds.has(product.id));
        return matchesSearch && matchesCategory && matchesStatus && matchesWishlist;
      })
      .sort((a, b) => {
        if (sort === "price-low") return parsePrice(a.price) - parsePrice(b.price);
        if (sort === "price-high") return parsePrice(b.price) - parsePrice(a.price);
        if (sort === "name") return a.name.localeCompare(b.name);
        return 0;
      });
  }, [category, products, query, sort, statuses, wishlist.productIds, wishlistOnly]);

  const toggleStatus = (status: string) => {
    setStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  };
  const closeImagePreview = useCallback(() => setImagePreviewProduct(null), []);
  const closeCheckout = useCallback(() => setCheckoutProduct(null), []);
  const closeCartSelector = useCallback(() => setCartProduct(null), []);
  const closeAddedNotice = useCallback(() => setAddedNotice(null), []);
  const closeShopNotice = useCallback(() => setShopNotice(null), []);

  const updateWishlistFilter = useCallback((enabled: boolean) => {
    if (enabled && !user) {
      openAuth();
      return;
    }
    if (enabled && user?.role !== "STUDENT") {
      setShopNotice({
        title: "Student account required",
        message: "Wishlists and restock alerts are available for student accounts.",
        error: true
      });
      return;
    }

    setWishlistOnly(enabled);
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set("wishlist", "1");
    else {
      url.searchParams.delete("wishlist");
      url.searchParams.delete("product");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [openAuth, user]);

  useEffect(() => {
    if (!authReady || !wishlistOnly || user?.role === "STUDENT") return;
    updateWishlistFilter(false);
  }, [authReady, updateWishlistFilter, user?.role, wishlistOnly]);

  const toggleWishlist = useCallback(async (product: Product) => {
    if (wishlistOnly && product.id && wishlist.productIds.has(product.id)) {
      wishlistFilterRef.current?.focus();
    }
    const result = await wishlist.toggle(product.id);
    if (!result.ok) {
      if (result.reason === "AUTH_REQUIRED") return;
      setShopNotice({
        title: result.reason === "STUDENT_ONLY" ? "Student account required" : "Wishlist not updated",
        message: result.reason === "STUDENT_ONLY"
          ? "Wishlists and restock alerts are available for student accounts."
          : result.message ?? "Please refresh the shop and try again.",
        error: true
      });
      return;
    }

    if (!result.wishlisted) {
      setShopNotice({
        title: "Removed from wishlist",
        message: `${product.name} was removed from your wishlist.`
      });
      return;
    }

    setShopNotice({
      title: isProductUnavailable(product) ? "Restock alert turned on" : "Saved to your wishlist",
      message: isProductUnavailable(product)
        ? `We will notify you when ${product.name} is available again.`
        : `${product.name} is now in your wishlist.`
    });
  }, [wishlist, wishlistOnly]);

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

  const wishlistViewLoading =
    wishlistOnly && !wishlist.error && (!authReady || (user?.role === "STUDENT" && !wishlist.ready));
  const wishlistViewUnavailable =
    wishlistOnly && user?.role === "STUDENT" && Boolean(wishlist.error) && !wishlist.ready;
  const wishlistControlsDisabled =
    !authReady || (user?.role === "STUDENT" && !wishlist.ready);

  return (
    <div className="grid w-full max-w-full min-w-0 gap-6 overflow-hidden lg:grid-cols-[250px_1fr]">
      <aside className="hidden space-y-5 lg:block">
        <section className="wes-card p-5">
          <h2 className="mb-4 text-xl font-bold">Categories</h2>
          <div className="space-y-2">
            {categories.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setCategory(item.label)}
                aria-pressed={category === item.label}
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
            <label htmlFor="shop-search" className="sr-only">Search campus items</label>
            <input id="shop-search" value={query} onChange={(event) => updateQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#7d887f]" placeholder="Search campus items" />
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 lg:hidden">
            {categories.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setCategory(item.label)}
                aria-pressed={category === item.label}
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
                type="button"
                onClick={() => toggleStatus(status)}
                aria-pressed={statuses.includes(status)}
                className={`h-10 rounded-xl border px-3 text-sm font-semibold ${statuses.includes(status) ? "border-primary bg-[#e8f4e8] text-primary" : "border-[#dfe8df] bg-white"}`}
              >
                {status}
              </button>
            ))}
            <label htmlFor="shop-sort" className="sr-only">Sort shop items</label>
            <select id="shop-sort" value={sort} onChange={(event) => setSort(event.target.value)} className="col-span-2 h-10 rounded-xl border border-[#dfe8df] bg-white px-3 text-sm font-semibold text-primary lg:col-span-1">
              <option value="featured">Featured</option>
              <option value="name">Name</option>
              <option value="price-low">Price Low</option>
              <option value="price-high">Price High</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[#3f4a44]">Showing {filteredProducts.length} of {products.length} items</p>
          <div className="flex items-center gap-2">
            <button
              ref={wishlistFilterRef}
              type="button"
              onClick={() => updateWishlistFilter(!wishlistOnly)}
              disabled={wishlistControlsDisabled}
              aria-pressed={wishlistOnly}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold transition sm:text-sm ${
                wishlistOnly
                  ? "border-primary bg-[#e8f4e8] text-primary"
                  : "border-[#d8e3d8] bg-white text-[#455149] hover:border-primary"
              }`}
            >
              <Heart className={`size-4 ${wishlistOnly ? "fill-primary" : ""}`} aria-hidden="true" />
              Wishlist
              {user?.role === "STUDENT" ? <span aria-label={`${wishlist.productIds.size} items`}>({wishlist.productIds.size})</span> : null}
            </button>
            <button
              type="button"
              onClick={() => {
                updateQuery("");
                setCategory("All Items");
                setStatuses(statusFilters);
                setSort("featured");
                updateWishlistFilter(false);
              }}
              className="h-10 px-1 text-sm font-semibold text-primary"
            >
              Reset
            </button>
          </div>
        </div>

        {wishlist.error && user?.role === "STUDENT" && !wishlistOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="alert">
            <span>Wishlist could not be loaded: {wishlist.error}</span>
            <button type="button" onClick={wishlist.retry} className="h-9 rounded-md border border-amber-300 bg-white px-3 text-xs font-extrabold text-amber-950">
              Retry
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="wes-card border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        {wishlistViewUnavailable ? (
          <div className="wes-card border-amber-200 bg-amber-50 p-8 text-center" role="alert">
            <p className="font-extrabold text-amber-950">Wishlist is temporarily unavailable</p>
            <p className="mt-1 text-sm text-amber-900">{wishlist.error}</p>
            <button type="button" onClick={wishlist.retry} className="mt-4 h-10 rounded-md border border-amber-300 bg-white px-4 text-sm font-extrabold text-amber-950">
              Retry wishlist
            </button>
          </div>
        ) : loading || wishlistViewLoading ? (
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">{wishlistViewLoading ? "Loading your wishlist..." : "Loading live shop items..."}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {wishlistViewLoading ? "Syncing saved items for this account." : "Checking the WESCOMM inventory database."}
            </p>
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
                onToggleWishlist={(item) => void toggleWishlist(item)}
                wishlisted={Boolean(product.id && wishlist.productIds.has(product.id))}
                wishlistPending={Boolean(product.id && wishlist.pendingProductIds.has(product.id))}
                wishlistDisabled={wishlistControlsDisabled}
                highlighted={Boolean(product.id && product.id === highlightedProductId)}
              />
            ))}
          </div>
        ) : !error ? (
          <div className="wes-card p-8 text-center">
            <p className="font-semibold">{wishlistOnly ? "No wishlist items found" : "No items found"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {wishlistOnly
                ? wishlist.productIds.size
                  ? "Try clearing the search, category, or stock filters."
                  : "Tap the heart on an item to save it here and receive restock alerts."
                : "Try another search, category, or stock filter."}
            </p>
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
      {shopNotice ? (
        <ShopNoticeToast
          title={shopNotice.title}
          message={shopNotice.message}
          error={shopNotice.error}
          onClose={closeShopNotice}
        />
      ) : null}
    </div>
  );
}
