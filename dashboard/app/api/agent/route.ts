import { getAgentStatus, getAgentLogs, clearAgentLogs, runAgentCycle, startAgent, stopAgent } from "@/lib/agent";

export async function GET() {
  return Response.json({
    status: getAgentStatus(),
    logs: getAgentLogs().slice(-50),
  });
}

export async function POST(request: Request) {
  const body = await request.json() as { action: string };

  switch (body.action) {
    case "run-now":
      runAgentCycle().catch(() => {});
      return Response.json({ ok: true, message: "Agent cyclus gestart" });

    case "start":
      startAgent();
      return Response.json({ ok: true, message: "Agent gestart" });

    case "stop":
      stopAgent();
      return Response.json({ ok: true, message: "Agent gestopt" });

    case "clear-logs":
      clearAgentLogs();
      return Response.json({ ok: true, message: "Logs gewist" });

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
