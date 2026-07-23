import type { Prisma } from "@prisma/client";

export async function lockProductForUpdate(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
  productId: string
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM public.products
    WHERE id = CAST(${productId} AS uuid)
    FOR UPDATE
  `;

  return rows.length === 1;
}
