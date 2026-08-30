import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@netslum/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@netslum/sandbox": fileURLToPath(new URL("./packages/sandbox/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["{apps,packages,workers}/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] }
  }
});
