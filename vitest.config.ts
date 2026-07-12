import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["src/tests/setup.ts"],
  },
  resolve: {
    alias: { obsidian: resolve(__dirname, "src/tests/mocks/obsidian.ts") },
  },
  esbuild: { target: "es2022" },
});
