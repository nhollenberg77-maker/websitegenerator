import { markLeadUnsubscribed } from "@/lib/db";

// 1-click unsubscribe endpoint voor de List-Unsubscribe header.
// RFC 8058: mail-clients (Gmail, Outlook) sturen een POST naar deze URL met
// body `List-Unsubscribe=One-Click` zonder user-interactie zichtbaar voor de
// eindgebruiker. Moet snel 200 returnen. GET wordt ook geaccepteerd zodat
// klikken op de URL ook werkt.

function handle(pid: string | null): Response {
  if (!pid) return new Response("pid required", { status: 400 });
  markLeadUnsubscribed(pid);
  return new Response("unsubscribed", { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  const pid = new URL(request.url).searchParams.get("pid");
  return handle(pid);
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let pid = url.searchParams.get("pid");
  if (!pid) {
    // Sommige clients sturen de pid in de body ipv query.
    try {
      const form = await request.formData();
      const v = form.get("pid");
      if (typeof v === "string") pid = v;
    } catch { /* ignore */ }
  }
  return handle(pid);
}
