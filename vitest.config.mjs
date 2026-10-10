import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  // The real `obsidian` package ships types only; tests use a small runtime mock.
  resolve: { alias: { obsidian: fileURLToPath(new URL("./src/test/obsidian-mock.ts", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
