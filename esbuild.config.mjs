import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { watch } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCss } from "./build-css.mjs";

const prod = process.argv[2] === "production";

// Concatenate the CSS partials in styles/ into the single styles.css Obsidian loads.
await buildCss();

// foliate-js's own PDF support (pdf.js) uses top-level await, which can't be
// bundled into a CommonJS file. We never hand foliate a PDF (we render PDFs
// with our own pdfjs-based reader), so stub that module out.
const stubFoliatePdf = {
  name: "stub-foliate-pdf",
  setup(build) {
    build.onResolve({ filter: /\/pdf\.js$/ }, (args) => {
      if (args.importer.includes("foliate-js")) {
        return { path: args.path, namespace: "foliate-pdf-stub" };
      }
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "foliate-pdf-stub" }, () => ({
      contents:
        "export const makePDF = () => { throw new Error('PDF handled by r-reader, not foliate'); };",
      loader: "js",
    }));
  },
};

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  plugins: [stubFoliatePdf],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
  // Rebuild styles.css whenever a partial under styles/ changes.
  const stylesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "styles");
  watch(stylesDir, { persistent: true }, () => {
    void buildCss().then(() => console.log("styles.css rebuilt")).catch((e) => console.error(e));
  });
}
