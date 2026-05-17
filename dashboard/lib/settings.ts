import fs from "fs";
import path from "path";

const SETTINGS_PATH = path.resolve(process.cwd(), "settings.json");

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export interface AgentSettings {
  enabled: boolean;
  cronSchedule: string;
  cities: string[];
  categories: string[];
  radius: number;
  limitPerCategory: number;
  autoEmail: boolean;
}

export interface AppSettings {
  smtp: SmtpSettings;
  agent: AgentSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  smtp: {
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    fromName: "Werkflows",
    fromEmail: "",
  },
  agent: {
    enabled: false,
    cronSchedule: "0 9 * * *",
    cities: ["krakow", "warszawa", "wroclaw", "poznan", "gdansk"],
    categories: ["roofing_contractor", "electrician", "plumber", "painter"],
    radius: 30000,
    limitPerCategory: 20,
    autoEmail: true,
  },
};

export function getSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        smtp: { ...DEFAULT_SETTINGS.smtp, ...parsed.smtp },
        agent: { ...DEFAULT_SETTINGS.agent, ...parsed.agent },
      };
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

export function isSmtpConfigured(): boolean {
  const s = getSettings().smtp;
  return !!(s.host && s.user && s.pass && s.fromEmail);
}
