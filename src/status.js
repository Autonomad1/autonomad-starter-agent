// Show where the agent stands: certification, duty, and the Platinum launch slot.

import { rest, describe } from "./http.js";
import { getCertification } from "./training.js";

const PROMO_TEXT = {
  certify_to_claim: "Get certified to claim it.",
  owner_to_confirm: "Certified. Your owner must confirm you from the email we sent them (\"Yes, this agent is mine\"; no card needed).",
  granted: "Granted.",
};

export async function showStatus(agent) {
  console.log("");
  console.log("== Your agent ==");
  console.log(`  DID:            ${agent.did}`);
  console.log(`  owner email:    ${agent.owner_email}`);

  let cert = null;
  try {
    cert = await getCertification(agent);
  } catch (e) {
    console.log(`  certification:  unknown (${e.message})`);
  }
  if (cert) {
    console.log(`  certified:      ${cert.certified}${cert.certified_at ? ` (at ${cert.certified_at})` : ""}`);
    if (cert.active !== undefined) console.log(`  active:         ${cert.active}`);
    if (Array.isArray(cert.demonstrated)) console.log(`  demonstrated:   ${cert.demonstrated.join(", ") || "none yet"}`);
    if (Array.isArray(cert.outstanding) && cert.outstanding.length) console.log(`  outstanding:    ${cert.outstanding.join(", ")}`);
    if (cert.blocked) console.log(`  blocked:        ${typeof cert.blocked === "string" ? cert.blocked : JSON.stringify(cert.blocked)}`);
    if (cert.next_step) console.log(`  next step:      ${typeof cert.next_step === "string" ? cert.next_step : JSON.stringify(cert.next_step)}`);
  }

  const ob = await rest("GET", `/v1/agents/${encodeURIComponent(agent.did)}/onboarding`, { agent });
  let promo = null;
  if (ob.ok) {
    const d = ob.body?.data || {};
    promo = d.promo || null;
    if (promo) {
      const status = promo.status || (promo.active ? "granted" : "unknown");
      console.log(`  Platinum slot:  ${status}${promo.active ? " (active)" : ""}`);
      if (PROMO_TEXT[status]) console.log(`                  ${PROMO_TEXT[status]}`);
    } else {
      console.log("  Platinum slot:  not shown in the onboarding answer");
    }
  } else {
    console.log(`  onboarding:     unknown (${describe(ob)}); run "npm run status" again shortly`);
  }

  const pr = await rest("GET", `/v1/agents/${encodeURIComponent(agent.did)}/profile`, { agent });
  if (pr.ok) {
    const duty = pr.body?.data?.duty;
    if (duty) console.log(`  on duty:        ${duty.on_duty} (last check-in ${duty.last_checked_in || "never"})`);
  }

  console.log("");
  if (cert?.certified) {
    console.log("You are certified. Live bookings are coming soon; until they open a live booking answers");
    console.log("`live_bookings_coming_soon` and nothing is booked or charged. Practice travelers are now refused.");
  }
  if (!promo?.active) {
    console.log(`Next: ask your owner to open the invitation sent to ${agent.owner_email} and press`);
    console.log("\"Yes, this agent is mine\". Certified + owner confirmed claims a Platinum slot while they last.");
  }
  console.log("Stay on duty with `npm run duty` (a signed check-in every few minutes on the A2A bus).");
  return { cert, promo };
}
