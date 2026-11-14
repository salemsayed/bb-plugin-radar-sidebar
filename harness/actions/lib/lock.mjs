import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => socket.destroy());
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.off("error", reject);
      server.unref();
      resolve(server);
    });
  });
}

function holderOf(file) {
  try { return readFileSync(file, "utf8").trim() || "an unknown run"; } catch { return "an unknown run"; }
}

export async function holdRunLock({ port, file, holder, log, pollMs = 2000 }) {
  let told = false;
  for (;;) {
    try {
      const server = await listen(port);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${holder}\n`);
      return server;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
    if (!told) {
      log(`waiting: another panel actions harness run holds the lock on port ${port} (${holderOf(file)})`);
      told = true;
    }
    await sleep(pollMs);
  }
}
