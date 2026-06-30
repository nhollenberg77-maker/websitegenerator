// Writer — de AGENT schrijft de persoonlijke Poolse copy; de CODE garandeert dat
// er een concept in de wachtrij komt (of dat een lead zonder e-mail zichtbaar
// wordt geparkeerd). Verstuurt nooit zelf. Zelfde patroon als de Builder.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import { getLeadById } from "../db";
import { setEmailDraft, postMessage } from "./store";
import { siteExists } from "../site-generator";
import { getScreenshotLocalUrl } from "../screenshot";
import { generateEmailHtml, generateEmailSubject } from "../email-template";
import type { Task } from "./types";

const HAS_DRAFT = new Set(["pending", "approved", "sent"]);

export async function runWriter(task: Task): Promise<void> {
  const placeId = task.lead_place_id;
  if (!placeId) throw new Error("write_email-taak zonder lead_place_id");
  const def = AGENT_DEFS.writer;
  const lead = getLeadById(placeId);

  const system = buildSystem(
    "writer",
    `Jouw taak is het schrijven van de outreach-copy via set_email_copy.

Werkwijze voor deze ene lead:
1. get_lead om bedrijf, niche, stad, reviews en de gebouwde site te zien.
2. Heeft de lead geen e-mail? Gebruik find_email.
3. set_email_copy: schrijf korte, persoonlijke, natuurlijke Poolse copy (branche, niche, hero-titel/sub, CTA, korte bedrijfsnaam). Geen overdrijving, geen spam-woorden. De template zorgt voor opmaak, screenshot, prijs en GDPR-voetnoot — jij levert de overtuigende tekst + je eigen kwaliteitsoordeel.
Roep set_email_copy precies één keer aan en stop dan. De mail komt in de goedkeur-wachtrij; jij verstuurt niets.`
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

  const fresh = getLeadById(placeId);
  if (!fresh) return;

  // Geen e-mailadres → de Writer kán niets opstellen. Zichtbaar parkeren
  // (alert) i.p.v. stil als "klaar" afsluiten zonder resultaat.
  if (!fresh.contact_email) {
    postMessage({ from: "writer", to: "manager", kind: "alert", body: `Geen e-mailadres gevonden voor "${fresh.name}" — telefoon-lead, geen mail mogelijk. Site staat klaar.`, leadPlaceId: placeId });
    return;
  }

  // Heeft e-mail maar geen concept (agent stopte zonder set_email_copy) → de
  // CODE zet alsnog een concept klaar met de template-copy (eventueel de door
  // de agent geschreven personalisatie als die er al stond). Geen lege run.
  if (!HAS_DRAFT.has(fresh.approval_status ?? "none")) {
    const siteUrl = siteExists(placeId) ? `/sites/${placeId}/index.html` : undefined;
    setEmailDraft({
      placeId,
      subject: generateEmailSubject(fresh),
      html: generateEmailHtml(fresh, siteUrl, getScreenshotLocalUrl(placeId)),
      score: 5,
      approvalStatus: "pending",
    });
    postMessage({ from: "writer", to: "manager", kind: "alert", body: `Writer leverde geen eigen copy voor "${fresh.name}" — concept met standaardtekst klaargezet (controleer vóór goedkeuren).`, leadPlaceId: placeId });
  }
}
