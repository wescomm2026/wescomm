// Generates app/theme-dark-compat.css: dark-mode equivalents for the literal
// color utilities (bg-white, text-[#17211b], border-red-200, ...) used across
// the frontend, so older screens follow the dark theme without rewriting every
// className. New UI should use the semantic tokens (bg-card, text-foreground...).
//
//   node scripts/generate-dark-compat.mjs          write the stylesheet
//   node scripts/generate-dark-compat.mjs --check  fail if it is out of date (prebuild)
//
// Each rule has the same specificity as the Tailwind utility it replaces and is
// loaded after Tailwind, so hover/focus/disabled utilities still win as usual.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const palette = require("tailwindcss/colors");
const OUTPUT = "app/theme-dark-compat.css";
const ROOTS = ["app", "components", "lib"];

// ---------------------------------------------------------------- scanning
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
  }
}
ROOTS.forEach(walk);
files.sort();

const PROPERTIES = {
  bg: "background-color",
  text: "color",
  border: "border-color",
  "border-t": "border-top-color",
  "border-r": "border-right-color",
  "border-b": "border-bottom-color",
  "border-l": "border-left-color",
  "border-x": "border-inline-color",
  "border-y": "border-block-color",
  ring: "--tw-ring-color",
  "ring-offset": "--tw-ring-offset-color",
  outline: "outline-color",
  divide: "border-color",
  fill: "fill",
  stroke: "stroke",
  placeholder: "color",
  accent: "accent-color",
  caret: "caret-color",
  decoration: "text-decoration-color",
  from: "--tw-gradient-from",
  via: "--tw-gradient-stops",
  to: "--tw-gradient-to"
};
// Gradient stops reuse Tailwind's own custom properties so position utilities keep working.
const DECLARATION = {
  from: (value) => `--tw-gradient-from: ${value} var(--tw-gradient-from-position)`,
  via: (value) => `--tw-gradient-stops: var(--tw-gradient-from), ${value} var(--tw-gradient-via-position), var(--tw-gradient-to)`,
  to: (value) => `--tw-gradient-to: ${value} var(--tw-gradient-to-position)`
};
const PROP_PATTERN = Object.keys(PROPERTIES).sort((a, b) => b.length - a.length).join("|");
const PALETTE_NAMES = "white|black|gray|slate|zinc|neutral|stone|red|amber|yellow|green|emerald|blue|indigo|sky|orange|rose|lime|teal|cyan|purple|violet|pink";
const TOKEN_RE = new RegExp(
  `(?<![\\w\\-\\[&:])((?:[a-z0-9-]+:)*)(${PROP_PATTERN})-(?:\\[(#[0-9a-fA-F]{3,8})\\]|(${PALETTE_NAMES})(?:-(\\d{2,3}))?)(?:/(\\d{1,3}))?(?![\\w\\[\\-/])`,
  "g"
);

const tokens = new Map();
const lines = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  source.split("\n").forEach((line, index) => lines.push({ file, line: index + 1, text: line }));
  for (const match of source.matchAll(TOKEN_RE)) {
    const [token, variants, prop, hex, name, shade, alpha] = match;
    if (!tokens.has(token)) tokens.set(token, { variants: variants.split(":").filter(Boolean), prop, hex, name, shade, alpha });
  }
}

// ---------------------------------------------------------------- colors
function hexToRgb(hex) {
  let value = hex.replace("#", "");
  if (value.length <= 4) value = value.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function resolveHex(entry) {
  if (entry.hex) return entry.hex;
  if (entry.name === "white") return "#ffffff";
  if (entry.name === "black") return "#000000";
  const family = palette[entry.name];
  return family && entry.shade ? family[entry.shade] : null;
}

function family(h) {
  if (h < 15 || h >= 340) return "danger";
  if (h < 65) return "warning";
  if (h < 170) return "primary";
  if (h < 260) return "info";
  return "muted";
}

const token = (name, alpha = 1) => (alpha >= 1 ? `hsl(var(--${name}))` : `hsl(var(--${name}) / ${+alpha.toFixed(3)})`);

/** Dark-mode color for a literal color in a given role, or null to keep it. */
const GRAY_FAMILIES = new Set(["gray", "slate", "zinc", "neutral", "stone"]);

function darkColor(role, hex, alpha, paletteName) {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  // Near-black inks (e.g. #101820) and the gray families read as neutral even with a slight hue.
  const neutral = s < 0.3 || l > 0.985 || l < 0.15 || GRAY_FAMILIES.has(paletteName);
  const fam = family(h);
  // Pale green tints are selection/hover fills; alert tints keep a clearer wash.
  const tint = fam === "primary" ? (l >= 0.95 ? 0.08 : 0.14) : 0.13;

  if (role === "background") {
    if (l >= 0.985 && alpha >= 0.7) return token("card", alpha);              // white panels
    if (l >= 0.985) return null;                                               // white veils on colored areas
    if (l >= 0.88 && neutral) return token("surface-subtle", alpha);           // light grey/green fills
    if (l >= 0.8 && neutral) return token("muted", alpha);                     // tracks, skeletons
    if (l >= 0.8) return fam === "muted" ? token("muted", alpha) : token(fam, tint * alpha); // tinted notice boxes
    return null;                                                               // solid colors, dark bars, overlays
  }
  if (role === "text") {
    if (l >= 0.8) return null;                                                 // light text sits on dark fills
    if (neutral) return token(l < 0.25 ? "foreground" : "muted-foreground", alpha);
    if (fam === "muted") return token("foreground", alpha);
    return token(fam === "primary" ? "primary" : fam, alpha);
  }
  if (role === "border") {
    if (l >= 0.985 && alpha < 1) return null;                                  // white hairlines on dark fills
    if (l >= 0.7 && neutral) return token("border", alpha);
    if (l >= 0.7) return token(fam === "muted" ? "border" : fam, 0.35 * alpha);
    if (neutral) return token("border-strong", alpha);
    return token(fam === "muted" ? "border-strong" : fam, 0.6 * alpha);
  }
  if (role === "ring-offset") return l >= 0.8 ? token("background") : null;
  return null;
}

const ROLE = {
  bg: "background", text: "text", placeholder: "text", fill: "text", stroke: "text", caret: "text", decoration: "text", accent: "text",
  border: "border", "border-t": "border", "border-r": "border", "border-b": "border", "border-l": "border", "border-x": "border", "border-y": "border",
  ring: "border", outline: "border", divide: "border", "ring-offset": "ring-offset",
  from: "background", via: "background", to: "background"
};

// ---------------------------------------------------------------- selectors
const PSEUDO = {
  hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", "focus-within": ":focus-within",
  active: ":active", disabled: ":disabled", checked: ":checked", first: ":first-child", last: ":last-child"
};
const MEDIA = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
const ORDER = ["", ...Object.keys(MEDIA)];

const rules = new Map(ORDER.map((key) => [key, []]));
const skipped = [];
const mapped = new Set();

for (const [name, entry] of [...tokens.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const hex = resolveHex(entry);
  if (!hex) { skipped.push(`${name} (unknown color)`); continue; }
  const alpha = entry.alpha ? Number(entry.alpha) / 100 : 1;
  const value = darkColor(ROLE[entry.prop], hex, alpha, entry.name);
  if (!value) continue;

  let media = "";
  let pseudo = "";
  let ancestor = "";
  let unsupported = false;
  for (const variant of entry.variants) {
    if (MEDIA[variant]) media = variant;
    else if (PSEUDO[variant]) pseudo += PSEUDO[variant];
    else if (variant === "group-hover") ancestor = ".group:hover ";
    else if (variant === "placeholder") pseudo += "::placeholder";
    else unsupported = true;
  }
  if (entry.prop === "placeholder") pseudo += "::placeholder";
  if (unsupported) { skipped.push(`${name} (variant)`); continue; }

  let selector = `:where(html[data-theme="dark"]) ${ancestor}[class~="${name}"]${pseudo}`;
  if (entry.prop === "divide") selector += " > :not([hidden]) ~ :not([hidden])";
  const declaration = DECLARATION[entry.prop] ? DECLARATION[entry.prop](value) : `${PROPERTIES[entry.prop]}: ${value}`;
  rules.get(media).push(`  ${selector} { ${declaration}; }`);
  mapped.add(name);
}

// Solid brand/danger fills turn light in dark mode, so their literal white
// text and inverted icons switch to the dark foreground for contrast.
const contrastRules = [
  `  :where(html[data-theme="dark"]) :is([class~="bg-primary"], [class~="bg-danger"], [class~="bg-success"])[class~="text-white"] { color: hsl(var(--primary-foreground)); }`,
  `  :where(html[data-theme="dark"]) :is([class~="bg-primary"], [class~="bg-danger"], [class~="bg-success"]) [class~="text-white"] { color: hsl(var(--primary-foreground)); }`,
  `  :where(html[data-theme="dark"]) :is([class~="bg-primary"], [class~="bg-danger"]) .asset-icon-img { filter: brightness(0) !important; }`
];

// ---------------------------------------------------------------- output
let css = `/* GENERATED by scripts/generate-dark-compat.mjs from the className literals in
   app/, components/, and lib/. Do not edit by hand; run
   \`npm run theme:dark-compat\` after adding literal color classes.
   ${mapped.size} literal color classes mapped to dark-mode tokens. Screen only:
   printed pages always use the light theme. */
@media screen {
${contrastRules.join("\n")}
${rules.get("").join("\n")}
}
`;
for (const key of ORDER.slice(1)) {
  const list = rules.get(key);
  if (list.length) css += `\n@media screen and (min-width: ${MEDIA[key]}px) {\n${list.join("\n")}\n}\n`;
}

// Same-element conflicts: a mapped base color plus a responsive variant of the
// same property that is not mapped would let the base mapping win at that size.
const conflicts = [];
for (const { file, line, text } of lines) {
  const present = [...text.matchAll(TOKEN_RE)].map((m) => m[0]);
  for (const base of present.filter((t) => mapped.has(t) && !t.includes(":"))) {
    const prop = tokens.get(base).prop;
    const semantic = "primary|danger|warning|success|info|foreground|muted|card|background|surface-subtle|border|accent|transparent|current|inherit";
    const responsive = [...text.matchAll(new RegExp(`(?<![\\w-])(?:sm|md|lg|xl|2xl):${prop}-(?:${semantic})(?![\\w-]*-\\d)`, "g"))];
    if (responsive.length) conflicts.push(`${file}:${line} ${base} with ${responsive.map((m) => m[0]).join(", ")}`);
  }
}

if (process.argv.includes("--check")) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== css) {
    console.error(`${OUTPUT} is out of date. Run \`npm run theme:dark-compat\` and commit the result.`);
    process.exit(1);
  }
  console.log(`Dark-mode compatibility stylesheet is up to date (${mapped.size} classes).`);
} else {
  writeFileSync(OUTPUT, css);
  console.log(`Wrote ${OUTPUT}: ${mapped.size} classes mapped, ${tokens.size - mapped.size - skipped.length} kept as-is.`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
  if (conflicts.length) console.log(`Responsive conflicts to review:\n  ${conflicts.join("\n  ")}`);
}
