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
2. ICP (breed): wij verkopen concept-websites aan ELK lokaal MKB-dienstverlenend bedrijf — vakmensen, kappers, restaurants, tandartsen, garages, salons, fysio, lokale winkels met diensten, enz. Wijs ZONDER verder onderzoek af (likely_icp=false): groothandels, fabrikanten, leveranciers/distributeurs, ketens/grote filiaalbedrijven, banken, overheidsinstanties, tankstations, en puur online/B2B bedrijven.
3. DE DOELGROEP (belangrijk): een bedrijf dat WÉL een eigen website heeft, maar een ZWAKKE/VEROUDERDE — want dan is er een e-mailadres om te benaderen, en kunnen we een veel betere versie aanbieden. Twee soorten wijs je daarom af:
   - GEEN website (alleen Google-profiel, Facebook-pagina of google.com/business-URL) → 'reject'. Niet te mailen, dus geen prospect — ook al lijkt het een 'gat in de markt'.
   - Een STERKE moderne, mobielvriendelijke site (https + viewport + schema/OG + genoeg tekst) → 'reject'. Die hebben ons niet nodig.
4. Bekijk de site met fetch_website en beoordeel: zwak/verouderd/dun/kapot (maar wél een echte eigen site) = je doelwit → 'keep'. Faalt fetch_website (timeout/blokkade)? Behandel als ONZEKER, niet automatisch keep.
5. qualify_lead met 'keep' of 'reject' + reden. LET OP: bij 'keep' checkt het systeem automatisch (a) of er echt een eigen site is, (b) of die niet te sterk is, en (c) of er een e-mailadres te vinden is — ontbreekt één daarvan, dan wordt de lead alsnog afgewezen. Kwalificeer dus alleen bedrijven met een zwakke maar bestaande site. Wijs ook af: <10 reviews of permanent gesloten.
6. Stop als de opdracht klaar is of je budget op is. Post een handoff aan de Manager met wat je vond.
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
