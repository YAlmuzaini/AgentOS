import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Compile the shared contracts from source so the web app never has to
      // consume the CommonJS build the API uses.
      "@agentos/shared": path.resolve(here, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
});
