import { buildInventoryReport } from "../domain/inventory-report.js";
import { prisma } from "../lib/prisma.js";

/** Every active product in one read, for the printable inventory report. */
export async function getInventoryReport(input: {
  actorId: string;
  categorySlug?: string;
  includeZeroStock?: boolean;
}) {
  const [products, actor] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        ...(input.categorySlug ? { category: { slug: input.categorySlug } } : {})
      },
      select: {
        id: true,
        name: true,
        saleMode: true,
        skuInventoryEnabled: true,
        price: true,
        stock: true,
        category: { select: { name: true, slug: true } },
        inventoryBatches: {
          where: { costVerified: false, quantityRemaining: { gt: 0 } },
          select: { quantityRemaining: true }
        },
        skus: {
          where: { isActive: true },
          select: {
            stock: true,
            optionValues: { select: { variant: { select: { optionName: true, optionValue: true } } } }
          }
        }
      },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    }),
    prisma.profile.findUnique({ where: { id: input.actorId }, select: { fullName: true } })
  ]);

  return buildInventoryReport(
    products.map((product) => ({
      id: product.id,
      name: product.name,
      saleMode: product.saleMode,
      skuInventoryEnabled: product.skuInventoryEnabled,
      price: Number(product.price),
      stock: product.stock,
      unverifiedCostQuantity: product.inventoryBatches.reduce((total, batch) => total + batch.quantityRemaining, 0),
      category: product.category,
      skus: product.skus.map((sku) => ({ stock: sku.stock, options: sku.optionValues.map((link) => link.variant) }))
    })),
    {
      generatedAt: new Date(),
      generatedBy: actor?.fullName ?? null,
      categorySlug: input.categorySlug ?? null,
      includeZeroStock: input.includeZeroStock
    }
  );
}
