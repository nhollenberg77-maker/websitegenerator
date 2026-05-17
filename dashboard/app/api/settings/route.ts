import { getSettings, saveSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/settings";
import { testSmtpConnection } from "@/lib/mailer";
import { startAgent, stopAgent } from "@/lib/agent";

export async function GET() {
  const settings = getSettings();
  // mask password for client
  return Response.json({
    ...settings,
    smtp: { ...settings.smtp, pass: settings.smtp.pass ? "••••••••" : "" },
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Partial<AppSettings>;
    const current = getSettings();

    const updated: AppSettings = {
      smtp: { ...current.smtp, ...body.smtp },
      agent: { ...current.agent, ...body.agent },
    };

    // Don't overwrite password with mask
    if (updated.smtp.pass === "••••••••") {
      updated.smtp.pass = current.smtp.pass;
    }

    saveSettings(updated);

    // Restart or stop agent based on new settings
    if (updated.agent.enabled) {
      startAgent();
    } else {
      stopAgent();
    }

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
