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
  category: string;
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
    .map((product) => ({ title: product.name, image: product.image, category: product.category }));
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

  const activeSlide = slides[activeIndex] ?? slides[0];

  return (
    <div
      className={cn("student-hero-product-card relative flex min-w-0 flex-col overflow-hidden border bg-white p-2.5 sm:p-3 md:min-h-[420px] lg:min-h-[350px]", className)}
      aria-busy={status === "loading"}
    >
      {status === "loading" ? (
        <div className="student-hero-image-stage grid min-h-[315px] flex-1 place-items-center px-6" role="status">
          <span className="sr-only">Loading dashboard product preview.</span>
          <div className="w-full max-w-[280px] animate-pulse space-y-5 motion-reduce:animate-none" aria-hidden="true">
            <div className="mx-auto h-48 w-4/5 rounded-xl bg-muted" />
            <div className="h-3 w-20 rounded-full bg-muted" />
            <div className="h-4 w-3/4 rounded-full bg-muted" />
          </div>
        </div>
      ) : status === "error" ? (
        <div className="student-hero-image-stage grid min-h-[315px] flex-1 place-items-center px-6 text-center" role="status">
          <div>
            <p className="text-sm font-bold uppercase text-primary">Live shop preview</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">The product preview is temporarily unavailable. You can still open the shop and try again.</p>
          </div>
        </div>
      ) : slides.length ? (
        <>
          <div className="student-hero-image-stage relative h-[245px] flex-none sm:h-[280px] md:h-auto md:min-h-[250px] md:flex-1 lg:min-h-[300px]">
            {slides.map((slide, index) => (
              <div
                key={`${slide.title}-${index}`}
                aria-hidden={activeIndex !== index}
                className={cn(
                  "absolute inset-0 z-[1] transition-opacity duration-500 motion-reduce:transition-none",
                  activeIndex === index ? "opacity-100" : "pointer-events-none opacity-0"
                )}
              >
                <Image
                  src={slide.image}
                  alt={slide.title}
                  fill
                  priority={priority && index === 0}
                  sizes="(min-width: 1280px) 600px, (min-width: 1024px) 45vw, 90vw"
                  className={cn(
                    "object-contain p-2 sm:p-3",
                    slide.image.startsWith("/assets/wup shop assets/") && "scale-[1.16] mix-blend-multiply sm:scale-[1.2]"
                  )}
                />
              </div>
            ))}
            <svg className="pointer-events-none absolute right-4 top-4 z-[2] size-12 text-accent sm:right-6 sm:top-6 sm:size-16" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <path d="M18 6 14 25M40 12 27 27M55 37 36 40" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="px-3 pb-2 pt-4 sm:px-4 sm:pb-3 sm:pt-5">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary sm:text-xs">WESCOMM {activeSlide.category}</p>
            <p className="mt-1.5 text-base font-extrabold leading-snug text-foreground sm:text-lg lg:text-xl xl:text-2xl">{activeSlide.title}</p>
          </div>
          {slides.length > 1 ? (
            <div className="mt-auto flex min-h-14 items-center justify-between gap-3 px-2 pb-1 pt-1 sm:min-h-16 sm:px-3 sm:pb-2">
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current - 1 + slides.length) % slides.length)}
                aria-label="Previous product preview"
                className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-border bg-surface-subtle text-primary shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-12"
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
              <div className="flex items-center justify-center gap-2.5" role="group" aria-label="Choose product preview">
                {slides.map((slide, index) => (
                  <button
                    key={`${slide.title}-${index}`}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Show product preview ${index + 1}: ${slide.title}`}
                    aria-current={activeIndex === index ? "true" : undefined}
                    className={cn("h-2.5 rounded-full bg-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none", activeIndex === index ? "w-7 bg-primary" : "w-2.5")}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current + 1) % slides.length)}
                aria-label="Next product preview"
                className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-border bg-surface-subtle text-primary shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-12"
              >
                <ChevronRight className="size-6" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="student-hero-image-stage grid min-h-[315px] flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-sm font-bold uppercase text-primary">Live shop preview</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Product images will appear here once active inventory items are available.</p>
          </div>
        </div>
      )}
    </div>
  );
}
