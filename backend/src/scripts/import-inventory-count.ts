import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  importWriteRefusal,
  resolveImportTarget,
  validateInventoryDataset,
  type ImportStep,
  type InventoryCountDataset,
  type ProductImportPlan
} from "../domain/inventory-count-import.js";
import { prisma } from "../lib/prisma.js";
import { applyInventoryCountImport, planInventoryCountImport } from "../services/inventory-count-import.service.js";

/*
 * Imports a physical inventory count sheet into the catalog.
 *
 *   npm run inventory:import                          # dry run: prints the plan, writes nothing
 *   npm run inventory:import -- --apply --actor-email staff@wesleyan.edu.ph
 *   npm run inventory:import -- --apply --actor-email ... --confirm-production <project-ref>
 *
 * Options: --dataset <file> (default: the September 2026 count), --report <file.json>.
 * Point DOTENV_CONFIG_PATH at the environment file of the database you intend to use.
 */

const DEFAULT_DATASET = "datasets/inventory/2026-09-ending-inventory.json";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function describeStep(step: ImportStep) {
  switch (step.type) {
    case "CREATE": return "create (price PHP 0 — Needs price)";
    case "RESTORE": return "restore from archive";
    case "RENAME": return `rename "${step.from}" → "${step.to}"`;
    case "ZERO_STOCK": return `clear previously recorded stock (${step.previousStock})`;
    case "CHANGE_SALE_MODE": return `change selling setup ${step.from} → ${step.to}`;
    case "SET_SIZES": return `set ${step.optionName}: ${step.sizes.map((size) => `${size.option}=${size.count}`).join(", ")}`;
    case "SET_SIZE_COUNTS": return `update counts: ${step.changes.map((change) => `${change.option} ${change.from}→${change.to}`).join(", ")}`;
    case "SET_STOCK": return `set stock ${step.from} → ${step.to}`;
    case "SET_IMAGE": return `use catalog photo ${step.imageUrl}`;
    case "ADD_ALIASES": return `add search aliases: ${step.aliases.join("; ")}`;
  }
}

function printPlan(plans: ProductImportPlan[]) {
  for (const plan of plans) {
    const head = plan.matched ? `MATCH  ${plan.matched.name}` : "NEW";
    console.log(`\n• ${plan.name}  [${plan.saleMode}, ${plan.total} on sheet]  ${head}`);
    if (plan.blockedReason) console.log(`    BLOCKED: ${plan.blockedReason}`);
    else if (!plan.steps.length) console.log("    up to date — no changes");
    for (const step of plan.steps) console.log(`    - ${describeStep(step)}`);
    for (const warning of plan.warnings) console.log(`    ! ${warning}`);
    if (plan.reviewCandidatesFound.length) {
      console.log(`    ? Review: existing ${plan.reviewCandidatesFound.map((name) => `"${name}"`).join(", ")} may be the same item (not merged).`);
    }
  }
  const pending = plans.filter((plan) => !plan.blockedReason && plan.steps.length);
  console.log(`\n${plans.length} sheet items: ${plans.filter((plan) => !plan.matched).length} new, ${plans.filter((plan) => plan.matched).length} matched, ${pending.length} with changes, ${plans.filter((plan) => plan.blockedReason).length} blocked.`);
}

async function main() {
  const datasetPath = path.resolve(process.cwd(), option("--dataset") ?? DEFAULT_DATASET);
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as InventoryCountDataset;
  const errors = validateInventoryDataset(dataset);
  if (errors.length) throw new Error(`Dataset is invalid:\n- ${errors.join("\n- ")}`);

  const target = resolveImportTarget({
    databaseUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
    stagingProjectRef: process.env.STAGING_SUPABASE_PROJECT_REF,
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF
  });
  const apply = process.argv.includes("--apply");
  console.log(`${dataset.title} (${dataset.products.length} items) → ${target.label}${apply ? "" : " — DRY RUN, nothing will be written"}`);

  if (!apply) {
    // Planning only reads the catalog.
    const plans = await planInventoryCountImport(dataset);
    printPlan(plans);
    const report = option("--report");
    if (report) writeFileSync(report, JSON.stringify({ target, dryRun: true, plans }, null, 2));
    return;
  }

  const refusal = importWriteRefusal(target, option("--confirm-production"));
  if (refusal) throw new Error(refusal);
  const actorEmail = option("--actor-email")?.trim().toLowerCase();
  if (!actorEmail) throw new Error("--actor-email is required with --apply (a staff or admin account).");
  const actor = await prisma.profile.findFirst({
    where: { email: { equals: actorEmail, mode: "insensitive" }, role: { in: ["STAFF", "ADMIN"] } },
    select: { id: true, fullName: true }
  });
  if (!actor) throw new Error(`No staff or admin account uses ${actorEmail}.`);

  const result = await applyInventoryCountImport(dataset, actor.id);
  printPlan(result.plans);
  console.log(`\nApplied by ${actor.fullName}: ${result.applied.length} updated, ${result.skipped.length} skipped, ${result.failed.length} failed.`);
  for (const failure of result.failed) console.log(`  FAILED ${failure.key}: ${failure.error}`);
  const report = option("--report");
  if (report) writeFileSync(report, JSON.stringify({ target, dryRun: false, ...result }, null, 2));
  if (result.failed.length) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
