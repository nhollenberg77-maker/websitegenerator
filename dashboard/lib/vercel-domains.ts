// Vercel domain sync — shared logic used by both:
//   - scripts/sync-vercel-domains.mjs (standalone CLI)
//   - agent.ts (auto-deploy at end of pipeline cycle)

import path from "path";
import Database from "better-sqlite3";

const TOKEN = process.env.VERCEL_TOKEN || "";
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "stronadlatwojejfirmy";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const BASE_DOMAIN = process.env.BASE_DOMAIN || "stronadlatwojejfirmy.com.pl";
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

export interface SyncResult {
  projectId: string | null;
  added: string[];
  existed: string[];
  failed: { domain: string; error: string }[];
  skipped: boolean;
  skipReason?: string;
}

interface ApiResp {
  status: number;
  body: { error?: { code: string; message: string }; projects?: Array<{ id: string; name: string }> } | null;
}

async function vapi(method: string, endpoint: string, body?: unknown): Promise<ApiResp> {
  const url = `https://api.vercel.com${endpoint}${
    TEAM_ID ? (endpoint.includes("?") ? "&" : "?") + "teamId=" + TEAM_ID : ""
  }`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function findProjectId(): Promise<string> {
  const r = await vapi("GET", `/v9/projects?search=${encodeURIComponent(PROJECT_NAME)}`);
  if (r.status !== 200) throw new Error(`Project lookup failed: HTTP ${r.status}`);
  const project = r.body?.projects?.find((p) => p.name === PROJECT_NAME);
  if (!project) throw new Error(`Project "${PROJECT_NAME}" niet gevonden in Vercel`);
  return project.id;
}

export async function syncVercelDomains(): Promise<SyncResult> {
  if (!TOKEN) {
    return {
      projectId: null,
      added: [],
      existed: [],
      failed: [],
      skipped: true,
      skipReason: "VERCEL_TOKEN ontbreekt in .env",
    };
  }

  const projectId = await findProjectId();

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare("SELECT slug FROM leads WHERE qualified = 1 AND slug IS NOT NULL")
    .all() as { slug: string }[];
  db.close();

  const result: SyncResult = {
    projectId,
    added: [],
    existed: [],
    failed: [],
    skipped: false,
  };

  for (const row of rows) {
    const domain = `${row.slug}.${BASE_DOMAIN}`;
    try {
      const r = await vapi("POST", `/v10/projects/${projectId}/domains`, { name: domain });
      if (r.status === 200 || r.status === 201) result.added.push(domain);
      else if (
        r.status === 409 ||
        r.body?.error?.code === "domain_already_in_use" ||
        r.body?.error?.code === "domain_taken"
      ) {
        result.existed.push(domain);
      } else {
        throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
      }
    } catch (err) {
      result.failed.push({
        domain,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return result;
}
