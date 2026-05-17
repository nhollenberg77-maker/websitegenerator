#!/usr/bin/env node
// Sync all qualified-lead slugs to Vercel as custom domains.
//
// Usage:
//   node --env-file=.env scripts/sync-vercel-domains.mjs
//
// Requires in dashboard/.env:
//   VERCEL_TOKEN=...
//   VERCEL_PROJECT_NAME=stronadlatwojejfirmy
//   (optionally VERCEL_TEAM_ID if the project is under a team)
//
// Idempotent: domains that already exist are skipped.

import Database from "better-sqlite3";
import path from "path";

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "stronadlatwojejfirmy";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const BASE_DOMAIN = process.env.BASE_DOMAIN || "stronadlatwojejfirmy.com.pl";
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

if (!TOKEN) {
  console.error("✗ VERCEL_TOKEN ontbreekt in .env");
  process.exit(1);
}

const teamQs = TEAM_ID ? `?teamId=${TEAM_ID}` : "";
const teamQs2 = TEAM_ID ? `&teamId=${TEAM_ID}` : "";

async function vapi(method, endpoint, body) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.vercel.com${endpoint}${TEAM_ID ? `${sep}teamId=${TEAM_ID}` : ""}`;
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

async function findProjectId() {
  const r = await vapi("GET", `/v9/projects?search=${encodeURIComponent(PROJECT_NAME)}`);
  if (r.status !== 200) throw new Error(`Project lookup failed: ${r.status}`);
  const project = r.body.projects?.find((p) => p.name === PROJECT_NAME);
  if (!project) throw new Error(`Project "${PROJECT_NAME}" niet gevonden`);
  return project.id;
}

async function addDomain(projectId, domain) {
  const r = await vapi("POST", `/v10/projects/${projectId}/domains`, { name: domain });
  if (r.status === 200 || r.status === 201) return "added";
  if (r.status === 409) return "exists";
  // Some Vercel responses use 400 with specific error codes for duplicates
  if (r.body?.error?.code === "domain_already_in_use") return "exists";
  throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
}

async function main() {
  console.log(`→ Project: ${PROJECT_NAME}${TEAM_ID ? ` (team ${TEAM_ID})` : ""}`);
  const projectId = await findProjectId();
  console.log(`  ID: ${projectId}\n`);

  console.log(`→ Reading qualified leads from ${DB_PATH}`);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare("SELECT slug, name FROM leads WHERE qualified=1 AND slug IS NOT NULL ORDER BY slug")
    .all();
  db.close();
  console.log(`  ${rows.length} leads met slug\n`);

  let added = 0,
    existed = 0,
    failed = 0;
  for (const row of rows) {
    const domain = `${row.slug}.${BASE_DOMAIN}`;
    try {
      const result = await addDomain(projectId, domain);
      if (result === "added") {
        console.log(`  ✓ ${domain}`);
        added++;
      } else {
        console.log(`  · ${domain} (already configured)`);
        existed++;
      }
    } catch (err) {
      console.error(`  ✗ ${domain}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nKlaar: ${added} toegevoegd, ${existed} bestond al, ${failed} mislukt`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
