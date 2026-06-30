import { listPendingApprovals, setApproval } from "@/lib/agents/store";

export async function GET() {
  try {
    const leads = listPendingApprovals().map((l) => ({
      place_id: l.place_id,
      name: l.name,
      city_query: l.city_query,
      category_query: l.category_query,
      slug: l.slug,
      contact_email: l.contact_email,
      email_subject: l.email_subject,
      email_body_html: l.email_body_html,
      email_quality_score: l.email_quality_score,
      site_quality_score: l.site_quality_score,
    }));
    return Response.json({ approvals: leads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      placeId: string;
      action: "approve" | "reject";
      note?: string;
    };
    if (!body.placeId || !["approve", "reject"].includes(body.action)) {
      return Response.json({ error: "placeId en geldige action vereist" }, { status: 400 });
    }
    const ok = setApproval(body.placeId, body.action === "approve" ? "approved" : "rejected", body.note);
    return Response.json({ ok, message: ok ? `Mail ${body.action === "approve" ? "goedgekeurd" : "afgewezen"}` : "Niet gevonden of al verwerkt" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
