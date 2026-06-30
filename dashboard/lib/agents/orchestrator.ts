// Orchestrator — het hart van de runtime. Eén tick():
//  1. (periodiek) draai de Manager
//  2. reconcile: zet downstream-taken klaar op basis van de DB-stand
//  3. claim pending taken en dispatch ze naar de juiste agent
//  4. verstuur GOEDGEKEURDE mails (na deploy), binnen een per-tick cap
//
// Bedoeld om continu te draaien vanuit worker.ts (cloud 24/7).

import { ensureAgentTables, claimNextTasks, completeTask, failTask, createTask, hasTaskForLead, getActiveGoals, getApprovedUnsent, markApprovedSent, addFeedback, postMessage, listTasks, countLeads, listPendingApprovals, setApproval } from "./store";
import { seedAgentConfigs, seedInitialGoal } from "./seed";
import { runScout } from "./scout";
import { runBuilder } from "./builder";
import { runWriter } from "./writer";
import { runManager, computeGoalProgress } from "./manager";
import { isAiConfigured } from "../ai";
import {
  getQualifiedLeadsWithoutSite,
  getLeadsWithSite,
  markLeadEmailed,
  getLeadById,
  recordSendOutcome,
  recentSendFailureRate,
  lastEmailedAtMs,
} from "../db";
import { siteExists } from "../site-generator";
import { getScreenshotEmailUrl, waitForUrl } from "../screenshot";
import { sendLeadEmail } from "../mailer";
import { generateEmailSubject, generateEmailHtml } from "../email-template";
import { getSettings, isSmtpConfigured } from "../settings";
import { autoDeploy } from "../deploy";
import { getPolicy, isWithinWindow, evaluateThrottleAndCap, checkContent, verifyEmail, startOfWarsawDayISO } from "../sending-policy";
import type { Task, GoalParams } from "./types";

const TASK_CONCURRENCY = 2;
const MANAGER_INTERVAL_MS = 5 * 60 * 1000; // elke 5 min — mail-tempo regelt sending-policy

let lastManagerRun = 0;
let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  ensureAgentTables();
  seedAgentConfigs();
  seedInitialGoal();
  initialized = true;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function dispatch(task: Task): Promise<void> {
  try {
    switch (task.type) {
      case "discover":
      case "qualify":
        await runScout(task);
        break;
      case "build_site":
      case "enrich":
        await runBuilder(task);
        break;
      case "write_email":
        await runWriter(task);
        break;
      default:
        throw new Error(`Onbekend taaktype: ${task.type}`);
    }
    completeTask(task.id, { ok: true });
  } catch (err) {
    failTask(task.id, err instanceof Error ? err.message : "onbekend", true);
  }
}

// Zet downstream-taken klaar op basis van de DB-stand (idempotent via dedup).
function reconcile(): void {
  // qualified leads zonder site → build_site
  for (const lead of getQualifiedLeadsWithoutSite()) {
    if (!hasTaskForLead("build_site", lead.place_id)) {
      createTask({ type: "build_site", assignedAgent: "builder", leadPlaceId: lead.place_id, priority: 5 });
    }
  }
  // leads met site + e-mail, nog geen concept/goedkeuring → write_email
  for (const lead of getLeadsWithSite()) {
    if (!lead.contact_email) continue;
    const status = lead.approval_status;
    const fresh = !status || status === "none";
    if (fresh && !hasTaskForLead("write_email", lead.place_id)) {
      createTask({ type: "write_email", assignedAgent: "writer", leadPlaceId: lead.place_id, priority: 6 });
    }
  }
}

// Deterministische fallback als er geen Manager-AI is: maak een discover-taak
// voor elk actief, niet-gehaald doel zonder lopende discover-taak.
function fallbackPlan(): void {
  const openDiscover = listTasks({ status: "pending" }).concat(listTasks({ status: "running" })).filter((t) => t.type === "discover").length;
  if (openDiscover > 0) return;
  for (const goal of getActiveGoals()) {
    const current = computeGoalProgress(goal);
    if (goal.target_value && current >= goal.target_value) continue;
    const params: GoalParams = goal.params ? JSON.parse(goal.params) : {};
    createTask({
      type: "discover",
      assignedAgent: "scout",
      goalId: goal.id,
      priority: 3,
      payload: {
        cities: params.cities ?? ["krakow"],
        categories: params.categories ?? ["plumber", "roofing_contractor"],
        radius: params.radius ?? 30000,
        limitPerCategory: params.limitPerCategory ?? 15,
        minGbpScore: params.minGbpScore ?? 5,
      },
    });
    postMessage({ from: "manager", kind: "info", body: `(auto) discover-taak voor doel "${goal.description}" — ${current}/${goal.target_value}` });
  }
}

const UNSUB_BASE = (process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || "https://app.stronadlatwojejfirmy.com.pl").replace(/\/$/, "");
let lastWindowLog = 0;

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Verstuurt hooguit één goedgekeurde mail per tick, volledig conform
// config/sending_schedule.yml: circuit-breaker → venster → dagcap/warming →
// throttle → e-mailverificatie → content-guards → verzenden.
async function sendApproved(): Promise<void> {
  const approved = getApprovedUnsent();
  if (approved.length === 0) return;
  const settings = getSettings();
  if (!isSmtpConfigured()) return; // stil — geen spam in de feed elke tick

  const policy = getPolicy();
  const now = new Date();

  // 0) Circuit-breaker: pauzeer bij hoog verzend-faalpercentage (de meetbare
  //    proxy; echte bounce/spam-breakers vereisen ESP-feedback die we niet hebben).
  const fr = recentSendFailureRate(20);
  if (fr.total >= 10 && fr.rate >= 0.5) {
    postMessage({ from: "manager", kind: "alert", body: `⛔ Circuit-breaker: ${Math.round(fr.rate * 100)}% van de laatste ${fr.total} verzendingen faalde — verzenden gepauzeerd. Controleer SMTP/domein.` });
    return;
  }

  if (policy) {
    // 1) Verzendvenster
    const win = isWithinWindow(policy, now);
    if (!win.allowed) {
      if (Date.now() - lastWindowLog > 30 * 60_000) { // hooguit elke 30 min loggen
        lastWindowLog = Date.now();
        postMessage({ from: "manager", kind: "info", body: `⏸ Verzenden buiten venster (${win.reason}) — ${approved.length} mail(s) wachten.` });
      }
      return;
    }
    // 2) Dagcap (warming-curve) + 3) throttle
    const sentToday = countLeads("WHERE emailed_at >= ?", [startOfWarsawDayISO(now)]);
    const gate = evaluateThrottleAndCap(policy, { sentToday, lastSendAtMs: lastEmailedAtMs(), now });
    if (!gate.allowed) return; // stil — wordt vaak geraakt (throttle)
  }

  // Publiceer sites/screenshots zodat de ingebedde screenshot-URL live is
  await autoDeploy().catch(() => {});

  // Stuur hooguit één mail (throttle bewaakt het tempo via emailed_at).
  for (const lead of approved) {
    const fresh = getLeadById(lead.place_id) || lead;
    if (!fresh.contact_email) continue;

    // E-mailverificatie (NeverBounce, alleen als ingeschakeld + key aanwezig)
    if (policy?.lead_verification?.enabled) {
      const v = await verifyEmail(fresh.contact_email);
      if (v === "reject") {
        markApprovedSent(fresh.place_id); // uit de wachtrij halen, niet sturen
        postMessage({ from: "manager", kind: "alert", body: `Mail naar "${fresh.name}" overgeslagen — e-mailverificatie: ongeldig adres.`, leadPlaceId: fresh.place_id });
        continue;
      }
    }

    const siteUrl = siteExists(fresh.place_id) ? `/sites/${fresh.place_id}/index.html` : undefined;
    let screenshotUrl = getScreenshotEmailUrl(fresh.place_id, fresh.slug);
    if (screenshotUrl && !(await waitForUrl(screenshotUrl, 45_000))) screenshotUrl = null;

    // Content-guards op de werkelijke mail
    if (policy) {
      const subject = generateEmailSubject(fresh);
      const html = generateEmailHtml(fresh, siteUrl, screenshotUrl, settings.smtp);
      const unsubUrl = `${UNSUB_BASE}/unsubscribe?pid=${encodeURIComponent(fresh.place_id)}`;
      const guard = checkContent(policy, { subject, html, text: stripHtml(html), leadName: fresh.name, unsubUrl });
      if (guard.hardFail.length) {
        markApprovedSent(fresh.place_id); // blokkeer + uit wachtrij
        postMessage({ from: "manager", kind: "alert", body: `Mail naar "${fresh.name}" geblokkeerd door content-guards: ${guard.hardFail.join("; ")}`, leadPlaceId: fresh.place_id });
        continue;
      }
      if (guard.warnings.length) {
        postMessage({ from: "manager", kind: "info", body: `⚠ Content-waarschuwing "${fresh.name}": ${guard.warnings.join("; ")}` });
      }
    }

    const result = await sendLeadEmail(fresh, settings.smtp, siteUrl, screenshotUrl);
    recordSendOutcome(fresh.place_id, fresh.contact_email, result.ok ? "sent" : "failed", result.error);
    if (result.ok) {
      markLeadEmailed(fresh.place_id);
      markApprovedSent(fresh.place_id);
      addFeedback({ kind: "email_outcome", leadPlaceId: fresh.place_id, metric: "sent", value: { at: now.toISOString() } });
      postMessage({ from: "manager", kind: "info", body: `📤 Mail verstuurd naar "${fresh.name}".`, leadPlaceId: fresh.place_id });
    } else {
      postMessage({ from: "manager", kind: "alert", body: `Mail naar "${fresh.name}" mislukt: ${result.error}`, leadPlaceId: fresh.place_id });
    }
    break; // één mail per tick — throttle regelt het tempo
  }
}

// Eén volledige ronde. Retourneert een korte samenvatting voor de worker-log.
export async function tick(): Promise<{ ran: number; summary: string }> {
  ensureInit();

  // 0) Pauze-knop uit instellingen — hele team stil.
  const appSettings = getSettings();
  if (appSettings.agent.paused) return { ran: 0, summary: "team gepauzeerd (instellingen)" };

  // 1) Manager periodiek (of deterministische fallback)
  const sinceManager = Date.now() - lastManagerRun;
  if (sinceManager >= MANAGER_INTERVAL_MS || lastManagerRun === 0) {
    lastManagerRun = Date.now();
    if (isAiConfigured()) {
      await runManager().catch((err) => postMessage({ from: "manager", kind: "alert", body: `Manager-fout: ${err instanceof Error ? err.message : "onbekend"}` }));
    } else {
      fallbackPlan();
    }
  }

  // 2) downstream-taken klaarzetten
  reconcile();

  // 2b) Goedkeur-poort uit? Dan keuren we klaargezette mails automatisch goed.
  if (appSettings.agent.approvalRequired === false) {
    for (const lead of listPendingApprovals()) setApproval(lead.place_id, "approved", "auto (goedkeuring uitgeschakeld)");
  }

  // 3) taken oppakken en uitvoeren
  const claimed = claimNextTasks(TASK_CONCURRENCY);
  if (claimed.length > 0) {
    await mapLimit(claimed, TASK_CONCURRENCY, dispatch);
  }

  // 4) goedgekeurde mails versturen
  await sendApproved().catch((err) => postMessage({ from: "manager", kind: "alert", body: `Verzendfout: ${err instanceof Error ? err.message : "onbekend"}` }));

  const summary = claimed.length
    ? `${claimed.length} taak/taken uitgevoerd: ${claimed.map((t) => t.type).join(", ")}`
    : "geen openstaande taken";
  return { ran: claimed.length, summary };
}
