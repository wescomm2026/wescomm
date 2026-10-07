import Image from "next/image";
import { cn } from "@/lib/utils";

export function AssetIcon({
  src,
  alt = "",
  className,
  sizes,
  appearance = "auto"
}: {
  src: string;
  alt?: string;
  className?: string;
  sizes?: string;
  appearance?: "auto" | "adaptive" | "plain";
}) {
  const isSvg = src.toLowerCase().endsWith(".svg");
  const isFullIllustration = src.includes("wescomm_saving_reservation") || src.includes("wescomm_reservation_completed");
  const adaptive = appearance === "adaptive" || (appearance === "auto" && isSvg && !isFullIllustration);

  return (
    <span
      className={cn(
        "relative inline-block size-6 shrink-0 rounded-md",
        adaptive && "theme-adaptive-asset-icon",
        className
      )}
    >
      <Image src={src} alt={alt} fill sizes={sizes ?? "32px"} className="asset-icon-img object-contain" />
    </span>
  );
}
