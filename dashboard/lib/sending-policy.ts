// Verzendbeleid-engine: leest config/sending_schedule.yml en dwingt af WANNEER,
// HOEVEEL en HOE er gemaild wordt. Eerder werd dit bestand genegeerd.
//
// Afdwingbaar met onze data: verzendvenster (Europe/Warsaw + Poolse feestdagen),
// warming-curve, dagcap, throttle, content-guards, en (optioneel) NeverBounce.
// NIET afdwingbaar zonder ESP-feedback: bounce/spam/open/reply-circuit-breakers
// (die vereisen inbound/ESP-data die dit systeem niet ontvangt) — de
// orchestrator gebruikt in plaats daarvan een verzend-faalpercentage-breaker.

import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

interface MailboxCfg { id: string; warming_started?: string; daily_cap_max?: number; enabled?: boolean }
interface CurveRow { day_from: number; day_to: number | null; cold_mails: number }
export interface SendingPolicy {
  mailboxes: MailboxCfg[];
  warming_curve: CurveRow[];
  sending_window: { timezone: string; days: string[]; start_hour: number; end_hour: number; skip_polish_holidays?: boolean };
  throttling: { min_seconds_between_sends: number; max_seconds_between_sends: number };
  content_guards: {
    subject: { max_length_chars: number; forbidden_words: string[]; forbid_all_caps?: boolean; require_personalization_token?: boolean };
    body: { max_links: number; forbid_url_shorteners?: boolean; require_unsubscribe_line?: boolean; min_words: number; max_words: number };
  };
  lead_verification?: { enabled?: boolean; provider?: string };
}

let cache: { policy: SendingPolicy | null; at: number } | null = null;

export function getPolicy(): SendingPolicy | null {
  // 60s cache zodat we niet elke tick de YAML lezen.
  if (cache && Date.now() - cache.at < 60_000) return cache.policy;
  const p = path.resolve(process.cwd(), process.env.SENDING_SCHEDULE || "../config/sending_schedule.yml");
  let policy: SendingPolicy | null = null;
  try {
    policy = parseYaml(fs.readFileSync(p, "utf-8")) as SendingPolicy;
  } catch {
    policy = null;
  }
  cache = { policy, at: Date.now() };
  return policy;
}

// ── Europe/Warsaw klok-onderdelen (DST-veilig via Intl) ──
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function warsawParts(d: Date): { dow: string; hour: number; minute: number; second: number; ymd: string; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const wd = (parts.weekday || "Mon").toLowerCase().slice(0, 3);
  return {
    dow: wd, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    ymd: `${parts.year}-${parts.month}-${parts.day}`, year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
  };
}

// UTC-instant van middernacht (Warsaw) vandaag — voor de dagcap-telling.
export function startOfWarsawDayISO(now = new Date()): string {
  const w = warsawParts(now);
  const elapsedMs = ((w.hour * 60 + w.minute) * 60 + w.second) * 1000;
  return new Date(now.getTime() - elapsedMs).toISOString();
}

// ── Poolse feestdagen (vaste + Pasen-afhankelijke) ──
function easterSunday(year: number): { m: number; d: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}
function polishHolidays(year: number): Set<string> {
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  const s = new Set(fixed);
  const e = easterSunday(year);
  const easter = new Date(Date.UTC(year, e.m - 1, e.d));
  const add = (offsetDays: number) => {
    const d = new Date(easter.getTime() + offsetDays * 86400_000);
    s.add(`${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
  };
  add(1);  // Poniedziałek Wielkanocny (Easter Monday)
  add(49); // Zielone Świątki (Pentecost)
  add(60); // Boże Ciało (Corpus Christi)
  return s;
}

export function isWithinWindow(p: SendingPolicy, now = new Date()): { allowed: boolean; reason: string } {
  const w = warsawParts(now);
  const win = p.sending_window;
  if (!win.days.includes(w.dow)) return { allowed: false, reason: `buiten venster: ${w.dow} (alleen ${win.days.join("/")})` };
  if (w.hour < win.start_hour || w.hour >= win.end_hour) return { allowed: false, reason: `buiten uren: ${w.hour}:00 (venster ${win.start_hour}-${win.end_hour})` };
  if (win.skip_polish_holidays && polishHolidays(w.year).has(`${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`)) {
    return { allowed: false, reason: "Poolse feestdag" };
  }
  return { allowed: true, reason: "" };
}

export function effectiveDailyCap(p: SendingPolicy, now = new Date()): number {
  const enabled = p.mailboxes.filter((m) => m.enabled);
  if (enabled.length === 0) return 0;
  // Warming: pak de laagste curve-waarde over enabled mailboxen (conservatief).
  let curveCap = 0;
  for (const mb of enabled) {
    const start = mb.warming_started ? new Date(mb.warming_started + "T00:00:00Z") : now;
    const days = Math.floor((now.getTime() - start.getTime()) / 86400_000);
    const row = p.warming_curve.find((r) => days >= r.day_from && (r.day_to == null || days <= r.day_to));
    const cold = row ? row.cold_mails : 0;
    const ceiling = mb.daily_cap_max ?? cold;
    curveCap += Math.min(cold, ceiling);
  }
  return curveCap;
}

// ── Content-guards op de werkelijke mail ──
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "rebrand.ly"];
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
export function checkContent(
  p: SendingPolicy,
  input: { subject: string; html: string; text: string; leadName: string; unsubUrl: string }
): { hardFail: string[]; warnings: string[] } {
  const g = p.content_guards;
  const hardFail: string[] = [];
  const warnings: string[] = [];
  const subj = input.subject;

  if (subj.length > g.subject.max_length_chars) hardFail.push(`onderwerp >${g.subject.max_length_chars} tekens (${subj.length})`);
  const low = subj.toLowerCase();
  for (const w of g.subject.forbidden_words || []) if (low.includes(w.toLowerCase())) hardFail.push(`verboden woord in onderwerp: "${w}"`);
  if (g.subject.forbid_all_caps && subj === subj.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(subj)) hardFail.push("onderwerp is volledig HOOFDLETTERS");
  if (g.subject.require_personalization_token) {
    const token = input.leadName.split(/\s+/)[0];
    if (token && !subj.includes(token)) warnings.push("geen personalisatie-token in onderwerp");
  }

  // Links: tel UNIEKE externe http-links, exclusief de uitschrijf-URL en mailto.
  const hrefs = Array.from(input.html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]);
  const unsubHost = (() => { try { return new URL(input.unsubUrl).host; } catch { return ""; } })();
  const external = new Set(
    hrefs.filter((h) => /^https?:\/\//i.test(h))
      .filter((h) => { try { return new URL(h).host !== unsubHost; } catch { return true; } })
      .map((h) => { try { return new URL(h).host; } catch { return h; } })
  );
  if (external.size > g.body.max_links) warnings.push(`${external.size} externe links (max ${g.body.max_links})`);
  if (g.body.forbid_url_shorteners && hrefs.some((h) => SHORTENERS.some((s) => h.includes(s)))) hardFail.push("URL-shortener in body");
  if (g.body.require_unsubscribe_line && !input.html.includes(input.unsubUrl)) hardFail.push("geen uitschrijf-link in body");
  const wc = wordCount(input.text);
  if (wc < g.body.min_words) hardFail.push(`te kort: ${wc} woorden (min ${g.body.min_words})`);
  if (wc > g.body.max_words) warnings.push(`lang: ${wc} woorden (max ${g.body.max_words})`);

  return { hardFail, warnings };
}

// Gate die throttle + dagcap combineert (venster apart aanroepen).
export function evaluateThrottleAndCap(
  p: SendingPolicy,
  input: { sentToday: number; lastSendAtMs: number | null; now?: Date }
): { allowed: boolean; reason: string } {
  const now = input.now ?? new Date();
  const cap = effectiveDailyCap(p, now);
  if (input.sentToday >= cap) return { allowed: false, reason: `dagcap bereikt: ${input.sentToday}/${cap}` };
  if (input.lastSendAtMs != null) {
    const gapS = (now.getTime() - input.lastSendAtMs) / 1000;
    if (gapS < p.throttling.min_seconds_between_sends) {
      return { allowed: false, reason: `throttle: ${Math.round(gapS)}s sinds laatste (min ${p.throttling.min_seconds_between_sends}s)` };
    }
  }
  return { allowed: true, reason: "" };
}

// Optionele e-mailverificatie (NeverBounce). Zonder API-key → 'skip' (blokkeert niet).
export async function verifyEmail(email: string): Promise<"ok" | "reject" | "skip"> {
  const key = process.env.NEVERBOUNCE_API_KEY;
  if (!key) return "skip";
  try {
    const res = await fetch(`https://api.neverbounce.com/v4/single/check?key=${key}&email=${encodeURIComponent(email)}`);
    if (!res.ok) return "skip";
    const data = await res.json();
    const result = data.result as string;
    if (["invalid", "disposable", "unknown", "catchall"].includes(result)) return "reject";
    return "ok";
  } catch {
    return "skip";
  }
}
