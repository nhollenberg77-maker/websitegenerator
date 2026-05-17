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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, TestTube, X, Loader2 } from "lucide-react";
import { CITIES, CATEGORIES } from "@/lib/types";

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

interface AgentSettings {
  enabled: boolean;
  cronSchedule: string;
  cities: string[];
  categories: string[];
  radius: number;
  limitPerCategory: number;
  autoEmail: boolean;
}

export default function SettingsPage() {
  const [smtp, setSmtp] = useState<SmtpSettings>({
    host: "", port: 587, secure: false, user: "", pass: "", fromName: "Werkflows", fromEmail: "",
  });
  const [agent, setAgent] = useState<AgentSettings>({
    enabled: false, cronSchedule: "0 9 * * *", cities: [], categories: [], radius: 30000, limitPerCategory: 20, autoEmail: true,
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

      {/* Agent */}
      <Card className="border-line mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold">Dagelijkse Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant={agent.enabled ? "default" : "outline"}
              size="sm"
              className={agent.enabled ? "bg-success hover:bg-success/90" : ""}
              onClick={() => setAgent((a) => ({ ...a, enabled: !a.enabled }))}
            >
              {agent.enabled ? "Actief" : "Uitgeschakeld"}
            </Button>
            <span className="text-sm text-ink-soft">
              {agent.enabled ? "Agent draait volgens schema" : "Agent is uit"}
            </span>
          </div>

          <div>
            <label className="text-sm text-ink-soft mb-1.5 block">
              Cron schema (standaard: elke dag om 09:00)
            </label>
            <Input
              value={agent.cronSchedule}
              onChange={(e) => setAgent((a) => ({ ...a, cronSchedule: e.target.value }))}
              placeholder="0 9 * * *"
              className="w-48 font-mono"
            />
          </div>

          <Separator />

          <div>
            <label className="text-sm text-ink-soft mb-1.5 block">Steden</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CITIES).map(([key, name]) => {
                const active = agent.cities.includes(key);
                return (
                  <Badge
                    key={key}
                    variant={active ? "default" : "secondary"}
                    className={`cursor-pointer select-none ${
                      active ? "bg-navy text-white hover:bg-navy/90" : "hover:bg-background-alt"
                    }`}
                    onClick={() => toggleAgentCity(key)}
                  >
                    {name}
                    {active && <X className="h-3 w-3 ml-1" />}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm text-ink-soft mb-1.5 block">Categorieën</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CATEGORIES)
                .filter(([key]) => key !== "general_contractor")
                .map(([key, label]) => {
                  const active = agent.categories.includes(key);
                  return (
                    <Badge
                      key={key}
                      variant={active ? "default" : "secondary"}
                      className={`cursor-pointer select-none ${
                        active ? "bg-navy text-white hover:bg-navy/90" : "hover:bg-background-alt"
                      }`}
                      onClick={() => toggleAgentCategory(key)}
                    >
                      {label}
                      {active && <X className="h-3 w-3 ml-1" />}
                    </Badge>
                  );
                })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Radius (m)</label>
              <Input
                type="number"
                value={agent.radius}
                onChange={(e) => setAgent((a) => ({ ...a, radius: parseInt(e.target.value) || 30000 }))}
              />
            </div>
            <div>
              <label className="text-sm text-ink-soft mb-1.5 block">Limiet per categorie</label>
              <Input
                type="number"
                value={agent.limitPerCategory}
                onChange={(e) => setAgent((a) => ({ ...a, limitPerCategory: Math.min(20, parseInt(e.target.value) || 20) }))}
                max={20}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant={agent.autoEmail ? "default" : "outline"}
              size="sm"
              className={agent.autoEmail ? "bg-navy hover:bg-navy/90" : ""}
              onClick={() => setAgent((a) => ({ ...a, autoEmail: !a.autoEmail }))}
            >
              {agent.autoEmail ? "Auto-email aan" : "Auto-email uit"}
            </Button>
            <span className="text-sm text-ink-soft">
              Automatisch mails sturen naar qualified leads
            </span>
          </div>
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
