// Two keys, both kept locally:
//  - an EVM wallet (secp256k1). It proves who you are at registration, signs
//    every A2A bus request, and is where $NOMD is paid.
//  - an Ed25519 key pair for signing booking mandates. Only the PUBLIC half is
//    sent to Autonomad (`public_key` on register_agent), so the private half
//    never appears in any response or transcript.

import { generateKeyPairSync } from "node:crypto";
import { Wallet } from "ethers";
import { PUBLIC_KEY } from "./config.js";

function b64urlToHex(s) {
  return Buffer.from(s, "base64url").toString("hex");
}

export function ensureKeys(state) {
  let changed = false;

  if (!state.wallet?.privateKey) {
    const w = Wallet.createRandom();
    state.wallet = { address: w.address, privateKey: w.privateKey };
    changed = true;
  }

  if (PUBLIC_KEY) {
    if (!/^[0-9a-f]{64}$/.test(PUBLIC_KEY)) {
      throw new Error("AUTONOMAD_PUBLIC_KEY must be 64 hex characters (a raw Ed25519 public key).");
    }
    if (state.ed25519?.publicKey !== PUBLIC_KEY) {
      // Bring-your-own: we hold only the public half.
      state.ed25519 = { publicKey: PUBLIC_KEY, privateKey: null, broughtOwn: true };
      changed = true;
    }
  } else if (!state.ed25519?.publicKey) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ format: "jwk" });
    const priv = privateKey.export({ format: "jwk" });
    state.ed25519 = { publicKey: b64urlToHex(pub.x), privateKey: b64urlToHex(priv.d), broughtOwn: false };
    changed = true;
  }

  return { wallet: new Wallet(state.wallet.privateKey), changed };
}
