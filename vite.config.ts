import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "web",
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true, rollupOptions: { input: { app: resolve(__dirname, "web/app/index.html") } } },
});
