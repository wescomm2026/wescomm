import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const DATASET_VERSION = "2.0";
const DATASET_SOURCE = "wesbot-dataset-v2";
const CONFIG_SOURCE = "wescomm-approved-config";
const APPLY_CONFIRMATION = "--apply";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetRoot = path.resolve(scriptDirectory, "../datasets/wesbot/v2/upstream");
const apply = process.argv.includes(APPLY_CONFIRMATION);

function normalize(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const targetOverrides = new Map(
  Object.entries({
    "WUP Men's Uniform Top": "Men's WUP Uniform",
    "WUP Men's Uniform Set": "Men's WUP Uniform Set",
    "BSBA Women's Uniform Set": "CBA Women's Uniform Set",
    "BSBA Women's Blouse": "CBA Women's Uniform",
    "BSBA Skirt": "CBA Women's Skirt"
  })
);

const cleanupProductTargets = [
  { name: "TEST", category: "TEST" },
  { name: "birthday", category: "cherrypie" }
];

const junkFaqQuestions = [
  "Alamat ng Mangga",
  "gio",
  "janmark magkano langgonisa niyo?"
];

const approvedConfigDrafts = [
  {
    question: "Where is WESCOMM located?",
    variants: ["Saan ang WESCOMM?", "WESCOMM location", "Commissary address"],
    answer: "WESCOMM is located at Mabini Extension, Cabanatuan City, Philippines, 3100.",
    category: "GENERAL"
  },
  {
    question: "How can I contact WESCOMM?",
    variants: ["WESCOMM contact email", "Paano makontak ang WESCOMM?", "Commissary email"],
    answer: "You can contact WESCOMM by email at wescomm2026@gmail.com.",
    category: "SUPPORT"
  },
  {
    question: "On which days is WESCOMM normally closed?",
    variants: ["Open ba WESCOMM ng weekend?", "Saturday Sunday schedule", "Weekend closure"],
    answer: "WESCOMM is normally closed on Saturday and Sunday. Check published announcements for special schedules.",
    category: "POLICY"
  },
  {
    question: "What are WESCOMM's operating hours?",
    variants: ["Anong oras bukas ang WESCOMM?", "WESCOMM hours", "Commissary opening hours"],
    answer: "WESCOMM is open from 10:00 AM to 4:30 PM.",
    category: "GENERAL"
  }
];

function aliasesFor(entry, productName) {
  const candidates = [entry.canonical_name, ...(entry.aliases ?? [])];
  if (entry.canonical_name.startsWith("BSBA ")) {
    candidates.push(entry.canonical_name.replace(/^BSBA /, "CBA "));
  }
  const productNameKey = normalize(productName);
  return [...new Map(
    candidates
      .filter((candidate) => normalize(candidate) && normalize(candidate) !== productNameKey)
      .map((candidate) => [normalize(candidate), candidate.trim()])
  ).entries()].map(([normalizedAlias, alias]) => ({ alias, normalizedAlias }));
}

async function loadJson(name) {
  return JSON.parse(await readFile(path.join(datasetRoot, name), "utf8"));
}

function matchAliasEntries(entries, products) {
  const productByNormalizedName = new Map();
  for (const product of products) {
    const key = normalize(product.name);
    const matches = productByNormalizedName.get(key) ?? [];
    matches.push(product);
    productByNormalizedName.set(key, matches);
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  for (const entry of entries) {
    const candidates = [
      targetOverrides.get(entry.canonical_name),
      entry.canonical_name,
      ...(entry.aliases ?? [])
    ].filter(Boolean);
    const productsById = new Map();
    for (const candidate of candidates) {
      for (const product of productByNormalizedName.get(normalize(candidate)) ?? []) {
        productsById.set(product.id, product);
      }
    }
    const matches = [...productsById.values()];
    if (matches.length === 1) {
      matched.push({ entry, product: matches[0], aliases: aliasesFor(entry, matches[0].name) });
    } else if (matches.length === 0) {
      unmatched.push(entry.canonical_name);
    } else {
      ambiguous.push({ canonicalName: entry.canonical_name, matches: matches.map((row) => row.name) });
    }
  }
  return { matched, unmatched, ambiguous };
}

async function findCleanupProducts(prisma) {
  const matches = [];
  for (const target of cleanupProductTargets) {
    const rows = await prisma.product.findMany({
      where: { name: target.name, category: { name: target.category } },
      select: { id: true, name: true, isActive: true, category: { select: { name: true } } }
    });
    matches.push(...rows);
  }
  return matches;
}

const prisma = new PrismaClient();
try {
  const [aliasEntries, faqDrafts, products, cleanupProducts, junkFaqs] = await Promise.all([
    loadJson("wesbot_product_aliases.json"),
    loadJson("wesbot_faq_knowledge_seed.json"),
    prisma.product.findMany({ select: { id: true, name: true } }),
    findCleanupProducts(prisma),
    prisma.faq.findMany({
      where: { question: { in: junkFaqQuestions } },
      select: { id: true, question: true, isPublished: true }
    })
  ]);
  const aliasPlan = matchAliasEntries(aliasEntries, products);
  if (aliasPlan.ambiguous.length > 0) {
    throw new Error(`Ambiguous product alias targets: ${JSON.stringify(aliasPlan.ambiguous)}`);
  }

  const plannedAliases = aliasPlan.matched.reduce((sum, row) => sum + row.aliases.length, 0);
  const report = {
    mode: apply ? "apply" : "dry-run",
    datasetVersion: DATASET_VERSION,
    productAliases: {
      datasetEntries: aliasEntries.length,
      matchedProducts: aliasPlan.matched.length,
      plannedAliases,
      unmatchedCanonicalNames: aliasPlan.unmatched
    },
    cleanup: {
      productsToDeactivate: cleanupProducts.map((row) => ({
        name: row.name,
        category: row.category.name,
        currentlyActive: row.isActive
      })),
      junkFaqsToUnpublish: junkFaqs.map((row) => ({
        question: row.question,
        currentlyPublished: row.isPublished
      }))
    },
    faqDrafts: {
      dataset: faqDrafts.length,
      approvedConfig: approvedConfigDrafts.length,
      operatingHoursIncluded: true
    }
  };

  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    console.log(`Dry run only. Re-run with ${APPLY_CONFIRMATION} after reviewing the exact targets.`);
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const aliasRows = aliasPlan.matched.flatMap((row) => row.aliases.map((alias) => ({
        productId: row.product.id,
        ...alias,
        source: DATASET_SOURCE,
        sourceVersion: DATASET_VERSION
      })));
      const aliasesCreated = aliasRows.length
        ? await tx.productAlias.createMany({ data: aliasRows, skipDuplicates: true })
        : { count: 0 };

      const deactivated = cleanupProducts.length === 0
        ? { count: 0 }
        : await tx.product.updateMany({
          where: {
            id: { in: cleanupProducts.map((row) => row.id) },
            isActive: true
          },
          data: { isActive: false }
        });
      const unpublished = junkFaqs.length === 0
        ? { count: 0 }
        : await tx.faq.updateMany({
          where: {
            id: { in: junkFaqs.map((row) => row.id) },
            isPublished: true
          },
          data: { isPublished: false }
        });

      const allDrafts = [
        ...faqDrafts.map((draft) => ({ ...draft, importSource: DATASET_SOURCE })),
        ...approvedConfigDrafts.map((draft) => ({ ...draft, importSource: CONFIG_SOURCE }))
      ];
      const existingDraftFaqs = await tx.faq.findMany({
        where: { question: { in: allDrafts.map((draft) => draft.question) } },
        select: { question: true, isPublished: true, source: true }
      });
      const existingFaqByQuestion = new Map(existingDraftFaqs.map((faq) => [faq.question, faq]));
      const faqOutcomes = { created: 0, updated: 0, preserved: 0 };
      for (const draft of allDrafts) {
        const existing = existingFaqByQuestion.get(draft.question);
        if (!existing) faqOutcomes.created += 1;
        else if (existing.source === draft.importSource && !existing.isPublished) faqOutcomes.updated += 1;
        else faqOutcomes.preserved += 1;
      }

      const faqImportRows = allDrafts.map((draft) => ({
        question: draft.question,
        answer: draft.answer,
        category: draft.category,
        source: draft.importSource,
        source_version: DATASET_VERSION
      }));
      await tx.$executeRaw(Prisma.sql`
        DO $wesbot_lock$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('wesbot-dataset-v2-import'));
        END
        $wesbot_lock$
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "faqs" AS target
        SET
          "answer" = draft.answer,
          "category" = draft.category,
          "source_version" = draft.source_version,
          "updated_at" = CURRENT_TIMESTAMP
        FROM jsonb_to_recordset(${JSON.stringify(faqImportRows)}::jsonb) AS draft(
          question TEXT,
          answer TEXT,
          category TEXT,
          source TEXT,
          source_version TEXT
        )
        WHERE target."question" = draft.question
          AND target."source" = draft.source
          AND NOT target."is_published"
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "faqs" (
          "question", "answer", "category", "is_published", "source", "source_version"
        )
        SELECT
          draft.question,
          draft.answer,
          draft.category,
          FALSE,
          draft.source,
          draft.source_version
        FROM jsonb_to_recordset(${JSON.stringify(faqImportRows)}::jsonb) AS draft(
          question TEXT,
          answer TEXT,
          category TEXT,
          source TEXT,
          source_version TEXT
        )
        WHERE NOT EXISTS (
          SELECT 1
          FROM "faqs" AS existing
          WHERE existing."question" = draft.question
        )
      `);

      const importedFaqs = await tx.faq.findMany({
        where: { question: { in: allDrafts.map((draft) => draft.question) } },
        select: { id: true, question: true }
      });
      const faqIdByQuestion = new Map(importedFaqs.map((faq) => [faq.question, faq.id]));
      const variantRows = allDrafts.flatMap((draft) => (draft.variants ?? []).flatMap((variant) => {
        const faqId = faqIdByQuestion.get(draft.question);
        const normalizedText = normalize(variant);
        return faqId && normalizedText ? [{
          faqId,
          variant,
          normalizedText,
          source: draft.importSource,
          sourceVersion: DATASET_VERSION
        }] : [];
      }));
      const variantsCreated = variantRows.length
        ? await tx.faqVariant.createMany({ data: variantRows, skipDuplicates: true })
        : { count: 0 };

      const actor = await tx.profile.findFirst({
        where: { role: "ADMIN" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true }
      });
      await tx.auditLog.upsert({
        where: { dedupeKey: "wesbot-dataset-v2-bootstrap" },
        create: {
          actorId: actor?.id,
          action: "WESBOT_KNOWLEDGE_IMPORTED",
          entityType: "wesbot_dataset",
          entityId: DATASET_VERSION,
          dedupeKey: "wesbot-dataset-v2-bootstrap",
          summary: "Imported reviewed WesBot v2 aliases and unpublished FAQ drafts.",
          metadata: {
            aliasesPlanned: aliasRows.length,
            aliasesCreated: aliasesCreated.count,
            variantsPlanned: variantRows.length,
            variantsCreated: variantsCreated.count,
            matchedProducts: aliasPlan.matched.length,
            unmatchedCanonicalNames: aliasPlan.unmatched,
            productsDeactivated: deactivated.count,
            junkFaqsUnpublished: unpublished.count,
            faqOutcomes,
            operatingHoursIncluded: true
          }
        },
        update: {}
      });

      return {
        aliasesPlanned: aliasRows.length,
        aliasesCreated: aliasesCreated.count,
        variantsPlanned: variantRows.length,
        variantsCreated: variantsCreated.count,
        productsDeactivated: deactivated.count,
        junkFaqsUnpublished: unpublished.count,
        faqOutcomes
      };
    }, { maxWait: 10_000, timeout: 60_000 });

    console.log(JSON.stringify({ ...report, applied: result }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
