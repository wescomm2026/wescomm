import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectWesbotIntent } from "../dist/domain/wesbot.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetRoot = path.resolve(scriptDirectory, "../datasets/wesbot/v2/upstream");

async function readJsonLines(name) {
  return (await readFile(path.join(datasetRoot, name), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(JSON.parse);
}

function evaluate(rows) {
  const mismatches = rows
    .map((row) => ({ ...row, actual: detectWesbotIntent(row.text) }))
    .filter((row) => row.actual !== row.intent);
  return {
    total: rows.length,
    correct: rows.length - mismatches.length,
    accuracy: Number(((rows.length - mismatches.length) / rows.length).toFixed(4)),
    mismatches
  };
}

const semantic = evaluate(await readJsonLines("wesbot_semantic_intents_v2.jsonl"));
const holdout = evaluate(await readJsonLines("wesbot_semantic_eval_holdout_v2.jsonl"));
console.log(JSON.stringify({ semantic, holdout }, null, 2));
