import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const here = join(dirname(fileURLToPath(import.meta.url)), "..");
export const harness = join(here, "..");
export const plugin = join(harness, "..");
