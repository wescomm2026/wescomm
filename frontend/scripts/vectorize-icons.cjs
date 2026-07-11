const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  vectorizeRaw,
  optimize
} = require("@neplex/vectorizer");

const assetsDirectory = path.resolve(__dirname, "../public/assets");
const requestedIcons = process.argv.slice(2);
const excludedAssets = new Set(["wescomm-logo", "wescomm-landing-hero"]);

const iconNames = requestedIcons.length
  ? requestedIcons.map((name) => path.basename(name, path.extname(name)))
  : fs
      .readdirSync(assetsDirectory)
      .filter((name) => name.endsWith(".png"))
      .map((name) => path.basename(name, ".png"))
      .filter((name) => !excludedAssets.has(name));

function isBackgroundPixel(data, pixelIndex) {
  const offset = pixelIndex * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const minimum = Math.min(red, green, blue);
  const average = (red + green + blue) / 3;
  return alpha < 20 || (minimum > 225 && average > 235);
}

function removeConnectedBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueue = (pixelIndex) => {
    if (visited[pixelIndex] || !isBackgroundPixel(data, pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    queueStart += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const offset = pixelIndex * 4;
    data[offset + 3] = 0;

    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }
}

function removeEdgeFringe(data, width, height, passes = 4) {
  for (let pass = 0; pass < passes; pass += 1) {
    const remove = [];
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixelIndex = y * width + x;
        const offset = pixelIndex * 4;
        if (data[offset + 3] === 0 || !isBackgroundPixel(data, pixelIndex)) continue;

        const neighbors = [
          pixelIndex - 1,
          pixelIndex + 1,
          pixelIndex - width,
          pixelIndex + width
        ];
        if (neighbors.some((neighbor) => data[neighbor * 4 + 3] === 0)) {
          remove.push(offset);
        }
      }
    }
    remove.forEach((offset) => {
      data[offset + 3] = 0;
    });
  }
}

async function vectorizeIcon(name) {
  const inputPath = path.join(assetsDirectory, `${name}.png`);
  const outputPath = path.join(assetsDirectory, `${name}.svg`);

  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipped missing asset: ${name}.png`);
    return;
  }

  const { data, info } = await sharp(inputPath)
    .trim({ background: "#ffffff", threshold: 12 })
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .extend({ top: 12, right: 12, bottom: 12, left: 12, background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  removeConnectedBackground(data, info.width, info.height);
  removeEdgeFringe(data, info.width, info.height);

  const traced = await vectorizeRaw(
    data,
    { width: info.width, height: info.height },
    {
      colorMode: 0,
      hierarchical: 0,
      filterSpeckle: 8,
      colorPrecision: 8,
      layerDifference: 6,
      mode: 2,
      cornerThreshold: 60,
      lengthThreshold: 4,
      maxIterations: 2,
      spliceThreshold: 45,
      pathPrecision: 3
    }
  );
  const optimized = await optimize(traced, {
    multipass: true,
    multipassIterations: 3
  });

  fs.writeFileSync(outputPath, optimized);
  console.log(`${name}.svg (${Math.round(Buffer.byteLength(optimized) / 1024)} KB)`);
}

async function main() {
  for (const name of iconNames) {
    await vectorizeIcon(name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
