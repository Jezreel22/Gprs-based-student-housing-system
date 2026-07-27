import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    alias: {
      // The `server-only` package is a Next convention; under Vitest we
      // alias it to a no-op so service-only modules can still load.
      "server-only": resolve(__dirname, "./tests/shims/server-only.ts"),
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "server-only": resolve(__dirname, "./tests/shims/server-only.ts"),
    },
  },
});