const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const assetDirectory = path.join(__dirname, "..", "public", "assets", "wup shop assets");
const cardWidth = 640;

async function main() {
  const names = (await fs.readdir(assetDirectory)).filter((name) => name.toLowerCase().endsWith(".png"));
  let sourceBytes = 0;
  let fullBytes = 0;
  let cardBytes = 0;

  for (const name of names) {
    const source = path.join(assetDirectory, name);
    const stem = name.slice(0, -4);
    const full = path.join(assetDirectory, `${stem}.webp`);
    const card = path.join(assetDirectory, `${stem}-card.webp`);
    const input = sharp(source).rotate();

    await input.clone().webp({ quality: 85, effort: 6 }).toFile(full);
    await input.clone().resize({ width: cardWidth, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toFile(card);

    sourceBytes += (await fs.stat(source)).size;
    fullBytes += (await fs.stat(full)).size;
    cardBytes += (await fs.stat(card)).size;
  }

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  console.log(`${names.length} product images: ${mb(sourceBytes)} MB PNG, ${mb(fullBytes)} MB full WebP, ${mb(cardBytes)} MB card WebP.`);

  const logoSource = path.join(__dirname, "..", "public", "assets", "wescomm-logo.png");
  const logoTarget = path.join(__dirname, "..", "public", "assets", "wescomm-logo.webp");
  const logoUiTarget = path.join(__dirname, "..", "public", "assets", "wescomm-logo-ui.webp");
  await sharp(logoSource).webp({ lossless: true, effort: 6 }).toFile(logoTarget);
  await sharp(logoSource).resize({ width: 480 }).webp({ lossless: true, effort: 6 }).toFile(logoUiTarget);
  console.log(`Logo: ${mb((await fs.stat(logoSource)).size)} MB PNG, ${mb((await fs.stat(logoTarget)).size)} MB full WebP, ${mb((await fs.stat(logoUiTarget)).size)} MB UI WebP.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
