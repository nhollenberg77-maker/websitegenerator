import { NextRequest } from "next/server";
import { getLeads, getDistinctCities, getDistinctCategories } from "@/lib/db";
import type { LeadsQuery } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    const query: LeadsQuery = {
      page: Math.max(1, parseInt(sp.get("page") || "1")),
      perPage: Math.min(100, Math.max(1, parseInt(sp.get("perPage") || "50"))),
      cities: sp.get("cities") ? sp.get("cities")!.split(",").filter(Boolean) : [],
      categories: sp.get("categories") ? sp.get("categories")!.split(",").filter(Boolean) : [],
      status: (sp.get("status") as LeadsQuery["status"]) || "all",
      search: sp.get("search") || "",
      sortBy: sp.get("sortBy") || "discovered_at",
      sortDir: (sp.get("sortDir") as "asc" | "desc") || "desc",
    };

    const result = getLeads(query);
    const cities = getDistinctCities();
    const categories = getDistinctCategories();

    return Response.json({ ...result, availableCities: cities, availableCategories: categories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
