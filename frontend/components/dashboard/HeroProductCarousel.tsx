"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getProductsFromApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type HeroSlide = {
  title: string;
  image: string;
};

type HeroProduct = {
  name: string;
  category: string;
  status: string;
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

function buildHeroSlides(products: HeroProduct[]) {
  const availableProducts = products
    .filter((product) => product.status !== "Out of Stock" && product.image)
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
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const loadSlides = useCallback(() => {
    let cancelled = false;

    getProductsFromApi()
      .then((products) => {
        if (cancelled) return;
        setSlides(buildHeroSlides(products));
      })
      .catch(() => {
        if (!cancelled) setSlides([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadSlides(), [loadSlides]);

  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 5500);

    return () => window.clearInterval(interval);
  }, [slides.length]);

  const indicators = useMemo(() => Math.max(slides.length, 1), [slides.length]);

  return (
    <div className={cn("relative min-h-[330px] overflow-hidden rounded-2xl bg-white lg:h-full lg:min-h-0", className)}>
      <div className="absolute right-4 top-5 grid grid-cols-3 gap-2">
        {Array.from({ length: 12 }).map((_, index) => (
          <span key={index} className="size-1.5 rounded-full bg-[#c6dcc5]" />
        ))}
      </div>

      {slides.length ? (
        <div className="absolute inset-0" aria-live="polite">
          {slides.map((slide, index) => (
            <div
              key={`${slide.title}-${index}`}
              className={cn(
                "absolute inset-0 transition-opacity duration-500",
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
          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2">
            {Array.from({ length: indicators }).map((_, index) => (
              <span
                key={index}
                className={cn("h-2 rounded-full bg-[#c6dcc5] transition-all", activeIndex === index ? "w-7 bg-primary" : "w-2")}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-8 text-center">
          <div>
            <p className="text-sm font-bold uppercase text-primary">Live shop preview</p>
            <p className="mt-2 text-sm leading-6 text-[#68746d]">Product images will appear here once the inventory database has active items.</p>
          </div>
        </div>
      )}
    </div>
  );
}
