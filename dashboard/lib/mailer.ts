import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpSettings } from "./settings";
import type { Lead } from "./types";
import { generateEmailHtml, generateEmailSubject, buildEmailHeaders } from "./email-template";
import { markLeadEmailed } from "./db";

// Eén gepoolde transporter per SMTP-config: hergebruikt TCP-handshakes en
// past pool-niveau rate-limiting toe over alle sends in het proces.
// Office365 limiet = 30 msg/min per gebruiker → we houden 10/min aan om
// reputatie + bounce-rate veilig te houden.
const POOL_OPTIONS = {
  pool: true as const,
  maxConnections: 3,
  maxMessages: 100,
  rateDelta: 60_000,
  rateLimit: 10,
};

let cachedTransport: { key: string; transport: Transporter } | null = null;

function transportKey(smtp: SmtpSettings): string {
  return `${smtp.host}|${smtp.port}|${smtp.secure}|${smtp.user}|${smtp.pass}`;
}

function getPooledTransport(smtp: SmtpSettings): Transporter {
  const key = transportKey(smtp);
  if (cachedTransport && cachedTransport.key === key) return cachedTransport.transport;
  if (cachedTransport) {
    try { cachedTransport.transport.close(); } catch { /* ignore */ }
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    ...POOL_OPTIONS,
  });
  cachedTransport = { key, transport };
  return transport;
}

// HTML → platte tekst voor multipart/alternative. Niet perfect maar genoeg
// voor spam-filters die de text-versie meewegen (SpamAssassin: HTML_ONLY).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function testSmtpConnection(smtp: SmtpSettings): Promise<{ ok: boolean; error?: string }> {
  // Test gebruikt geen pool — losse verify-connection, daarna sluiten.
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    try { transport.close(); } catch { /* ignore */ }
  }
}

export async function sendLeadEmail(
  lead: Lead,
  smtp: SmtpSettings,
  siteUrl?: string,
  screenshotUrl?: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!lead.contact_email) {
    return { ok: false, error: "No email address found for lead" };
  }
  return sendEmailToAddress(lead, lead.contact_email, smtp, siteUrl, screenshotUrl);
}

export async function sendEmailToAddress(
  lead: Lead,
  toEmail: string,
  smtp: SmtpSettings,
  siteUrl?: string,
  screenshotUrl?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getPooledTransport(smtp);
    const replyTo = smtp.replyToEmail || smtp.fromEmail;
    const html = generateEmailHtml(lead, siteUrl, screenshotUrl, smtp);

    await transport.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: toEmail,
      replyTo,
      subject: generateEmailSubject(lead),
      html,
      text: htmlToText(html),
      headers: buildEmailHeaders(lead, smtp),
    });

    markLeadEmailed(lead.place_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
