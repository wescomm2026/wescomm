import Image from "next/image";
import { cn } from "@/lib/utils";

export function AssetIcon({
  src,
  alt = "",
  className,
  sizes
}: {
  src: string;
  alt?: string;
  className?: string;
  sizes?: string;
}) {
  return (
    <span className={cn("relative inline-block size-6 shrink-0", className)}>
      <Image src={src} alt={alt} fill sizes={sizes ?? "32px"} className="asset-icon-img object-contain" />
    </span>
  );
}
