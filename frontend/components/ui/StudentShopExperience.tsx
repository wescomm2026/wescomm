"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShoppingBag, X } from "lucide-react";
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
  onAddToCart
}: {
  product: Product;
  onBuyNow: (product: Product) => void;
  onAddToCart: (product: Product) => void;
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
    <article className="wes-card flex h-full flex-col p-4">
      <div className="flex min-h-8 flex-wrap items-start gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{product.status}</span>
        {clothOnly ? <span className="rounded-full bg-[#eef6ef] px-3 py-1 text-xs font-bold text-primary">Cloth only</span> : null}
      </div>
      <div className="relative mx-auto mt-2 h-40 w-full">
        <Image src={product.image} alt="" fill className="object-contain" />
      </div>
      <h3 className="mt-3 line-clamp-2 min-h-12 text-base font-bold leading-6">{product.name}</h3>
      <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{product.detail}</p>
      <p className="mt-1 text-xs font-semibold text-primary">{product.category}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="font-extrabold text-primary">{product.price}</p>
        {product.oldPrice ? <p className="text-sm text-muted-foreground line-through">{product.oldPrice}</p> : null}
      </div>
      <p className="mt-2 text-sm font-semibold text-[#506059]">{availabilityText(product)}</p>
      {clothOnly ? (
        <p className="mt-2 rounded-md border border-[#cfe2d1] bg-[#f5faf5] px-3 py-2 text-xs font-medium leading-5 text-[#4e6255]">
          Tela/material lang. Preview lang ang uniform image.
        </p>
      ) : null}
      {disabled ? (
        <Button variant="secondary" disabled className="mt-auto h-11 w-full border-primary text-primary">
          <AssetIcon src="/assets/out-of-stock.svg" className="size-5" />
          Out of Stock
        </Button>
      ) : (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
          <Button variant="secondary" className="h-11 min-w-0 px-2 text-xs sm:text-sm" onClick={() => onAddToCart(product)}>
            <AssetIcon src="/assets/cart.svg" className="size-5" />
            Add to Cart
          </Button>
          <Button className="h-11 min-w-0 px-2 text-xs sm:text-sm" onClick={() => onBuyNow(product)}>
            <ShoppingBag className="size-4" />
            Buy Now
          </Button>
        </div>
      )}
    </article>
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
          setProducts([]);
          if (!background) {
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id || product.name}
                product={product}
                onBuyNow={setCheckoutProduct}
                onAddToCart={setCartProduct}
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
