import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const DATASET_SOURCE = "wesbot-dataset-v2";
const CONFIG_SOURCE = "wescomm-approved-config";
const DATASET_VERSION = "2.0";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const faqPath = path.resolve(scriptDirectory, "../datasets/wesbot/v2/upstream/wesbot_faq_knowledge_seed.json");
const faqDrafts = JSON.parse(await readFile(faqPath, "utf8"));
const configQuestions = [
  "Where is WESCOMM located?",
  "How can I contact WESCOMM?",
  "On which days is WESCOMM normally closed?",
  "What are WESCOMM's operating hours?"
];
const junkQuestions = ["Alamat ng Mangga", "gio", "janmark magkano langgonisa niyo?"];

const prisma = new PrismaClient();
try {
  const [
    datasetAliases,
    datasetVariants,
    configVariants,
    datasetFaqs,
    configFaqs,
    cleanupProducts,
    junkFaqs,
    auditLogs
  ] = await Promise.all([
    prisma.productAlias.count({ where: { source: DATASET_SOURCE, sourceVersion: DATASET_VERSION } }),
    prisma.faqVariant.count({ where: { source: DATASET_SOURCE, sourceVersion: DATASET_VERSION } }),
    prisma.faqVariant.count({ where: { source: CONFIG_SOURCE, sourceVersion: DATASET_VERSION } }),
    prisma.faq.count({
      where: {
        question: { in: faqDrafts.map((draft) => draft.question) },
        source: DATASET_SOURCE,
        sourceVersion: DATASET_VERSION,
        isPublished: false
      }
    }),
    prisma.faq.count({
      where: {
        question: { in: configQuestions },
        source: CONFIG_SOURCE,
        sourceVersion: DATASET_VERSION,
        isPublished: false
      }
    }),
    prisma.product.findMany({
      where: {
        OR: [
          { name: "TEST", category: { name: "TEST" } },
          { name: "birthday", category: { name: "cherrypie" } }
        ]
      },
      select: { name: true, isActive: true, category: { select: { name: true } } }
    }),
    prisma.faq.findMany({
      where: { question: { in: junkQuestions } },
      select: { question: true, isPublished: true }
    }),
    prisma.auditLog.count({ where: { dedupeKey: "wesbot-dataset-v2-bootstrap" } })
  ]);

  const checks = {
    datasetAliases: datasetAliases === 57,
    datasetFaqs: datasetFaqs === 26,
    configFaqs: configFaqs === 4,
    faqVariants: datasetVariants + configVariants === 90,
    approvedProductsInactive: cleanupProducts.length === 2 && cleanupProducts.every((row) => !row.isActive),
    junkFaqsUnpublished: junkFaqs.length === 3 && junkFaqs.every((row) => !row.isPublished),
    auditRecordedOnce: auditLogs === 1
  };
  const report = {
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    checks,
    counts: {
      datasetAliases,
      datasetFaqs,
      configFaqs,
      faqVariants: datasetVariants + configVariants,
      cleanupProducts: cleanupProducts.length,
      junkFaqs: junkFaqs.length,
      auditLogs
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
