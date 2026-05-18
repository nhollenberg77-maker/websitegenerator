import cron, { type ScheduledTask } from "node-cron";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getSettings, isSmtpConfigured } from "./settings";
import { getUnmailedQualifiedLeads, getQualifiedLeadsWithoutSite, markSiteGenerated, countReadyLeads, getLeadsNeedingEmailScrape, setLeadContactEmail } from "./db";
import { sendLeadEmail } from "./mailer";
import { generateSiteForLead, siteExists } from "./site-generator";
import { syncVercelDomains } from "./vercel-domains";
import { findContactEmail } from "./email-scraper";
import { generateScreenshot, hasScreenshot, getScreenshotEmailUrl, waitForUrl } from "./screenshot";

const LOG_PATH = path.resolve(process.cwd(), "agent-log.json");
const MAX_LOG_ENTRIES = 200;

export interface AgentLogEntry {
  timestamp: string;
  type: "info" | "error" | "success";
  message: string;
}

let cronTask: ScheduledTask | null = null;
let isRunning = false;

function appendLog(entry: AgentLogEntry): void {
  const logs = getAgentLogs();
  logs.push(entry);
  const trimmed = logs.slice(-MAX_LOG_ENTRIES);
  fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
}

export function getAgentLogs(): AgentLogEntry[] {
  try {
    if (fs.existsSync(LOG_PATH)) {
      return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
    }
  } catch {
    // corrupt file
  }
  return [];
}

export function clearAgentLogs(): void {
  fs.writeFileSync(LOG_PATH, "[]", "utf-8");
}

export function getAgentStatus(): { running: boolean; enabled: boolean; schedule: string; nextRun: string | null } {
  const settings = getSettings();
  return {
    running: isRunning,
    enabled: settings.agent.enabled,
    schedule: settings.agent.cronSchedule,
    nextRun: null,
  };
}

// Run an arbitrary command. cwd defaults to dashboard/.
function runCmd(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: cwd || process.cwd(), env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

// Auto-deploy: git push generated sites + sync Vercel domains.
// Best-effort — errors are logged but don't abort the cycle.
export async function autoDeploy(): Promise<void> {
  const ts = () => new Date().toISOString();
  const projectRoot = path.resolve(process.cwd(), "..");

  // Only push if there are changes in the relevant paths
  const status = await runCmd(
    "git",
    ["status", "--porcelain", "dashboard/public/sites", "dashboard/public/sub", "dashboard/public/preview", "leads.db"],
    projectRoot
  );
  if (status.code !== 0) {
    appendLog({ timestamp: ts(), type: "error", message: `git status faalde: ${status.stderr.slice(0, 120)}` });
    return;
  }

  if (status.stdout.trim()) {
    appendLog({ timestamp: ts(), type: "info", message: "Deploy: git commit + push" });
    await runCmd("git", ["add", "dashboard/public/sites", "dashboard/public/sub", "dashboard/public/preview", "leads.db"], projectRoot);
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const commit = await runCmd("git", ["commit", "-m", `auto: pipeline ${stamp}`], projectRoot);
    if (commit.code !== 0 && !commit.stdout.includes("nothing to commit")) {
      appendLog({ timestamp: ts(), type: "error", message: `git commit faalde: ${(commit.stderr || commit.stdout).slice(0, 120)}` });
      return;
    }
    const push = await runCmd("git", ["push", "origin", "main"], projectRoot);
    if (push.code !== 0) {
      appendLog({ timestamp: ts(), type: "error", message: `git push faalde: ${push.stderr.slice(0, 200)}` });
      return;
    }
    appendLog({ timestamp: ts(), type: "success", message: "Git push ✓ — Vercel build draait" });
  } else {
    appendLog({ timestamp: ts(), type: "info", message: "Deploy: geen wijzigingen om te pushen" });
  }

  // Sync Vercel domains (idempotent — already-configured slugs zijn no-op)
  try {
    const result = await syncVercelDomains();
    if (result.skipped) {
      appendLog({ timestamp: ts(), type: "info", message: `Vercel sync overgeslagen: ${result.skipReason}` });
      return;
    }
    appendLog({
      timestamp: ts(),
      type: "success",
      message: `Vercel domains: ${result.added.length} nieuw, ${result.existed.length} bestonden, ${result.failed.length} mislukt`,
    });
    for (const f of result.failed) {
      appendLog({ timestamp: ts(), type: "error", message: `  ✗ ${f.domain}: ${f.error.slice(0, 100)}` });
    }
  } catch (err) {
    appendLog({
      timestamp: ts(),
      type: "error",
      message: `Vercel sync faalde: ${err instanceof Error ? err.message : "onbekend"}`,
    });
  }
}

function runScript(scriptPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const proc = spawn(pythonBin, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

export async function runAgentCycle(): Promise<void> {
  if (isRunning) {
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Agent al bezig, overgeslagen." });
    return;
  }

  isRunning = true;
  const settings = getSettings();
  const { agent } = settings;

  const ts = () => new Date().toISOString();
  const target = Math.max(1, agent.targetReadyLeads || 5);
  const minGbp = Math.max(1, agent.minGbpScore || 5);
  const maxCycles = Math.max(1, agent.maxCyclesPerRun || 3);

  appendLog({ timestamp: ts(), type: "info", message: `Agent cyclus gestart — doel: ${target} bruikbare leads (qualified, GBP ≥ ${minGbp}, met e-mail)` });

  const discoveryScript = path.resolve(process.cwd(), process.env.DISCOVERY_SCRIPT || "../discovery.py");
  const qualifyScript = path.resolve(process.cwd(), process.env.QUALIFY_SCRIPT || "../qualify.py");
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

  for (let round = 1; round <= maxCycles; round++) {
    const readyBefore = countReadyLeads(minGbp);
    if (readyBefore >= target) {
      appendLog({ timestamp: ts(), type: "success", message: `Doel bereikt: ${readyBefore}/${target} bruikbare leads aanwezig — discovery overgeslagen` });
      break;
    }

    appendLog({ timestamp: ts(), type: "info", message: `Ronde ${round}/${maxCycles} — nu ${readyBefore}/${target} bruikbare leads, op zoek naar meer` });

    // Discovery per stad
    for (const city of agent.cities) {
      appendLog({ timestamp: ts(), type: "info", message: `Discovery: ${city}` });
      const args = [
        "--city", city,
        "--categories", ...agent.categories,
        "--radius", String(agent.radius),
        "--limit", String(agent.limitPerCategory),
        "--db", dbPath,
      ];
      const result = await runScript(discoveryScript, args);
      if (result.code !== 0) {
        appendLog({ timestamp: ts(), type: "error", message: `Discovery ${city} fout: ${result.stderr.slice(0, 200)}` });
      } else {
        const newMatch = result.stdout.match(/Nieuw in database\s*:\s*(\d+)/);
        const newCount = newMatch ? newMatch[1] : "?";
        appendLog({ timestamp: ts(), type: "success", message: `Discovery ${city}: ${newCount} nieuwe leads` });
      }
    }

    // Qualification
    appendLog({ timestamp: ts(), type: "info", message: "Qualification starten…" });
    const qualResult = await runScript(qualifyScript, ["--db", dbPath]);
    if (qualResult.code !== 0) {
      appendLog({ timestamp: ts(), type: "error", message: `Qualification fout: ${qualResult.stderr.slice(0, 200)}` });
    } else {
      const qualMatch = qualResult.stdout.match(/Qualified\s*:\s*(\d+)/);
      const qualCount = qualMatch ? qualMatch[1] : "?";
      appendLog({ timestamp: ts(), type: "success", message: `Qualification klaar: ${qualCount} qualified` });
    }

    // E-mail scraping voor nieuw-gequalificeerde leads zonder e-mail
    const needScrape = getLeadsNeedingEmailScrape();
    if (needScrape.length > 0) {
      appendLog({ timestamp: ts(), type: "info", message: `E-mail zoeken op ${needScrape.length} websites…` });
      let scrapedFound = 0;
      const concurrency = 3;
      let cursor = 0;
      async function scrapeWorker() {
        while (cursor < needScrape.length) {
          const lead = needScrape[cursor++];
          if (!lead.website) continue;
          const email = await findContactEmail(lead.website);
          if (email) {
            setLeadContactEmail(lead.place_id, email);
            scrapedFound++;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, needScrape.length) }, scrapeWorker));
      appendLog({ timestamp: ts(), type: "success", message: `E-mails gevonden: ${scrapedFound} van ${needScrape.length} sites` });
    }

    const readyAfter = countReadyLeads(minGbp);
    appendLog({ timestamp: ts(), type: "info", message: `Na ronde ${round}: ${readyAfter}/${target} bruikbare leads` });

    if (readyAfter >= target) {
      appendLog({ timestamp: ts(), type: "success", message: `Doel bereikt na ${round} ${round === 1 ? "ronde" : "rondes"}` });
      break;
    }
    if (readyAfter === readyBefore && round < maxCycles) {
      appendLog({ timestamp: ts(), type: "info", message: "Geen nieuwe bruikbare leads in deze ronde — verdere rondes overgeslagen. Voeg steden of categorieën toe voor meer." });
      break;
    }
    if (round === maxCycles && readyAfter < target) {
      appendLog({ timestamp: ts(), type: "info", message: `Max. rondes bereikt. ${readyAfter}/${target} gehaald — voeg steden/categorieën toe of verhoog max. rondes.` });
    }
  }

  // Enrichment (foto's + reviews ophalen)
  const enrichScript = path.resolve(process.cwd(), process.env.ENRICH_SCRIPT || "../enrich.py");
  appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Enrichment starten (foto's + reviews)…" });
  const enrichResult = await runScript(enrichScript, ["--db", dbPath]);
  if (enrichResult.code !== 0) {
    appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Enrichment fout: ${enrichResult.stderr.slice(0, 200)}` });
  } else {
    const enrichMatch = enrichResult.stdout.match(/(\d+)\s*leads\s*verrijkt/);
    const enrichCount = enrichMatch ? enrichMatch[1] : "?";
    appendLog({ timestamp: new Date().toISOString(), type: "success", message: `Enrichment klaar: ${enrichCount} leads verrijkt` });
  }

  // Site generation
  const leadsWithoutSite = getQualifiedLeadsWithoutSite();
  if (leadsWithoutSite.length > 0) {
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: `${leadsWithoutSite.length} qualified leads zonder site` });
    let generated = 0;
    let genFailed = 0;
    for (const lead of leadsWithoutSite) {
      try {
        generateSiteForLead(lead);
        markSiteGenerated(lead.place_id);
        generated++;
      } catch (err) {
        genFailed++;
        appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Site fout voor ${lead.name}: ${err instanceof Error ? err.message : "onbekend"}` });
      }
    }
    appendLog({ timestamp: new Date().toISOString(), type: "success", message: `Sites: ${generated} gegenereerd, ${genFailed} mislukt` });
  }

  // Screenshot generation — voor alle qualified leads met site maar zonder screenshot
  if (agent.autoEmail) {
    const unmailedLeads = getUnmailedQualifiedLeads();
    const needScreenshot = unmailedLeads.filter((l) => siteExists(l.place_id) && !hasScreenshot(l.place_id));
    if (needScreenshot.length > 0) {
      appendLog({ timestamp: new Date().toISOString(), type: "info", message: `Screenshots maken voor ${needScreenshot.length} sites…` });
      let shot = 0;
      let shotFailed = 0;
      for (const lead of needScreenshot) {
        const result = await generateScreenshot(lead.place_id);
        if (result) shot++;
        else shotFailed++;
      }
      appendLog({ timestamp: new Date().toISOString(), type: "success", message: `Screenshots: ${shot} klaar, ${shotFailed} mislukt` });
    }
  }

  // Deploy (git push + Vercel domain sync) — always run, picks up any new slugs/screenshots
  appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Deploy starten…" });
  await autoDeploy();

  // Email
  if (agent.autoEmail && isSmtpConfigured()) {
    const leads = getUnmailedQualifiedLeads();
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: `${leads.length} qualified leads nog niet gemaild` });

    let sent = 0;
    let failed = 0;
    let withScreenshot = 0;
    for (const lead of leads) {
      const siteUrl = siteExists(lead.place_id)
        ? `/sites/${lead.place_id}/index.html`
        : undefined;
      let screenshotUrl = getScreenshotEmailUrl(lead.place_id, lead.slug);
      if (screenshotUrl) {
        const live = await waitForUrl(screenshotUrl, 45_000);
        if (!live) screenshotUrl = null;
        else withScreenshot++;
      }
      const result = await sendLeadEmail(lead, settings.smtp, siteUrl, screenshotUrl);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (result.error !== "No email address found for lead") {
          appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Mail fout voor ${lead.name}: ${result.error}` });
        }
      }
    }
    appendLog({ timestamp: new Date().toISOString(), type: "success", message: `E-mail: ${sent} verstuurd (${withScreenshot} met screenshot), ${failed} mislukt` });
  } else if (agent.autoEmail) {
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Auto-email overgeslagen: SMTP niet geconfigureerd" });
  }

  appendLog({ timestamp: new Date().toISOString(), type: "success", message: "Agent cyclus voltooid" });
  isRunning = false;
}

export function startAgent(): void {
  stopAgent();
  const settings = getSettings();
  if (!settings.agent.enabled) return;

  const schedule = settings.agent.cronSchedule || "0 9 * * *";
  if (!cron.validate(schedule)) {
    appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Ongeldige cron schedule: ${schedule}` });
    return;
  }

  cronTask = cron.schedule(schedule, () => {
    runAgentCycle().catch((err) => {
      appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Agent crash: ${err instanceof Error ? err.message : "onbekend"}` });
      isRunning = false;
    });
  });

  appendLog({ timestamp: new Date().toISOString(), type: "info", message: `Agent gestart met schedule: ${schedule}` });
}

export function stopAgent(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Agent gestopt" });
  }
}

