import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "cli/**/*.test.ts", "mail-router/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
