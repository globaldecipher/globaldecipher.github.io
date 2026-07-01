import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The Explorer is the /network-graph/ page, so Vite writes its entire output
// into the project's existing site/network-graph/ folder. The rest of the
// site is built by build.mjs and shouldn't be touched here.
export default defineConfig({
  plugins: [react()],
  base: "/network-graph/",
  build: {
    outDir: resolve(__dirname, "../../site/network-graph"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/d3") || id.includes("/node_modules/internmap")) return "d3";
          if (id.includes("/node_modules/maplibre-gl")) return "maplibre";
        }
      }
    }
  },
  server: {
    port: 4174,
    proxy: {
      "/api": "http://localhost:8787",
      "/media": "http://localhost:8787"
    }
  }
});
