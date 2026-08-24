import "dotenv/config";

const startedAt = performance.now();
const [{ listProducts }, { productAnswer }, { listPublishedWesbotFaqs }, { prisma }] = await Promise.all([
  import("../dist/services/product.service.js"),
  import("../dist/services/wesbot.service.js"),
  import("../dist/services/wesbot-knowledge.service.js"),
  import("../dist/lib/prisma.js")
]);

await prisma.$queryRawUnsafe("SELECT 1");
const warmedAt = performance.now();
const products = await listProducts({
  candidateTerms: ["bsba"],
  limit: 12
}, { bypassCache: true });
const productLookupMs = performance.now() - warmedAt;
const expectedProduct = products.find((product) => product.name === "CBA Women's Uniform Set");
const aliasResolved = Boolean(
  expectedProduct?.aliases.some((alias) => alias.toLowerCase() === "bsba women's uniform set")
);
const grounded = productAnswer(products, "BSBA Women's Uniform Set", {
  productName: "BSBA Women's Uniform Set",
  department: "BSBA",
  options: [],
  quantity: null,
  reservationReference: null,
  receiptCode: null,
  contextReference: null
});
const faqStartedAt = performance.now();
const publishedFaqs = await listPublishedWesbotFaqs();
const faqLookupMs = performance.now() - faqStartedAt;
const junkQuestions = new Set(["Alamat ng Mangga", "gio", "janmark magkano langgonisa niyo?"]);
const checks = {
  bsbaAliasResolvesToCba: aliasResolved,
  productAnswerUsesLiveProduct: Boolean(
    expectedProduct && grounded.sourceReferences.includes(`product:${expectedProduct.id}`)
  ),
  importedDraftsStayUnpublished: publishedFaqs.every((faq) => (
    !["wesbot-dataset-v2", "wescomm-approved-config"].includes(faq.source ?? "")
  )),
  junkFaqsStayUnpublished: publishedFaqs.every((faq) => !junkQuestions.has(faq.question))
};
const report = {
  status: Object.values(checks).every(Boolean) ? "passed" : "failed",
  checks,
  candidateProducts: products.length,
  publishedFaqs: publishedFaqs.length,
  connectionWarmupMs: Number((warmedAt - startedAt).toFixed(1)),
  productLookupMs: Number(productLookupMs.toFixed(1)),
  faqLookupMs: Number(faqLookupMs.toFixed(1)),
  durationMs: Number((performance.now() - startedAt).toFixed(1))
};
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (report.status !== "passed") process.exitCode = 1;
