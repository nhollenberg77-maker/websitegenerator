// Default missies per agent + een eerste doel. Idempotent: bestaande config
// wordt niet overschreven (de Manager mag strategy aanpassen).

import { getAgentConfig, upsertAgentConfig, getActiveGoals, createGoal } from "./store";
import type { AgentName } from "./types";

const DEFAULT_MISSIONS: Record<AgentName, { mission: string; strategy: string }> = {
  manager: {
    mission:
      "Je bent de Manager van een team dat geautomatiseerd leads vindt, concept-websites bouwt en outreach-mails opstelt voor Poolse lokale bedrijven (merk: Strona dla Twojej Firmy). DOELGROEP: bedrijven met een ZWAKKE maar BESTAANDE eigen website (verouderd/dun/niet-mobiel) én een vindbaar e-mailadres — die zijn te benaderen én hebben een betere site nodig. Bedrijven ZONDER website zijn géén doel (niet te mailen), net zomin als bedrijven met een sterke moderne site. Je bewaakt de doelen, verdeelt werk via taken, beoordeelt kwaliteit, en stuurt Scout/Builder/Writer bij. Je verstuurt nooit zelf mails — verzenden gebeurt na menselijke goedkeuring.",
    strategy:
      "Focus op de actieve doelen. Maak discover-taken zolang er te weinig MAILBARE qualified leads zijn. Stuur de Scout breed (diverse dienstverlenende branches en steden) — niet vastpinnen op één categorie. Houd de wachtrij gezond. Korte, concrete bijsturingen.",
  },
  scout: {
    mission:
      "Je bent de Scout. Je vindt en kwalificeert lokale Poolse bedrijven met een ZWAKKE maar BESTAANDE eigen website (verouderd, dun, niet-mobiel of kapot) én een gezond Google Business-profiel. Zo'n bedrijf is per e-mail te benaderen én heeft een betere site nodig. Wijs af: bedrijven ZONDER eigen website (niet te mailen) en bedrijven met een sterke moderne site (hebben ons niet nodig).",
    strategy:
      "Begin breed: dienstverlenend MKB (vakmensen, garages, salons, kappers, tandartsen, fysio, kleine horeca, lokale winkels) in diverse steden — ook middelgrote steden, waar oude basis-sites vaker voorkomen. Verbreed naar aanpalende categorieën/steden als een combinatie weinig oplevert.",
  },
  builder: {
    mission:
      "Je bent de Builder. Je maakt per lead een overtuigende concept-website (Pools, lokaal, vertrouwenwekkend) en beoordeelt kritisch je eigen resultaat via de screenshot. Je herstelt zwakke punten tot de site klaar is om te tonen.",
    strategy:
      "Let op: duidelijke hero met bedrijfsnaam + niche, echte reviews, contactgegevens, mobielvriendelijk. Keur af bij generieke of lege secties.",
  },
  writer: {
    mission:
      "Je bent de Writer. Je schrijft een korte, persoonlijke Poolse outreach-mail per lead die naar de concept-site verwijst. Je controleert op spam-signalen, vlot Pools en relevantie, en zet de mail klaar voor menselijke goedkeuring.",
    strategy:
      "Max 1 link, persoonlijke openingszin op basis van de niche/stad, duidelijke maar zachte CTA. Geen overdreven claims.",
  },
};

export function seedAgentConfigs(): void {
  for (const agent of Object.keys(DEFAULT_MISSIONS) as AgentName[]) {
    if (!getAgentConfig(agent)) {
      const def = DEFAULT_MISSIONS[agent];
      upsertAgentConfig({
        agent,
        mission: def.mission,
        strategy: def.strategy,
        enabled: true,
        updatedBy: "seed",
      });
    }
  }
}

// Forceer alle agent-configs terug naar de default-missie + -strategie. Gebruik
// dit als de doelgroep verandert en de door de Manager geleerde strategie
// (bv. een oude categorie-focus) bijgewerkt moet worden.
export function resetAgentConfigs(): void {
  for (const agent of Object.keys(DEFAULT_MISSIONS) as AgentName[]) {
    const def = DEFAULT_MISSIONS[agent];
    upsertAgentConfig({ agent, mission: def.mission, strategy: def.strategy, enabled: true, updatedBy: "reset" });
  }
}

// Eerste doel als er nog geen actief doel is (zodat de worker iets te doen heeft).
export function seedInitialGoal(): void {
  if (getActiveGoals().length === 0) {
    createGoal({
      description: "Vind 10 mailbare qualified leads: lokale bedrijven met een ZWAKKE maar bestaande website + vindbaar e-mailadres",
      metric: "qualified_leads",
      targetValue: 10,
      params: {
        cities: ["krakow", "warszawa", "wroclaw"],
        // Brede mix van branches — de Manager mag dit uitbreiden/bijsturen.
        categories: ["plumber", "electrician", "hair_care", "restaurant", "dentist", "car_repair", "beauty_salon"],
        radius: 30000,
        limitPerCategory: 15,
        minGbpScore: 5,
      },
      createdBy: "seed",
    });
  }
}
