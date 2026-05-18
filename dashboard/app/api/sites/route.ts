import { NextRequest } from "next/server";
import { getLeadById, getLeadsWithSite, getQualifiedLeadsWithoutSite, markSiteGenerated } from "@/lib/db";
import { generateSiteForLead, deleteSite, listGeneratedSites } from "@/lib/site-generator";
import { deleteScreenshot } from "@/lib/screenshot";

export async function GET() {
  try {
    const leads = getLeadsWithSite();
    const siteIds = listGeneratedSites();
    return Response.json({ leads, siteCount: siteIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, placeId } = body;

    if (action === "generate" && placeId) {
      const lead = getLeadById(placeId);
      if (!lead) return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
      if (lead.qualified !== 1) return Response.json({ error: "Lead is niet qualified" }, { status: 400 });

      const result = generateSiteForLead(lead);
      markSiteGenerated(placeId);
      return Response.json({ ok: true, ...result });
    }

    if (action === "generate-all") {
      const leads = getQualifiedLeadsWithoutSite();
      const results: { placeId: string; name: string; url: string }[] = [];

      for (const lead of leads) {
        const result = generateSiteForLead(lead);
        markSiteGenerated(lead.place_id);
        results.push({ placeId: lead.place_id, name: lead.name, url: result.url });
      }

      return Response.json({ ok: true, generated: results.length, results });
    }

    if (action === "regenerate-all") {
      // Regenereer ALLE qualified leads (overschrijft bestaande sites + screenshots).
      // Gebruik dit wanneer site-generator-logica/template is gewijzigd.
      const { getLeads } = await import("@/lib/db");
      const allQualified = getLeads({
        page: 1, perPage: 500,
        cities: [], categories: [],
        status: "qualified", search: "",
        sortBy: "qualified_at", sortDir: "desc",
        minGbp: null, hasEmail: null,
      }).leads;

      const results: { placeId: string; name: string; url: string }[] = [];
      for (const lead of allQualified) {
        deleteSite(lead.place_id);
        deleteScreenshot(lead.place_id);
        const r = generateSiteForLead(lead);
        markSiteGenerated(lead.place_id);
        results.push({ placeId: lead.place_id, name: lead.name, url: r.url });
      }
      return Response.json({ ok: true, regenerated: results.length, results });
    }

    if (action === "regenerate" && placeId) {
      const lead = getLeadById(placeId);
      if (!lead) return Response.json({ error: "Lead niet gevonden" }, { status: 404 });

      deleteSite(placeId);
      const result = generateSiteForLead(lead);
      markSiteGenerated(placeId);
      return Response.json({ ok: true, ...result });
    }

    if (action === "delete" && placeId) {
      deleteSite(placeId);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Ongeldige actie" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
