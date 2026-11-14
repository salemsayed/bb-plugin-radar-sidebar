import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { holdRunLock } from "./lock.mjs";

const folders = [];
const lockFile = () => {
  folders.push(mkdtempSync(join(tmpdir(), "harness-lock-")));
  return join(folders.at(-1), "run-lock");
};
after(() => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }); });

const freePort = () => new Promise(resolve => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

test("a second run waits for the first, says who holds the lock, then takes it", async () => {
  const port = await freePort();
  const file = lockFile();
  const lines = [];
  const first = await holdRunLock({ port, file, holder: "pid 1 since 07:00", log: line => lines.push(line) });
  let secondHeld = false;
  const second = holdRunLock({ port, file, holder: "pid 2", log: line => lines.push(line), pollMs: 20 }).then(server => { secondHeld = true; return server; });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(secondHeld, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^waiting: another panel actions harness run holds the lock on port \d+ \(pid 1 since 07:00\)$/);
  first.close();
  const server = await second;
  assert.equal(secondHeld, true);
  assert.equal(lines.length, 1);
  assert.equal(readFileSync(file, "utf8"), "pid 2\n");
  server.close();
});

test("a free lock is taken at once without a waiting line", async () => {
  const lines = [];
  const server = await holdRunLock({ port: await freePort(), file: lockFile(), holder: "pid 3", log: line => lines.push(line) });
  assert.deepEqual(lines, []);
  server.close();
});
