import { spawn } from "node:child_process";
import path from "node:path";

const PRISMA_STATUS_MAX_ATTEMPTS = 3;
const PRISMA_STATUS_RETRY_DELAY_MS = 500;
const prismaCliPath = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");

function runPrismaStatus() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prismaCliPath, "migrate", "status"], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isTransientConnectionFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /\bP1001\b|Can't reach database server/i.test(output)
    || /Error: Schema engine error:\s*$/i.test(output);
}

for (let attempt = 1; attempt <= PRISMA_STATUS_MAX_ATTEMPTS; attempt += 1) {
  const result = await runPrismaStatus();
  if (result.code === 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (attempt > 1) {
      console.log(`Prisma migrate status recovered on attempt ${attempt}.`);
    }
    process.exit(0);
  }

  if (!isTransientConnectionFailure(result) || attempt === PRISMA_STATUS_MAX_ATTEMPTS) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.code);
  }

  console.warn(`Prisma migrate status connection attempt ${attempt} failed; retrying.`);
  await new Promise((resolve) => setTimeout(resolve, PRISMA_STATUS_RETRY_DELAY_MS * attempt));
}
