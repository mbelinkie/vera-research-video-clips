import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import {
  managedResearchPlugin,
  managedResearchProxyOptions,
} from "./managed-proxy.ts";

const managed = process.env.VERA_RUNTIME_MODE === "managed-local";
if (
  managed &&
  (process.env.NODE_ENV === "production" ||
    process.env.CLOUD_AUTH_MODE !== "development" ||
    process.env.LOCAL_AGENT_HOST !== "127.0.0.1" ||
    process.env.CLOUD_API_HOST !== "127.0.0.1" ||
    process.env.VITE_MANAGED_RESEARCH !== "true")
)
  throw new Error(
    "Managed Research Vite is restricted to development loopback.",
  );
const webPort = Number(process.env.WEB_PORT ?? 43_112);
const proxySettings = {
  authorization: process.env.MANAGED_RESEARCH_AUTHORIZATION ?? "",
  csrf: process.env.MANAGED_RESEARCH_CSRF ?? "",
  webPort,
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    react(),
    ...(managed ? [managedResearchPlugin(proxySettings)] : []),
  ],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    cors: { origin: `http://127.0.0.1:${webPort}` },
    proxy: {
      "/local-agent": managed
        ? managedResearchProxyOptions(
            `http://127.0.0.1:${process.env.LOCAL_AGENT_PORT ?? 43110}`,
            proxySettings,
          )
        : {
            target: "http://127.0.0.1:43110",
            changeOrigin: false,
            rewrite: (path) => path.replace(/^\/local-agent/, ""),
          },
      "/cloud-api": managed
        ? managedResearchProxyOptions(
            `http://127.0.0.1:${process.env.CLOUD_API_PORT ?? 43111}`,
            proxySettings,
          )
        : {
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
