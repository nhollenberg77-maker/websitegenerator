// Scout — DETERMINISTISCH (geen LLM-loop). Kwalificatie is een checklist, geen
// oordeel: zoek → moet een eigen site hebben → site niet te sterk → e-mail
// vindbaar → juiste branche + gezond profiel. Zo stromen er gegarandeerd
// mailbare leads door (i.p.v. een goedkoop model dat "blijft nadenken").

import { searchNearby, CITIES } from "./places";
import { fetchWebsite } from "./web";
import { findContactEmail } from "../email-scraper";
import { isStrongSite, isLikelyIcp } from "./tools";
import { leadKnownState, upsertLead, markLeadQualified, rejectLead, recordRun, postMessage } from "./store";
import { getLeadById, setLeadContactEmail } from "../db";
import type { Task } from "./types";

interface DiscoverPayload { cities?: string[]; categories?: string[]; radius?: number; limitPerCategory?: number }

const MIN_REVIEWS = 10;
const MAX_QUALIFY_PER_RUN = 6;   // genoeg per ronde; de orchestrator maakt steeds nieuwe discover-taken
const MAX_FETCH_PER_RUN = 25;    // begrens dure website-fetches + e-mail-scrapes per ronde

export async function runScout(task: Task): Promise<void> {
  const startedAt = new Date().toISOString();
  const payload: DiscoverPayload = task.payload ? JSON.parse(task.payload) : {};
  const cities = payload.cities?.length ? payload.cities : ["krakow"];
  const categories = payload.categories?.length ? payload.categories : ["plumber", "electrician", "hair_care"];
  const radiusM = payload.radius ?? 30000;
  const limit = payload.limitPerCategory ?? 20;

  let scanned = 0, qualified = 0, fetched = 0;
  const rejReasons: Record<string, number> = {};
  const rej = (id: string, reason: string, key: string) => { rejectLead(id, reason); rejReasons[key] = (rejReasons[key] ?? 0) + 1; };

  outer:
  for (const city of cities) {
    const cinfo = CITIES[city.toLowerCase()];
    for (const category of categories) {
      let places;
      try { places = await searchNearby({ city, category, radiusM, limit }); }
      catch { continue; }

      for (const p of places) {
        if (qualified >= MAX_QUALIFY_PER_RUN || fetched >= MAX_FETCH_PER_RUN) break outer;
        const state = leadKnownState(p.place_id);
        if (state === "rejected") continue;
        if (state === "new") {
          upsertLead({ ...p, city_query: cinfo?.name ?? city, voivodeship: cinfo?.voivodeship ?? null, category_query: category });
        } else if (getLeadById(p.place_id)?.qualified) {
          continue; // al gekwalificeerd
        }
        scanned++;

        // 1) Branche-filter: duidelijk off-target → afwijzen (niet opnieuw bekijken).
        if (!isLikelyIcp(p.primary_type, p.types)) { rej(p.place_id, `off-target type: ${p.primary_type ?? "?"}`, "off-target"); continue; }
        // 2) Gezond profiel: genoeg reviews, niet permanent gesloten.
        if (p.business_status === "CLOSED_PERMANENTLY") { rej(p.place_id, "permanent gesloten", "gesloten"); continue; }
        if ((p.rating_count ?? 0) < MIN_REVIEWS) { rej(p.place_id, `te weinig reviews (${p.rating_count ?? 0})`, "weinig-reviews"); continue; }
        // 3) Moet een eigen website hebben (anders niet te mailen = geen doel).
        if (!p.website) { rej(p.place_id, "geen eigen website (niet mailbaar)", "geen-website"); continue; }

        // 4) Site ophalen: te sterk → afwijzen; onbereikbaar → overslaan (onzeker).
        fetched++;
        let sig;
        try { sig = await fetchWebsite(p.website); } catch { continue; }
        if (!sig.ok) continue; // onbereikbaar — laat onbeslist, mogelijk volgende ronde
        if (isStrongSite(sig)) { rej(p.place_id, `sterke moderne site (${sig.textLength} tekens)`, "sterke-site"); continue; }

        // 5) E-mail vindbaar? Geen adres → afwijzen (niet te benaderen).
        const email = await findContactEmail(p.website);
        if (!email) { rej(p.place_id, "geen vindbaar e-mailadres op de site", "geen-email"); continue; }

        // ✓ Mailbare prospect: zwakke bestaande site + e-mail + gezond profiel.
        const gbpScore = Math.min(10, Math.round((p.rating ?? 0) + Math.min(5, (p.rating_count ?? 0) / 30)));
        setLeadContactEmail(p.place_id, email);
        markLeadQualified(p.place_id, gbpScore, 6);
        qualified++;
      }
    }
  }

  const rejSummary = Object.entries(rejReasons).map(([k, n]) => `${k}:${n}`).join(", ") || "geen";
  const summary = `${qualified} gekwalificeerd (mailbaar), ${scanned} bekeken, ${fetched} sites gecheckt. Afgewezen — ${rejSummary}.`;
  recordRun({ agent: "scout", taskId: task.id, status: "ok", summary, reasoning: summary, model: "deterministisch (geen LLM)", startedAt });
  postMessage({ from: "scout", to: "manager", kind: "handoff", body: summary, taskId: task.id });
}
