import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * bb's own Inter, read from the installed bb app when there is one, so screenshots use the app's font
 * (without it the harness fell back to a system sans and every shot looked unlike bb). Nothing is copied
 * into the repo; without an installed bb the harness keeps the fallback stack.
 */
function bbInter(): Plugin {
  const find = (): string | null => {
    const machines = join(homedir(), ".bb-machines");
    if (!existsSync(machines)) return null;
    for (const machine of readdirSync(machines)) {
      const versions = join(machines, machine, "app-versions");
      if (!existsSync(versions)) continue;
      for (const version of readdirSync(versions).sort().reverse()) {
        const assets = join(versions, version, "node_modules/bb-app/app/dist/assets");
        const font = existsSync(assets) ? readdirSync(assets).find(name => /^inter-latin-wght-normal-.*\.woff2$/.test(name)) : undefined;
        if (font) return join(assets, font);
      }
    }
    return null;
  };
  const font = find();
  return {
    name: "bb-inter",
    configureServer(server) {
      server.middlewares.use("/bb-inter.woff2", (_req, res) => {
        if (!font) { res.statusCode = 404; res.end(); return; }
        res.setHeader("content-type", "font/woff2");
        res.end(readFileSync(font));
      });
    },
  };
}

// Visual harness for the Bots view: `npx vite --config harness/vite.config.ts`. Not part of the plugin build.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) } },
  server: { host: "127.0.0.1", strictPort: true },
  plugins: [bbInter()],
});
