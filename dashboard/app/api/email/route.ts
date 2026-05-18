import { getLeadById, setLeadContactEmail } from "@/lib/db";
import { getSettings, isSmtpConfigured } from "@/lib/settings";
import { sendEmailToAddress } from "@/lib/mailer";
import { generateEmailHtml, generateEmailSubject } from "@/lib/email-template";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json() as { action: string; placeId?: string; toEmail?: string; email?: string | null };

  if (body.action === "preview") {
    if (!body.placeId) return Response.json({ error: "placeId required" }, { status: 400 });
    const lead = getLeadById(body.placeId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    return Response.json({
      subject: generateEmailSubject(lead),
      html: generateEmailHtml(lead),
    });
  }

  if (body.action === "save-email") {
    if (!body.placeId) return Response.json({ error: "placeId required" }, { status: 400 });
    const lead = getLeadById(body.placeId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    const email = body.email?.trim() || null;
    if (email && !EMAIL_RE.test(email)) {
      return Response.json({ error: "Ongeldig e-mailadres" }, { status: 400 });
    }
    setLeadContactEmail(body.placeId, email);
    return Response.json({ ok: true, contact_email: email });
  }

  if (body.action === "send" || body.action === "send-saved") {
    if (!body.placeId) {
      return Response.json({ error: "placeId required" }, { status: 400 });
    }
    if (!isSmtpConfigured()) {
      return Response.json({ error: "SMTP niet geconfigureerd" }, { status: 400 });
    }

    const lead = getLeadById(body.placeId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    const recipient = body.action === "send-saved" ? lead.contact_email : body.toEmail;
    if (!recipient) {
      return Response.json({ error: "Geen e-mailadres bekend voor deze lead" }, { status: 400 });
    }
    if (!EMAIL_RE.test(recipient)) {
      return Response.json({ error: "Ongeldig e-mailadres" }, { status: 400 });
    }

    const settings = getSettings();
    const result = await sendEmailToAddress(lead, recipient, settings.smtp);
    return Response.json(result);
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
