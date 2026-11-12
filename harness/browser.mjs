import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const CANDIDATES = [process.env.HARNESS_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];

export async function launch() {
  const executablePath = CANDIDATES.find(path => path && existsSync(path));
  if (!executablePath) throw new Error("No Chrome found. Set HARNESS_CHROME to a Chrome or Chromium binary.");
  return chromium.launch({ executablePath, headless: true });
}
