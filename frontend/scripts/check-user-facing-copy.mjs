import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [path.join(frontendRoot, "app"), path.join(frontendRoot, "components")];
const extensions = new Set([".ts", ".tsx"]);
const bannedPhrases = [
  "API request failed",
  "Staff API request failed",
  "Internal server error",
  "Apply the new WesBot usage database migration",
  "Run backend/DATABASE_AUDIT_LOGS_SQL.txt",
  "connected to the WESCOMM backend",
  "live backend data",
  "live backend insights",
  "found in the database",
  "Waiting for backend push keys",
  "Semantic mode",
  "Average latency",
  "Runtime status",
  "Requests in flight",
  "Rate snapshot",
  "retryable cleanup job",
  "provider-reported tokens",
  "inventory database"
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return extensions.has(path.extname(entry.name)) ? [target] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map(sourceFiles))).flat();
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const phrase of bannedPhrases) {
    if (source.includes(phrase)) failures.push(`${path.relative(frontendRoot, file)} contains "${phrase}"`);
  }
  if (/instanceof Error\s*\?\s*[A-Za-z_$][\w$]*\.message\s*:/.test(source)) {
    failures.push(`${path.relative(frontendRoot, file)} renders an unreviewed raw Error.message`);
  }
  if (/\$\{[^}\n]*[A-Za-z_$][\w$]*Error\.message[^}\n]*\}/.test(source)) {
    failures.push(`${path.relative(frontendRoot, file)} interpolates an unreviewed raw Error.message`);
  }
}

assert.deepEqual(failures, [], `User-facing copy guard failed:\n${failures.join("\n")}`);
console.log(`User-facing copy guard passed for ${files.length} frontend files.`);
