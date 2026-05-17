import { getLeadById } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ place_id: string }> }
) {
  const { place_id } = await params;
  try {
    const lead = getLeadById(place_id);
    if (!lead) {
      return Response.json({ error: "Lead not found" }, { status: 404 });
    }
    return Response.json(lead);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
