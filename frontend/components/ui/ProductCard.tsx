import Image from "next/image";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Product = {
  name: string;
  category: string;
  stock: number;
  status: string;
  price: string;
  image: string;
};

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex gap-4">
        <div className="relative size-16 shrink-0 rounded-md bg-muted">
          <Image src={product.image} alt="" fill className="object-contain p-3" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{product.name}</h3>
          <p className="text-sm text-muted-foreground">{product.category}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={product.status} />
            <span className="text-sm text-muted-foreground">Stock: {product.stock} pcs</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="font-semibold">{product.price}</p>
        <Button className="h-9 px-3">
          <AssetIcon src="/assets/browse.svg" className="size-5" />
          View
        </Button>
      </div>
    </article>
  );
}
