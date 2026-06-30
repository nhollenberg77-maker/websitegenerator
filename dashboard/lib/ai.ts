// Gedeelde Anthropic-client + helpers voor de 4 AI-agents.
// Model: claude-opus-4-7 met adaptive thinking + effort=high.
// Prompt caching op stabiele system-prompts.

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAiClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY ontbreekt in .env");
    }
    // maxRetries hoger dan de SDK-default (2): vangt tijdelijke 429/5xx/timeouts
    // op met backoff, zodat een korte API-hapering geen taak laat mislukken.
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
  }
  return _client;
}

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Model-mix: alles Haiku voor max kosten-efficiency.
// (Wissel naar "claude-sonnet-4-6" hier als kwaliteit tegenvalt.)
export const AI_MODEL_VISION = "claude-haiku-4-5";
export const AI_MODEL_TEXT = "claude-haiku-4-5";

// Google Places photo URL helper voor SERVER-SIDE gebruik (vision AI-calls).
//
// Accepteert twee input-vormen:
//   1) Proxy-pad: "/api/photo?ref=places/.../photos/...&w=1200"  (nieuwe stijl,
//      sinds we de key niet meer in de DB opslaan om lekkage te voorkomen)
//   2) Bare Places URL: "https://places.googleapis.com/v1/places/.../photos/.../media"
//      (legacy/eerdere data)
//
// In beide gevallen produceren we de volledige upstream URL inclusief
// `&key=...` — die mag alleen server-side gebruikt worden (Anthropic vision).
// Voor end-user rendering (sites, mails) → gebruik de proxy URL direct.
export function photoUrlWithKey(input: string, maxWidth = 1200): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return input;

  // Vorm 1: proxy-pad. Pak `ref=` uit en bouw upstream URL.
  if (input.startsWith("/api/photo")) {
    const idx = input.indexOf("?");
    if (idx >= 0) {
      const params = new URLSearchParams(input.slice(idx + 1));
      const ref = params.get("ref");
      const w = params.get("w");
      if (ref) {
        const width = w && /^\d+$/.test(w) ? w : String(maxWidth);
        return `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${width}&key=${key}`;
      }
    }
    return input; // malformed — laat AI dit ontdekken
  }

  // Vorm 2: bare Places URL — voeg maxWidthPx + key toe als ze ontbreken.
  const sep = input.includes("?") ? "&" : "?";
  if (input.includes("key=")) return input;
  return `${input}${sep}maxWidthPx=${maxWidth}&key=${key}`;
}

// Wrapper voor calls met JSON-output via structured outputs.
// Cached system-prompt (stable) + dynamic user-content.
// Model-flexibel: Sonnet 4.6 ondersteunt adaptive thinking + effort low|medium|high.
// Haiku 4.5 ondersteunt geen effort/thinking — laat die velden weg.
export async function callAiJson<T = unknown>(args: {
  model: string;
  systemPrompt: string;
  userContent: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  thinking?: boolean;
  maxTokens?: number;
}): Promise<{ data: T | null; rawText: string; usage: Anthropic.Usage | null }> {
  const client = getAiClient();
  const maxTokens = args.maxTokens ?? 8000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    model: args.model,
    max_tokens: maxTokens,
    output_config: {
      format: { type: "json_schema", schema: args.schema },
    },
    system: [
      {
        type: "text",
        text: args.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: args.userContent }],
  };

  if (args.thinking) payload.thinking = { type: "adaptive" };
  if (args.effort) payload.output_config.effort = args.effort;

  try {
    const response = await client.messages.create(payload);

    // Extract text block (structured output put the JSON here)
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const rawText = textBlock?.text ?? "";
    let data: T | null = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText) as T;
      } catch {
        // try to extract first JSON object/array
        const match = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) {
          try { data = JSON.parse(match[0]) as T; } catch { /* ignore */ }
        }
      }
    }
    return { data, rawText, usage: response.usage };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`AI call faalde (${err.status}): ${err.message}`);
    }
    throw err;
  }
}
