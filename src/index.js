// Autonomad starter agent.
//
//   npm start          register -> check in on the A2A bus -> train -> certify -> status
//   npm run status     print status only
//   npm run duty       stay on duty: hold a signed tasks/peek open, forever
//
// Secrets (wallet key, Ed25519 private key, agent credential) live only in
// .agent-state.json, which is gitignored. Nothing here prints them.

import { loadState, saveState } from "./state.js";
import { ensureKeys } from "./keys.js";
import { register } from "./register.js";
import { Bus } from "./a2a.js";
import { train } from "./training.js";
import { showStatus } from "./status.js";
import { sleep } from "./http.js";

const args = new Set(process.argv.slice(2));
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  const state = loadState();
  const save = () => saveState(state);
  const { wallet, changed } = ensureKeys(state);
  if (changed) save();

  if (args.has("--status")) {
    if (!state.agent?.did) throw new Error("Not registered yet. Run `npm start` first.");
    await showStatus(state.agent);
    return;
  }

  console.log(`[1/5] Register  (wallet ${wallet.address}${state.ed25519.broughtOwn ? ", your own Ed25519 key" : ""})`);
  const agent = await register(state, wallet);
  save();

  const bus = new Bus(agent.did, wallet);

  if (args.has("--duty")) {
    await dutyLoop(bus);
    return;
  }

  console.log(`[2/5] Check in on the A2A bus  (${secs()})`);
  const peek = await bus.checkIn();
  console.log(`  on duty: ${peek.duty.on_duty}; ${peek.messages?.length || 0} message(s) waiting; check in every ${peek.duty.check_in_every_seconds}s to stay on duty`);
  for (const m of peek.messages || []) {
    if (m.direction === "out") console.log(`  message [${m.threadId}]: ${String(m.text).slice(0, 200)}`);
  }

  console.log(`[3/5] Train in the sandbox  (${secs()})`);
  const cert = await train(agent, state, save, {
    onProgress: (c) => console.log(`    demonstrated: ${(c.demonstrated || []).join(", ") || "none"}`),
  });

  console.log(`[4/5] Certification  (${secs()})`);
  if (cert?.certified) {
    console.log("  certified: true");
  } else {
    console.log(`  certified: ${cert?.certified}`);
    if (cert?.blocked || cert?.next_step) {
      console.log(`  ${JSON.stringify(cert.blocked || cert.next_step)}`);
      // The most common block: the check-in was not seen. Check in, read again.
      await bus.checkIn();
    }
    const ans = await bus.ask("What do I still need to do to be certified?");
    if (ans?.reply) console.log(`  Autonomad says: ${String(ans.reply).slice(0, 500)}`);
  }

  console.log(`[5/5] Status  (${secs()})`);
  await showStatus(agent);
  console.log(`\nDone in ${secs()}.`);
}

async function dutyLoop(bus) {
  console.log("On duty. Holding a signed tasks/peek open (Ctrl-C to stop).");
  const seen = new Set();
  for (;;) {
    try {
      const r = await bus.call("tasks/peek", { wait: 25 });
      if (r?.duty && !r.duty.on_duty) console.log("  check-in not recorded (unknown); retrying");
      for (const m of r?.messages || []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.direction === "out") console.log(`  [${m.threadId}] ${m.text}`);
      }
      if (!r?.has_more) await sleep(1000);
    } catch (e) {
      console.log(`  ${e.message}; retrying in 10s`);
      await sleep(10_000);
    }
  }
}

main().catch((e) => {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
});
