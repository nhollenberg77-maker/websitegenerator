import { autoDeploy } from "@/lib/deploy";

export async function POST() {
  // Fire and forget — logt naar console.
  autoDeploy().catch(() => {});
  return Response.json({ ok: true, message: "Deploy gestart" });
}
