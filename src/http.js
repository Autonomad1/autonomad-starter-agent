// A small fetch wrapper that is honest about what it does not know.
//
// - 429: the request was refused before it ran. Wait `retry_after_ms` and retry.
// - 503 / network error on a READ: unknown, not "none". Retry a few times.
// - 503 / network error on a WRITE: unknown outcome. We do NOT retry here;
//   the caller reads state first (see training.js, bookOnce).

import { API_URL } from "./config.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UnknownOutcome extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "UnknownOutcome";
    this.detail = detail;
  }
}

async function readBody(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text.slice(0, 500) }; }
}

export function retryAfterMs(res, body) {
  const fromBody = body?.retry_after_ms ?? body?.error?.data?.retry_after_ms ?? body?.data?.retry_after_ms;
  if (Number.isFinite(fromBody)) return fromBody;
  const h = Number(res?.headers?.get?.("retry-after"));
  return Number.isFinite(h) && h > 0 ? h * 1000 : 60_000;
}

/**
 * Call the Autonomad REST API.
 * @param {string} method
 * @param {string} path      e.g. "/v1/bookings"
 * @param {object} [opts]
 * @param {object} [opts.body]
 * @param {{did: string, credential: string}} [opts.agent]  sends x-agent-did / x-agent-credential
 * @param {boolean} [opts.write]  true for calls that change something (no blind retry on 5xx)
 * @returns {Promise<{status: number, ok: boolean, body: any}>}
 */
export async function rest(method, path, { body, agent, write = method !== "GET" } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (agent) {
    headers["x-agent-did"] = agent.did;
    headers["x-agent-credential"] = agent.credential;
  }

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (write) throw new UnknownOutcome(`${method} ${path}: no answer (${err.message})`);
      if (attempt >= 4) throw new UnknownOutcome(`${method} ${path}: no answer after ${attempt} tries (${err.message})`);
      await sleep(2000 * attempt);
      continue;
    }
    const json = await readBody(res);

    if (res.status === 429 && attempt < 4) {
      const wait = retryAfterMs(res, json);
      console.log(`    rate limited; waiting ${Math.round(wait / 1000)}s as asked`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500 && !write && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    return { status: res.status, ok: res.ok, body: json };
  }
}

/** A short, safe description of an error answer (never includes headers). */
export function describe(r) {
  const b = r.body || {};
  const msg = b.code || b.error?.code || b.error?.message || b.error || b.detail || b.message || JSON.stringify(b).slice(0, 200);
  return `${r.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
}
