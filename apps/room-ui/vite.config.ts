import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const HUB = process.env.BOTHREAD_HUB ?? "http://127.0.0.1:4889";

// In dev, proxy the control plane + WebSocket to the local hub.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: HUB, changeOrigin: true },
      "/ws": { target: HUB.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
