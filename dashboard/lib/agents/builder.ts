// Builder — hybride: de AGENT doet het creatieve werk (de Poolse site-content
// schrijven, toegespitst op het bedrijf); de CODE garandeert de mechanische
// stappen (verrijken, HTML genereren, screenshot). Zo eindigt een build nooit
// "leeg" door narrate-and-stop — de grootste foutbron.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import { getLeadById, markSiteGenerated } from "../db";
import { setLeadEnrichment } from "./store";
import { placeDetails, photoProxyUrls } from "./places";
import { generateSiteForLead } from "../site-generator";
import { generateScreenshot, hasScreenshot } from "../screenshot";
import { postMessage, setSiteQuality } from "./store";
import type { Task } from "./types";

export async function runBuilder(task: Task): Promise<void> {
  const placeId = task.lead_place_id;
  if (!placeId) throw new Error("build_site-taak zonder lead_place_id");
  const def = AGENT_DEFS.builder;

  // 1) CODE garandeert verrijking (reviews + foto's) vóór het schrijven.
  let lead = getLeadById(placeId);
  if (!lead) throw new Error(`Lead ${placeId} niet gevonden`);
  if (!lead.enriched_at) {
    try {
      const details = await placeDetails(placeId);
      let refs: string[] = [];
      try { refs = lead.photo_refs ? (JSON.parse(lead.photo_refs) as string[]) : []; } catch { /* ignore */ }
      setLeadEnrichment(placeId, {
        reviewsJson: details?.reviews.length ? JSON.stringify(details.reviews) : null,
        description: details?.description || null,
        photoUrls: refs.length ? JSON.stringify(photoProxyUrls(refs)) : null,
      });
      lead = getLeadById(placeId) || lead;
    } catch { /* enrich is best-effort */ }
  }

  // 2) AGENT schrijft de content (het creatieve deel). Eén heldere opdracht.
  const system = buildSystem(
    "builder",
    `Jouw taak is ALLEEN het schrijven van de site-content via set_site_content. De site wordt daarna automatisch gegenereerd — jij hoeft niet te genereren of te screenshotten.

Voor deze lead (welk type bedrijf dan ook — kapper, restaurant, tandarts, garage, vakman, winkel, enz.):
1. get_lead om naam, type, stad, reviews en beschrijving te zien.
2. set_site_content: schrijf de VOLLEDIGE Poolse copy, toegespitst op DIT bedrijf en deze branche/stad — brand_name (volledige naam zonder rechtsvorm), category_label, hero-kop, intro, over-ons, diensten, highlights, faq, formulier-opties. Leid alles af uit naam/type/reviews. Geloofwaardig en concreet; verzin GEEN keurmerken/certificaten/garanties.
   → HORECA (restaurant/bistro/café/bakkerij): vul OOK cuisine, hours (leeg als onbekend) en menu (secties met passende gerechten + prijzen in zł) — verzin een plausibel, smakelijk menu.
   → KAPPER/BARBERSHOP/BEAUTY/NAGELS/TATTOO/SPA, ZORG (tandarts/fysio/kliniek) of WINKEL: vul OOK hours en een pricelist — passende diensten/behandelingen/aanbod met prijzen in zł (bv. 'Strzyżenie męskie — 60 zł'). Verzin plausibele posten op basis van type/naam/reviews; geen medische beloften of verzonnen keurmerken.
Roep set_site_content precies één keer aan met complete content, en stop dan. Hou je redenering kort.`
  );

  await runAgentLoop({
    agent: "builder",
    system,
    userPrompt: `Schrijf de site-content voor "${lead.name}" (${lead.category_query}, ${lead.city_query}). place_id=${placeId}.`,
    tools: def.tools,
    model: def.model,
    taskId: task.id,
    leadPlaceId: placeId,
    budgetTokens: def.budgetTokens,
    maxIterations: def.maxIterations,
    maxTokensPerTurn: def.maxTokensPerTurn,
  });

  // 2b) Content-garantie: schreef de agent geen content? Eén gerichte herkansing
  //     (i.p.v. meteen terugvallen op de generieke template).
  if (!getLeadById(placeId)?.site_content) {
    await runAgentLoop({
      agent: "builder", system,
      userPrompt: `Je hebt nog GEEN set_site_content aangeroepen voor "${lead.name}". Roep set_site_content nu één keer aan met de volledige Poolse content. Niet beschrijven — doen. place_id=${placeId}.`,
      tools: def.tools, model: def.model, taskId: task.id, leadPlaceId: placeId,
      budgetTokens: def.budgetTokens, maxIterations: 4, maxTokensPerTurn: def.maxTokensPerTurn,
    }).catch(() => {});
  }

  // 3) CODE genereert de site + screenshot — gegarandeerd, ongeacht of de agent
  //    het zelf had aangeroepen. Geen lege builds meer.
  const fresh = getLeadById(placeId) || lead;
  // Altijd (her)genereren — niet overslaan als het bestand bestaat, anders pakt
  // een herbouw nieuwe/gewijzigde content niet op.
  generateSiteForLead(fresh);
  markSiteGenerated(placeId);
  if (!hasScreenshot(placeId)) {
    await generateScreenshot(placeId).catch(() => {
      postMessage({ from: "builder", to: "manager", kind: "alert", body: `Screenshot mislukt voor "${fresh.name}" — de outreach-mail mist straks een voorbeeld-afbeelding.`, leadPlaceId: placeId });
    });
  }
  if (!fresh.site_content) {
    // Agent schreef geen content → site draait op de neutrale fallback.
    postMessage({ from: "builder", to: "manager", kind: "alert", body: `Site voor "${fresh.name}" gegenereerd zónder agent-content (fallback) — controleer met inspect_site.`, leadPlaceId: placeId });
  } else {
    setSiteQuality(placeId, 7, { note: "site-content door agent geschreven" });
  }
}
