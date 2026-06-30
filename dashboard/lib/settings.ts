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
  // Email-handtekening en juridische voettekst — gebruikt in cold-emails.
  // Als deze leeg zijn vallen we terug op fromName / fromEmail of laten
  // we de juridische footer weg (zacht degradatiegedrag).
  signatureName?: string;       // bijv. "Tomek Paszowski" (default: fromName)
  replyToEmail?: string;        // bijv. "tomek@..."         (default: fromEmail)
  companyName?: string;         // bijv. "Strony dla Twojej Firmy Sp. z o.o."
  companyAddress?: string;      // bijv. "ul. Floriańska 1, 31-019 Kraków"
  companyNip?: string;          // bijv. "1234567890" (Polish tax ID)
  companyRegon?: string;        // bijv. "123456789"  (Polish REGON)
}

export interface AgentSettings {
  // Agent-driven besturing. Het team bepaalt zelf wat het zoekt; dit zijn de
  // enige hoog-niveau knoppen die de mens nog heeft.
  focusHint: string;          // vrije tekst die de Manager-agent leest
  approvalRequired: boolean;  // mails eerst door mens laten goedkeuren
  paused: boolean;            // hele team pauzeren
  monthlyBudgetUsd: number;   // 0 = geen plafond; anders: stop dure agent-arbeid bij dit bedrag
}

// IMAP voor reply-/bounce-tracking (los van SMTP). Leeg = uitgeschakeld.
export interface ImapSettings {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface AppSettings {
  smtp: SmtpSettings;
  agent: AgentSettings;
  imap: ImapSettings;
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
    signatureName: "",
    replyToEmail: "",
    companyName: "",
    companyAddress: "",
    companyNip: "",
    companyRegon: "",
  },
  agent: {
    focusHint: "",
    approvalRequired: true,
    paused: false,
    monthlyBudgetUsd: 0,
  },
  imap: {
    enabled: false,
    host: "",
    port: 993,
    user: "",
    pass: "",
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
        imap: { ...DEFAULT_SETTINGS.imap, ...parsed.imap },
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
