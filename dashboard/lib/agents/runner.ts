// Agent-runner: voert een agent uit als een echte multi-step tool-use loop.
// Elke agent = systeemprompt + toolkit + model + tokenbudget. De runner logt
// één run per taak naar agent_runs (met iteraties + tool-calls + tokens).

import type Anthropic from "@anthropic-ai/sdk";
import { getAiClient } from "../ai";
import { recordRun } from "./store";
import type { AgentName } from "./types";

// Een tool die de agent kan aanroepen. De handler geeft tekst terug, of een
// rijk content-blok (bv. een screenshot als image) voor vision in de loop.
export interface AgentTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: Record<string, any>;
  handler: (
    input: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<string | { content: Anthropic.ToolResultBlockParam["content"]; isError?: boolean }>;
}

// Context die elke tool-handler meekrijgt (huidige taak/lead).
export interface ToolContext {
  agent: AgentName;
  taskId: number | null;
  leadPlaceId: string | null;
  // mutabel kladblok dat tools kunnen vullen (bv. de Writer's e-mail-resultaat)
  scratch: Record<string, unknown>;
}

export interface AgentLoopResult {
  finalText: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  budgetHit: boolean;
  scratch: Record<string, unknown>;
}

export async function runAgentLoop(args: {
  agent: AgentName;
  system: string;
  userPrompt: string;
  tools: AgentTool[];
  model: string;
  taskId?: number | null;
  leadPlaceId?: string | null;
  budgetTokens?: number;
  maxIterations?: number;
  maxTokensPerTurn?: number;
  effort?: "low" | "medium" | "high";
}): Promise<AgentLoopResult> {
  const client = getAiClient();
  const maxIterations = args.maxIterations ?? 10;
  const budgetTokens = args.budgetTokens ?? 120_000;
  const startedAt = new Date().toISOString();
  const ctx: ToolContext = {
    agent: args.agent,
    taskId: args.taskId ?? null,
    leadPlaceId: args.leadPlaceId ?? null,
    scratch: {},
  };

  const toolMap = new Map(args.tools.map((t) => [t.name, t]));
  const apiTools: Anthropic.Tool[] = args.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
  // Prompt-caching: markeer de laatste tool → de hele (stabiele) tools-blok
  // wordt gecached en niet elke iteratie opnieuw vol betaald.
  if (apiTools.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiTools[apiTools.length - 1] as any).cache_control = { type: "ephemeral" };
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.userPrompt }];
  const toolCalls: { name: string; input: Record<string, unknown> }[] = [];
  let inputTokens = 0, outputTokens = 0, iterations = 0, finalText = "";
  let budgetHit = false;
  let status: "ok" | "error" = "ok";
  let nudged = false; // één corrigerend duwtje als het model narrate-and-stopt

  try {
    for (; iterations < maxIterations; iterations++) {
      if (inputTokens + outputTokens >= budgetTokens) { budgetHit = true; break; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        model: args.model,
        max_tokens: args.maxTokensPerTurn ?? 2000,
        // System-prompt als cache-block: stabiele prefix wordt hergebruikt
        // i.p.v. elke iteratie tegen vol inputtarief opnieuw verstuurd.
        system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
        tools: apiTools,
        messages,
      };
      if (args.effort) payload.output_config = { effort: args.effort };

      const resp: Anthropic.Message = await client.messages.create(payload);
      inputTokens += resp.usage?.input_tokens ?? 0;
      outputTokens += resp.usage?.output_tokens ?? 0;

      const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      if (textBlocks.length) finalText = textBlocks.map((b) => b.text).join("\n").trim();

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
        // Narrate-and-stop: het model beschreef wat het ging doen maar maakte de
        // taak niet af. Geef één duwtje. (resp.content heeft hier GEEN tool_use,
        // dus terugspelen is veilig — geen "tool_use zonder tool_result"-400.)
        if (!nudged) {
          nudged = true;
          if (toolCalls.length === 0) {
            // pure inleiding op beurt 0 → herstart forceful (geen werk verloren)
            messages.length = 0;
            messages.push({ role: "user", content: `${args.userPrompt}\n\nBELANGRIJK: geef GEEN inleidende tekst. Je EERSTE antwoord moet meteen een tool-aanroep zijn. Beschrijf niet wat je gaat doen — doe het.` });
          } else {
            // wel werk gedaan maar gestopt zonder af te maken → duw door, context
            // behouden. Push ALLEEN tekstblokken: een afgekapt tool_use-block
            // (stop_reason "max_tokens") zonder tool_result geeft anders een 400.
            const textOnly = resp.content.filter((b) => b.type === "text");
            messages.push({ role: "assistant", content: textOnly.length ? textOnly : [{ type: "text", text: "…" }] });
            messages.push({ role: "user", content: "Je hebt de taak nog niet afgemaakt — je beschreef alleen wat je gaat doen. Roep NU de volgende vereiste tool aan (bv. set_site_content / set_email_copy / qualify_lead). Niet beschrijven, dóen." });
          }
          continue;
        }
        break;
      }

      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        toolCalls.push({ name: tu.name, input });
        const tool = toolMap.get(tu.name);
        try {
          if (!tool) {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: `Onbekende tool: ${tu.name}`, is_error: true });
            continue;
          }
          const out = await tool.handler(input, ctx);
          if (typeof out === "string") {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: out.slice(0, 6000) });
          } else {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: out.content, is_error: out.isError });
          }
        } catch (err) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `Fout: ${err instanceof Error ? err.message : "onbekend"}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    status = "error";
    finalText = `Loop-fout: ${err instanceof Error ? err.message : "onbekend"}`;
  }

  const summary = (finalText.split("\n")[0] || `${toolCalls.length} tool-calls`).slice(0, 200);
  const reasoning = [
    finalText,
    `— ${iterations} iteraties, ${toolCalls.length} tool-calls: ${toolCalls.map((c) => c.name).join(", ")}`,
    budgetHit ? "[tokenbudget bereikt]" : "",
  ].filter(Boolean).join("\n");

  recordRun({
    agent: args.agent,
    taskId: args.taskId ?? null,
    status,
    summary,
    reasoning,
    model: args.model,
    inputTokens,
    outputTokens,
    iterations,
    toolCalls: toolCalls.length,
    startedAt,
  });

  return { finalText, toolCalls, inputTokens, outputTokens, iterations, budgetHit, scratch: ctx.scratch };
}
