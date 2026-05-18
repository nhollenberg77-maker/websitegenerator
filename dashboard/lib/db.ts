import Database from "better-sqlite3";
import path from "path";
import type { Lead, LeadStats, LeadsQuery, LeadsResponse } from "./types";
import { slugify, isReservedSlug } from "./slug";

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

let migrated = false;

function ensureMigrated(): void {
  if (migrated) return;
  try {
    const db = new Database(DB_PATH);
    const columns = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "emailed_at")) {
      db.exec("ALTER TABLE leads ADD COLUMN emailed_at TEXT DEFAULT NULL");
    }
    if (!columns.some((c) => c.name === "site_generated_at")) {
      db.exec("ALTER TABLE leads ADD COLUMN site_generated_at TEXT DEFAULT NULL");
    }
    const enrichCols = ["photo_refs", "photo_urls", "reviews_json", "description", "enriched_at"];
    for (const col of enrichCols) {
      if (!columns.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT DEFAULT NULL`);
      }
    }
    if (!columns.some((c) => c.name === "slug")) {
      db.exec("ALTER TABLE leads ADD COLUMN slug TEXT DEFAULT NULL");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_slug ON leads(slug) WHERE slug IS NOT NULL");
    }
    if (!columns.some((c) => c.name === "contact_email")) {
      db.exec("ALTER TABLE leads ADD COLUMN contact_email TEXT DEFAULT NULL");
    }
    db.close();
    migrated = true;
  } catch {
    // DB may not exist yet
  }
}

function getDb(readonly = true): Database.Database {
  ensureMigrated();
  return new Database(DB_PATH, { readonly });
}

export function getStats(): LeadStats {
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN qualified = 0 THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN qualified IS NULL THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN emailed_at IS NOT NULL THEN 1 ELSE 0 END) as emailed,
        SUM(CASE WHEN site_generated_at IS NOT NULL THEN 1 ELSE 0 END) as sites
      FROM leads`
    )
    .get() as { total: number; qualified: number; rejected: number; pending: number; emailed: number; sites: number };

  const byCity = db
    .prepare(
      `SELECT city_query as city, COUNT(*) as count
       FROM leads GROUP BY city_query ORDER BY count DESC`
    )
    .all() as { city: string; count: number }[];

  const byCategory = db
    .prepare(
      `SELECT category_query as category,
        SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) as qualified,
        COUNT(*) as total
       FROM leads GROUP BY category_query ORDER BY total DESC`
    )
    .all() as { category: string; qualified: number; total: number }[];

  const recentQualified = db
    .prepare(
      `SELECT * FROM leads WHERE qualified = 1
       ORDER BY qualified_at DESC LIMIT 5`
    )
    .all() as Lead[];

  db.close();

  return {
    ...totals,
    byCity,
    byCategory,
    recentQualified,
  };
}

export function getLeads(query: LeadsQuery): LeadsResponse {
  const db = getDb();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.cities.length > 0) {
    conditions.push(`city_query IN (${query.cities.map(() => "?").join(",")})`);
    params.push(...query.cities);
  }

  if (query.categories.length > 0) {
    conditions.push(`category_query IN (${query.categories.map(() => "?").join(",")})`);
    params.push(...query.categories);
  }

  if (query.status === "qualified") {
    conditions.push("qualified = 1");
  } else if (query.status === "rejected") {
    conditions.push("qualified = 0");
  } else if (query.status === "pending") {
    conditions.push("qualified IS NULL");
  }

  if (query.minGbp !== null && query.minGbp !== undefined) {
    conditions.push("good_gbp_score >= ?");
    params.push(query.minGbp);
  }

  if (query.hasEmail === true) {
    conditions.push("contact_email IS NOT NULL AND contact_email != ''");
  } else if (query.hasEmail === false) {
    conditions.push("(contact_email IS NULL OR contact_email = '')");
  }

  if (query.search) {
    conditions.push("name LIKE ?");
    params.push(`%${query.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSorts = [
    "name", "city_query", "primary_type", "rating_count", "rating",
    "photo_count", "good_gbp_score", "bad_site_score", "qualified", "discovered_at", "emailed_at", "site_generated_at",
  ];
  const sortCol = allowedSorts.includes(query.sortBy) ? query.sortBy : "discovered_at";
  const sortDir = query.sortDir === "asc" ? "ASC" : "DESC";
  const nullsHandling = sortDir === "DESC" ? "NULLS LAST" : "NULLS FIRST";

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM leads ${where}`).get(...params) as { count: number }
  ).count;

  const offset = (query.page - 1) * query.perPage;
  const leads = db
    .prepare(
      `SELECT * FROM leads ${where} ORDER BY ${sortCol} ${sortDir} ${nullsHandling} LIMIT ? OFFSET ?`
    )
    .all(...params, query.perPage, offset) as Lead[];

  db.close();

  return {
    leads,
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.ceil(total / query.perPage),
  };
}

export function getLeadById(placeId: string): Lead | undefined {
  const db = getDb();
  const lead = db.prepare("SELECT * FROM leads WHERE place_id = ?").get(placeId) as
    | Lead
    | undefined;
  db.close();
  return lead;
}

export function getDistinctCities(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT city_query FROM leads WHERE city_query IS NOT NULL ORDER BY city_query")
    .all() as { city_query: string }[];
  db.close();
  return rows.map((r) => r.city_query);
}

export function getDistinctCategories(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT category_query FROM leads WHERE category_query IS NOT NULL ORDER BY category_query")
    .all() as { category_query: string }[];
  db.close();
  return rows.map((r) => r.category_query);
}

export function getUnmailedQualifiedLeads(): Lead[] {
  const db = getDb();
  const leads = db
    .prepare(
      `SELECT * FROM leads
       WHERE qualified = 1 AND emailed_at IS NULL AND website IS NOT NULL
       ORDER BY qualified_at DESC`
    )
    .all() as Lead[];
  db.close();
  return leads;
}

export function setLeadContactEmail(placeId: string, email: string | null): void {
  const db = getDb(false);
  db.prepare("UPDATE leads SET contact_email = ? WHERE place_id = ?").run(email, placeId);
  db.close();
}

export function setLeadAiPolish(placeId: string, json: string | null): void {
  const db = getDb(false);
  db.prepare("UPDATE leads SET ai_polish = ? WHERE place_id = ?").run(json, placeId);
  db.close();
}

export function setLeadAiEmail(placeId: string, json: string | null): void {
  const db = getDb(false);
  db.prepare("UPDATE leads SET ai_email = ? WHERE place_id = ?").run(json, placeId);
  db.close();
}

export function countReadyLeads(minGbp: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM leads
       WHERE qualified = 1
         AND good_gbp_score >= ?
         AND contact_email IS NOT NULL
         AND contact_email != ''`
    )
    .get(minGbp) as { n: number };
  db.close();
  return row.n;
}

export function getLeadsNeedingEmailScrape(): Lead[] {
  const db = getDb();
  const leads = db
    .prepare(
      `SELECT * FROM leads
       WHERE qualified = 1
         AND website IS NOT NULL
         AND (contact_email IS NULL OR contact_email = '')
       ORDER BY qualified_at DESC`
    )
    .all() as Lead[];
  db.close();
  return leads;
}

export function markLeadEmailed(placeId: string): void {
  const db = getDb(false);
  db.prepare("UPDATE leads SET emailed_at = ? WHERE place_id = ?").run(
    new Date().toISOString(),
    placeId
  );
  db.close();
}

export function markSiteGenerated(placeId: string): void {
  const db = getDb(false);
  db.prepare("UPDATE leads SET site_generated_at = ? WHERE place_id = ?").run(
    new Date().toISOString(),
    placeId
  );
  db.close();
}

export function getQualifiedLeadsWithoutSite(): Lead[] {
  const db = getDb();
  const leads = db
    .prepare(
      `SELECT * FROM leads
       WHERE qualified = 1 AND site_generated_at IS NULL
       ORDER BY qualified_at DESC`
    )
    .all() as Lead[];
  db.close();
  return leads;
}

export function getLeadsWithSite(): Lead[] {
  const db = getDb();
  const leads = db
    .prepare(
      `SELECT * FROM leads
       WHERE site_generated_at IS NOT NULL
       ORDER BY site_generated_at DESC`
    )
    .all() as Lead[];
  db.close();
  return leads;
}

// Ensure a unique slug exists for a lead. Returns the slug.
// - Reuses existing slug if already set.
// - Generates from lead.name otherwise.
// - On collision (or reserved word), appends -2, -3, ... or falls back to a
//   suffix derived from place_id.
export function ensureSlugForLead(placeId: string): string {
  const db = getDb(false);
  try {
    const row = db.prepare("SELECT slug, name FROM leads WHERE place_id = ?").get(placeId) as
      | { slug: string | null; name: string }
      | undefined;
    if (!row) throw new Error(`Lead ${placeId} not found`);
    if (row.slug) return row.slug;

    const base = slugify(row.name);
    let candidate = base;
    let i = 2;
    const existsStmt = db.prepare("SELECT 1 FROM leads WHERE slug = ? AND place_id != ?");
    while (isReservedSlug(candidate) || existsStmt.get(candidate, placeId)) {
      candidate = `${base}-${i++}`;
      if (i > 99) {
        candidate = `${base}-${placeId.slice(-6).toLowerCase()}`;
        break;
      }
    }
    db.prepare("UPDATE leads SET slug = ? WHERE place_id = ?").run(candidate, placeId);
    return candidate;
  } finally {
    db.close();
  }
}

export function getLeadBySlug(slug: string): Lead | undefined {
  const db = getDb();
  const lead = db.prepare("SELECT * FROM leads WHERE slug = ?").get(slug) as Lead | undefined;
  db.close();
  return lead;
}
