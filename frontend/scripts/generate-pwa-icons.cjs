const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "public", "assets", "wescomm-logo.png");
const outputDirectory = path.join(projectRoot, "public", "icons");
const background = { r: 246, g: 250, b: 247, alpha: 1 };

async function renderIcon(filename, size, contentScale) {
  const contentSize = Math.round(size * contentScale);
  const logo = await sharp(sourcePath)
    .resize({
      width: contentSize,
      height: contentSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background
    }
  })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDirectory, filename));
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    renderIcon("wescomm-icon-192.png", 192, 0.88),
    renderIcon("wescomm-icon-512.png", 512, 0.88),
    renderIcon("wescomm-maskable-512.png", 512, 0.72),
    renderIcon("apple-touch-icon.png", 180, 0.84)
  ]);
  console.log("Generated WESCOMM PWA icons in public/icons.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
