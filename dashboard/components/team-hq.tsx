"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Compass, Search, Building2, PenLine, Loader2, CheckCircle2, XCircle,
  Target, Plus, Inbox, Lightbulb, Zap, TrendingUp, Coins, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AgentName = "manager" | "scout" | "builder" | "writer";

interface AgentCard {
  name: AgentName;
  mission: string | null;
  strategy: string | null;
  enabled: boolean;
  lastRun: { status: string; summary: string | null; at: string | null; reasoning: string | null } | null;
  throughputLastHour: number;
  tasksCompleted: number;
  successRate: number;
  tokens: number;
  cost: number;
}
interface GoalRow { id: number; description: string; target: number | null; current: number; status: string; }
interface FeedMsg { id: number; from_agent: string; to_agent: string | null; kind: string; body: string; created_at: string | null; }
interface Approval {
  place_id: string; name: string; city_query: string | null; category_query: string | null;
  slug: string | null; contact_email: string | null; email_subject: string | null;
  email_body_html: string | null; email_quality_score: number | null; site_quality_score: number | null;
}
interface RecentTask { id: number; agent: string; summary: string | null; status: string; tokens: number; toolCalls: number; iterations: number; cost: number; at: string | null; }
interface TeamData {
  agents: AgentCard[]; goals: GoalRow[]; queue: Record<string, number>;
  feed: FeedMsg[]; learnings: { id: number; note: string | null }[];
  recentTasks: RecentTask[]; pendingApprovals: number;
  cost: { total: number; totalTokens: number; byModel: { model: string; tokens: number; cost: number }[] };
  budget: { month: number; monthlyCap: number; remaining: number | null; pctUsed: number | null; costPerQualified: number | null };
  activity: { range: string; series: { t: number; runs: number; tokens: number }[] };
  stats: { qualified: number; sites: number; emailed: number; replied: number };
}

const AGENT_META: Record<AgentName, { label: string; icon: typeof Compass; tint: string }> = {
  manager: { label: "Manager", icon: Compass, tint: "text-amber-300" },
  scout: { label: "Scout", icon: Search, tint: "text-sky-300" },
  builder: { label: "Builder", icon: Building2, tint: "text-violet-300" },
  writer: { label: "Writer", icon: PenLine, tint: "text-emerald-300" },
};
const KIND_COLOR: Record<string, string> = {
  handoff: "text-sky-300", feedback: "text-violet-300", alert: "text-orange-400",
  request: "text-amber-300", info: "text-white/55",
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}u`;
  return `${Math.floor(d / 86400)}d`;
}

export function TeamHQ() {
  const [data, setData] = useState<TeamData | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [range, setRange] = useState<"24h" | "week" | "month">("week");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showGoalForm, setShowGoalForm] = useState(false);

  const fetchAll = useCallback(async () => {
    const [team, appr] = await Promise.all([
      fetch(`/api/team?range=${range}`).then((r) => r.json()),
      fetch("/api/approvals").then((r) => r.json()),
    ]);
    if (!team.error) setData(team);
    if (!appr.error) setApprovals(appr.approvals);
  }, [range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, [fetchAll]);

  const decide = async (placeId: string, action: "approve" | "reject") => {
    setBusy(placeId + action);
    await fetch("/api/approvals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId, action }),
    });
    await fetchAll();
    setBusy(null);
  };

  const activeTasks = (data?.queue?.running ?? 0) + (data?.queue?.pending ?? 0);

  return (
    <div className="min-h-full bg-[#0b0f0c] text-white px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center">
            <Bot className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Agent Swarm</h1>
            <p className="text-xs text-white/40">{activeTasks} actieve taken · {data?.agents.filter((a) => a.enabled).length ?? 0} agents online</p>
          </div>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {/* ROW 1: activity · cost · quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <Panel className="lg:col-span-6">
          <PanelHead title="Swarm-activiteit" sub="Uitgevoerde agent-taken" icon={TrendingUp} />
          <SwarmChart series={data?.activity.series ?? []} range={range} />
        </Panel>

        <Panel className="lg:col-span-3">
          <PanelHead title="Tokenkosten" sub="Som van al het verbruik" icon={Coins} />
          <div className="mt-2">
            <div className="font-display text-3xl font-semibold tracking-tight">{money(data?.cost.total ?? 0)}</div>
            <div className="text-xs text-white/40 mt-1">{kfmt(data?.cost.totalTokens ?? 0)} tokens totaal</div>
          </div>
          {data?.budget && data.budget.monthlyCap > 0 && (
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="text-white/55">deze maand</span>
                <span className="font-mono text-white/80">{money(data.budget.month)} / {money(data.budget.monthlyCap)}</span>
              </div>
              <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", (data.budget.pctUsed ?? 0) >= 90 ? "bg-orange-400" : "bg-emerald-400")} style={{ width: `${Math.min(100, data.budget.pctUsed ?? 0)}%` }} />
              </div>
            </div>
          )}
          {data?.budget?.costPerQualified != null && (
            <div className="text-[11px] text-white/40 mt-2">{money(data.budget.costPerQualified)} per qualified lead</div>
          )}
          <div className="mt-4 space-y-2">
            {(data?.cost.byModel ?? []).map((m) => (
              <div key={m.model} className="flex items-center justify-between text-xs">
                <span className="text-white/55 truncate">{m.model.replace("claude-", "")}</span>
                <span className="font-mono text-white/80">{money(m.cost)}</span>
              </div>
            ))}
            {(data?.cost.byModel ?? []).length === 0 && <p className="text-xs text-white/30">Nog geen verbruik.</p>}
          </div>
        </Panel>

        <Panel className="lg:col-span-3">
          <PanelHead title="Snelacties" icon={Zap} />
          <div className="mt-2 space-y-2">
            <QuickBtn label="Nieuw doel" hint="Geef het team werk" onClick={() => setShowGoalForm((s) => !s)} primary />
            <QuickBtn label={`Goedkeuren (${data?.pendingApprovals ?? 0})`} hint="Mails klaar om te versturen" onClick={() => document.getElementById("approvals")?.scrollIntoView({ behavior: "smooth" })} />
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Mini label="Qualified" value={data?.stats.qualified ?? 0} />
              <Mini label="Gemaild" value={data?.stats.emailed ?? 0} />
              <Mini label="Replies" value={data?.stats.replied ?? 0} />
            </div>
          </div>
          {showGoalForm && <GoalForm onDone={() => { setShowGoalForm(false); fetchAll(); }} />}
        </Panel>
      </div>

      {/* ROW 2: top agents · recent tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <Panel className="lg:col-span-5">
          <PanelHead title="Agents" sub="Het team" icon={Bot} />
          <div className="mt-3 space-y-3">
            {(data?.agents ?? []).map((a) => <AgentRow key={a.name} a={a} />)}
          </div>
        </Panel>

        <Panel className="lg:col-span-7">
          <PanelHead title="Recente taken" icon={CheckCircle2} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/35 text-left">
                  <th className="font-medium py-2 pr-2">Agent</th>
                  <th className="font-medium py-2 pr-2">Resultaat</th>
                  <th className="font-medium py-2 pr-2 text-right">Stappen</th>
                  <th className="font-medium py-2 pr-2 text-right">Tokens</th>
                  <th className="font-medium py-2 pr-2 text-right">Kosten</th>
                  <th className="font-medium py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentTasks ?? []).map((t) => {
                  const meta = AGENT_META[t.agent as AgentName];
                  return (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="py-2 pr-2">
                        <span className={cn("inline-flex items-center gap-1.5", meta?.tint)}>
                          {meta && <meta.icon className="h-3.5 w-3.5" />}{meta?.label ?? t.agent}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-white/65 max-w-[240px] truncate">{t.summary ?? "—"}</td>
                      <td className="py-2 pr-2 text-right font-mono text-white/45">{t.iterations}i·{t.toolCalls}t</td>
                      <td className="py-2 pr-2 text-right font-mono text-white/60">{kfmt(t.tokens)}</td>
                      <td className="py-2 pr-2 text-right font-mono text-white/60">{money(t.cost)}</td>
                      <td className="py-2 text-right">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium",
                          t.status === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-orange-500/15 text-orange-300")}>
                          {t.status === "ok" ? "Klaar" : "Fout"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {(data?.recentTasks ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-white/30">Nog geen taken uitgevoerd.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ROW 3: goals · approvals · feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 space-y-4">
          <Panel>
            <PanelHead title="Doelen" icon={Target} action={{ label: "nieuw doel", onClick: () => setShowGoalForm((s) => !s) }} />
            <div className="mt-3 space-y-3">
              {(data?.goals ?? []).filter((g) => g.status === "active").map((g) => {
                const pct = g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
                return (
                  <div key={g.id}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm text-white/80">{g.description}</span>
                      <span className="font-mono text-xs text-white/60">{g.current}/{g.target ?? "∞"}</span>
                    </div>
                    <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {(data?.goals ?? []).filter((g) => g.status === "active").length === 0 && (
                <p className="text-sm text-white/40">Geen actieve doelen. Maak er één aan om het team werk te geven.</p>
              )}
            </div>
          </Panel>

          <Panel id="approvals">
            <PanelHead title="Goedkeur-wachtrij" sub="Mails wachten op jouw akkoord" icon={Inbox}
              action={{ label: `${approvals.length} wachten`, onClick: () => {} }} />
            <div className="mt-3 space-y-3">
              {approvals.length === 0 && <p className="text-sm text-white/40">Geen mails om goed te keuren. De Writer zet ze hier neer zodra sites klaar zijn.</p>}
              {approvals.map((a) => (
                <div key={a.place_id} className="rounded-lg border border-white/8 bg-white/[0.02] p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{a.name}</div>
                      <div className="text-xs text-white/50 truncate">{a.email_subject || "(geen onderwerp)"}</div>
                      <div className="text-[11px] text-white/35 mt-1">
                        {a.city_query} · {a.category_query} · → {a.contact_email}
                        {typeof a.email_quality_score === "number" && <> · mail {a.email_quality_score}/10</>}
                        {typeof a.site_quality_score === "number" && <> · site {a.site_quality_score}/10</>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => decide(a.place_id, "approve")} disabled={!!busy}
                        className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-md text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-[#04130b] disabled:opacity-50">
                        {busy === a.place_id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="h-3.5 w-3.5" />Keur goed</>}
                      </button>
                      <button onClick={() => decide(a.place_id, "reject")} disabled={!!busy}
                        className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-md text-xs bg-white/5 hover:bg-white/10 border border-white/10">
                        <XCircle className="h-3.5 w-3.5" />Wijs af
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs">
                    <button onClick={() => setPreview(preview === a.place_id ? null : a.place_id)} className="text-emerald-400 hover:underline">
                      {preview === a.place_id ? "verberg mail" : "bekijk mail"}
                    </button>
                    {a.slug && <a href={`/sites/${a.place_id}/index.html`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">bekijk site</a>}
                  </div>
                  {preview === a.place_id && a.email_body_html && (
                    <iframe title="mail" srcDoc={a.email_body_html} className="w-full h-96 mt-3 rounded border border-white/10 bg-white" />
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <Panel className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <span className="text-xs text-white/45 font-mono tracking-wider uppercase">Team-chat</span>
              <span className="text-xs text-white/30 font-mono">{data?.feed.length ?? 0}</span>
            </div>
            <div className="p-3 h-[26rem] overflow-y-auto text-xs leading-relaxed space-y-2">
              {(data?.feed ?? []).length === 0 && <p className="text-white/30">Nog geen berichten.</p>}
              {(data?.feed ?? []).map((m) => (
                <div key={m.id} className="border-b border-white/5 pb-1.5">
                  <span className="text-white/35">{timeAgo(m.created_at)} </span>
                  <span className="font-semibold text-white/75">{m.from_agent}</span>
                  {m.to_agent && <span className="text-white/35"> → {m.to_agent}</span>}
                  <span className={cn("block mt-0.5", KIND_COLOR[m.kind] ?? "text-white/55")}>{m.body}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Wat het team leerde" icon={Lightbulb} />
            <ul className="mt-3 space-y-2">
              {(data?.learnings ?? []).length === 0 && <p className="text-sm text-white/40">Nog geen inzichten.</p>}
              {(data?.learnings ?? []).map((l) => <li key={l.id} className="text-xs text-white/55">• {l.note}</li>)}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ─── building blocks ─── */

function Panel({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn("rounded-2xl border border-white/8 bg-[#121a14] p-5", className)}>{children}</div>;
}
function PanelHead({ title, sub, icon: Icon, action }: { title: string; sub?: string; icon?: typeof Bot; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-white/40" />}
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {sub && <div className="text-[11px] text-white/35">{sub}</div>}
        </div>
      </div>
      {action && <button onClick={action.onClick} className="text-xs text-emerald-400 hover:underline flex items-center gap-1"><Plus className="h-3 w-3" />{action.label}</button>}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/8 p-2 text-center">
      <div className="font-display text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] text-white/35 uppercase tracking-wide">{label}</div>
    </div>
  );
}
function QuickBtn({ label, hint, onClick, primary }: { label: string; hint: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full text-left rounded-lg px-3 py-2.5 transition-colors border",
      primary ? "bg-emerald-500/15 border-emerald-400/25 hover:bg-emerald-500/25" : "bg-white/[0.03] border-white/8 hover:bg-white/[0.06]")}>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[11px] text-white/40">{hint}</div>
    </button>
  );
}
function RangeToggle({ range, onChange }: { range: string; onChange: (r: "24h" | "week" | "month") => void }) {
  const opts: { k: "24h" | "week" | "month"; label: string }[] = [
    { k: "24h", label: "24u" }, { k: "week", label: "Week" }, { k: "month", label: "Maand" },
  ];
  return (
    <div className="inline-flex rounded-lg bg-white/[0.04] border border-white/8 p-1">
      {opts.map((o) => (
        <button key={o.k} onClick={() => onChange(o.k)}
          className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            range === o.k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function AgentRow({ a }: { a: AgentCard }) {
  const meta = AGENT_META[a.name];
  const Icon = meta.icon;
  const working = a.lastRun?.at && (Date.now() - new Date(a.lastRun.at).getTime()) < 20000;
  const quota = Math.min(100, (a.throughputLastHour / 12) * 100);
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className={cn("h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center", meta.tint)}><Icon className="h-4 w-4" /></div>
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              {meta.label}
              <span className={cn("h-1.5 w-1.5 rounded-full", working ? "bg-emerald-400 animate-pulse" : a.enabled ? "bg-emerald-500/40" : "bg-white/20")} />
            </div>
            <div className="text-[11px] text-white/40">{a.tasksCompleted} taken · {Math.round(a.successRate * 100)}% ok</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono text-white/70">{money(a.cost)}</div>
          <div className="text-[10px] text-white/35">{kfmt(a.tokens)} tok</div>
        </div>
      </div>
      <div className="text-[11px] text-white/45 mb-2 line-clamp-1" title={a.lastRun?.summary ?? ""}>
        {a.lastRun?.summary || "Nog niet actief."}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
          <div className="h-full bg-white/40 rounded-full" style={{ width: `${quota}%` }} />
        </div>
        <span className="text-[10px] text-white/30 font-mono shrink-0">{a.throughputLastHour}/u</span>
      </div>
    </div>
  );
}

function SwarmChart({ series, range }: { series: { t: number; runs: number; tokens: number }[]; range: string }) {
  const W = 560, H = 150, P = 8;
  const max = Math.max(1, ...series.map((s) => s.runs));
  const total = series.reduce((s, p) => s + p.runs, 0);
  const pts = series.map((s, i) => {
    const x = P + (i / Math.max(1, series.length - 1)) * (W - 2 * P);
    const y = H - P - (s.runs / max) * (H - 2 * P);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${pts[0][0].toFixed(1)},${H - P} Z` : "";
  const label = range === "24h" ? "laatste 24 uur" : range === "month" ? "laatste 30 dagen" : "laatste 7 dagen";
  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-display text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-xs text-white/40">taken · {label}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 150 }}>
        <defs>
          <linearGradient id="swarmgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#swarmgrad)" />}
        {line && <path d={line} fill="none" stroke="rgb(52 211 153)" strokeWidth="2" strokeLinejoin="round" />}
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="rgb(52 211 153)" />)}
      </svg>
    </div>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("20");
  const [cities, setCities] = useState("krakow");
  const [categories, setCategories] = useState("roofing_contractor, plumber");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!description) return;
    setSaving(true);
    await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create", description, targetValue: Number(target) || undefined,
        cities: cities.split(",").map((s) => s.trim()).filter(Boolean),
        categories: categories.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setSaving(false); onDone();
  };
  const inp = "w-full text-sm px-3 py-2 rounded-md border border-white/10 bg-white/[0.03] text-white placeholder:text-white/30";
  return (
    <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/8 space-y-2">
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Doel, bv. 30 dakdekkers in Warszawa" className={inp} />
      <div className="grid grid-cols-3 gap-2">
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="aantal" className={inp} />
        <input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="steden" className={inp} />
        <input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="categorieën" className={inp} />
      </div>
      <button onClick={submit} disabled={saving || !description}
        className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-[#04130b] disabled:opacity-50">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Doel aanmaken"}
      </button>
    </div>
  );
}
