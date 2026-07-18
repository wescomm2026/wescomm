const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const serviceWorkerPath = path.join(projectRoot, "public", "sw.js");
const sourceRoots = ["app", "components", "lib"];
const sourceFiles = [
  "package.json",
  "next.config.mjs",
  "public/manifest.webmanifest",
  "public/offline.html",
  "public/assets/wescomm-logo.png"
];
const buildIdPattern = /const BUILD_ID = "[A-Za-z0-9._-]+";/;

async function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    return entry.isDirectory() ? listFiles(relativePath) : [relativePath];
  }));
  return nestedFiles.flat();
}

async function sourceBuildId(serviceWorkerSource) {
  const hash = crypto.createHash("sha256");
  const nestedFiles = (await Promise.all(sourceRoots.map(listFiles))).flat();
  const files = [...nestedFiles, ...sourceFiles].sort();

  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update(await fs.readFile(path.join(projectRoot, relativePath)));
  }

  hash.update(serviceWorkerSource.replace(buildIdPattern, 'const BUILD_ID = "BUILD_ID";'));
  return hash.digest("hex").slice(0, 16);
}

async function main() {
  const serviceWorkerSource = await fs.readFile(serviceWorkerPath, "utf8");
  if (!buildIdPattern.test(serviceWorkerSource)) {
    throw new Error("Unable to find the service-worker BUILD_ID declaration.");
  }

  const deploymentId = (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.WESCOMM_RELEASE_ID ||
    ""
  ).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32);
  const buildId = deploymentId || await sourceBuildId(serviceWorkerSource);
  const nextSource = serviceWorkerSource.replace(buildIdPattern, `const BUILD_ID = "${buildId}";`);

  await fs.writeFile(serviceWorkerPath, nextSource, "utf8");
  console.log(`Prepared WESCOMM service worker for build ${buildId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
