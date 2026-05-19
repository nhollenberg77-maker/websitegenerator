import { getLeadById, markLeadUnsubscribed } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { Metadata } from "next";

// Publieke pagina die Poolse prospects bereiken via de unsubscribe-link in
// een cold-email. Markeert de lead idempotent als afgemeld en bevestigt dat
// in het Pools. Geen dashboard-chrome (zie sidebar.tsx PUBLIC_ROUTES).

export const metadata: Metadata = {
  title: "Wypisz się z naszych wiadomości",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ pid?: string }>;
}) {
  const { pid } = await searchParams;
  const settings = getSettings();
  const companyName = settings.smtp.companyName || settings.smtp.fromName || "Nasza firma";

  let status: "ok" | "already" | "unknown" | "missing" = "missing";
  let leadName: string | null = null;

  if (pid) {
    const lead = getLeadById(pid);
    if (!lead) {
      status = "unknown";
    } else if (lead.unsubscribed_at) {
      status = "already";
      leadName = lead.name;
    } else {
      markLeadUnsubscribed(pid);
      status = "ok";
      leadName = lead.name;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-line shadow-sm p-8 sm:p-10">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink mb-3">
          {status === "ok" || status === "already" ? "Zostali Państwo wypisani" : "Wypisz się"}
        </h1>

        {status === "ok" && (
          <p className="text-ink-soft leading-relaxed">
            {leadName ? <><strong className="text-ink">{leadName}</strong> — n</> : "N"}ie wyślemy więcej
            wiadomości na ten adres. Przepraszamy za niedogodności.
          </p>
        )}

        {status === "already" && (
          <p className="text-ink-soft leading-relaxed">
            {leadName ? <><strong className="text-ink">{leadName}</strong> już został</> : "Ten adres był już"} wypisany
            wcześniej. Nie wyślemy więcej wiadomości.
          </p>
        )}

        {status === "unknown" && (
          <p className="text-ink-soft leading-relaxed">
            Nie znaleźliśmy tego identyfikatora w naszej bazie. Możliwe, że link wygasł albo został
            wcześniej użyty. Jeśli nadal otrzymują Państwo nasze wiadomości, proszę odpisać słowem
            <strong className="text-ink"> „STOP”</strong> na e-mail, który Państwo otrzymali.
          </p>
        )}

        {status === "missing" && (
          <p className="text-ink-soft leading-relaxed">
            Aby się wypisać, proszę użyć linka „Wypisz się” znajdującego się na dole e-maila, który
            Państwo od nas otrzymali. Można też odpowiedzieć słowem <strong className="text-ink">„STOP”</strong>.
          </p>
        )}

        <p className="text-xs text-ink-soft mt-8 pt-6 border-t border-line">
          {companyName}
          {settings.smtp.companyAddress && <> · {settings.smtp.companyAddress}</>}
          {settings.smtp.companyNip && <> · NIP {settings.smtp.companyNip}</>}
        </p>
      </div>
    </div>
  );
}
