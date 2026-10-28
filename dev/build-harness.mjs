// Bundle the dev harness (real UI + fake obsidian) and a fixture vault into dev/out/.
// Serve it with `node e2e/serve.mjs` and open http://localhost:4174/index.html
// (?view=reader|story|library, ?mobile=1, ?seed=1, ?obsidian=dark, or any setting).
import esbuild from "esbuild";
import { copyFile, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildCss } from "../build-css.mjs";
import { MEDIA_FILES, MEDIA_TABLE, STORY, makeEpub } from "./fixtures.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dev/out");
const vault = path.join(out, "vault");

async function write(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await buildCss();

await esbuild.build({
  entryPoints: [path.join(root, "dev/harness.tsx")],
  bundle: true,
  outfile: path.join(out, "harness.js"),
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { obsidian: path.join(root, "dev/obsidian-browser.ts") },
  // Same as the plugin build: foliate's PDF module is never used.
  plugins: [
    {
      name: "stub-foliate-pdf",
      setup(build) {
        build.onResolve({ filter: /\/pdf\.js$/ }, (args) =>
          args.importer.includes("foliate-js") ? { path: args.path, namespace: "pdf-stub" } : undefined,
        );
        build.onLoad({ filter: /.*/, namespace: "pdf-stub" }, () => ({ contents: 'export const makePDF = () => { throw new Error("no pdf") };' }));
      },
    },
  ],
  sourcemap: "inline",
  logLevel: "warning",
});

await copyFile(path.join(root, "styles.css"), path.join(out, "styles.css"));
await copyFile(path.join(root, "dev/theme.css"), path.join(out, "theme.css"));
// A build stamp on the asset URLs keeps the browser from serving a stale bundle.
const v = Date.now();
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="theme.css?v=${v}"><link rel="stylesheet" href="styles.css?v=${v}"><title>R Reader harness</title></head>
<body><div id="root"></div><script src="harness.js?v=${v}"></script></body></html>`,
);

await write(path.join(vault, "Books/The Harbor Lantern.epub"), makeEpub());
await write(path.join(vault, "Stories/harbor.ark"), JSON.stringify(STORY));
await write(path.join(vault, "Assets/media.json"), JSON.stringify(MEDIA_TABLE));
for (const [p, svg] of Object.entries(MEDIA_FILES)) await write(path.join(vault, "Assets", p), svg);
await write(
  path.join(vault, "cover.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#1f3a5f"/>' +
    '<circle cx="150" cy="200" r="60" fill="#f2c14e"/></svg>',
);
console.log("dev/out ready");
