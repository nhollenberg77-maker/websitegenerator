import {
  getAllConfigs,
  getLastRunPerAgent,
  listRecentRuns,
  listMessages,
  listGoals,
  countTasksByStatus,
  listFeedback,
  countLeads,
  tokenUsageByModel,
  agentStats,
  activitySeries,
} from "@/lib/agents/store";
import { costForModel, totalCost, MODEL_PRICES } from "@/lib/agents/pricing";
import type { Goal, GoalParams } from "@/lib/agents/types";

function goalProgress(goal: Goal): number {
  if (goal.metric !== "qualified_leads") return goal.current_value;
  const params: GoalParams = goal.params ? JSON.parse(goal.params) : {};
  if (params.categories?.length) {
    const placeholders = params.categories.map(() => "?").join(",");
    return countLeads(`WHERE qualified=1 AND category_query IN (${placeholders})`, params.categories);
  }
  return countLeads("WHERE qualified=1");
}

const ORDER = ["manager", "scout", "builder", "writer"] as const;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get("range") || "week"; // 24h | week | month
    const nowMs = Date.now();
    const series =
      range === "24h"
        ? activitySeries(1, 24, nowMs)
        : range === "month"
          ? activitySeries(24, 30, nowMs)
          : activitySeries(24, 7, nowMs);

    const configs = getAllConfigs();
    const lastRuns = getLastRunPerAgent();
    const recent = listRecentRuns(80);
    const stats = agentStats();
    const oneHourAgo = nowMs - 3600_000;

    const agents = ORDER.map((name) => {
      const cfg = configs.find((c) => c.agent === name);
      const last = lastRuns[name];
      const s = stats[name];
      const completed = s?.ok ?? 0;
      const errors = s?.error ?? 0;
      const successRate = completed + errors > 0 ? completed / (completed + errors) : 1;
      const throughput = recent.filter(
        (r) => r.agent === name && r.finished_at && new Date(r.finished_at).getTime() > oneHourAgo
      ).length;
      const cost = s ? costForModel(s.model ?? "claude-haiku-4-5", s.inputTokens, s.outputTokens) : 0;
      return {
        name,
        mission: cfg?.mission ?? null,
        strategy: cfg?.strategy ?? null,
        enabled: cfg ? cfg.enabled === 1 : true,
        lastRun: last
          ? { status: last.status, summary: last.summary, at: last.finished_at, reasoning: last.reasoning }
          : null,
        throughputLastHour: throughput,
        tasksCompleted: completed,
        successRate,
        tokens: (s?.inputTokens ?? 0) + (s?.outputTokens ?? 0),
        cost,
      };
    });

    const usage = tokenUsageByModel();
    const cost = {
      total: totalCost(usage),
      byModel: usage.map((u) => ({
        model: u.model,
        tokens: u.inputTokens + u.outputTokens,
        cost: costForModel(u.model, u.inputTokens, u.outputTokens),
        price: MODEL_PRICES[u.model] ?? null,
      })),
      totalTokens: usage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0),
    };

    const goals = listGoals().map((g) => ({
      id: g.id,
      description: g.description,
      metric: g.metric,
      target: g.target_value,
      current: g.status === "active" ? goalProgress(g) : g.current_value,
      status: g.status,
      params: g.params ? JSON.parse(g.params) : null,
    }));

    const recentTasks = recent.slice(0, 14).map((r) => ({
      id: r.id,
      agent: r.agent,
      summary: r.summary,
      status: r.status,
      tokens: r.tokens ?? 0,
      toolCalls: r.tool_calls ?? 0,
      iterations: r.iterations ?? 0,
      cost: costForModel(r.model ?? "claude-haiku-4-5", r.input_tokens ?? 0, r.output_tokens ?? 0),
      at: r.finished_at,
    }));

    return Response.json({
      agents,
      goals,
      queue: countTasksByStatus(),
      feed: listMessages({ limit: 60 }),
      learnings: listFeedback({ kind: "manager_insight", limit: 8 }),
      recentTasks,
      pendingApprovals: countLeads("WHERE approval_status='pending'"),
      cost,
      activity: { range, series },
      stats: {
        qualified: countLeads("WHERE qualified=1"),
        sites: countLeads("WHERE site_generated_at IS NOT NULL"),
        emailed: countLeads("WHERE emailed_at IS NOT NULL"),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
