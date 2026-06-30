// Modelprijzen (USD per 1M tokens) — bron: claude-api skill, juni 2026.
// Gebruikt om tokenverbruik om te rekenen naar kosten in het dashboard.

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Fallback voor onbekende modellen: behandel als Haiku (goedkoopste) i.p.v. 0.
const DEFAULT_PRICE = { input: 1, output: 5 };

export function costForModel(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export function totalCost(usage: { model: string; inputTokens: number; outputTokens: number }[]): number {
  return usage.reduce((sum, u) => sum + costForModel(u.model, u.inputTokens, u.outputTokens), 0);
}
