"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Play, Loader2, ArrowRight, CheckCircle2, AlertTriangle, Globe, Users, Mail, Search, ScanSearch, Sparkles, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentLogEntry {
  timestamp: string;
  type: "info" | "error" | "success";
  message: string;
}

interface AgentStatus {
  running: boolean;
  enabled: boolean;
  schedule: string;
}

interface Stats {
  total: number;
  qualified: number;
  rejected: number;
  pending: number;
  sites: number;
  emailed: number;
}

interface Settings {
  smtp: { host: string; user: string; pass: string; fromEmail: string };
  agent: { enabled: boolean; cities: string[]; categories: string[]; autoEmail: boolean };
}

const STEPS = [
  { key: "discovery", label: "Discovery", icon: Search, match: /Discovery:/i },
  { key: "qualify", label: "Qualify", icon: ScanSearch, match: /Qualification starten|Qualification klaar/i },
  { key: "enrich", label: "Enrich", icon: Sparkles, match: /Enrichment starten|Enrichment klaar/i },
  { key: "sites", label: "Sites", icon: Globe, match: /qualified leads zonder site|Sites: \d/i },
  { key: "email", label: "Mail", icon: Mail, match: /qualified leads nog niet gemaild|E-mail: \d/i },
] as const;

function detectCurrentStep(logs: AgentLogEntry[], running: boolean): string | null {
  if (!running) return null;
  // Walk backwards through logs to find latest matching step
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i].message;
    for (const step of STEPS) {
      if (step.match.test(msg)) return step.key;
    }
  }
  return null;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s geleden`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  return `${Math.floor(diff / 86400)} dagen geleden`;
}

export function Cockpit() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [starting, setStarting] = useState(false);

  const fetchAll = useCallback(async () => {
    const [agentRes, statsRes, settingsRes] = await Promise.all([
      fetch("/api/agent").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setStatus(agentRes.status);
    setLogs(agentRes.logs);
    setStats(statsRes);
    setSettings(settingsRes);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const isRunning = status?.running;
    const interval = setInterval(fetchAll, isRunning ? 1500 : 8000);
    return () => clearInterval(interval);
  }, [status?.running, fetchAll]);

  const currentStep = useMemo(() => detectCurrentStep(logs, status?.running || false), [logs, status?.running]);
  const lastRunLog = useMemo(() => [...logs].reverse().find((l) => /cyclus voltooid|cyclus gestart/i.test(l.message)), [logs]);

  const handleRun = async () => {
    setStarting(true);
    await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run-now" }),
    });
    // Immediately mark as running optimistically
    setStatus((s) => (s ? { ...s, running: true } : s));
    await fetchAll();
    setStarting(false);
  };

  const [deploying, setDeploying] = useState(false);
  const handleDeploy = async () => {
    setDeploying(true);
    await fetch("/api/deploy", { method: "POST" });
    await fetchAll();
    // Keep deploying flag for ~3s so user sees feedback
    setTimeout(() => setDeploying(false), 3000);
  };

  const smtpConfigured = !!(settings?.smtp?.host && settings?.smtp?.user && settings?.smtp?.pass);
  const citiesConfigured = (settings?.agent?.cities?.length || 0) > 0;
  const categoriesConfigured = (settings?.agent?.categories?.length || 0) > 0;
  const autoEmailEnabled = settings?.agent?.autoEmail || false;

  const canRun = citiesConfigured && categoriesConfigured;
  const preflightOk = canRun && smtpConfigured;

  const funnelData = stats
    ? [
        { label: "Ontdekt", value: stats.total, icon: Database, color: "bg-ink-soft" },
        { label: "Qualified", value: stats.qualified, icon: CheckCircle2, color: "bg-success" },
        { label: "Sites gegenereerd", value: stats.sites, icon: Globe, color: "bg-navy" },
        { label: "E-mails verstuurd", value: stats.emailed, icon: Mail, color: "bg-warning" },
      ]
    : [];
  const funnelMax = Math.max(...funnelData.map((f) => f.value), 1);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="font-display text-3xl font-semibold text-ink tracking-tight">
          Cockpit. <span className="italic font-normal text-ink-soft">Eén knop, hele pipeline.</span>
        </h2>
        <p className="text-sm text-ink-soft mt-2">
          Discovery → Qualify → Enrich → Site gen → Mail. Allemaal vanaf hier.
        </p>
      </div>

      {/* ============ ACTION PANEL ============ */}
      <div className="bg-navy text-white rounded-xl p-6 md:p-8 mb-6 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/55 mb-3">
            <span className={cn(
              "h-2 w-2 rounded-full",
              status?.running ? "bg-green-400 animate-pulse" : preflightOk ? "bg-green-400" : "bg-amber-400"
            )} />
            {status?.running ? "Pipeline draait" : lastRunLog ? `Idle — vorige actie ${timeAgo(lastRunLog.timestamp)}` : "Klaar voor de eerste run"}
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div>
              <h3 className="font-display text-2xl md:text-3xl font-semibold leading-tight">
                {status?.running ? "Pipeline bezig…" : "Start volledige cyclus."}
              </h3>
              <p className="text-sm text-white/60 mt-2 max-w-md">
                {status?.running
                  ? "Wacht tot alle stappen klaar zijn. Voortgang hieronder."
                  : "Vindt nieuwe leads, kwalificeert, verrijkt, bouwt sites en verstuurt mails."}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <Button
                size="lg"
                onClick={handleDeploy}
                disabled={deploying || status?.running}
                className="bg-white/10 hover:bg-white/15 text-white border border-white/20 font-medium px-5 py-6 text-sm disabled:opacity-50"
                title="Push huidige sites naar Vercel + voeg ontbrekende subdomeinen toe"
              >
                {deploying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deployen…
                  </>
                ) : (
                  <>
                    <Globe className="h-4 w-4 mr-2" />
                    Deploy nu
                  </>
                )}
              </Button>
              <Button
                size="lg"
                onClick={handleRun}
                disabled={starting || status?.running || !canRun}
                className="bg-white text-navy hover:bg-white/90 font-semibold px-8 py-6 text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {starting || status?.running ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Bezig…
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" fill="currentColor" />
                    Start cyclus
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* ============ PIPELINE STRIP ============ */}
          <div className="flex items-center gap-1 md:gap-3 overflow-x-auto -mx-2 px-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = currentStep === step.key;
              const isPast = currentStep && STEPS.findIndex((s) => s.key === currentStep) > idx;
              return (
                <div key={step.key} className="flex items-center gap-1 md:gap-3 shrink-0">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
                      isActive && "bg-white/15 ring-1 ring-white/30",
                      isPast && "opacity-60",
                      !isActive && !isPast && "opacity-50"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isActive && "animate-pulse")} />
                    <span className="text-xs md:text-sm font-medium">{step.label}</span>
                  </div>
                  {idx < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-white/30 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ============ FUNNEL + LIVE ACTIVITY ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        {/* Funnel */}
        <div className="lg:col-span-2 bg-card border border-line rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-sm font-semibold text-ink tracking-wider uppercase">Funnel</h3>
            <Link href="/leads" className="text-xs text-ink-soft hover:text-navy underline-offset-2 hover:underline">
              alle leads →
            </Link>
          </div>
          <div className="space-y-4">
            {funnelData.map((row) => (
              <div key={row.label}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm text-ink-soft">{row.label}</span>
                  <span className="font-display text-xl font-semibold text-ink tabular-nums">{row.value}</span>
                </div>
                <div className="h-1.5 bg-background-alt rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", row.color)}
                    style={{ width: `${(row.value / funnelMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {stats && stats.pending > 0 && (
            <div className="mt-5 pt-4 border-t border-line text-xs text-ink-soft">
              {stats.pending} pending · {stats.rejected} afgewezen
            </div>
          )}
        </div>

        {/* Live activity */}
        <div className="lg:col-span-3 bg-[#1a1a1a] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full", status?.running ? "bg-green-400 animate-pulse" : "bg-white/20")} />
              <span className="text-xs text-white/55 font-mono tracking-wider uppercase">Live log</span>
            </div>
            <span className="text-xs text-white/35 font-mono">{logs.length}</span>
          </div>
          <div className="p-5 h-72 lg:h-80 overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.length === 0 && (
              <p className="text-white/30">Nog geen activiteit. Druk op &quot;Start cyclus&quot; om te beginnen.</p>
            )}
            {logs.slice(-50).reverse().map((entry, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-words py-0.5",
                  entry.type === "error" && "text-orange-400",
                  entry.type === "success" && "text-green-400",
                  entry.type === "info" && "text-white/65"
                )}
              >
                <span className="text-white/30">
                  {new Date(entry.timestamp).toLocaleTimeString("nl-NL")}
                </span>{" "}
                {entry.message}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ PRE-FLIGHT CHECKS ============ */}
      <div className="bg-card border border-line rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm font-semibold text-ink tracking-wider uppercase">Pre-flight</h3>
          <Link href="/settings" className="text-xs text-ink-soft hover:text-navy underline-offset-2 hover:underline">
            instellingen aanpassen →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Check
            ok={citiesConfigured}
            label={`${settings?.agent?.cities?.length || 0} steden geconfigureerd`}
            hint={!citiesConfigured ? "Kies minimaal 1 stad bij instellingen" : undefined}
          />
          <Check
            ok={categoriesConfigured}
            label={`${settings?.agent?.categories?.length || 0} categorieën geconfigureerd`}
            hint={!categoriesConfigured ? "Kies minimaal 1 categorie bij instellingen" : undefined}
          />
          <Check
            ok={smtpConfigured}
            label={smtpConfigured ? `SMTP via ${settings?.smtp?.host}` : "SMTP niet geconfigureerd"}
            hint={!smtpConfigured ? "Zonder SMTP worden geen e-mails verstuurd" : undefined}
          />
          <Check
            ok={autoEmailEnabled}
            label={autoEmailEnabled ? "Auto-email staat aan" : "Auto-email staat uit"}
            hint={!autoEmailEnabled ? "Sites worden gegenereerd maar niet verstuurd" : undefined}
            warningOnly={!autoEmailEnabled}
          />
        </div>
      </div>

      {/* ============ QUICK LINKS ============ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
        <QuickLink href="/leads" icon={Users} label="Leads doorbladeren" hint={`${stats?.total || 0} leads in database`} />
        <QuickLink href="/sites" icon={Globe} label="Sites bekijken" hint={`${stats?.sites || 0} voorbeeldsites`} />
        <QuickLink href="/settings" icon={Mail} label="SMTP / steden / cron" hint="Instellingen" />
      </div>
    </div>
  );
}

function Check({ ok, label, hint, warningOnly = false }: { ok: boolean; label: string; hint?: string; warningOnly?: boolean }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-background-alt/50">
      <div
        className={cn(
          "h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          ok ? "bg-success text-white" : warningOnly ? "bg-amber-100 text-amber-700" : "bg-warning/15 text-warning"
        )}
      >
        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink leading-snug">{label}</div>
        {hint && <div className="text-xs text-ink-soft mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, hint }: { href: string; icon: typeof Globe; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 p-4 rounded-xl border border-line bg-card hover:border-navy hover:shadow-sm transition-all"
    >
      <div className="h-9 w-9 rounded-lg bg-background-alt flex items-center justify-center shrink-0 group-hover:bg-navy group-hover:text-white transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink truncate">{label}</div>
        <div className="text-xs text-ink-soft truncate">{hint}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-ink-soft ml-auto group-hover:text-navy transition-colors shrink-0" />
    </Link>
  );
}

