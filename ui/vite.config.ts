import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// `bun run ui:dev` proxies the API to a running `conductor ui` (default 4224),
// so the SPA can develop against live pipeline state.
const API = process.env.CONDUCTOR_API ?? "http://127.0.0.1:4224";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), reactRouter()],
  server: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
    },
  },
});
