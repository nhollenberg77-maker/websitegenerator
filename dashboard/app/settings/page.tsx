"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, TestTube, X, Loader2, Target, Clock, MapPin, Tag, Sliders, Mail, Bot, Building2 } from "lucide-react";

function SettingsSection({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink font-medium">
          <span className="text-navy">{icon}</span>
          {title}
        </div>
        {hint && <span className="text-xs text-ink-soft">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

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
import { CITIES, CATEGORIES } from "@/lib/types";

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  signatureName?: string;
  replyToEmail?: string;
  companyName?: string;
  companyAddress?: string;
  companyNip?: string;
  companyRegon?: string;
}

interface AgentSettings {
  enabled: boolean;
  cronSchedule: string;
  cities: string[];
  categories: string[];
  radius: number;
  limitPerCategory: number;
  autoEmail: boolean;
  targetReadyLeads: number;
  minGbpScore: number;
  maxCyclesPerRun: number;
  autoBroadenOnStagnation: boolean;
}

export default function SettingsPage() {
  const [smtp, setSmtp] = useState<SmtpSettings>({
    host: "", port: 587, secure: false, user: "", pass: "", fromName: "Werkflows", fromEmail: "",
    signatureName: "", replyToEmail: "", companyName: "", companyAddress: "", companyNip: "", companyRegon: "",
  });
  const [agent, setAgent] = useState<AgentSettings>({
    enabled: false, cronSchedule: "0 9 * * *", cities: [], categories: [], radius: 30000, limitPerCategory: 20, autoEmail: true,
    targetReadyLeads: 5, minGbpScore: 5, maxCyclesPerRun: 3, autoBroadenOnStagnation: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSmtp(data.smtp);
        setAgent(data.agent);
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smtp, agent }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleTestSmtp() {
    setTesting(true);
    setTestResult(null);
    // Save first so the test uses current values
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smtp, agent }),
    });
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test-smtp" }),
    });
    const result = await res.json();
    setTestResult(result);
    setTesting(false);
  }

  function toggleAgentCity(city: string) {
    setAgent((prev) => ({
      ...prev,
      cities: prev.cities.includes(city) ? prev.cities.filter((c) => c !== city) : [...prev.cities, city],
    }));
  }

  function toggleAgentCategory(cat: string) {
    setAgent((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat) ? prev.categories.filter((c) => c !== cat) : [...prev.categories, cat],
    }));
  }

  if (loading) return <div className="p-4 sm:p-6 lg:p-8 text-ink-soft">Laden…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Instellingen. <span className="italic font-normal text-ink-soft">E-mail en agent.</span>
        </h2>
      </div>

      {/* SMTP */}
      <Card className="border-line mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold">SMTP E-mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">SMTP Host</label>
              <Input
                value={smtp.host}
                onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Port</label>
              <Input
                type="number"
                value={smtp.port}
                onChange={(e) => setSmtp((s) => ({ ...s, port: parseInt(e.target.value) || 587 }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Gebruikersnaam</label>
              <Input
                value={smtp.user}
                onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))}
                placeholder="jouw@email.com"
              />
            </div>
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Wachtwoord</label>
              <Input
                type="password"
                value={smtp.pass}
                onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))}
                placeholder="App-specifiek wachtwoord"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Afzendernaam</label>
              <Input
                value={smtp.fromName}
                onChange={(e) => setSmtp((s) => ({ ...s, fromName: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Afzender e-mail</label>
              <Input
                value={smtp.fromEmail}
                onChange={(e) => setSmtp((s) => ({ ...s, fromEmail: e.target.value }))}
                placeholder="noreply@werkflows.nl"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-ink-soft mb-1.5 block">Beveiliging</label>
            <Select
              value={smtp.secure ? "tls" : "starttls"}
              onValueChange={(v) => setSmtp((s) => ({ ...s, secure: v === "tls" }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                <SelectItem value="tls">TLS/SSL (port 465)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleTestSmtp} disabled={testing || !smtp.host}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube className="h-4 w-4 mr-2" />}
              Test verbinding
            </Button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? "text-success" : "text-warning"}`}>
                {testResult.ok ? "Verbinding geslaagd" : `Fout: ${testResult.error}`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Afzender + juridische voettekst (verplicht voor cold-outreach in PL) */}
      <Card className="border-line mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-navy" />
            Handtekening en juridische voettekst
          </CardTitle>
          <p className="text-xs text-ink-soft mt-1">
            Verschijnen onderaan elke cold-email. NIP/REGON zijn in Polen verplicht voor commerciële outreach.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="Naam onder ondertekening" hint="leeg = gebruik afzendernaam">
              <Input
                value={smtp.signatureName ?? ""}
                onChange={(e) => setSmtp((s) => ({ ...s, signatureName: e.target.value }))}
                placeholder="Tomek Paszowski"
              />
            </FieldLabel>
            <FieldLabel label="Reply-To e-mail" hint="leeg = gebruik afzender e-mail">
              <Input
                type="email"
                value={smtp.replyToEmail ?? ""}
                onChange={(e) => setSmtp((s) => ({ ...s, replyToEmail: e.target.value }))}
                placeholder="tomek@stronadlatwojejfirmy.com.pl"
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Bedrijfsnaam (juridisch)" hint="voor de mail-voettekst en /unsubscribe pagina">
            <Input
              value={smtp.companyName ?? ""}
              onChange={(e) => setSmtp((s) => ({ ...s, companyName: e.target.value }))}
              placeholder="Strony dla Twojej Firmy Sp. z o.o."
            />
          </FieldLabel>
          <FieldLabel label="Bedrijfsadres">
            <Input
              value={smtp.companyAddress ?? ""}
              onChange={(e) => setSmtp((s) => ({ ...s, companyAddress: e.target.value }))}
              placeholder="ul. Floriańska 1, 31-019 Kraków"
            />
          </FieldLabel>
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel label="NIP" hint="10-cijferig">
              <Input
                value={smtp.companyNip ?? ""}
                onChange={(e) => setSmtp((s) => ({ ...s, companyNip: e.target.value }))}
                placeholder="1234567890"
                className="font-mono"
              />
            </FieldLabel>
            <FieldLabel label="REGON" hint="9 of 14 cijfers">
              <Input
                value={smtp.companyRegon ?? ""}
                onChange={(e) => setSmtp((s) => ({ ...s, companyRegon: e.target.value }))}
                placeholder="123456789"
                className="font-mono"
              />
            </FieldLabel>
          </div>
        </CardContent>
      </Card>

      {/* Agent */}
      <Card className="border-line mb-6 overflow-hidden">
        <CardHeader className="pb-3 bg-background-alt/30 border-b border-line">
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
              <Bot className="h-4 w-4 text-navy" />
              Dagelijkse Agent
            </CardTitle>
            <button
              type="button"
              onClick={() => setAgent((a) => ({ ...a, enabled: !a.enabled }))}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                agent.enabled
                  ? "bg-success/15 text-success border border-success/30 hover:bg-success/20"
                  : "bg-ink-soft/10 text-ink-soft border border-ink-soft/20 hover:bg-ink-soft/15"
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${agent.enabled ? "bg-success" : "bg-ink-soft"}`} />
              {agent.enabled ? "Actief" : "Uitgeschakeld"}
            </button>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            {agent.enabled
              ? `Draait volgens schema en zoekt elke run naar ${agent.targetReadyLeads} nieuwe leads klaar om te mailen.`
              : "Agent draait nu niet. Klik 'Start cyclus' in de cockpit om handmatig te draaien."}
          </p>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">

          {/* DOEL */}
          <SettingsSection icon={<Target className="h-3.5 w-3.5" />} title="Doel" hint="Hoeveel bruikbare leads moet de agent per cyclus opleveren?">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldLabel label="Aantal leads">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={agent.targetReadyLeads}
                  onChange={(e) => setAgent((a) => ({ ...a, targetReadyLeads: Math.max(1, parseInt(e.target.value) || 5) }))}
                />
              </FieldLabel>
              <FieldLabel label="Minimale GBP-score">
                <Select
                  value={String(agent.minGbpScore)}
                  onValueChange={(v) => setAgent((a) => ({ ...a, minGbpScore: parseInt(v ?? "5") || 5 }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">≥ 5 / 7</SelectItem>
                    <SelectItem value="6">≥ 6 / 7</SelectItem>
                    <SelectItem value="7">= 7 / 7</SelectItem>
                  </SelectContent>
                </Select>
              </FieldLabel>
              <FieldLabel label="Max. zoek-rondes">
                <Select
                  value={String(agent.maxCyclesPerRun)}
                  onValueChange={(v) => setAgent((a) => ({ ...a, maxCyclesPerRun: parseInt(v ?? "3") || 3 }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 ronde</SelectItem>
                    <SelectItem value="2">2 rondes</SelectItem>
                    <SelectItem value="3">3 rondes</SelectItem>
                    <SelectItem value="5">5 rondes</SelectItem>
                  </SelectContent>
                </Select>
              </FieldLabel>
            </div>
            <p className="text-xs text-ink-soft mt-2 leading-relaxed">
              Een &quot;bruikbare lead&quot; = qualified <strong>én</strong> GBP-score haalt drempel <strong>én</strong> heeft een e-mailadres.
              De agent blijft zoeken (max. {agent.maxCyclesPerRun} {agent.maxCyclesPerRun === 1 ? "ronde" : "rondes"}) totdat hij er {agent.targetReadyLeads} heeft.
            </p>

            <button
              type="button"
              onClick={() => setAgent((a) => ({ ...a, autoBroadenOnStagnation: !a.autoBroadenOnStagnation }))}
              className={`mt-3 flex items-center gap-3 px-3 py-2 rounded-lg border w-full text-left transition-colors ${
                agent.autoBroadenOnStagnation
                  ? "bg-navy/5 border-navy/30 hover:bg-navy/10"
                  : "bg-background-alt border-line hover:border-ink-soft/40"
              }`}
            >
              <div className={`h-5 w-9 rounded-full relative transition-colors shrink-0 ${agent.autoBroadenOnStagnation ? "bg-navy" : "bg-ink-soft/30"}`}>
                <span className={`absolute top-0.5 h-4 w-4 bg-white rounded-full shadow transition-all ${agent.autoBroadenOnStagnation ? "left-4" : "left-0.5"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">
                  Auto-broaden bij stagnatie
                </p>
                <p className="text-xs text-ink-soft">
                  Als een ronde 0 nieuwe bruikbare leads oplevert, voegt de agent automatisch een ongebruikte categorie of stad toe.
                </p>
              </div>
            </button>
          </SettingsSection>

          {/* SCHEMA */}
          <SettingsSection icon={<Clock className="h-3.5 w-3.5" />} title="Schema" hint="Wanneer draait de agent automatisch?">
            <FieldLabel label="Cron-expressie" hint="Bijv. '0 9 * * *' = elke dag om 09:00">
              <Input
                value={agent.cronSchedule}
                onChange={(e) => setAgent((a) => ({ ...a, cronSchedule: e.target.value }))}
                placeholder="0 9 * * *"
                className="font-mono w-48"
              />
            </FieldLabel>
          </SettingsSection>

          {/* STEDEN */}
          <SettingsSection icon={<MapPin className="h-3.5 w-3.5" />} title="Steden" hint={`${agent.cities.length} geselecteerd`}>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CITIES).map(([key, name]) => {
                const active = agent.cities.includes(key);
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => toggleAgentCity(key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-navy text-white hover:bg-navy/90 shadow-sm"
                        : "bg-background-alt text-ink-soft border border-line hover:border-ink-soft/40 hover:text-ink"
                    }`}
                  >
                    {name}
                    {active && <X className="h-3 w-3 ml-1.5 inline" />}
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          {/* CATEGORIEËN */}
          <SettingsSection icon={<Tag className="h-3.5 w-3.5" />} title="Categorieën" hint={`${agent.categories.length} geselecteerd`}>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CATEGORIES)
                .filter(([key]) => key !== "general_contractor")
                .map(([key, label]) => {
                  const active = agent.categories.includes(key);
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => toggleAgentCategory(key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        active
                          ? "bg-navy text-white hover:bg-navy/90 shadow-sm"
                          : "bg-background-alt text-ink-soft border border-line hover:border-ink-soft/40 hover:text-ink"
                      }`}
                    >
                      {label}
                      {active && <X className="h-3 w-3 ml-1.5 inline" />}
                    </button>
                  );
                })}
            </div>
          </SettingsSection>

          {/* GEAVANCEERD */}
          <SettingsSection icon={<Sliders className="h-3.5 w-3.5" />} title="Geavanceerd" hint="Zoekparameters voor Google Places">
            <div className="grid grid-cols-2 gap-4">
              <FieldLabel label="Radius" hint="meters rondom stad-centrum">
                <Input
                  type="number"
                  value={agent.radius}
                  onChange={(e) => setAgent((a) => ({ ...a, radius: parseInt(e.target.value) || 30000 }))}
                />
              </FieldLabel>
              <FieldLabel label="Limiet per tile" hint="max 20 (Google API)">
                <Input
                  type="number"
                  value={agent.limitPerCategory}
                  onChange={(e) => setAgent((a) => ({ ...a, limitPerCategory: Math.min(20, parseInt(e.target.value) || 20) }))}
                  max={20}
                />
              </FieldLabel>
            </div>
          </SettingsSection>

          {/* AUTO-EMAIL */}
          <SettingsSection icon={<Mail className="h-3.5 w-3.5" />} title="Auto-mail" hint="Wat gebeurt er met bruikbare leads na de cyclus?">
            <button
              type="button"
              onClick={() => setAgent((a) => ({ ...a, autoEmail: !a.autoEmail }))}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border w-full text-left transition-colors ${
                agent.autoEmail
                  ? "bg-navy/5 border-navy/30 hover:bg-navy/10"
                  : "bg-background-alt border-line hover:border-ink-soft/40"
              }`}
            >
              <div className={`h-5 w-9 rounded-full relative transition-colors ${agent.autoEmail ? "bg-navy" : "bg-ink-soft/30"}`}>
                <span className={`absolute top-0.5 h-4 w-4 bg-white rounded-full shadow transition-all ${agent.autoEmail ? "left-4" : "left-0.5"}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">
                  {agent.autoEmail ? "Auto-mail staat aan" : "Auto-mail staat uit"}
                </p>
                <p className="text-xs text-ink-soft">
                  {agent.autoEmail
                    ? "Bruikbare leads krijgen automatisch de template-mail."
                    : "Mails worden niet verzonden — gebruik de Mail-knop per lead om handmatig te sturen."}
                </p>
              </div>
            </button>
          </SettingsSection>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="bg-navy hover:bg-navy/90">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Opslaan
        </Button>
        {saved && <span className="text-sm text-success">Opgeslagen</span>}
      </div>
    </div>
  );
}
