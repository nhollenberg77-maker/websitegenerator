#!/usr/bin/env node
// Verwijder ALLE lead-subdomeinen uit Vercel (*.stronadlatwojejfirmy.com.pl)
// behalve het apex-domein zelf en eventuele non-lead subdomeinen (www, etc.).
//
// Usage:
//   node --env-file=.env scripts/wipe-vercel-subdomains.mjs              # dry-run, toont wat verwijderd zou worden
//   node --env-file=.env scripts/wipe-vercel-subdomains.mjs --confirm     # daadwerkelijk verwijderen
//
// Requires in dashboard/.env:
//   VERCEL_TOKEN=...
//   VERCEL_PROJECT_NAME=stronadlatwojejfirmy

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "stronadlatwojejfirmy";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const BASE_DOMAIN = process.env.BASE_DOMAIN || "stronadlatwojejfirmy.com.pl";

const CONFIRM = process.argv.includes("--confirm");

// Subdomeinen die NIET verwijderd mogen worden (apex, www, etc.)
const PROTECTED_SUBDOMAINS = new Set(["www", "mail", "@", ""]);

if (!TOKEN) {
  console.error("✗ VERCEL_TOKEN ontbreekt in .env");
  process.exit(1);
}

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

async function listDomains(projectId) {
  // /v9/projects/{id}/domains kan pagineren — we trekken alles in batches van 100
  const out = [];
  let until = "";
  while (true) {
    const qs = `limit=100${until ? `&until=${until}` : ""}`;
    const r = await vapi("GET", `/v9/projects/${projectId}/domains?${qs}`);
    if (r.status !== 200) throw new Error(`Domain list failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const batch = r.body.domains || [];
    out.push(...batch);
    if (batch.length < 100) break;
    until = batch[batch.length - 1].createdAt;
  }
  return out;
}

async function deleteDomain(projectId, domain) {
  const r = await vapi("DELETE", `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`);
  if (r.status === 200 || r.status === 204) return "deleted";
  if (r.status === 404) return "not_found";
  throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
}

async function main() {
  console.log(`→ Project: ${PROJECT_NAME}${TEAM_ID ? ` (team ${TEAM_ID})` : ""}`);
  const projectId = await findProjectId();
  console.log(`  ID: ${projectId}\n`);

  const all = await listDomains(projectId);
  console.log(`→ ${all.length} domeinen totaal op project\n`);

  const suffix = `.${BASE_DOMAIN}`;
  const subdomainsToDelete = [];
  const keep = [];

  for (const d of all) {
    const name = d.name;
    // Apex zelf (zonder subdomain) → behouden
    if (name === BASE_DOMAIN) { keep.push(`${name} (apex)`); continue; }
    // Niet onder onze basis → niet aankomen (bijv. .vercel.app)
    if (!name.endsWith(suffix)) { keep.push(`${name} (andere basis)`); continue; }
    const sub = name.slice(0, -suffix.length);
    if (PROTECTED_SUBDOMAINS.has(sub.toLowerCase())) {
      keep.push(`${name} (beschermd subdomein)`);
      continue;
    }
    subdomainsToDelete.push(name);
  }

  console.log(`→ Behouden (${keep.length}):`);
  for (const k of keep) console.log(`  · ${k}`);

  console.log(`\n→ Te verwijderen (${subdomainsToDelete.length}):`);
  for (const d of subdomainsToDelete) console.log(`  ✗ ${d}`);

  if (!CONFIRM) {
    console.log(`\n⚠ Dry-run. Voer met --confirm uit om daadwerkelijk te verwijderen.`);
    return;
  }

  if (subdomainsToDelete.length === 0) {
    console.log(`\nGeen subdomeinen om te verwijderen.`);
    return;
  }

  console.log(`\n→ Verwijderen…`);
  let ok = 0, fail = 0, notFound = 0;
  for (const domain of subdomainsToDelete) {
    try {
      const result = await deleteDomain(projectId, domain);
      if (result === "deleted") { console.log(`  ✓ ${domain}`); ok++; }
      else { console.log(`  · ${domain} (already gone)`); notFound++; }
    } catch (err) {
      console.error(`  ✗ ${domain}: ${err.message}`);
      fail++;
    }
  }
  console.log(`\nKlaar: ${ok} verwijderd, ${notFound} bestonden niet, ${fail} mislukt`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
