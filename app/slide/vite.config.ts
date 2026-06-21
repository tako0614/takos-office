import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Mounted under the unified Takos Office worker at /slide.
  base: "/slide/",
  plugins: [solid(), tailwindcss()],
  server: {
    // Wave M-C: LAN listen for hostname-based dev access (= takosumi
    // local-substrate Caddy が slide.takos.test → host.docker.internal:3002
    // で TLS 終端 + reverse proxy する前提)。 localhost access も影響受けない。
    host: true,
    port: 3002,
  },
});
