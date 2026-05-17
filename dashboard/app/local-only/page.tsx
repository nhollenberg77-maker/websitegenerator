import { Globe } from "lucide-react";

export const metadata = {
  title: "Lokaal dashboard — Strona dla Twojej Firmy",
  description: "Dit dashboard draait alleen op de lokale machine.",
};

export default function LocalOnly() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-navy text-white mb-6">
          <Globe className="h-5 w-5" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-ink mb-3">
          Dashboard draait alleen lokaal.
        </h1>
        <p className="text-sm text-ink-soft leading-relaxed mb-6">
          De pipeline gebruikt Python, een lokale SQLite-database en
          bestandsschrijfacties — dat past niet op een serverless platform.
        </p>
        <p className="text-sm text-ink-soft leading-relaxed">
          De gegenereerde voorbeeld-sites zijn wel publiek bereikbaar onder{" "}
          <code className="bg-background-alt px-1.5 py-0.5 rounded text-xs">
            /sites/&lt;place_id&gt;/
          </code>
          .
        </p>
      </div>
    </main>
  );
}
