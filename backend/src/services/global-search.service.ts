import { prisma } from "../lib/prisma.js";
import { decryptSensitiveText } from "../utils/field-encryption.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

export type GlobalSearchResult = {
  id: string;
  type: "PRODUCT" | "RESERVATION" | "RECEIPT" | "CONVERSATION";
  title: string;
  subtitle: string;
  section: "inventory" | "reservations" | "receipt-verification" | "messages";
};

export async function searchStaffWorkspace(rawQuery: string) {
  const query = rawQuery.trim();
  const profileMatch = {
    OR: [
      { fullName: { contains: query, mode: "insensitive" as const } },
      { email: { contains: query, mode: "insensitive" as const } },
      { studentNumber: { contains: query, mode: "insensitive" as const } }
    ]
  };

  const [products, reservations, receipts, conversations] = await withTransientPrismaReadRetry(() =>
    prisma.$transaction([
      prisma.product.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { category: { is: { name: { contains: query, mode: "insensitive" } } } }
          ]
        },
        orderBy: { name: "asc" },
        take: 5,
        select: { id: true, name: true, stock: true, category: { select: { name: true } } }
      }),
      prisma.reservation.findMany({
        where: {
          OR: [
            { referenceCode: { contains: query, mode: "insensitive" } },
            { student: { is: profileMatch } }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          referenceCode: true,
          status: true,
          student: { select: { fullName: true, email: true } }
        }
      }),
      prisma.receipt.findMany({
        where: {
          OR: [
            { receiptCode: { contains: query, mode: "insensitive" } },
            { student: { is: profileMatch } }
          ]
        },
        orderBy: { issuedAt: "desc" },
        take: 5,
        select: {
          id: true,
          receiptCode: true,
          status: true,
          student: { select: { fullName: true, email: true } }
        }
      }),
      prisma.conversation.findMany({
        where: { student: { is: profileMatch } },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          subject: true,
          mode: true,
          student: { select: { fullName: true, email: true } }
        }
      })
    ])
  );

  const results: GlobalSearchResult[] = [
    ...products.map((product) => ({
      id: product.id,
      type: "PRODUCT" as const,
      title: product.name,
      subtitle: `${product.category.name} · ${product.stock} in stock`,
      section: "inventory" as const
    })),
    ...reservations.map((reservation) => ({
      id: reservation.id,
      type: "RESERVATION" as const,
      title: reservation.referenceCode,
      subtitle: `${reservation.student.fullName || reservation.student.email} · ${reservation.status.replaceAll("_", " ")}`,
      section: "reservations" as const
    })),
    ...receipts.map((receipt) => ({
      id: receipt.id,
      type: "RECEIPT" as const,
      title: receipt.receiptCode,
      subtitle: `${receipt.student.fullName || receipt.student.email} · ${receipt.status}`,
      section: "receipt-verification" as const
    })),
    ...conversations.map((conversation) => ({
      id: conversation.id,
      type: "CONVERSATION" as const,
      title: decryptSensitiveText(conversation.subject, "conversation.subject") ?? "Support request",
      subtitle: `${conversation.student.fullName || conversation.student.email} · ${conversation.mode.replaceAll("_", " ")}`,
      section: "messages" as const
    }))
  ];

  return results;
}
