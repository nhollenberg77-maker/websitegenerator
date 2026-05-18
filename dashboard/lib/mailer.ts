import nodemailer from "nodemailer";
import type { SmtpSettings } from "./settings";
import type { Lead } from "./types";
import { generateEmailHtml, generateEmailSubject } from "./email-template";
import { markLeadEmailed } from "./db";

export async function testSmtpConnection(smtp: SmtpSettings): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function sendLeadEmail(lead: Lead, smtp: SmtpSettings, siteUrl?: string, screenshotUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
  const recipientEmail = lead.contact_email || extractEmailFromWebsite(lead.website || "", lead.phone_national);
  if (!recipientEmail) {
    return { ok: false, error: "No email address found for lead" };
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    await transport.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: recipientEmail,
      subject: generateEmailSubject(lead),
      html: generateEmailHtml(lead, siteUrl, screenshotUrl),
    });

    markLeadEmailed(lead.place_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

function extractEmailFromWebsite(_website: string, _phone: string | null): string | null {
  // Placeholder: in a real implementation this would scrape the website for contact emails
  // or use a pattern like info@domain.tld
  // For now, return null — emails will need to be manually added or scraped in a future module
  return null;
}

export async function sendEmailToAddress(
  lead: Lead,
  toEmail: string,
  smtp: SmtpSettings,
  siteUrl?: string,
  screenshotUrl?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    await transport.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: toEmail,
      subject: generateEmailSubject(lead),
      html: generateEmailHtml(lead, siteUrl, screenshotUrl),
    });

    markLeadEmailed(lead.place_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
