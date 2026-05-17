"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScoreBadge } from "@/components/score-badge";
import { Separator } from "@/components/ui/separator";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Phone, Globe, ExternalLink, Star, Mail, Eye, Send, Loader2, Check } from "lucide-react";
import type { Lead } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

interface LeadDetailSheetProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
}

export function LeadDetailSheet({ lead, open, onClose }: LeadDetailSheetProps) {
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  if (!lead) return null;

  const typesArray: string[] = lead.types ? (() => {
    try { return JSON.parse(lead.types); } catch { return []; }
  })() : [];

  async function handlePreview() {
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", placeId: lead!.place_id }),
    });
    const data = await res.json();
    setPreviewHtml(data.html);
  }

  async function handleSend() {
    if (!emailTo) return;
    setSending(true);
    setSendResult(null);
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", placeId: lead!.place_id, toEmail: emailTo }),
    });
    const data = await res.json();
    setSendResult(data);
    setSending(false);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => {
      if (!o) {
        onClose();
        setPreviewHtml(null);
        setSendResult(null);
        setEmailTo("");
      }
    }}>
      <SheetContent className="w-[440px] sm:max-w-[440px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">{lead.name}</SheetTitle>
          <div className="flex items-center gap-2 mt-1">
            <ScoreBadge score={lead.qualified} type="status" />
            <span className="text-xs text-ink-soft">
              {CATEGORIES[lead.category_query || ""] || lead.primary_type}
            </span>
            {lead.emailed_at && (
              <span className="text-xs text-success flex items-center gap-1">
                <Mail className="h-3 w-3" /> Gemaild
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {lead.address && (
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 text-ink-soft mt-0.5 shrink-0" />
              <span className="text-sm">{lead.address}</span>
            </div>
          )}

          {lead.phone_national && (
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-ink-soft shrink-0" />
              <a
                href={`tel:${lead.phone_intl || lead.phone_national}`}
                className="text-sm text-navy underline underline-offset-2"
              >
                {lead.phone_national}
              </a>
            </div>
          )}

          {lead.website && (
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-ink-soft shrink-0" />
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-navy underline underline-offset-2 truncate"
              >
                {lead.website}
              </a>
            </div>
          )}

          <div className="flex gap-2">
            <a
              href={`https://www.google.com/maps/place/?q=place_id:${lead.place_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <MapPin className="h-3.5 w-3.5 mr-1.5" />
              Google Maps
              <ExternalLink className="h-3 w-3 ml-1.5" />
            </a>
            {lead.website && (
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Globe className="h-3.5 w-3.5 mr-1.5" />
                Website
                <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            )}
          </div>

          <Separator />

          <div>
            <h4 className="font-display text-sm font-semibold mb-3">GBP Details</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-ink-soft">Rating</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                  <span className="font-medium">{lead.rating ?? "—"}</span>
                  <span className="text-ink-soft text-xs">({lead.rating_count ?? 0})</span>
                </div>
              </div>
              <div>
                <span className="text-ink-soft">Foto&apos;s</span>
                <p className="font-medium mt-0.5">{lead.photo_count}</p>
              </div>
              <div>
                <span className="text-ink-soft">Status</span>
                <p className="font-medium mt-0.5">{lead.business_status || "—"}</p>
              </div>
              <div>
                <span className="text-ink-soft">Stad</span>
                <p className="font-medium mt-0.5">{lead.city_query}</p>
              </div>
              <div>
                <span className="text-ink-soft">Woiwodschap</span>
                <p className="font-medium mt-0.5">{lead.voivodeship || "—"}</p>
              </div>
              <div>
                <span className="text-ink-soft">Gevonden</span>
                <p className="font-medium mt-0.5 text-xs">
                  {lead.discovered_at
                    ? new Date(lead.discovered_at).toLocaleDateString("nl-NL")
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-display text-sm font-semibold mb-3">Score Breakdown</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">GBP-score</span>
                <ScoreBadge score={lead.good_gbp_score} max={7} type="gbp" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Slechte-site-score</span>
                <ScoreBadge score={lead.bad_site_score} type="site" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Drempel GBP</span>
                <span className="text-xs text-ink-soft">≥ 5/7</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Drempel site</span>
                <span className="text-xs text-ink-soft">≥ 3</span>
              </div>
            </div>
          </div>

          {/* Email section */}
          {lead.qualified === 1 && (
            <>
              <Separator />
              <div>
                <h4 className="font-display text-sm font-semibold mb-3">
                  <Mail className="h-4 w-4 inline mr-1.5" />
                  E-mail
                </h4>

                <div className="space-y-3">
                  <Button variant="outline" size="sm" onClick={handlePreview}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" />
                    Bekijk e-mail preview
                  </Button>

                  {previewHtml && (
                    <div className="border border-line rounded-md overflow-hidden">
                      <iframe
                        srcDoc={previewHtml}
                        className="w-full h-64 bg-white"
                        title="Email preview"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="E-mailadres ontvanger"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      className="bg-navy hover:bg-navy/90"
                      onClick={handleSend}
                      disabled={sending || !emailTo}
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>

                  {sendResult && (
                    <p className={`text-xs ${sendResult.ok ? "text-success" : "text-warning"}`}>
                      {sendResult.ok ? (
                        <><Check className="h-3 w-3 inline mr-1" />Verstuurd</>
                      ) : (
                        sendResult.error
                      )}
                    </p>
                  )}

                  {lead.emailed_at && (
                    <p className="text-xs text-ink-soft">
                      Eerder gemaild op {new Date(lead.emailed_at).toLocaleDateString("nl-NL")}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {typesArray.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-display text-sm font-semibold mb-2">Types</h4>
                <div className="flex flex-wrap gap-1">
                  {typesArray.map((t: string) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 bg-background-alt rounded text-xs text-ink-soft"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
