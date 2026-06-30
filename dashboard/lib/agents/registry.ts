// Per-agent definitie: model, toolkit, tokenbudget, iteratie-limiet. Lean:
// workers op Haiku, Manager op Sonnet, strakke budgetten.

import type { AgentName } from "./types";
import type { AgentTool } from "./runner";
import { SCOUT_TOOLS, BUILDER_TOOLS, WRITER_TOOLS, MANAGER_TOOLS } from "./tools";
import { getAgentConfig } from "./store";

export const WORKER_MODEL = "claude-haiku-4-5";
export const MANAGER_MODEL = "claude-sonnet-4-6";

export interface AgentDef {
  model: string;
  tools: AgentTool[];
  budgetTokens: number;
  maxIterations: number;
  maxTokensPerTurn: number;
}

export const AGENT_DEFS: Record<AgentName, AgentDef> = {
  scout: { model: WORKER_MODEL, tools: SCOUT_TOOLS, budgetTokens: 60_000, maxIterations: 10, maxTokensPerTurn: 1500 },
  builder: { model: WORKER_MODEL, tools: BUILDER_TOOLS, budgetTokens: 50_000, maxIterations: 8, maxTokensPerTurn: 1800 },
  writer: { model: WORKER_MODEL, tools: WRITER_TOOLS, budgetTokens: 30_000, maxIterations: 8, maxTokensPerTurn: 1500 },
  manager: { model: MANAGER_MODEL, tools: MANAGER_TOOLS, budgetTokens: 40_000, maxIterations: 10, maxTokensPerTurn: 1500 },
};

// Systeemprompt = stabiele missie + door Manager bijgestelde strategie (uit DB).
export function buildSystem(agent: AgentName, extra = ""): string {
  const cfg = getAgentConfig(agent);
  return [
    cfg?.mission ?? `Je bent de ${agent}.`,
    cfg?.strategy ? `\nHuidige strategie (door de Manager bijgesteld): ${cfg.strategy}` : "",
    extra ? `\n${extra}` : "",
  ].join("");
}
