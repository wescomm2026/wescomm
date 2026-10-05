import "dotenv/config";

import { Prisma, PrismaClient, type AppRole, type ProductStatus } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { databaseTargetFingerprint } from "../domain/payment-conversion-cli-policy.js";
import { assertSafeStagingMutationEnvironment } from "../domain/staging-data-policy.js";

const prisma = new PrismaClient();
const applyFlag = "--apply";
const confirmationPrefix = "--confirm-seed-staging:";
const policyVersion = "2026-09-02";
const qaCategoryName = "QA Fixtures";
const qaCategorySlug = "qa-fixtures";
const qaDepartmentCode = "QA";
const seedMovementNote = "[QA SEED] Deterministic staging opening stock.";

type AccountSeed = {
  email: string;
  fullName: string;
  role: AppRole;
  studentNumber: string | null;
};

const accountSeeds: AccountSeed[] = [
  { email: "student@wesleyan.edu.ph", fullName: "QA Student 01", role: "STUDENT", studentNumber: "QA-2026-0001" },
  ...Array.from({ length: 9 }, (_, index): AccountSeed => {
    const number = String(index + 2).padStart(2, "0");
    return {
      email: `qa.student${number}@wesleyan.edu.ph`,
      fullName: `QA Student ${number}`,
      role: "STUDENT",
      studentNumber: `QA-2026-${String(index + 2).padStart(4, "0")}`
    };
  }),
  { email: "staff@wesleyan.edu.ph", fullName: "QA Commissary Staff", role: "STAFF", studentNumber: null },
  { email: "admin@wesleyan.edu.ph", fullName: "QA System Administrator", role: "ADMIN", studentNumber: null }
];

const productNames = [
  "[QA] Simple Notebook",
  "[QA] Variant PE Shirt",
  "[QA] SKU Uniform Set",
  "[QA] Out-of-stock Tote"
];

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function listAllAuthUsers(client: SupabaseAdminClient) {
  const users: Array<{ id: string; email?: string }> = [];
  const perPage = 1_000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email })));
    if (data.users.length < perPage) break;
  }
  return users;
}

async function ensureAuthUser(
  client: SupabaseAdminClient,
  usersByEmail: Map<string, { id: string; email?: string }>,
  seed: AccountSeed
) {
  const normalizedEmail = seed.email.toLowerCase();
  const existing = usersByEmail.get(normalizedEmail);
  if (existing) return existing;

  const { data, error } = await client.auth.admin.createUser({
    email: seed.email,
    email_confirm: true,
    user_metadata: { full_name: seed.fullName, wescomm_fixture: "staging" }
  });
  if (error) throw error;
  if (!data.user) throw new Error(`Supabase did not return the created user for ${seed.email}.`);

  const created = { id: data.user.id, email: data.user.email };
  usersByEmail.set(normalizedEmail, created);
  return created;
}

async function ensureProfiles(client: SupabaseAdminClient, departmentId: string) {
  const users = await listAllAuthUsers(client);
  const usersByEmail = new Map(
    users
      .filter((user) => user.email)
      .map((user) => [user.email!.trim().toLowerCase(), user] as const)
  );

  for (const seed of accountSeeds) {
    const authUser = await ensureAuthUser(client, usersByEmail, seed);
    const conflictingProfile = await prisma.profile.findUnique({ where: { email: seed.email } });
    if (conflictingProfile && conflictingProfile.id !== authUser.id) {
      throw new Error(`Profile/auth identity mismatch for ${seed.email}; refusing to overwrite it.`);
    }

    await prisma.profile.upsert({
      where: { id: authUser.id },
      update: {
        email: seed.email,
        fullName: seed.fullName,
        role: seed.role,
        studentNumber: seed.studentNumber,
        departmentId: seed.role === "STUDENT" ? departmentId : null,
        department: seed.role === "STUDENT" ? "QA Fixtures" : null,
        onboardingCompletedAt: seed.role === "STUDENT" ? new Date() : null,
        phone: seed.role === "STUDENT" ? "09990000000" : null,
        address: seed.role === "STUDENT" ? "Staging data only — not a real address" : null
      },
      create: {
        id: authUser.id,
        email: seed.email,
        fullName: seed.fullName,
        role: seed.role,
        studentNumber: seed.studentNumber,
        departmentId: seed.role === "STUDENT" ? departmentId : null,
        department: seed.role === "STUDENT" ? "QA Fixtures" : null,
        onboardingCompletedAt: seed.role === "STUDENT" ? new Date() : null,
        phone: seed.role === "STUDENT" ? "09990000000" : null,
        address: seed.role === "STUDENT" ? "Staging data only — not a real address" : null
      }
    });
    await prisma.policyAcceptance.upsert({
      where: { userId_policyVersion: { userId: authUser.id, policyVersion } },
      update: {},
      create: { userId: authUser.id, policyVersion }
    });
  }
}

async function assertFixtureProductsAreSafeToRebuild() {
  const products = await prisma.product.findMany({
    where: { name: { in: productNames } },
    select: { id: true }
  });
  const productIds = products.map((product) => product.id);
  if (!productIds.length) return;

  const [reservationItems, walkInItems, movementCount, seedMovementCount] = await Promise.all([
    prisma.reservationItem.count({ where: { productId: { in: productIds } } }),
    prisma.walkInSaleItem.count({ where: { productId: { in: productIds } } }),
    prisma.inventoryMovement.count({ where: { productId: { in: productIds } } }),
    prisma.inventoryMovement.count({
      where: { productId: { in: productIds }, notes: { startsWith: "[QA SEED]" } }
    })
  ]);
  const nonSeedMovements = movementCount - seedMovementCount;
  if (reservationItems || walkInItems || nonSeedMovements) {
    throw new Error(
      "QA fixtures already have transaction activity. Run the protected staging reset before reseeding."
    );
  }
}

async function rebuildProductChildren(transaction: Prisma.TransactionClient, productId: string) {
  await transaction.inventoryMovement.deleteMany({ where: { productId } });
  await transaction.inventoryBatch.deleteMany({ where: { productId } });
  await transaction.productSkuVariant.deleteMany({ where: { sku: { productId } } });
  await transaction.productSku.deleteMany({ where: { productId } });
  await transaction.productVariant.deleteMany({ where: { productId } });
}

async function upsertProduct(
  transaction: Prisma.TransactionClient,
  categoryId: string,
  input: {
    name: string;
    description: string;
    price: number;
    stock: number;
    lowStockThreshold: number;
    status: ProductStatus;
    saleMode?: "SIMPLE" | "OPTIONS";
    skuInventoryEnabled?: boolean;
  }
) {
  return transaction.product.upsert({
    where: { name: input.name },
    update: {
      categoryId,
      description: input.description,
      price: input.price,
      stock: input.stock,
      stockTarget: Math.max(input.stock, 10),
      lowStockThreshold: input.lowStockThreshold,
      status: input.status,
      saleMode: input.saleMode ?? "SIMPLE",
      skuInventoryEnabled: input.skuInventoryEnabled ?? false,
      audienceScope: "ALL_STUDENTS",
      isActive: true
    },
    create: {
      categoryId,
      name: input.name,
      description: input.description,
      price: input.price,
      stock: input.stock,
      stockTarget: Math.max(input.stock, 10),
      lowStockThreshold: input.lowStockThreshold,
      status: input.status,
      saleMode: input.saleMode ?? "SIMPLE",
      skuInventoryEnabled: input.skuInventoryEnabled ?? false,
      audienceScope: "ALL_STUDENTS",
      isActive: true
    }
  });
}

async function createOpeningBatch(
  transaction: Prisma.TransactionClient,
  input: {
    batchCode: string;
    productId: string;
    skuId?: string;
    quantity: number;
    unitCost: number;
    performedById: string;
  }
) {
  if (input.quantity <= 0) return;
  await transaction.inventoryBatch.create({
    data: {
      batchCode: input.batchCode,
      productId: input.productId,
      skuId: input.skuId,
      quantityReceived: input.quantity,
      quantityRemaining: input.quantity,
      unitCost: input.unitCost,
      costVerified: true,
      receivedAt: new Date("2026-10-01T00:00:00.000Z"),
      supplierNote: "Synthetic staging fixture",
      createdById: input.performedById
    }
  });
  await transaction.inventoryMovement.create({
    data: {
      productId: input.productId,
      skuId: input.skuId,
      type: "RESTOCK",
      quantity: input.quantity,
      previousStock: 0,
      newStock: input.quantity,
      performedById: input.performedById,
      notes: seedMovementNote
    }
  });
}

async function seedCatalog() {
  const staff = await prisma.profile.findUniqueOrThrow({ where: { email: "staff@wesleyan.edu.ph" } });
  await assertFixtureProductsAreSafeToRebuild();

  await prisma.$transaction(async (transaction) => {
    const category = await transaction.category.upsert({
      where: { slug: qaCategorySlug },
      update: { name: qaCategoryName, iconUrl: "/assets/all-items.svg", isActive: true },
      create: { name: qaCategoryName, slug: qaCategorySlug, iconUrl: "/assets/all-items.svg", isActive: true }
    });

    const simple = await upsertProduct(transaction, category.id, {
      name: productNames[0],
      description: "Synthetic simple product for staging checkout and inventory tests.",
      price: 50,
      stock: 20,
      lowStockThreshold: 5,
      status: "IN_STOCK"
    });
    await rebuildProductChildren(transaction, simple.id);
    await createOpeningBatch(transaction, {
      batchCode: "QA-OPENING-SIMPLE-001",
      productId: simple.id,
      quantity: 20,
      unitCost: 25,
      performedById: staff.id
    });

    const variantProduct = await upsertProduct(transaction, category.id, {
      name: productNames[1],
      description: "Synthetic variant-only product covering size selection and low-stock behavior.",
      price: 350,
      stock: 7,
      lowStockThreshold: 8,
      status: "RESTOCK_SOON",
      saleMode: "OPTIONS"
    });
    await rebuildProductChildren(transaction, variantProduct.id);
    for (const variant of [
      { optionValue: "Small", stock: 5 },
      { optionValue: "Medium", stock: 2 },
      { optionValue: "Large", stock: 0 }
    ]) {
      await transaction.productVariant.create({
        data: {
          productId: variantProduct.id,
          optionName: "Size",
          optionValue: variant.optionValue,
          stock: variant.stock,
          stockTarget: 10,
          lowStockThreshold: 2
        }
      });
    }
    await createOpeningBatch(transaction, {
      batchCode: "QA-OPENING-VARIANT-001",
      productId: variantProduct.id,
      quantity: 7,
      unitCost: 190,
      performedById: staff.id
    });

    const skuProduct = await upsertProduct(transaction, category.id, {
      name: productNames[2],
      description: "Synthetic SKU-backed product covering option combinations and FIFO layers.",
      price: 700,
      stock: 7,
      lowStockThreshold: 2,
      status: "IN_STOCK",
      saleMode: "OPTIONS",
      skuInventoryEnabled: true
    });
    await rebuildProductChildren(transaction, skuProduct.id);
    for (const skuSeed of [
      { size: "Small", code: "QA-SET-S", stock: 4, unitCost: 410 },
      { size: "Medium", code: "QA-SET-M", stock: 3, unitCost: 420 }
    ]) {
      const variant = await transaction.productVariant.create({
        data: {
          productId: skuProduct.id,
          optionName: "Size",
          optionValue: skuSeed.size,
          stock: skuSeed.stock,
          stockTarget: 10,
          lowStockThreshold: 2
        }
      });
      const sku = await transaction.productSku.create({
        data: {
          productId: skuProduct.id,
          code: skuSeed.code,
          stock: skuSeed.stock,
          stockTarget: 10,
          lowStockThreshold: 2,
          isActive: true,
          optionSnapshot: [{ optionName: "Size", optionValue: skuSeed.size }]
        }
      });
      await transaction.productSkuVariant.create({ data: { skuId: sku.id, variantId: variant.id } });
      await createOpeningBatch(transaction, {
        batchCode: `QA-OPENING-${skuSeed.code}`,
        productId: skuProduct.id,
        skuId: sku.id,
        quantity: skuSeed.stock,
        unitCost: skuSeed.unitCost,
        performedById: staff.id
      });
    }

    const soldOut = await upsertProduct(transaction, category.id, {
      name: productNames[3],
      description: "Synthetic unavailable product for sold-out UI and validation tests.",
      price: 150,
      stock: 0,
      lowStockThreshold: 3,
      status: "OUT_OF_STOCK"
    });
    await rebuildProductChildren(transaction, soldOut.id);

    await transaction.auditLog.upsert({
      where: { dedupeKey: "staging-fixtures:v1" },
      update: {
        actorId: staff.id,
        summary: "Deterministic staging fixtures refreshed.",
        metadata: { fixtureVersion: 1, fakeDataOnly: true }
      },
      create: {
        actorId: staff.id,
        action: "STAGING_FIXTURES_SEEDED",
        entityType: "staging_environment",
        entityId: null,
        dedupeKey: "staging-fixtures:v1",
        summary: "Deterministic staging fixtures created.",
        metadata: { fixtureVersion: 1, fakeDataOnly: true }
      }
    });
  }, { maxWait: 20_000, timeout: 120_000 });
}

async function main() {
  const target = assertSafeStagingMutationEnvironment(process.env);
  const fingerprint = databaseTargetFingerprint(process.env.DATABASE_URL);
  const expectedConfirmation = `${confirmationPrefix}${fingerprint}`;
  const dryRun = !process.argv.includes(applyFlag);
  const confirmations = process.argv.filter((argument) => argument.startsWith(confirmationPrefix));
  const client = createSupabaseAdminClient();
  const authUsers = await listAllAuthUsers(client);
  const [existingProfiles, existingProducts] = await Promise.all([
    prisma.profile.count({ where: { email: { in: accountSeeds.map((seed) => seed.email) } } }),
    prisma.product.count({ where: { name: { in: productNames } } })
  ]);

  if (dryRun) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      target: { environment: "staging", supabaseProjectRef: target.stagingProjectRef, fingerprint },
      fixtures: {
        accounts: accountSeeds.length,
        products: productNames.length,
        existingAuthUsers: authUsers.filter((user) => accountSeeds.some((seed) => seed.email === user.email?.toLowerCase())).length,
        existingProfiles,
        existingProducts
      },
      applyCommand: `${applyFlag} ${expectedConfirmation}`
    }, null, 2));
    return;
  }

  if (confirmations.length !== 1 || confirmations[0] !== expectedConfirmation) {
    throw new Error(
      `Seeding requires an exact database-target confirmation.\n`
      + `Database fingerprint: ${fingerprint}\n`
      + `Re-run with: ${applyFlag} ${expectedConfirmation}`
    );
  }

  const department = await prisma.department.upsert({
    where: { code: qaDepartmentCode },
    update: { groupName: "Quality Assurance", displayName: "QA Fixtures", isActive: true, sortOrder: 999 },
    create: { code: qaDepartmentCode, groupName: "Quality Assurance", displayName: "QA Fixtures", isActive: true, sortOrder: 999 }
  });
  await ensureProfiles(client, department.id);
  await seedCatalog();

  const verification = {
    profiles: await prisma.profile.count({ where: { email: { in: accountSeeds.map((seed) => seed.email) } } }),
    products: await prisma.product.count({ where: { name: { in: productNames } } }),
    inventoryBatches: await prisma.inventoryBatch.count({ where: { product: { name: { in: productNames } } } }),
    verifiedInventoryBatches: await prisma.inventoryBatch.count({
      where: { product: { name: { in: productNames } }, costVerified: true }
    })
  };
  if (
    verification.profiles !== accountSeeds.length
    || verification.products !== productNames.length
    || verification.inventoryBatches !== 4
    || verification.verifiedInventoryBatches !== verification.inventoryBatches
  ) {
    throw new Error(`Staging seed verification failed: ${JSON.stringify(verification)}.`);
  }

  console.log(JSON.stringify({
    mode: "APPLIED",
    target: { environment: "staging", supabaseProjectRef: target.stagingProjectRef, fingerprint },
    verification,
    loginAccounts: [
      "student@wesleyan.edu.ph",
      "qa.student02@wesleyan.edu.ph",
      "staff@wesleyan.edu.ph",
      "admin@wesleyan.edu.ph"
    ]
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
