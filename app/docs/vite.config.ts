import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Mounted under the unified Takos Office worker at /docs.
  base: "/docs/",
  plugins: [solidPlugin(), tailwindcss()],
  server: {
    // Wave M-C: LAN listen for hostname-based dev access (= takosumi
    // local-substrate Caddy が docs.takos.test → host.docker.internal:3001
    // で TLS 終端 + reverse proxy する前提)。 localhost access も影響受けない。
    host: true,
    port: 3001,
  },
  build: {
    target: "esnext",
  },
});
