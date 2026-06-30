// Orchestrator — het hart van de runtime. Eén tick():
//  1. (periodiek) draai de Manager
//  2. reconcile: zet downstream-taken klaar op basis van de DB-stand
//  3. claim pending taken en dispatch ze naar de juiste agent
//  4. verstuur GOEDGEKEURDE mails (na deploy), binnen een per-tick cap
//
// Bedoeld om continu te draaien vanuit worker.ts (cloud 24/7).

import { ensureAgentTables, claimNextTasks, completeTask, failTask, createTask, hasTaskForLead, getActiveGoals, getApprovedUnsent, markApprovedSent, addFeedback, postMessage, listTasks, countLeads, listPendingApprovals, setApproval, resetStaleRunningTasks, requeueSiteRebuild } from "./store";
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
  recentBounceRate,
  lastEmailedAtMs,
} from "../db";
import { siteExists, siteQualityIssues } from "../site-generator";
import { getScreenshotEmailUrl, waitForUrl } from "../screenshot";
import { sendLeadEmail } from "../mailer";
import { generateEmailSubject, generateEmailHtml } from "../email-template";
import { getSettings, isSmtpConfigured } from "../settings";
import { autoDeploy } from "../deploy";
import { getPolicy, isWithinWindow, evaluateThrottleAndCap, checkContent, verifyEmail, startOfWarsawDayISO } from "../sending-policy";
import { isOverBudget, budgetStatus } from "./budget";
import { pollInbox } from "../inbox";
import type { Task, GoalParams } from "./types";

const TASK_CONCURRENCY = 6;
const MANAGER_INTERVAL_MS = 20 * 60 * 1000; // elke 20 min — Manager (Sonnet+vision) is duur; workers draaien los door
let managerBusy = false; // Manager draait niet-blokkerend; voorkom overlap
let goalReachedAnnounced = false; // eenmalige "doel bereikt"-melding

let lastManagerRun = 0;
let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  ensureAgentTables();
  seedAgentConfigs();
  seedInitialGoal();
  resetStaleRunningTasks(); // verweesde taken van een vorige worker opruimen
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
// Automatische kwaliteitscontrole: detecteert zwakke sites (lege content, geen
// menu/prijslijst, niet-Poolse tekens) en laat ze automatisch herbouwen. Na een
// paar pogingen escaleert het naar de Manager (handmatig bekijken/overrulen).
const QC_MAX_REBUILDS = 2;
const qcRebuilds = new Map<string, number>();
const qcAlerted = new Set<string>();
let lastQc = 0;
const QC_INTERVAL_MS = 5 * 60_000;

function qcSites(): void {
  for (const lead of getLeadsWithSite()) {
    const issues = siteQualityIssues(lead);
    if (!issues.length) { qcRebuilds.delete(lead.place_id); qcAlerted.delete(lead.place_id); continue; }
    const n = qcRebuilds.get(lead.place_id) ?? 0;
    if (n < QC_MAX_REBUILDS) {
      qcRebuilds.set(lead.place_id, n + 1);
      requeueSiteRebuild(lead.place_id);
      postMessage({ from: "manager", kind: "info", body: `QC: site "${lead.name}" — ${issues.join(", ")} → automatisch opnieuw bouwen (poging ${n + 1}/${QC_MAX_REBUILDS}).`, leadPlaceId: lead.place_id });
    } else if (!qcAlerted.has(lead.place_id)) {
      qcAlerted.add(lead.place_id);
      postMessage({ from: "manager", kind: "alert", body: `QC: site "${lead.name}" blijft zwak (${issues.join(", ")}) na ${QC_MAX_REBUILDS} herbouwen — bekijk handmatig met inspect_site of overrule de lead.`, leadPlaceId: lead.place_id });
    }
  }
}

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
let lastBudgetLog = 0;
let lastInboxPoll = 0;
const INBOX_POLL_MS = 10 * 60_000; // reply/bounce-check elke 10 min
let lastDeploy = 0;
const DEPLOY_INTERVAL_MS = 5 * 60_000; // nieuwe sites + screenshots periodiek live zetten op Vercel

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
  // Echte bounce-rate (uit IMAP) — beschermt domein-reputatie (schema: stop ≥3.5%).
  const br = recentBounceRate(100);
  if (br.sent >= 20 && br.rate >= 0.035) {
    postMessage({ from: "manager", kind: "alert", body: `⛔ Circuit-breaker: bounce-rate ${(br.rate * 100).toFixed(1)}% (${br.bounced}/${br.sent}) ≥ 3.5% — verzenden gepauzeerd om je domein te beschermen.` });
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

  // 0b) Doel(en) bereikt? Dan schaalt het team af: géén nieuwe lead-generatie en
  //     géén (dure) Manager meer. In-flight builds/mails worden nog afgemaakt en
  //     goedgekeurde mails worden nog verstuurd/opgevolgd (goedkoop), zodat de
  //     klaarstaande concepten niet blijven hangen.
  const activeGoals = getActiveGoals();
  const goalsMet = activeGoals.length > 0 && activeGoals.every((g) => !g.target_value || computeGoalProgress(g) >= g.target_value);
  if (goalsMet && !goalReachedAnnounced) {
    goalReachedAnnounced = true;
    postMessage({ from: "manager", kind: "info", body: "🎯 Doel bereikt — lead-generatie en Manager gestopt. Alleen klaarstaande mails versturen + opvolgen blijft lopen." });
  }
  if (!goalsMet) goalReachedAnnounced = false;

  // 1) Manager periodiek — NIET-BLOKKEREND. Stopt zodra het doel bereikt is.
  const sinceManager = Date.now() - lastManagerRun;
  if (!goalsMet && !managerBusy && (sinceManager >= MANAGER_INTERVAL_MS || lastManagerRun === 0)) {
    lastManagerRun = Date.now();
    if (isAiConfigured()) {
      managerBusy = true;
      runManager()
        .catch((err) => postMessage({ from: "manager", kind: "alert", body: `Manager-fout: ${err instanceof Error ? err.message : "onbekend"}` }))
        .finally(() => { managerBusy = false; });
    } else {
      fallbackPlan();
    }
  }

  // 1b) Budgetplafond bereikt? Stop dure agent-arbeid (LLM-loops), maar laat
  //     reeds-goedgekeurde mail nog wel verzonden worden (goedkoop).
  const over = isOverBudget();
  if (over) {
    if (Date.now() - lastBudgetLog > 30 * 60_000) {
      lastBudgetLog = Date.now();
      const b = budgetStatus();
      postMessage({ from: "manager", kind: "alert", body: `⛔ Maandbudget bereikt ($${b.month.toFixed(2)}/$${b.monthlyCap}). Agents pauzeren tot volgende maand of verhoog het plafond. Goedgekeurde mails worden nog verstuurd.` });
    }
    await sendApproved().catch(() => {});
    return { ran: 0, summary: "budgetplafond bereikt — agents gepauzeerd" };
  }

  // 1c) Automatische kwaliteitscontrole van gebouwde sites (periodiek). Zwakke
  //     sites worden vóór reconcile teruggezet, zodat ze meteen herbouwd worden.
  if (Date.now() - lastQc >= QC_INTERVAL_MS) {
    lastQc = Date.now();
    qcSites();
  }

  // 2) downstream-taken klaarzetten
  reconcile();

  // 2a) ALTIJD ontdekkingswerk klaarzetten als we onder het doel zitten — niet
  //     wachten op de Manager (die draait maar elke 20 min). Houdt de Scout
  //     continu aan het werk i.p.v. de wachtrij te laten leeglopen.
  fallbackPlan();

  // 2b) Goedkeur-poort uit? Dan keuren we klaargezette mails automatisch goed.
  if (appSettings.agent.approvalRequired === false) {
    for (const lead of listPendingApprovals()) setApproval(lead.place_id, "approved", "auto (goedkeuring uitgeschakeld)");
  }

  // 3) taken oppakken en uitvoeren
  const claimed = claimNextTasks(TASK_CONCURRENCY);
  if (claimed.length > 0) {
    await mapLimit(claimed, TASK_CONCURRENCY, dispatch);
  }

  // 3b) Nieuwe sites/screenshots periodiek publiceren naar Vercel — zodat de
  //     klant de concept-site kan zien én de mail-screenshot publiek laadt,
  //     niet pas op het moment van verzenden.
  if (Date.now() - lastDeploy >= DEPLOY_INTERVAL_MS) {
    lastDeploy = Date.now();
    await autoDeploy().catch((err) => postMessage({ from: "manager", kind: "alert", body: `Deploy-fout: ${err instanceof Error ? err.message : "onbekend"}` }));
  }

  // 4) goedgekeurde mails versturen
  await sendApproved().catch((err) => postMessage({ from: "manager", kind: "alert", body: `Verzendfout: ${err instanceof Error ? err.message : "onbekend"}` }));

  // 5) reply-/bounce-tracking (IMAP, alleen als geconfigureerd)
  if (Date.now() - lastInboxPoll >= INBOX_POLL_MS) {
    lastInboxPoll = Date.now();
    await pollInbox().catch(() => {});
  }

  const summary = claimed.length
    ? `${claimed.length} taak/taken uitgevoerd: ${claimed.map((t) => t.type).join(", ")}`
    : "geen openstaande taken";
  return { ran: claimed.length, summary };
}
