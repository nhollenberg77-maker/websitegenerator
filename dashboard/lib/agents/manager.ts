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
    `${focus ? `FOCUS van de eigenaar (leidend): ${focus}\n\n` : ""}Werkwijze (managementronde):
1. read_status — bekijk doelen + voortgang, wachtrij, goedkeuringen.
2. category_performance — kijk welke branches/steden de beste qualified leads (en replies) opleveren. LEER hiervan: stuur targeting bij naar wat werkt; stop sectoren die slecht presteren.
3. budget_status — bewaak de KOSTEN. Nader je het maandplafond (>80%), neem gas terug: minder/geen nieuwe discover-taken en focus op de goedkoopste, best presterende sectoren. Let op kosten per qualified lead — als een sector veel kost en weinig oplevert, stop ermee.
4. read_messages + read_feedback — wat meldt het team, wat leren we uit uitkomsten (replies/bounces)?
5. Voor elk actief doel dat nog niet gehaald is en waar geen discover-taken lopen: create_discover_task (max 2 per ronde). Kies steden/categorieën die passen bij de FOCUS hierboven en bij wat goed presteert; durf BREED te gaan (elk lokaal MKB-bedrijf met zwakke/ontbrekende site telt — niet alleen bouw). Gebruik geldige Google place types (bv. plumber, electrician, hair_care, restaurant, dentist, car_repair, beauty_salon, physiotherapist, bakery, florist).
6. Stel waar zinvol de strategie van Scout/Builder/Writer bij met set_strategy — concreet, op basis van wat je leerde.
7. Sluit gehaalde doelen met manage_goal(close); maak zo nodig een nieuw, breder doel. Leg max één nuttige les vast met record_insight.
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
