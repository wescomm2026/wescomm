const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { parse } = require("../../backend/node_modules/dotenv");

const envFile = resolve(
  process.cwd(),
  process.env.VERCEL_ENV_FILE || ".vercel/.env.preview.local",
);
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node run-with-vercel-env.cjs <command> [...args]");
  process.exit(2);
}

let parsedEnvironment;
try {
  parsedEnvironment = parse(readFileSync(envFile));
} catch (error) {
  console.error(`Unable to load the pulled Vercel environment file: ${error.message}`);
  process.exit(1);
}

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env: { ...process.env, ...parsedEnvironment },
  shell: false,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to run ${command}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
