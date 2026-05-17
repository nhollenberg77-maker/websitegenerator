import { getLeadById } from "@/lib/db";
import { getSettings, isSmtpConfigured } from "@/lib/settings";
import { sendEmailToAddress } from "@/lib/mailer";
import { generateEmailHtml, generateEmailSubject } from "@/lib/email-template";

export async function POST(request: Request) {
  const body = await request.json() as { action: string; placeId?: string; toEmail?: string };

  if (body.action === "preview") {
    if (!body.placeId) return Response.json({ error: "placeId required" }, { status: 400 });
    const lead = getLeadById(body.placeId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    return Response.json({
      subject: generateEmailSubject(lead),
      html: generateEmailHtml(lead),
    });
  }

  if (body.action === "send") {
    if (!body.placeId || !body.toEmail) {
      return Response.json({ error: "placeId and toEmail required" }, { status: 400 });
    }
    if (!isSmtpConfigured()) {
      return Response.json({ error: "SMTP niet geconfigureerd" }, { status: 400 });
    }

    const lead = getLeadById(body.placeId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    const settings = getSettings();
    const result = await sendEmailToAddress(lead, body.toEmail, settings.smtp);
    return Response.json(result);
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
