import { listGoals, createGoal, setGoalStatus } from "@/lib/agents/store";

export async function GET() {
  return Response.json({ goals: listGoals() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "create" | "close" | "pause" | "activate";
      goalId?: number;
      description?: string;
      targetValue?: number;
      cities?: string[];
      categories?: string[];
    };

    if (!body.action || body.action === "create") {
      if (!body.description) return Response.json({ error: "description vereist" }, { status: 400 });
      const id = createGoal({
        description: body.description,
        metric: "qualified_leads",
        targetValue: body.targetValue,
        params: { cities: body.cities, categories: body.categories },
        createdBy: "human",
      });
      return Response.json({ ok: true, id });
    }

    if (!body.goalId) return Response.json({ error: "goalId vereist" }, { status: 400 });
    const map = { close: "done", pause: "paused", activate: "active" } as const;
    setGoalStatus(body.goalId, map[body.action as "close" | "pause" | "activate"]);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
