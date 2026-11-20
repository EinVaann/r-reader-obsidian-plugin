import { promises as fs } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Obsidian loads a single `styles.css` from the plugin root. We keep the CSS
// split into readable partials under `styles/` and concatenate them — in
// numeric filename order — into that one file. Plain concatenation (no CSS
// transform) keeps the embedded base64 font data URIs byte-for-byte intact.

const root = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(root, "styles");
const outFile = path.join(root, "styles.css");

/** The shadcn components' Tailwind utilities (rr: prefix, no preflight), compiled from styles/tailwind.css. */
function tailwind() {
  // Run the CLI script with node: the .bin shim is a shell script, which execFileSync can't start on Windows.
  const cli = path.join(root, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
  return execFileSync(process.execPath, [cli, "-i", path.join(stylesDir, "tailwind.css"), "--optimize"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export async function buildCss() {
  const entries = (await fs.readdir(stylesDir))
    .filter((f) => f.endsWith(".css") && f !== "tailwind.css")
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const parts = [];
  for (const file of entries) {
    parts.push(await fs.readFile(path.join(stylesDir, file), "utf8"));
  }
  // Last, so a component's own classes beat the older partials.
  parts.push(tailwind());
  entries.push("tailwind.css (compiled)");

  // Join with a blank line; partials already end in newlines, so trim the
  // seams to avoid runaway blank lines, then end with a single trailing newline.
  const css = parts.map((p) => p.replace(/\s+$/, "")).join("\n\n") + "\n";
  await fs.writeFile(outFile, css);
  return entries;
}

// Allow running directly: `node build-css.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await buildCss();
  console.log(`styles.css ← ${files.join(", ")}`);
}
