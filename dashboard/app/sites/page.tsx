"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, RefreshCw, Trash2, Sparkles, ExternalLink, Loader2 } from "lucide-react";

interface SiteLead {
  place_id: string;
  name: string;
  city_query: string | null;
  category_query: string | null;
  site_generated_at: string | null;
  qualified: number | null;
  rating: number | null;
  rating_count: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  roofing_contractor: "Dakdekker",
  electrician: "Elektricien",
  plumber: "Loodgieter",
  painter: "Schilder",
  general_contractor: "Aannemer",
};

const VARIANT_LABELS: Record<string, { label: string; color: string }> = {
  electrician: { label: "Service", color: "bg-blue-900" },
  plumber: { label: "Service", color: "bg-blue-900" },
  painter: { label: "Editorial", color: "bg-stone-700" },
  roofing_contractor: { label: "Established", color: "bg-red-900" },
  general_contractor: { label: "Editorial", color: "bg-stone-700" },
};

export default function SitesPage() {
  const [leads, setLeads] = useState<SiteLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  const fetchSites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sites");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSites(); }, [fetchSites]);

  const generateSite = async (placeId: string) => {
    setGenerating(placeId);
    try {
      await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", placeId }),
      });
      await fetchSites();
    } catch {
      // ignore
    }
    setGenerating(null);
  };

  const regenerateSite = async (placeId: string) => {
    setGenerating(placeId);
    try {
      await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate", placeId }),
      });
      await fetchSites();
    } catch {
      // ignore
    }
    setGenerating(null);
  };

  const deleteSite = async (placeId: string) => {
    setGenerating(placeId);
    try {
      await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", placeId }),
      });
      await fetchSites();
    } catch {
      // ignore
    }
    setGenerating(null);
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-all" }),
      });
      const data = await res.json();
      if (data.generated > 0) {
        await fetchSites();
      }
    } catch {
      // ignore
    }
    setGeneratingAll(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">
            Sites. <span className="italic font-normal text-ink-soft">Gegenereerde voorbeeldsites.</span>
          </h2>
          <p className="text-sm text-ink-soft mt-1">
            {leads.length} site{leads.length !== 1 ? "s" : ""} gegenereerd
          </p>
        </div>
        <Button
          onClick={generateAll}
          disabled={generatingAll}
          className="bg-navy hover:bg-navy/90 w-full sm:w-auto"
        >
          {generatingAll ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          {generatingAll ? "Bezig…" : "Genereer alle ontbrekende sites"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-soft">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Laden…
        </div>
      ) : leads.length === 0 ? (
        <Card className="card-elev border-0">
          <CardContent className="py-16 text-center">
            <Globe className="h-10 w-10 text-ink-faint mx-auto mb-4" />
            <p className="text-ink-soft">Nog geen sites gegenereerd.</p>
            <p className="text-sm text-ink-faint mt-1">
              Qualify eerst leads en klik dan op &quot;Genereer alle ontbrekende sites&quot;.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {leads.map((lead) => {
            const variant = VARIANT_LABELS[lead.category_query || ""] || { label: "Premium", color: "bg-slate-700" };
            const isActive = generating === lead.place_id;

            return (
              <Card key={lead.place_id} className="card-elev card-hover border-0">
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-display font-semibold text-ink truncate max-w-full">
                        {lead.name}
                      </span>
                      <Badge variant="secondary" className={`${variant.color} text-white text-[10px] px-1.5 py-0`}>
                        {variant.label}
                      </Badge>
                      {lead.category_query && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {CATEGORY_LABELS[lead.category_query] || lead.category_query}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-soft">
                      {lead.city_query && <span>{lead.city_query}</span>}
                      {lead.rating && (
                        <span className="inline-flex items-center gap-1"><span className="text-amber-300">★</span> <span className="num">{lead.rating.toFixed(1)}</span> <span className="text-ink-faint">({lead.rating_count})</span></span>
                      )}
                      {lead.site_generated_at && (
                        <span>
                          Gegenereerd: {new Date(lead.site_generated_at).toLocaleDateString("nl-NL", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                    <a
                      href={`/sites/${lead.place_id}/index.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Bekijk
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => regenerateSite(lead.place_id)}
                      disabled={isActive}
                    >
                      {isActive ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteSite(lead.place_id)}
                      disabled={isActive}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
