// Writer — echte agent-loop. Schrijft de Poolse outreach-copy en zet de mail
// klaar voor menselijke goedkeuring. Verstuurt nooit zelf.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import { getLeadById } from "../db";
import type { Task } from "./types";

export async function runWriter(task: Task): Promise<void> {
  const placeId = task.lead_place_id;
  if (!placeId) throw new Error("write_email-taak zonder lead_place_id");
  const def = AGENT_DEFS.writer;
  const lead = getLeadById(placeId);

  const system = buildSystem(
    "writer",
    `Werkwijze voor deze ene lead:
1. get_lead om bedrijf, niche, stad, reviews en de gebouwde site te zien.
2. Heeft de lead geen e-mail? Gebruik find_email.
3. set_email_copy: schrijf korte, persoonlijke, natuurlijke Poolse copy (branche, niche, hero-titel/sub, CTA, korte bedrijfsnaam). Geen overdrijving, geen spam-woorden. De template zorgt voor opmaak, screenshot, prijs en GDPR-voetnoot — jij levert de overtuigende tekst + je eigen kwaliteitsoordeel.
De mail komt in de goedkeur-wachtrij; jij verstuurt niets.`
  );

  await runAgentLoop({
    agent: "writer",
    system,
    userPrompt: `Stel de outreach-mail op voor lead "${lead?.name ?? placeId}" (${lead?.category_query}, ${lead?.city_query}). place_id=${placeId}.`,
    tools: def.tools,
    model: def.model,
    taskId: task.id,
    leadPlaceId: placeId,
    budgetTokens: def.budgetTokens,
    maxIterations: def.maxIterations,
    maxTokensPerTurn: def.maxTokensPerTurn,
  });
}
