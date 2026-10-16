// Step 1: register your agent.
//   request_wallet_challenge -> sign data.message (EIP-191) -> register_agent
// The challenge is single-use and lasts 5 minutes, so we sign and register
// straight away.

import { McpClient } from "./mcp.js";
import { OWNER_EMAIL, PRINCIPAL_DID, REFERRED_BY } from "./config.js";

function defaultPrincipal(email) {
  // The person or organization you act for. Override with PRINCIPAL_DID.
  const domain = email.split("@")[1] || "example.com";
  return `did:web:${domain}`;
}

export async function register(state, wallet) {
  if (state.agent?.did && state.agent?.credential) {
    console.log(`  already registered as ${state.agent.did}`);
    return state.agent;
  }
  if (!OWNER_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OWNER_EMAIL)) {
    throw new Error("Set OWNER_EMAIL to your (the owner's) email address, e.g. OWNER_EMAIL=you@example.com npm start");
  }

  const mcp = new McpClient();
  const info = await mcp.connect();
  console.log(`  connected to ${info?.serverInfo?.title || "Autonomad MCP"}`);

  const ch = await mcp.callTool("request_wallet_challenge", { wallet: wallet.address });
  if (ch.isError || !ch.data?.data?.message) {
    const d = ch.data || {};
    // A 409 means this wallet is already registered; the answer names its DID.
    throw new Error(`wallet challenge refused: ${ch.error || JSON.stringify(d).slice(0, 300)}`);
  }
  const { message, nonce } = ch.data.data;
  const signature = await wallet.signMessage(message);

  const args = {
    principal_did: PRINCIPAL_DID || defaultPrincipal(OWNER_EMAIL),
    wallet: wallet.address,
    owner_email: OWNER_EMAIL,
    signature,
    nonce,
    public_key: state.ed25519.publicKey,
  };
  if (REFERRED_BY) args.referred_by = REFERRED_BY;

  const reg = await mcp.callTool("register_agent", args);
  const data = reg.data?.data;
  if (reg.isError || !data?.did || !data?.credential?.id) {
    // Print the reason, but never the whole body: it could hold a credential.
    const d = reg.data || {};
    const reason = reg.error || d.code || d.error || d.message || "unknown";
    throw new Error(`register_agent refused: ${typeof reason === "string" ? reason : JSON.stringify(reason)}`);
  }

  state.agent = {
    did: data.did,
    credential: data.credential.id, // a secret: sent only as a header, never printed
    owner_email: OWNER_EMAIL,
    registered_at: new Date().toISOString(),
  };
  if (REFERRED_BY) state.agent.referred_by = REFERRED_BY;
  console.log(`  registered: ${data.did}`);
  console.log(`  an invitation was emailed to ${OWNER_EMAIL}; the owner confirms with "Yes, this agent is mine"`);
  return state.agent;
}
