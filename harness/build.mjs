import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
export const dist = join(here, "dist");

const options = {
  entryPoints: { harness: join(here, "src/main.tsx") },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome120",
  jsx: "automatic",
  sourcemap: true,
  logLevel: "info",
  loader: { ".woff2": "file", ".svg": "dataurl" },
  alias: { "@get-bb/plugin-sdk/app": join(here, "src/sdk.tsx"), "@": root },
  nodePaths: [join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
};

export async function buildHarness() {
  await mkdir(dist, { recursive: true });
  await build(options);
  await copyFile(join(here, "index.html"), join(dist, "index.html"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--serve")) {
    await mkdir(dist, { recursive: true });
    await copyFile(join(here, "index.html"), join(dist, "index.html"));
    const watcher = await context(options);
    await watcher.watch();
    const { port } = await watcher.serve({ servedir: dist, port: Number(process.env.PORT ?? 4173) });
    console.log(`Scenarios: http://127.0.0.1:${port}/`);
  } else {
    await buildHarness();
  }
}
