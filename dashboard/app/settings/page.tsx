"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, TestTube, Loader2, Mail, Bot, Building2, Target } from "lucide-react";

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-ink mb-1.5 block">
        {label}
        {hint && <span className="text-xs text-ink-soft font-normal ml-1.5">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

interface SmtpSettings {
  host: string; port: number; secure: boolean; user: string; pass: string;
  fromName: string; fromEmail: string; signatureName?: string; replyToEmail?: string;
  companyName?: string; companyAddress?: string; companyNip?: string; companyRegon?: string;
}

// Agent-driven: het team bepaalt zelf wát het zoekt. Alleen hoog-niveau knoppen.
interface AgentSettings {
  focusHint?: string;
  approvalRequired?: boolean;
  paused?: boolean;
  monthlyBudgetUsd?: number;
  [k: string]: unknown;
}
interface ImapSettings { enabled: boolean; host: string; port: number; user: string; pass: string }

function Toggle({ on, onClick, title, desc }: { on: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border w-full text-left transition-colors ${on ? "bg-navy/5 border-navy/30 hover:bg-navy/10" : "bg-background-alt border-line hover:border-ink-soft/40"}`}>
      <div className={`h-5 w-9 rounded-full relative transition-colors shrink-0 ${on ? "bg-navy" : "bg-ink-soft/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 bg-white rounded-full shadow transition-all ${on ? "left-4" : "left-0.5"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-soft">{desc}</p>
      </div>
    </button>
  );
}

export default function SettingsPage() {
  const [smtp, setSmtp] = useState<SmtpSettings>({
    host: "", port: 587, secure: false, user: "", pass: "", fromName: "", fromEmail: "",
    signatureName: "", replyToEmail: "", companyName: "", companyAddress: "", companyNip: "", companyRegon: "",
  });
  const [agent, setAgent] = useState<AgentSettings>({ focusHint: "", approvalRequired: true, paused: false, monthlyBudgetUsd: 0 });
  const [imap, setImap] = useState<ImapSettings>({ enabled: false, host: "", port: 993, user: "", pass: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => {
      setSmtp(data.smtp);
      setAgent(data.agent);
      if (data.imap) setImap(data.imap);
      setLoading(false);
    });
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smtp, agent, imap }) });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 3000);
  }

  async function testSmtp() {
    setTesting(true); setTestResult(null);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smtp, agent, imap }) });
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test-smtp" }) });
    setTestResult(await res.json()); setTesting(false);
  }

  if (loading) return <div className="p-4 sm:p-6 lg:p-8 text-ink-soft">Laden…</div>;

  const identityMissing = !smtp.companyName || !smtp.companyNip;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Instellingen. <span className="italic font-normal text-ink-soft">Het team regelt de rest.</span>
        </h2>
      </div>

      {/* TEAM — agent-driven besturing */}
      <Card className="card-elev border-0 mb-6 overflow-hidden">
        <CardHeader className="pb-3 bg-background-alt/30 border-b border-line">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-navy" /> Het team
          </CardTitle>
          <p className="text-xs text-ink-soft mt-1">
            De agents bepalen zélf wat ze zoeken, bouwen en schrijven, en leren wat werkt. Je hoeft geen steden,
            categorieën of schema meer in te stellen. Doelen geef je in <Link href="/" className="text-navy underline">Agent Swarm</Link>.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <FieldLabel label="Focus voor het team" hint="vrije tekst — de Manager-agent leest dit">
            <textarea
              value={agent.focusHint ?? ""}
              onChange={(e) => setAgent((a) => ({ ...a, focusHint: e.target.value }))}
              placeholder="Bijv. 'Lokale dienstverleners met een zwakke of ontbrekende website — kappers, restaurants, garages, tandartsen, vakmensen in grote Poolse steden. Mik op bedrijven met goede Google-reviews.'"
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-md border border-line bg-card resize-y"
            />
          </FieldLabel>

          <Toggle
            on={agent.approvalRequired !== false}
            onClick={() => setAgent((a) => ({ ...a, approvalRequired: !(a.approvalRequired !== false) }))}
            title="Mails eerst laten goedkeuren"
            desc="Aanbevolen. Het team zet mails klaar; jij keurt ze goed in Agent Swarm voordat ze verzonden worden."
          />
          <Toggle
            on={!!agent.paused}
            onClick={() => setAgent((a) => ({ ...a, paused: !a.paused }))}
            title="Team pauzeren"
            desc="Stopt alle agent-activiteit (zoeken, bouwen, schrijven, verzenden) tot je dit weer uitzet."
          />
          <FieldLabel label="Maandbudget (USD)" hint="0 = geen plafond. De Manager bewaakt dit en stopt dure agent-arbeid bij dit bedrag.">
            <Input type="number" min={0} className="w-40"
              value={agent.monthlyBudgetUsd ?? 0}
              onChange={(e) => setAgent((a) => ({ ...a, monthlyBudgetUsd: Math.max(0, parseFloat(e.target.value) || 0) }))} />
          </FieldLabel>
        </CardContent>
      </Card>

      {/* IMAP — reply/bounce-tracking */}
      <Card className="card-elev border-0 mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2"><Mail className="h-4 w-4 text-navy" /> Inbox-tracking (IMAP)</CardTitle>
          <p className="text-xs text-ink-soft mt-1">
            Optioneel. Laat het team de inbox lezen om <strong>antwoorden en bounces</strong> te herkennen — zo leert de Manager welke sectoren écht converteren en beschermt de bounce-circuit-breaker je domein. Vaak dezelfde inloggegevens als SMTP.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle on={imap.enabled} onClick={() => setImap((i) => ({ ...i, enabled: !i.enabled }))}
            title="Inbox-tracking aan" desc="Zonder dit blijven reply-/bounce-cijfers leeg." />
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="IMAP host"><Input value={imap.host} onChange={(e) => setImap((i) => ({ ...i, host: e.target.value }))} placeholder="outlook.office365.com" /></FieldLabel>
            <FieldLabel label="Port"><Input type="number" value={imap.port} onChange={(e) => setImap((i) => ({ ...i, port: parseInt(e.target.value) || 993 }))} /></FieldLabel>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Gebruikersnaam"><Input value={imap.user} onChange={(e) => setImap((i) => ({ ...i, user: e.target.value }))} placeholder="tomek@..." /></FieldLabel>
            <FieldLabel label="Wachtwoord"><Input type="password" value={imap.pass} onChange={(e) => setImap((i) => ({ ...i, pass: e.target.value }))} placeholder="App-wachtwoord" /></FieldLabel>
          </div>
        </CardContent>
      </Card>

      {/* SMTP */}
      <Card className="card-elev border-0 mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2"><Mail className="h-4 w-4 text-navy" /> SMTP e-mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="SMTP host"><Input value={smtp.host} onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))} placeholder="smtp.office365.com" /></FieldLabel>
            <FieldLabel label="Port"><Input type="number" value={smtp.port} onChange={(e) => setSmtp((s) => ({ ...s, port: parseInt(e.target.value) || 587 }))} /></FieldLabel>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Gebruikersnaam"><Input value={smtp.user} onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))} placeholder="jouw@email.com" /></FieldLabel>
            <FieldLabel label="Wachtwoord"><Input type="password" value={smtp.pass} onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))} placeholder="App-wachtwoord" /></FieldLabel>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Afzendernaam"><Input value={smtp.fromName} onChange={(e) => setSmtp((s) => ({ ...s, fromName: e.target.value }))} /></FieldLabel>
            <FieldLabel label="Afzender e-mail"><Input value={smtp.fromEmail} onChange={(e) => setSmtp((s) => ({ ...s, fromEmail: e.target.value }))} placeholder="tomek@..." /></FieldLabel>
          </div>
          <FieldLabel label="Beveiliging">
            <Select value={smtp.secure ? "tls" : "starttls"} onValueChange={(v) => setSmtp((s) => ({ ...s, secure: v === "tls" }))}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                <SelectItem value="tls">TLS/SSL (port 465)</SelectItem>
              </SelectContent>
            </Select>
          </FieldLabel>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={testSmtp} disabled={testing || !smtp.host}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube className="h-4 w-4 mr-2" />}Test verbinding
            </Button>
            {testResult && <span className={`text-sm ${testResult.ok ? "text-success" : "text-warning"}`}>{testResult.ok ? "Verbinding geslaagd" : `Fout: ${testResult.error}`}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Afzender-identiteit — verplicht voor verzenden */}
      <Card className={`mb-6 ${identityMissing ? "border-warning/40" : "border-line"}`}>
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-navy" /> Afzender-identiteit</CardTitle>
          <p className="text-xs text-ink-soft mt-1">
            Verschijnt onderaan elke mail. <strong>Bedrijfsnaam + NIP zijn verplicht</strong> — zonder deze weigert het team te verzenden (Poolse regelgeving).
            {identityMissing && <span className="text-warning"> Nu nog niet ingevuld.</span>}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Naam onder ondertekening" hint="leeg = afzendernaam"><Input value={smtp.signatureName ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, signatureName: e.target.value }))} placeholder="Tomek Paszowski" /></FieldLabel>
            <FieldLabel label="Reply-To e-mail" hint="leeg = afzender e-mail"><Input type="email" value={smtp.replyToEmail ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, replyToEmail: e.target.value }))} placeholder="tomek@..." /></FieldLabel>
          </div>
          <FieldLabel label="Bedrijfsnaam (juridisch)"><Input value={smtp.companyName ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, companyName: e.target.value }))} placeholder="Strona dla Twojej Firmy Sp. z o.o." /></FieldLabel>
          <FieldLabel label="Bedrijfsadres"><Input value={smtp.companyAddress ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, companyAddress: e.target.value }))} placeholder="ul. Floriańska 1, 31-019 Kraków" /></FieldLabel>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="NIP" hint="10-cijferig, verplicht"><Input value={smtp.companyNip ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, companyNip: e.target.value }))} placeholder="1234567890" className="font-mono" /></FieldLabel>
            <FieldLabel label="REGON" hint="9 of 14 cijfers"><Input value={smtp.companyRegon ?? ""} onChange={(e) => setSmtp((s) => ({ ...s, companyRegon: e.target.value }))} placeholder="123456789" className="font-mono" /></FieldLabel>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="bg-navy hover:bg-navy/90">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Opslaan
        </Button>
        {saved && <span className="text-sm text-success">Opgeslagen</span>}
        <Link href="/" className="ml-auto text-sm text-navy hover:underline flex items-center gap-1"><Target className="h-3.5 w-3.5" /> Doelen instellen in Agent Swarm →</Link>
      </div>
    </div>
  );
}
