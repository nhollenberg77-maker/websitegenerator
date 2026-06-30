// Manager — echte agent-loop (Sonnet). Plant werk, stuurt strategie bij, leerlus.

import { runAgentLoop } from "./runner";
import { AGENT_DEFS, buildSystem } from "./registry";
import { countLeads } from "./store";
import { getSettings } from "../settings";
import type { Goal, GoalParams } from "./types";

// Voortgang van een doel (qualified_leads, optioneel op categorie gefilterd).
export function computeGoalProgress(goal: Goal): number {
  if (goal.metric !== "qualified_leads") return goal.current_value;
  const params: GoalParams = goal.params ? JSON.parse(goal.params) : {};
  if (params.categories?.length) {
    const ph = params.categories.map(() => "?").join(",");
    return countLeads(`WHERE qualified=1 AND category_query IN (${ph})`, params.categories);
  }
  return countLeads("WHERE qualified=1");
}

export async function runManager(): Promise<void> {
  const def = AGENT_DEFS.manager;
  const focus = getSettings().agent.focusHint?.trim();
  const system = buildSystem(
    "manager",
    `${focus ? `FOCUS van de eigenaar (leidend): ${focus}\n\n` : ""}Je bent niet alleen een planner — je bent de KWALITEITSBEWAKER. Kijk net zo kritisch als een eigenaar: controleer of het werk écht klopt, niet alleen of de cijfers oplopen. Vertrouw het team niet blind; inspecteer steekproeven en grijp in bij fouten.

Werkwijze (managementronde):
1. read_status + budget_status — stand, voortgang, wachtrij, en de KOSTEN. Nader je het maandplafond (>80%), neem gas terug en focus op de goedkoopste, best presterende sectoren.
2. KWALITEITSCONTROLE (belangrijk, doe dit elke ronde):
   • review_qualified_leads — controleer een steekproef. Staat er een lead met een ⚠ STERKE SITE of buiten de doelgroep tussen? Dan is hij FOUT gekwalificeerd → overrule_lead met reden, en geef Scout via set_strategy concrete feedback.
   • inspect_site — bekijk 1-2 gebouwde concept-sites visueel. Past de site bij dit type bedrijf en branche? Spreekt het aan? Klopt de template (bv. een restaurant moet een menukaart hebben, geen bouw-layout)? Bij problemen: geef de Builder via set_strategy concrete feedback.
3. category_performance + read_feedback/read_messages — leer welke branches/steden de beste qualified leads én replies opleveren; stuur targeting bij naar wat werkt, stop wat slecht presteert.
4. Voor elk actief doel dat nog niet gehaald is en waar geen discover-taken lopen: create_discover_task (max 2 per ronde). Kies steden/categorieën die passen bij de FOCUS en bij wat goed presteert; durf BREED te gaan (elk lokaal MKB met zwakke/ontbrekende site — niet alleen bouw). Gebruik geldige Google place types (plumber, electrician, hair_care, restaurant, dentist, car_repair, beauty_salon, physiotherapist, bakery, florist, …).
5. Stel de strategie van Scout/Builder/Writer bij met set_strategy — concreet, op basis van wat je in de QC en data zag.
6. Sluit gehaalde doelen met manage_goal(close); maak zo nodig een nieuw, breder doel. Leg max één nuttige les vast met record_insight.
Houd het kort en doelgericht. Verstuur nooit zelf mails.`
  );

  await runAgentLoop({
    agent: "manager",
    system,
    userPrompt: "Doe je managementronde: beoordeel de stand, verdeel werk en stel waar nodig bij.",
    tools: def.tools,
    model: def.model,
    budgetTokens: def.budgetTokens,
    maxIterations: def.maxIterations,
    maxTokensPerTurn: def.maxTokensPerTurn,
  });
}
