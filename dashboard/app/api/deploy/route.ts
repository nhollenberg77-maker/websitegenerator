import { autoDeploy } from "@/lib/agent";

export async function POST() {
  // Fire and forget — logs to agent-log.json so cockpit's live log picks it up
  autoDeploy().catch(() => {});
  return Response.json({ ok: true, message: "Deploy gestart" });
}
