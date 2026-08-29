import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARD_MAX_CALLS = 300;
const CONCURRENCY = 5;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetRoot = path.resolve(scriptDirectory, "../datasets/wesbot/v2/upstream");
const evaluationEnvPath = process.env.WESBOT_EVAL_ENV_FILE?.trim()
  ? path.resolve(process.cwd(), process.env.WESBOT_EVAL_ENV_FILE.trim())
  : path.resolve(scriptDirectory, "../.env.wesbot-eval.local");

// The optional evaluation-only file is loaded first; the regular backend .env
// fills missing application settings without overriding the scoped credential.
loadEnv({ path: evaluationEnvPath, override: false, quiet: true });
loadEnv({ path: path.resolve(scriptDirectory, "../.env"), override: false, quiet: true });

async function readJsonLines(name) {
  return (await readFile(path.join(datasetRoot, name), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(JSON.parse);
}

function macroF1(rows, intents) {
  const scores = perIntentMetrics(rows, intents).map((metric) => metric.f1);
  return Number((scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)).toFixed(4));
}

function perIntentMetrics(rows, intents) {
  return intents.map((intent) => {
    const truePositive = rows.filter((row) => row.expected === intent && row.actual === intent).length;
    const falsePositive = rows.filter((row) => row.expected !== intent && row.actual === intent).length;
    const falseNegative = rows.filter((row) => row.expected === intent && row.actual !== intent).length;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
      intent,
      support: rows.filter((row) => row.expected === intent).length,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4))
    };
  });
}

function safeErrorDetail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    statusCode: typeof error?.statusCode === "number" ? error.statusCode : null,
    message: message
      .replace(/(authorization|bearer|api[_ -]?key|token)([=: ]+)[^\s,;]+/gi, "$1$2[redacted]")
      .slice(0, 500)
  };
}

function failedResult(row, error) {
  return {
    id: row.id,
    expected: row.intent ?? row.provisional_intent,
    error: safeErrorDetail(error)
  };
}

async function mapLimited(rows, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      try {
        output[index] = await worker(rows[index]);
      } catch (error) {
        output[index] = failedResult(rows[index], error);
      }
    }
  }));
  return output;
}

const hasGeminiCredential = Boolean(process.env.GEMINI_API_KEY?.trim());
if (!hasGeminiCredential) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "No Gemini API credential is configured.",
    productionDataUsed: false,
    callsMade: 0
  }, null, 2));
  process.exit(0);
}

process.env.WESBOT_ENABLED = "true";
process.env.WESBOT_AI_ENABLED = "true";
process.env.WESBOT_AI_REWRITE_ENABLED = "false";
process.env.WESBOT_SEMANTIC_MODE = "active";

const [holdout, contexts, clarifications] = await Promise.all([
  readJsonLines("wesbot_semantic_eval_holdout_v2.jsonl"),
  readJsonLines("wesbot_multiturn_context_v2.jsonl"),
  readJsonLines("wesbot_clarification_cases_v2.jsonl")
]);
const callCount = holdout.length + contexts.length + clarifications.length;
if (callCount > HARD_MAX_CALLS) {
  throw new Error(`Evaluation requires ${callCount} calls, exceeding the ${HARD_MAX_CALLS}-call hard limit.`);
}

const { classifyWesbotSemanticallyForEvaluation } = await import("../dist/services/wesbot-classifier.service.js");
const evaluate = (row, message, context = []) => classifyWesbotSemanticallyForEvaluation({
  caseId: row.id,
  message,
  context
}).then((decision) => ({
  id: row.id,
  expected: row.intent ?? row.provisional_intent,
  actual: decision.intent,
  needsClarification: decision.needsClarification,
  confidenceBand: decision.confidenceBand
}));

let firstHoldoutResult;
try {
  firstHoldoutResult = await evaluate(holdout[0], holdout[0].text);
} catch (error) {
  console.log(JSON.stringify({
    status: "blocked",
    reason: "Gemini preflight failed; the dataset evaluation was stopped after one call.",
    productionDataUsed: false,
    callsAttempted: 1,
    diagnostic: safeErrorDetail(error)
  }, null, 2));
  process.exit(1);
}

const [remainingHoldoutResults, contextResults, clarificationResults] = await Promise.all([
  mapLimited(holdout.slice(1), (row) => evaluate(row, row.text)),
  mapLimited(contexts, (row) => evaluate(row, row.current_message, row.context)),
  mapLimited(clarifications, (row) => evaluate(row, row.text))
]);
const holdoutResults = [firstHoldoutResult, ...remainingHoldoutResults];

const intents = [...new Set(holdout.map((row) => row.intent))];
const intentMetrics = perIntentMetrics(holdoutResults, intents);
const holdoutAccuracy = holdoutResults.filter((row) => row.actual === row.expected).length / Math.max(1, holdout.length);
const holdoutMacroF1 = macroF1(holdoutResults, intents);
const clarificationAccuracy = clarificationResults.filter((row) => !row.error && row.needsClarification).length
  / Math.max(1, clarifications.length);
const multiturnAccuracy = contextResults.filter((row) => (
  !row.error && row.actual === row.expected && !row.needsClarification
)).length / Math.max(1, contexts.length);
const allResults = [...holdoutResults, ...contextResults, ...clarificationResults];
const callFailures = allResults.filter((row) => row.error).length;
const gates = {
  withinCallLimit: callCount <= HARD_MAX_CALLS,
  noCallFailures: callFailures === 0,
  holdoutMacroF1: holdoutMacroF1 >= 0.85,
  perIntentRecall: intentMetrics.every((metric) => metric.recall >= 0.8),
  clarificationAccuracy: clarificationAccuracy >= 0.9,
  multiturnAccuracy: multiturnAccuracy >= 0.85
};
const report = {
  status: Object.values(gates).every(Boolean) ? "passed" : "failed",
  productionDataUsed: false,
  callsAttempted: callCount,
  callFailures,
  gates,
  holdout: {
    total: holdout.length,
    accuracy: Number(holdoutAccuracy.toFixed(4)),
    macroF1: holdoutMacroF1,
    perIntent: intentMetrics,
    mismatchIds: holdoutResults.filter((row) => row.error || row.actual !== row.expected).map((row) => row.id)
  },
  multiturn: {
    total: contexts.length,
    accuracy: Number(multiturnAccuracy.toFixed(4)),
    correctIntentWithoutClarification: contextResults.filter((row) => (
      !row.error && row.actual === row.expected && !row.needsClarification
    )).length,
    mismatchIds: contextResults.filter((row) => (
      row.error || row.actual !== row.expected || row.needsClarification
    )).map((row) => row.id)
  },
  clarification: {
    total: clarifications.length,
    accuracy: Number(clarificationAccuracy.toFixed(4)),
    correctlyClarified: clarificationResults.filter((row) => !row.error && row.needsClarification).length,
    missedIds: clarificationResults.filter((row) => row.error || !row.needsClarification).map((row) => row.id)
  }
};
console.log(JSON.stringify(report, null, 2));
