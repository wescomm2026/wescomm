import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetRoot = path.resolve(scriptDirectory, "../datasets/wesbot/v2");
const upstreamRoot = path.join(datasetRoot, "upstream");

const allowedIntents = [
  "PRODUCT_INQUIRY",
  "RESERVATION_STATUS",
  "CANCELLATION_ELIGIBILITY",
  "PAYMENT_STATUS",
  "RECEIPT_STATUS",
  "PICKUP_INFORMATION",
  "POLICY_QUESTION",
  "HUMAN_HANDOFF",
  "GENERAL_SUPPORT"
];

function normalizeText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(upstreamRoot, name), "utf8"));
}

async function readJsonLines(name) {
  const content = await readFile(path.join(upstreamRoot, name), "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${name}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertUnique(rows, field, name, transform = (value) => String(value)) {
  const seen = new Set();
  for (const row of rows) {
    const value = transform(row[field]);
    assert(value, `${name} contains an empty ${field}.`);
    assert(!seen.has(value), `${name} contains duplicate ${field}: ${value}`);
    seen.add(value);
  }
}

function assertIntentDistribution(rows, expectedPerIntent, name) {
  const counts = new Map(allowedIntents.map((intent) => [intent, 0]));
  for (const row of rows) {
    assert(allowedIntents.includes(row.intent), `${name} contains unsupported intent ${row.intent}.`);
    counts.set(row.intent, (counts.get(row.intent) ?? 0) + 1);
  }
  for (const intent of allowedIntents) {
    assert(counts.get(intent) === expectedPerIntent, `${name} expected ${expectedPerIntent} ${intent} examples, found ${counts.get(intent)}.`);
  }
}

const manifest = JSON.parse(await readFile(path.join(datasetRoot, "manifest.json"), "utf8"));
const semantic = await readJsonLines("wesbot_semantic_intents_v2.jsonl");
const holdout = await readJsonLines("wesbot_semantic_eval_holdout_v2.jsonl");
const context = await readJsonLines("wesbot_multiturn_context_v2.jsonl");
const clarifications = await readJsonLines("wesbot_clarification_cases_v2.jsonl");
const current = await readJsonLines("wesbot_intents_current.jsonl");
const balanced = await readJsonLines("wesbot_intents_balanced.jsonl");
const faqs = await readJson("wesbot_faq_knowledge_seed.json");
const aliases = await readJson("wesbot_product_aliases.json");
const classifierSchema = await readJson("wesbot_semantic_classifier_schema_v2.json");
const neededConfiguration = await readJson("wesbot_config_needed.json");

assert(manifest.datasetVersion === "2.0", "Unexpected WesBot dataset version.");
assert(semantic.length === manifest.semanticTrainingExamples, "Semantic training count does not match the manifest.");
assert(holdout.length === manifest.semanticHoldoutExamples, "Semantic holdout count does not match the manifest.");
assert(context.length === manifest.multiturnExamples, "Multiturn count does not match the manifest.");
assert(clarifications.length === manifest.clarificationExamples, "Clarification count does not match the manifest.");
assert(faqs.length === manifest.faqDrafts, "FAQ draft count does not match the manifest.");
assert(aliases.length === manifest.productAliasEntries, "Product alias count does not match the manifest.");

for (const [rows, name] of [[semantic, "semantic"], [holdout, "holdout"], [context, "context"], [clarifications, "clarifications"], [current, "current"], [balanced, "balanced"]]) {
  assertUnique(rows, "id", name);
}
for (const [rows, name] of [[semantic, "semantic"], [holdout, "holdout"], [current, "current"], [balanced, "balanced"]]) {
  assertUnique(rows, "text", name, normalizeText);
}

assertIntentDistribution(semantic, 25, "semantic");
assertIntentDistribution(holdout, 5, "holdout");
assertIntentDistribution(balanced, 20, "balanced");

const semanticText = new Set(semantic.map((row) => normalizeText(row.text)));
assert(holdout.every((row) => !semanticText.has(normalizeText(row.text))), "Semantic holdout leaks exact training text.");

const currentText = new Set(current.map((row) => normalizeText(row.text)));
assert(balanced.every((row) => currentText.has(normalizeText(row.text))), "Balanced regression fixtures are expected to remain a subset of current detector fixtures.");

assert(new Set(classifierSchema.allowed_intents).size === allowedIntents.length, "Classifier schema intent count does not match runtime intents.");
assert(allowedIntents.every((intent) => classifierSchema.allowed_intents.includes(intent)), "Classifier schema is missing a runtime intent.");
assert(clarifications.every((row) => row.expected_behavior === "ASK_CLARIFICATION" && row.must_not_invent === true), "Clarification fixtures must fail closed.");
assert(context.every((row) => Array.isArray(row.context) && row.context.length > 0 && row.current_message), "Multiturn fixtures require context and a current message.");
assert(neededConfiguration.length === 3 && neededConfiguration.every((entry) => entry.is_published === false), "Unknown official configuration must remain unpublished.");

assertUnique(faqs, "question", "faq drafts", normalizeText);
assertUnique(aliases, "id", "product aliases");
const aliasTerms = aliases.flatMap((entry) => [entry.canonical_name, ...entry.aliases]).map(normalizeText).filter(Boolean);
assert(new Set(aliasTerms).size === aliasTerms.length, "Product alias terms must be globally unique after normalization.");

console.log(JSON.stringify({
  status: "passed",
  version: manifest.datasetVersion,
  semantic: semantic.length,
  holdout: holdout.length,
  multiturn: context.length,
  clarifications: clarifications.length,
  legacyRegression: balanced.length,
  faqDrafts: faqs.length,
  productAliasEntries: aliases.length
}, null, 2));
