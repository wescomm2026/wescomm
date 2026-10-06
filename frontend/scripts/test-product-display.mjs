import assert from "node:assert/strict";
import {
  PRODUCT_PLACEHOLDER_IMAGE,
  isMissingProductPhoto,
  productDisplayName,
  resolveProductImage
} from "../lib/product-image.ts";
import { sortProductOptionValues } from "../lib/product-display.ts";

const templates = {
  "PE Uniform Top": "/assets/wup shop assets/pe-uniform-top.webp",
  "Senior High Men's Uniform Set": "/assets/wup shop assets/senior high boys set.webp"
};
const webp = (image) => image.replace(/\.png$/i, ".webp");
const resolve = (name, ownImage) => {
  const displayName = productDisplayName(name);
  return { name: displayName, image: resolveProductImage({ displayName, ownImage, templateImageByName: templates, optimizeLocalImage: webp }) };
};

// A product's own photo always wins, local or remote.
assert.deepEqual(resolve("CBA Women's Uniform", "/assets/wup shop assets/BSBA GIRL UNIFORM.png"), {
  name: "CBA Women's Uniform",
  image: "/assets/wup shop assets/BSBA GIRL UNIFORM.webp"
});
assert.deepEqual(resolve("PE Uniform top", "https://example.supabase.co/storage/top.webp"), {
  name: "PE Uniform top",
  image: "https://example.supabase.co/storage/top.webp"
});

// Legacy Boys/Girls rows keep their current Men's/Women's display names (exact names only).
assert.equal(productDisplayName("Senior High Boys Uniform Set"), "Senior High Men's Uniform Set");
assert.equal(productDisplayName("senior high girls skirt"), "Senior High Women's Skirt");
assert.equal(productDisplayName("WUP Girls Blouse Classic"), "WUP Women's Blouse");
assert.equal(productDisplayName("Wesleyan Slacks"), "WUP Slacks");

// Partial-name guessing is gone: new count-sheet items keep their own names.
for (const name of ["Senior High Men's Upper Uniform", "Nursing Female Uniform Cloth", "CAMS Uniform Cloth", "PE T-shirt (College)", "ID Lace", "PE Shirt"]) {
  assert.equal(productDisplayName(name), name);
}

// No photo of its own: an exact catalog template photo, otherwise the placeholder.
assert.equal(resolve("Senior High Boys Uniform Set", null).image, templates["Senior High Men's Uniform Set"]);
assert.equal(resolve("Nursing Female Uniform Cloth", null).image, PRODUCT_PLACEHOLDER_IMAGE);
assert.equal(resolve("Moss Green Polo Shirt", "/assets/uniforms.svg").image, PRODUCT_PLACEHOLDER_IMAGE);
assert.equal(resolve("Moss Green Polo Shirt", "   ").image, PRODUCT_PLACEHOLDER_IMAGE);

assert.equal(isMissingProductPhoto(null), true);
assert.equal(isMissingProductPhoto("/assets/id-accessories.svg"), true);
assert.equal(isMissingProductPhoto(PRODUCT_PLACEHOLDER_IMAGE), true);
assert.equal(isMissingProductPhoto("/assets/wup shop assets/elem pe shirt.webp"), false);

// Children's numbered sizes come first, then letter sizes in size order.
assert.deepEqual(
  sortProductOptionValues("Size", ["M", "#12", "XS", "#8", "L", "S", "#20", "2XL", "#10"]),
  ["#8", "#10", "#12", "#20", "XS", "S", "M", "L", "2XL"]
);
assert.deepEqual(sortProductOptionValues("Color", ["Red", "Blue"]), ["Red", "Blue"]);

console.log("Product display tests passed.");
