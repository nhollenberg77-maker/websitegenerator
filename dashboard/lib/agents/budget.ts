// Kosten-bewustzijn voor de Manager: bereken uitgaven per periode uit het
// tokenverbruik (agent_runs) × modelprijs, en bewaak een maandplafond.

import { tokenUsageSince, countLeads } from "./store";
import { totalCost } from "./pricing";
import { getSettings } from "../settings";

function startOfDayUTC(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
function startOfWeekUTC(now = new Date()): string {
  const day = (now.getUTCDay() + 6) % 7; // maandag = 0
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return d.toISOString();
}
function startOfMonthUTC(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function spendSince(sinceIso: string): number {
  return totalCost(tokenUsageSince(sinceIso));
}

export interface BudgetStatus {
  today: number;
  week: number;
  month: number;
  monthlyCap: number;       // 0 = geen plafond
  remaining: number | null; // null = geen plafond
  pctUsed: number | null;   // 0-100, null = geen plafond
  qualified: number;
  costPerQualified: number | null;
}

export function budgetStatus(): BudgetStatus {
  const now = new Date();
  const today = spendSince(startOfDayUTC(now));
  const week = spendSince(startOfWeekUTC(now));
  const month = spendSince(startOfMonthUTC(now));
  const monthlyCap = getSettings().agent.monthlyBudgetUsd || 0;
  const qualified = countLeads("WHERE qualified=1");
  const allTime = spendSince("1970-01-01T00:00:00.000Z");
  return {
    today, week, month, monthlyCap,
    remaining: monthlyCap > 0 ? Math.max(0, monthlyCap - month) : null,
    pctUsed: monthlyCap > 0 ? Math.min(100, (month / monthlyCap) * 100) : null,
    qualified,
    costPerQualified: qualified > 0 ? allTime / qualified : null,
  };
}

// Hard plafond bereikt? (dure agent-arbeid stoppen)
export function isOverBudget(): boolean {
  const s = budgetStatus();
  return s.monthlyCap > 0 && s.month >= s.monthlyCap;
}
