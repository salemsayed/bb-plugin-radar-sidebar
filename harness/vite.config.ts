import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Visual harness for the Bots view: `npx vite --config harness/vite.config.ts`. Not part of the plugin build.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) } },
  server: { host: "127.0.0.1", strictPort: true },
});
