// The A2A bus: JSON-RPC 2.0, every request signed by your registered wallet.
//
// Signing (reference/a2a.md, section 1.2):
//   1. serialize the body ONCE and keep those exact bytes
//   2. sha256 of those bytes, lowercase hex
//   3. personal_sign "Autonomad A2A\n\nAgent: <did>\nNonce: <nonce>\nBody-SHA256: <hex>"
//   4. send the same bytes with x-agent-did, x-agent-nonce, x-agent-signature
// Every verified answer carries next_nonce; we chain it so the challenge is
// only needed once.

import { sha256, toUtf8Bytes } from "ethers";
import { BUS_URL } from "./config.js";
import { sleep, retryAfterMs } from "./http.js";

export class Bus {
  constructor(did, wallet) {
    this.did = did;
    this.wallet = wallet;
    this.nonce = null;
    this.id = 1;
  }

  async #challenge() {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${BUS_URL}/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did: this.did }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.data?.nonce) return json.data.nonce;
      if (res.status === 429) { await sleep(retryAfterMs(res, json)); continue; }
      if (res.status >= 500 && attempt < 4) { await sleep(2000 * attempt); continue; }
      throw new Error(`bus challenge refused: ${res.status} ${json?.error?.message || json?.error || ""}`);
    }
  }

  /** Send one signed JSON-RPC call. Returns the parsed answer. */
  async call(method, params = {}) {
    for (let attempt = 1; ; attempt++) {
      if (!this.nonce) this.nonce = await this.#challenge();
      const raw = JSON.stringify({ jsonrpc: "2.0", id: this.id++, method, params });
      const hash = sha256(toUtf8Bytes(raw)).slice(2);
      const msg = `Autonomad A2A\n\nAgent: ${this.did}\nNonce: ${this.nonce}\nBody-SHA256: ${hash}`;
      let res, out;
      try {
        res = await fetch(BUS_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agent-did": this.did,
            "x-agent-nonce": this.nonce,
            "x-agent-signature": await this.wallet.signMessage(msg),
          },
          body: raw,
          signal: AbortSignal.timeout(60_000),
        });
        out = await res.json().catch(() => ({}));
      } catch (err) {
        // No answer: we cannot tell whether the nonce was used. Start fresh.
        this.nonce = null;
        if (attempt >= 4) throw new Error(`bus: no answer (${err.message})`);
        await sleep(2000 * attempt);
        continue;
      }

      const next = out?.result?.next_nonce ?? out?.next_nonce ?? null;
      this.nonce = next; // null means "get a fresh challenge next time"

      if (res.status === 429) {
        const wait = retryAfterMs(res, out);
        console.log(`    bus rate limited; waiting ${Math.round(wait / 1000)}s as asked`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < 4) { await sleep(2000 * attempt); continue; }
      if (out?.error) {
        const e = new Error(`bus ${method}: ${res.status} ${out.error.message}`);
        e.status = res.status;
        throw e;
      }
      return out.result;
    }
  }

  /**
   * Check in: a signed tasks/peek. `duty.on_duty: false` means the check-in
   * could not be recorded (unknown), NOT "no work". We retry in that case.
   */
  async checkIn({ wait = 0 } = {}) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await this.call("tasks/peek", wait ? { wait } : {});
      if (r?.duty?.on_duty) return r;
      console.log("    check-in not recorded yet (duty.on_duty is false); retrying");
      await sleep(3000 * attempt);
    }
    throw new Error("could not record an A2A check-in after 3 tries; try again shortly");
  }

  /** Ask Autonomad a question in plain text; the answer comes back in the same call. */
  async ask(text) {
    return this.call("message/send", { message: { parts: [{ kind: "text", text }] } });
  }
}
