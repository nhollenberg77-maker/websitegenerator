import { getSettings, saveSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/settings";
import { testSmtpConnection } from "@/lib/mailer";

export async function GET() {
  const settings = getSettings();
  // mask passwords for client
  return Response.json({
    ...settings,
    smtp: { ...settings.smtp, pass: settings.smtp.pass ? "••••••••" : "" },
    imap: { ...settings.imap, pass: settings.imap.pass ? "••••••••" : "" },
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Partial<AppSettings>;
    const current = getSettings();

    const updated: AppSettings = {
      smtp: { ...current.smtp, ...body.smtp },
      agent: { ...current.agent, ...body.agent },
      imap: { ...current.imap, ...body.imap },
    };

    // Don't overwrite passwords with the mask
    if (updated.smtp.pass === "••••••••") updated.smtp.pass = current.smtp.pass;
    if (updated.imap.pass === "••••••••") updated.imap.pass = current.imap.pass;

    saveSettings(updated);
    // Geen oude cron meer — het agent-team draait via de worker (orchestrator).
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json() as { action: string };

  if (body.action === "test-smtp") {
    const settings = getSettings();
    const result = await testSmtpConnection(settings.smtp);
    return Response.json(result);
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
