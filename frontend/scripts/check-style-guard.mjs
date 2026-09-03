import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const baseline = JSON.parse(await readFile(path.join(root, "scripts/style-baseline.json"), "utf8"));
const extensions = new Set([".ts", ".tsx"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return extensions.has(path.extname(entry.name)) ? [target] : [];
  }));
  return files.flat();
}

const files = (await Promise.all(["app", "components", "lib"].map((directory) => sourceFiles(path.join(root, directory))))).flat();
const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

function values(pattern) {
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

const hex = values(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g);
const radii = values(/rounded-\[[^\]]+\]/g);
const shadows = values(/shadow-\[[^\]]+\]/g);
const metrics = {
  rawHexOccurrences: hex.length,
  uniqueHexValues: new Set(hex.map((value) => value.toLowerCase())).size,
  arbitraryRadiusOccurrences: radii.length,
  uniqueArbitraryRadii: new Set(radii).size,
  arbitraryShadowOccurrences: shadows.length,
  uniqueArbitraryShadows: new Set(shadows).size
};

const regressions = Object.entries(metrics).filter(([name, value]) => value > baseline[name]);
if (regressions.length) {
  console.error("Style guard failed. Use semantic tokens/primitives instead of adding visual literals:");
  regressions.forEach(([name, value]) => console.error(`- ${name}: ${value} (baseline maximum ${baseline[name]})`));
  process.exitCode = 1;
} else {
  console.log(`Style guard passed: ${JSON.stringify(metrics)}`);
}
