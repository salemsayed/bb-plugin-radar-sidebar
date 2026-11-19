import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { dist } from "./build.mjs";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".map": "application/json" };

export function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://harness").pathname;
    const file = join(dist, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(done => server.listen(0, "127.0.0.1", () => done(server)));
}
