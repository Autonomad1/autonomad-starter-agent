// Endpoints and settings. Everything here can be overridden with an env var,
// but the defaults are Autonomad production.

export const MCP_URL = process.env.AUTONOMAD_MCP_URL || "https://mcp.autonomad.ai/mcp?agentMode=true";
export const API_URL = process.env.AUTONOMAD_API_URL || "https://api.autonomad.ai";
export const BUS_URL = process.env.AUTONOMAD_BUS_URL || "https://www.autonomad.ai/api/a2a/v1/a2a";

export const STATE_FILE = process.env.AGENT_STATE_FILE || ".agent-state.json";

export const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim();
export const PRINCIPAL_DID = (process.env.PRINCIPAL_DID || "").trim();
export const REFERRED_BY = (process.env.REFERRED_BY || "").trim();

// Optional: bring your own Ed25519 public key (64 hex characters). If unset,
// a key pair is generated locally and kept in the state file.
export const PUBLIC_KEY = (process.env.AUTONOMAD_PUBLIC_KEY || "").trim().toLowerCase();

// Where the practice stays happen. Any city works; the search must return at
// least two hotels for the `chose_from_options` skill.
export const PRACTICE_CITY = process.env.PRACTICE_CITY || "Lisbon";
export const PRACTICE_COUNTRY = process.env.PRACTICE_COUNTRY || "PT";
