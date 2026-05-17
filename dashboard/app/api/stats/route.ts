import { getStats } from "@/lib/db";

export async function GET() {
  try {
    const stats = getStats();
    return Response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
