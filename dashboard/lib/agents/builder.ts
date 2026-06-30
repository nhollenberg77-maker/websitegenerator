// Builder — echte agent-loop met vision. Bouwt de concept-site en beoordeelt
// zijn eigen werk via de screenshot.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import { getLeadById } from "../db";
import type { Task } from "./types";

export async function runBuilder(task: Task): Promise<void> {
  const placeId = task.lead_place_id;
  if (!placeId) throw new Error("build_site-taak zonder lead_place_id");
  const def = AGENT_DEFS.builder;
  const lead = getLeadById(placeId);

  const system = buildSystem(
    "builder",
    `Werkwijze voor deze ene lead (welk type bedrijf dan ook — kapper, restaurant, tandarts, garage, vakman, winkel, enz.):
1. get_lead om de gegevens te zien; place_details / enrich_lead om reviews + foto's op te halen (verplicht vóór genereren).
2. set_site_content: schrijf de VOLLEDIGE Poolse copy, volledig toegespitst op DIT specifieke bedrijf en deze branche en stad — category_label, hero-kop, intro, over-ons, diensten, highlights, faq en formulier-opties. Leid de branche en diensten af uit de naam, het type en de reviews. Schrijf concreet en geloofwaardig; verzin GEEN keurmerken, certificaten of garanties die je niet kunt verifiëren.
   → Zet ALTIJD brand_name op de volledige bedrijfsnaam (zonder rechtsvorm) — dit is wat in het logo/de header komt; kap meerwoordige namen niet af (bv. "Kawiarnia Drukarnia", niet "Kawiarnia").
   → HORECA (restaurant/bistro/café/bakkerij): de site krijgt een eigen menu-template. Vul dan OOK 'cuisine' (type keuken), 'hours' (openingstijden, leeg laten als onbekend) en 'menu' (secties met passende gerechten + prijzen in zł). Verzin een plausibel, smakelijk menu dat past bij de naam/keuken/reviews — geen bouw-diensten.
3. generate_site → screenshot → view_screenshot: bekijk je eigen resultaat kritisch (spreekt het deze ondernemer aan? past de toon bij de branche?).
4. Niet goed genoeg of verkeerde branche-toon? Pas set_site_content aan en genereer opnieuw (max 1-2 keer; let op je budget).
5. set_site_quality met je eindoordeel. Post een handoff aan de Writer als de site klaar is.`
  );

  await runAgentLoop({
    agent: "builder",
    system,
    userPrompt: `Bouw de concept-site voor lead "${lead?.name ?? placeId}" (${lead?.category_query}, ${lead?.city_query}). place_id=${placeId}.`,
    tools: def.tools,
    model: def.model,
    taskId: task.id,
    leadPlaceId: placeId,
    budgetTokens: def.budgetTokens,
    maxIterations: def.maxIterations,
    maxTokensPerTurn: def.maxTokensPerTurn,
  });
}
