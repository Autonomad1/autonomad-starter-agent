// Training: the five exam skills, with practice bookings made as your agent.
// Follows reference/training-and-certification.md of the Autonomad skill.
//
// Until you are certified every booking made as your agent is PRACTICE: it is
// simulated, reaches no supplier and charges no card. Practice travelers are
// named "practice-<label>"; the same label is the same traveler.
//
//   completed_stay          book -> read bookings (not cancelled by property) -> check in -> check out
//   cancelled               book -> cancel; repeat the terms exactly (meta.refund_expected, meta.policy)
//   chose_from_options      search (2+ results) -> book one of them, overlapping dates
//   rebooked                after a cancel, book the SAME traveler again, overlapping dates
//   recovered_a_disruption  keep reading bookings; when one is "supplier_cancelled", rebook that traveler
//
// Rules this file keeps:
//   - Unknown is not none: a 503 or an unreadable answer is retried, never read as "nothing".
//   - Never book again after an unknown outcome: read GET /v1/bookings first.

import { rest, describe, sleep, UnknownOutcome } from "./http.js";
import { PRACTICE_CITY, PRACTICE_COUNTRY } from "./config.js";

const SKILLS = ["completed_stay", "cancelled", "chose_from_options", "rebooked", "recovered_a_disruption"];
const MAX_BOOKINGS = 20; // practice bookings this run may make; the sandbox keeps 50 per agent

function isoDay(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function getCertification(agent) {
  for (let attempt = 1; ; attempt++) {
    const r = await rest("GET", `/v1/agents/${encodeURIComponent(agent.did)}/certification`, { agent });
    if (r.ok) return r.body?.data ?? r.body;
    if (r.status >= 500 && attempt < 5) { await sleep(3000 * attempt); continue; }
    // Unknown, not false.
    throw new Error(`could not read certification status (${describe(r)}); this is unknown, not "not certified"`);
  }
}

export function outstandingOf(cert) {
  if (Array.isArray(cert?.outstanding)) return new Set(cert.outstanding);
  const shown = new Set(cert?.demonstrated || []);
  return new Set(SKILLS.filter((s) => !shown.has(s)));
}

class Trainer {
  constructor(agent, state, save) {
    this.agent = agent;
    this.state = state;
    this.save = save;
    this.checkIn = isoDay(60);
    this.checkOut = isoDay(63);
    // reservation_id -> practice traveler label. Kept locally because a
    // booking's traveler is ours to remember; the sandbox matches by label.
    this.state.practice = this.state.practice || { travelers: {}, replaced: [], counter: 0, booked: 0 };
    this.p = this.state.practice;
    this.results = [];
    this.pick = 0;
  }

  nextLabel() {
    this.p.counter += 1;
    this.save();
    return `practice-t${this.p.counter}`;
  }

  async search() {
    const body = { city: PRACTICE_CITY, country: PRACTICE_COUNTRY, check_in: this.checkIn, check_out: this.checkOut, adults: 1 };
    const r = await rest("POST", "/v1/availability/search", { body, agent: this.agent, write: false });
    if (!r.ok) throw new Error(`search failed (${describe(r)}); unknown, not "no hotels" — try again shortly`);
    const rows = Array.isArray(r.body?.data) ? r.body.data : (r.body?.data?.results || r.body?.data?.hotels || []);
    const ids = [...new Set(rows.map((h) => h.property_id).filter(Boolean))];
    if (ids.length < 2) {
      throw new Error(`search returned ${ids.length} properties; chose_from_options needs 2 or more. Try another PRACTICE_CITY.`);
    }
    this.results = ids;
    return ids;
  }

  async listBookings() {
    const r = await rest("GET", "/v1/bookings", { agent: this.agent });
    if (!r.ok) throw new Error(`could not read bookings (${describe(r)}); unknown, not "none"`);
    return Array.isArray(r.body?.data) ? r.body.data : [];
  }

  /**
   * Book one practice stay. Searches first (each search justifies one booking).
   * If the outcome is unknown, reads the bookings list before doing anything else.
   */
  async book(label) {
    if (this.p.booked >= MAX_BOOKINGS) throw new Error(`stopped after ${MAX_BOOKINGS} practice bookings`);
    await this.search();
    const property_id = this.results[this.pick++ % this.results.length];
    const before = new Set((await this.listBookings()).map((b) => b.reservation_id));
    const body = {
      property_id,
      agent_did: this.agent.did,
      room_type: "standard",
      check_in: this.checkIn,
      check_out: this.checkOut,
      traveler_id: label,
    };

    let r;
    try {
      r = await rest("POST", "/v1/bookings", { body, agent: this.agent, write: true });
    } catch (err) {
      if (!(err instanceof UnknownOutcome)) throw err;
      r = null;
    }
    const unknown = !r || r.status >= 500 || r.body?.code === "booking_outcome_unknown";
    if (unknown) {
      // NEVER book again on an unknown outcome. Read first.
      console.log(`    booking outcome unknown${r ? ` (${describe(r)})` : ""}; reading bookings before anything else`);
      await sleep(3000);
      const after = await this.listBookings();
      const found = after.find((b) => !before.has(b.reservation_id) && b.property_id === property_id && b.check_in === this.checkIn);
      if (!found) throw new Error("the booking's outcome is unknown and it is not in the bookings list yet; stopping rather than booking twice. Run again later.");
      r = { ok: true, status: 201, body: { data: found } };
    }
    if (!r.ok) throw new Error(`practice booking refused (${describe(r)})`);

    const res = r.body.data;
    this.p.travelers[res.reservation_id] = label;
    this.p.booked += 1;
    this.save();
    const note = r.body?.meta?.property_verified === false ? " (property could not be verified; accepted anyway)" : "";
    console.log(`    booked ${label} at ${property_id} -> ${res.reservation_id}${note}`);
    return res;
  }

  async action(id, verb) {
    const r = await rest("POST", `/v1/bookings/${encodeURIComponent(id)}/${verb}`, { agent: this.agent, write: true });
    return r;
  }
}

/**
 * Run the exam until certified. Returns the final certification status.
 */
export async function train(agent, state, save, { onProgress } = {}) {
  const t = new Trainer(agent, state, save);
  let cert = await getCertification(agent);
  if (cert?.certified) return cert;

  for (let round = 1; round <= 25; round++) {
    const todo = outstandingOf(cert);
    if (todo.size === 0) break;
    console.log(`  round ${round}: outstanding ${[...todo].join(", ")}`);

    // Always look at what we have first: the property may have cancelled a stay.
    const bookings = await t.listBookings();
    const ours = bookings.filter((b) => t.p.travelers[b.reservation_id]);
    const disrupted = ours.find((b) => b.status === "supplier_cancelled" && !t.p.replaced.includes(b.reservation_id));

    if (disrupted) {
      // 3.5 recovered_a_disruption: same traveler, overlapping dates.
      const label = t.p.travelers[disrupted.reservation_id];
      console.log(`  ${disrupted.reservation_id} was cancelled by the property (${disrupted.disruption || "no note"}); rebooking ${label}`);
      await t.book(label);
      t.p.replaced.push(disrupted.reservation_id);
      save();
    } else if (todo.has("chose_from_options") || todo.has("recovered_a_disruption")) {
      // 3.3: search (inside book) and book one of the results. New bookings are
      // also how a property cancellation turns up (about one in three).
      await t.book(t.nextLabel());
    } else if (todo.has("cancelled") || todo.has("rebooked")) {
      // 3.2 cancelled, then 3.4 rebooked for the same traveler.
      let target = ours.find((b) => b.status === "confirmed");
      if (!target) target = await t.book(t.nextLabel());
      const label = t.p.travelers[target.reservation_id];
      const r = await t.action(target.reservation_id, "cancel");
      if (r.ok) {
        const m = r.body?.meta || {};
        // Say exactly what the terms return. Never promise more.
        console.log(`    cancelled ${target.reservation_id}: refund_expected=${m.refund_expected}; terms: "${m.policy || "(none given)"}"`);
        t.p.replaced.push(target.reservation_id);
        save();
        await t.book(label);
      } else {
        console.log(`    cancel refused (${describe(r)}); reading bookings again`);
      }
    } else if (todo.has("completed_stay")) {
      // 3.1: only a stay the property did not cancel. We just read the list.
      let target = ours.find((b) => b.status === "confirmed");
      if (!target) { await t.book(t.nextLabel()); continue; }
      const ci = await t.action(target.reservation_id, "checkin");
      if (!ci.ok) { console.log(`    check-in refused (${describe(ci)}); reading bookings again`); continue; }
      const co = await t.action(target.reservation_id, "checkout");
      if (!co.ok) { console.log(`    check-out refused (${describe(co)})`); continue; }
      console.log(`    checked in and out of ${target.reservation_id}`);
    } else {
      break;
    }

    cert = await getCertification(agent);
    onProgress?.(cert);
    if (cert?.certified) return cert;
  }

  // All five done but not certified: the answer says why (e.g. no A2A check-in).
  return getCertification(agent);
}
