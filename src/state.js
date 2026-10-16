// Local state: your wallet key, your signing key and your agent credential.
// It never leaves this machine. The file is gitignored and written 0600.

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { STATE_FILE } from "./config.js";

export function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(STATE_FILE, 0o600); } catch { /* best effort on odd filesystems */ }
}
