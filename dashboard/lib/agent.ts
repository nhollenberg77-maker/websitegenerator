import cron, { type ScheduledTask } from "node-cron";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getSettings, isSmtpConfigured } from "./settings";
import { getUnmailedQualifiedLeads, getQualifiedLeadsWithoutSite, markSiteGenerated } from "./db";
import { sendLeadEmail } from "./mailer";
import { generateSiteForLead, siteExists } from "./site-generator";

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

  appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Agent cyclus gestart" });

  const discoveryScript = path.resolve(process.cwd(), process.env.DISCOVERY_SCRIPT || "../discovery.py");
  const qualifyScript = path.resolve(process.cwd(), process.env.QUALIFY_SCRIPT || "../qualify.py");
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

  // Discovery per stad
  for (const city of agent.cities) {
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: `Discovery: ${city}` });

    const args = [
      "--city", city,
      "--categories", ...agent.categories,
      "--radius", String(agent.radius),
      "--limit", String(agent.limitPerCategory),
      "--db", dbPath,
    ];

    const result = await runScript(discoveryScript, args);
    if (result.code !== 0) {
      appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Discovery ${city} fout: ${result.stderr.slice(0, 200)}` });
    } else {
      const newMatch = result.stdout.match(/Nieuw in database\s*:\s*(\d+)/);
      const newCount = newMatch ? newMatch[1] : "?";
      appendLog({ timestamp: new Date().toISOString(), type: "success", message: `Discovery ${city}: ${newCount} nieuwe leads` });
    }
  }

  // Qualification
  appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Qualification starten…" });
  const qualResult = await runScript(qualifyScript, ["--db", dbPath]);
  if (qualResult.code !== 0) {
    appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Qualification fout: ${qualResult.stderr.slice(0, 200)}` });
  } else {
    const qualMatch = qualResult.stdout.match(/Qualified\s*:\s*(\d+)/);
    const qualCount = qualMatch ? qualMatch[1] : "?";
    appendLog({ timestamp: new Date().toISOString(), type: "success", message: `Qualification klaar: ${qualCount} qualified` });
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

  // Email
  if (agent.autoEmail && isSmtpConfigured()) {
    const leads = getUnmailedQualifiedLeads();
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: `${leads.length} qualified leads nog niet gemaild` });

    let sent = 0;
    let failed = 0;
    for (const lead of leads) {
      const siteUrl = siteExists(lead.place_id)
        ? `/sites/${lead.place_id}/index.html`
        : undefined;
      const result = await sendLeadEmail(lead, settings.smtp, siteUrl);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (result.error !== "No email address found for lead") {
          appendLog({ timestamp: new Date().toISOString(), type: "error", message: `Mail fout voor ${lead.name}: ${result.error}` });
        }
      }
    }
    appendLog({ timestamp: new Date().toISOString(), type: "success", message: `E-mail: ${sent} verstuurd, ${failed} mislukt` });
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

