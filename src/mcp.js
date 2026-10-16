// A minimal MCP client for Autonomad's streamable-HTTP server (JSON-RPC 2.0).
// No SDK needed: initialize, send "initialized", then call tools.

import { MCP_URL } from "./config.js";

function parseSse(text) {
  // The server answers with Server-Sent Events: lines of "data: {json}".
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload) { try { out.push(JSON.parse(payload)); } catch { /* ignore keep-alives */ } }
    }
  }
  return out;
}

export class McpClient {
  constructor({ agentHeaders } = {}) {
    this.sessionId = null;
    this.nextId = 1;
    // Optional x-agent-did / x-agent-credential, sent on initialize so the
    // session acts as your agent without the credential entering a chat.
    this.agentHeaders = agentHeaders || {};
  }

  async #post(message, extraHeaders = {}) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(90_000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (message.id === undefined) return null; // a notification
    const ct = res.headers.get("content-type") || "";
    const msgs = ct.includes("text/event-stream") ? parseSse(text) : [JSON.parse(text || "null")];
    const reply = msgs.find((m) => m && m.id === message.id);
    if (!reply) throw new Error(`MCP: no answer to ${message.method} (HTTP ${res.status})`);
    return reply;
  }

  async connect() {
    const init = await this.#post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "autonomad-starter-agent", version: "0.1.0" },
      },
    }, this.agentHeaders);
    if (init.error) throw new Error(`MCP initialize failed: ${init.error.message}`);
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return init.result;
  }

  /**
   * Call a tool. Returns the parsed JSON of its text result, plus `isError`.
   */
  async callTool(name, args) {
    const reply = await this.#post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (reply.error) return { isError: true, error: reply.error.message, code: reply.error.code };
    const text = (reply.result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let data;
    try { data = JSON.parse(text); } catch { data = { text }; }
    return { isError: !!reply.result?.isError, data };
  }
}
