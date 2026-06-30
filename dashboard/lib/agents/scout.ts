// Scout — echte agent-loop. Vindt + kwalificeert leads met oordeel.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import type { Task } from "./types";

interface DiscoverPayload { cities?: string[]; categories?: string[] }

export async function runScout(task: Task): Promise<void> {
  const def = AGENT_DEFS.scout;
  const payload: DiscoverPayload = task.payload ? JSON.parse(task.payload) : {};
  const cities = payload.cities?.length ? payload.cities : ["krakow"];
  const categories = payload.categories?.length ? payload.categories : ["plumber", "roofing_contractor"];

  const system = buildSystem(
    "scout",
    `Werkwijze:
1. Gebruik places_search per (stad, categorie) uit je opdracht. Elke kandidaat krijgt een 'state' en 'likely_icp'-vlag mee.
2. ICP (breed): wij verkopen concept-websites aan ELK lokaal MKB-dienstverlenend bedrijf dat baat heeft bij een eigen site — vakmensen, maar net zo goed kappers, restaurants, tandartsen, garages, schoonheidssalons, fysio, lokale winkels met diensten, enz. Wijs ZONDER verder onderzoek af (likely_icp=false): groothandels, fabrikanten, leveranciers/distributeurs, ketens/grote filiaalbedrijven, banken, overheidsinstanties, tankstations, en puur online/B2B bedrijven die geen lokale klantensite nodig hebben.
3. RANGSCHIK op kansrijkheid. De BESTE prospect = GEEN of een DODE website + een GEZOND Google-profiel (genoeg reviews, redelijke rating, foto's). Die mag je direct 'keep'. Een lead zónder website afwijzen is FOUT — dat is juist je beste klant.
4. Heeft de kandidaat wel een website? Bekijk hem met fetch_website en beoordeel zelf:
   - LET OP: als fetch_website faalt (status null, note 'timeout'/'fetch mislukt'), betekent dat NIET automatisch een zwakke site — de site kan prima bestaan maar de bot blokkeren. Behandel 'onbereikbaar' als ONZEKER: niet automatisch 'keep'. Probeer eventueel place_details of zet de lead opzij i.p.v. te gokken.
   - Een werkende, moderne, mobielvriendelijke site (https + viewport + genoeg tekst + recente uitstraling) → 'reject' (die hebben ons niet nodig).
   - Een zwakke/verouderde/kapotte site, of alleen een Facebook/listing-pagina, of een google.com/business-URL (= geen echte site) → 'keep'.
5. qualify_lead met 'keep' of 'reject' + duidelijke reden. Wijs ook af: te weinig reviews (<10) of permanent gesloten.
6. Voor 'keep'-leads: find_email. Lukt dat niet (bv. geen website om te scrapen), laat het zo — markeer in save_dossier dat dit een telefoon-lead is; verzin GEEN e-mailadres.
7. Stop als de opdracht klaar is of je budget op is. Post een handoff aan de Manager met wat je vond.
Wees zuinig: focus op de meest kansrijke kandidaten, onderzoek niet eindeloos.`
  );

  await runAgentLoop({
    agent: "scout",
    system,
    userPrompt: `Opdracht: vind en kwalificeer leads in steden [${cities.join(", ")}] voor categorieën [${categories.join(", ")}]. Begin met places_search.`,
    tools: def.tools,
    model: def.model,
    taskId: task.id,
    budgetTokens: def.budgetTokens,
    maxIterations: def.maxIterations,
    maxTokensPerTurn: def.maxTokensPerTurn,
  });
}
