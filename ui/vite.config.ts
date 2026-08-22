import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `bun run ui:dev` proxies the API to a running `cue ui` (default 4224),
// so the SPA can develop against live pipeline state.
const API = process.env.CUE_API ?? "http://127.0.0.1:4224";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), react({ compiler: true })],
  build: { outDir: "build/client" },
  server: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
    },
  },
});
