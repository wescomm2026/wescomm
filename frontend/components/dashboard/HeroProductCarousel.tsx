"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDashboardProducts, type DashboardProducts } from "@/components/dashboard/DashboardProductsProvider";
import { isProductUnavailable } from "@/lib/product-display";
import { cn } from "@/lib/utils";

type HeroSlide = {
  title: string;
  image: string;
};

function categoryPriority(category: string) {
  if (category === "Uniforms") return 0;
  if (category === "ID Accessories") return 1;
  if (category === "School Supplies") return 2;
  if (category === "Others") return 3;
  if (category === "Textbooks") return 4;
  return 5;
}

function buildHeroSlides(products: DashboardProducts) {
  const availableProducts = products
    .filter((product) => !isProductUnavailable(product) && product.image)
    .sort((left, right) => categoryPriority(left.category) - categoryPriority(right.category) || left.name.localeCompare(right.name));

  const uniforms = availableProducts.filter((product) => product.category === "Uniforms").slice(0, 3);
  const books = availableProducts.filter((product) => product.category === "Textbooks").slice(0, 1);
  const middleItems = availableProducts
    .filter((product) => product.category !== "Uniforms" && product.category !== "Textbooks")
    .slice(0, 1);

  const selected = [...uniforms, ...middleItems, ...books];
  const selectedNames = new Set(selected.map((product) => product.name));
  const fillers = availableProducts.filter((product) => !selectedNames.has(product.name)).slice(0, Math.max(0, 5 - selected.length));

  return [...selected, ...fillers]
    .slice(0, 5)
    .map((product) => ({ title: product.name, image: product.image }));
}

export function HeroProductCarousel({ className, priority = false }: { className?: string; priority?: boolean }) {
  const { products, status } = useDashboardProducts();
  const [activeIndex, setActiveIndex] = useState(0);
  const slides = useMemo(() => buildHeroSlides(products), [products]);

  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 5500);

    return () => window.clearInterval(interval);
  }, [slides.length]);

  const indicators = useMemo(() => Math.max(slides.length, 1), [slides.length]);

  return (
    <div
      className={cn("relative min-h-[330px] overflow-hidden rounded-2xl bg-white lg:h-full lg:min-h-0", className)}
      aria-busy={status === "loading"}
    >
      <div className="absolute right-4 top-5 grid grid-cols-3 gap-2" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, index) => (
          <span key={index} className="size-1.5 rounded-full bg-[#c6dcc5]" />
        ))}
      </div>

      {status === "loading" ? (
        <div className="absolute inset-0 grid place-items-center px-12" role="status">
          <span className="sr-only">Loading dashboard product preview.</span>
          <div className="w-full max-w-[280px] animate-pulse space-y-5 motion-reduce:animate-none" aria-hidden="true">
            <div className="mx-auto size-40 rounded-full bg-[#edf4ed]" />
            <div className="mx-auto h-3 w-32 rounded-full bg-[#dfeadf]" />
            <div className="mx-auto h-2.5 w-20 rounded-full bg-[#edf4ed]" />
          </div>
        </div>
      ) : status === "error" ? (
        <div className="absolute inset-0 grid place-items-center px-8 text-center" role="status">
          <div>
            <p className="text-sm font-bold uppercase text-primary">Live shop preview</p>
            <p className="mt-2 text-sm leading-6 text-[#68746d]">The product preview is temporarily unavailable. You can still open the shop and try again.</p>
          </div>
        </div>
      ) : slides.length ? (
        <div className="absolute inset-0">
          {slides.map((slide, index) => (
            <div
              key={`${slide.title}-${index}`}
              className={cn(
                "absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none",
                activeIndex === index ? "opacity-100" : "pointer-events-none opacity-0"
              )}
            >
              <div className="absolute inset-0 px-14 py-12 sm:px-24 lg:px-20 xl:px-28">
                <Image
                  src={slide.image}
                  alt=""
                  fill
                  priority={priority && index === 0}
                  sizes="(min-width: 1280px) 680px, (min-width: 1024px) 54vw, 100vw"
                  className="object-contain"
                />
              </div>
            </div>
          ))}
          {slides.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current - 1 + slides.length) % slides.length)}
                aria-label="Previous product preview"
                className="absolute left-3 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-[#d8e4d9] bg-white/90 text-primary shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current + 1) % slides.length)}
                aria-label="Next product preview"
                className="absolute right-3 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-[#d8e4d9] bg-white/90 text-primary shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          ) : null}
          <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 gap-2" aria-label="Choose product preview">
            {Array.from({ length: indicators }).map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show product preview ${index + 1}`}
                aria-current={activeIndex === index ? "true" : undefined}
                className={cn("h-2 rounded-full bg-[#c6dcc5] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none", activeIndex === index ? "w-7 bg-primary" : "w-2")}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-8 text-center">
          <div>
            <p className="text-sm font-bold uppercase text-primary">Live shop preview</p>
            <p className="mt-2 text-sm leading-6 text-[#68746d]">Product images will appear here once active inventory items are available.</p>
          </div>
        </div>
      )}
    </div>
  );
}
