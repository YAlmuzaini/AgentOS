import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // Every suite talks to the same Postgres test database and truncates
    // between tests, so they must not interleave.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  plugins: [
    // esbuild does not emit decorator metadata, which Nest's DI relies on.
    // SWC does, so the container resolves constructor types under test exactly
    // as it does under `nest start`.
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2023",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
