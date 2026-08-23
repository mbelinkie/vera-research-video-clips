import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 43_112,
    proxy: {
      "/local-agent": {
        target: "http://127.0.0.1:43110",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/local-agent/, ""),
      },
      "/cloud-api": {
        target: "http://127.0.0.1:43111",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/cloud-api/, ""),
      },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
