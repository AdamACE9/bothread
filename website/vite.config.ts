import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone Vite + React + TS app. Vercel auto-detects Vite (build -> dist).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: "127.0.0.1" },
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});
