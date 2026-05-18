"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreBadge } from "@/components/score-badge";
import { LeadDetailSheet } from "@/components/lead-detail-sheet";
import { Eye, ExternalLink, Star, ChevronLeft, ChevronRight, ArrowUpDown, Mail, Loader2, Check, AlertCircle, SearchCheck, Search, ListChecks, MapPin, Tag, Award, Inbox, Sparkles, X } from "lucide-react";
import type { Lead, LeadsResponse } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const DEFAULT_STATUS = "qualified";
const DEFAULT_MIN_GBP = "5";
const DEFAULT_HAS_EMAIL = "yes";
const DEFAULT_PER_PAGE = "5";

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 lg:p-8 text-ink-soft">Laden…</div>}>
      <LeadsPageContent />
    </Suspense>
  );
}

function LeadsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<LeadsResponse & { availableCities: string[]; availableCategories: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mailingId, setMailingId] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [scrapingEmails, setScrapingEmails] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);

  const page = parseInt(searchParams.get("page") || "1");
  const status = searchParams.get("status") ?? DEFAULT_STATUS;
  const city = searchParams.get("city") || "";
  const category = searchParams.get("category") || "";
  const search = searchParams.get("search") || "";
  const minGbp = searchParams.get("minGbp") ?? DEFAULT_MIN_GBP;
  const hasEmail = searchParams.get("hasEmail") ?? DEFAULT_HAS_EMAIL;
  const perPage = searchParams.get("perPage") ?? DEFAULT_PER_PAGE;
  const sortBy = searchParams.get("sortBy") || "discovered_at";
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";

  const isDefaultFilter =
    status === DEFAULT_STATUS &&
    minGbp === DEFAULT_MIN_GBP &&
    hasEmail === DEFAULT_HAS_EMAIL &&
    perPage === DEFAULT_PER_PAGE &&
    !city &&
    !category &&
    !search;

  const requestedCount = parseInt(perPage) || 5;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("perPage", String(Math.max(1, parseInt(perPage) || 5)));
    if (status !== "all") params.set("status", status);
    if (city) params.set("cities", city);
    if (category) params.set("categories", category);
    if (search) params.set("search", search);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    if (minGbp) params.set("minGbp", minGbp);
    if (hasEmail && hasEmail !== "any") params.set("hasEmail", hasEmail);

    const res = await fetch(`/api/leads?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, status, city, category, search, sortBy, sortDir, minGbp, hasEmail, perPage]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!updates.page) params.set("page", "1");
    router.push(`/leads?${params}`);
  }

  async function handleBulkFindEmails() {
    if (scrapingEmails) return;
    setScrapingEmails(true);
    setScrapeStatus("Zoeken…");
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find-emails-bulk" }),
      });
      const json = await res.json();
      if (json.ok) {
        setScrapeStatus(`${json.found} van ${json.scanned} gevonden`);
        fetchLeads();
      } else {
        setScrapeStatus(json.error || "Fout bij zoeken");
      }
    } catch (err) {
      setScrapeStatus(err instanceof Error ? err.message : "Netwerkfout");
    } finally {
      setScrapingEmails(false);
      setTimeout(() => setScrapeStatus(null), 6000);
    }
  }

  async function handleQuickMail(lead: Lead, e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.contact_email || mailingId) return;
    setMailingId(lead.place_id);
    setMailResult((prev) => ({ ...prev, [lead.place_id]: { ok: false, error: undefined } }));
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-saved", placeId: lead.place_id }),
      });
      const json = await res.json();
      setMailResult((prev) => ({ ...prev, [lead.place_id]: json }));
      if (json.ok) fetchLeads();
    } catch (err) {
      setMailResult((prev) => ({
        ...prev,
        [lead.place_id]: { ok: false, error: err instanceof Error ? err.message : "Onbekende fout" },
      }));
    } finally {
      setMailingId(null);
    }
  }

  function toggleSort(col: string) {
    if (sortBy === col) {
      updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc", sortBy: col });
    } else {
      updateParams({ sortBy: col, sortDir: "desc" });
    }
  }

  function openDetail(lead: Lead) {
    setSelectedLead(lead);
    setSheetOpen(true);
  }

  const FilterField = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs text-ink-soft font-medium">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );

  const SortHeader = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-ink"
      onClick={() => toggleSort(col)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortBy === col ? "text-navy" : "text-ink-soft/40"}`} />
      </div>
    </TableHead>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
      <div className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Leads. <span className="italic font-normal text-ink-soft">Filter en beheer.</span>
        </h2>
        <div className="flex items-center gap-2">
          {scrapeStatus && (
            <span className="text-xs text-ink-soft">{scrapeStatus}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkFindEmails}
            disabled={scrapingEmails}
            title="Zoek e-mailadressen op de websites van alle qualified leads zonder e-mail"
          >
            {scrapingEmails ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <SearchCheck className="h-3.5 w-3.5 mr-1.5" />
            )}
            Zoek ontbrekende e-mails
          </Button>
        </div>
      </div>

      <div className="bg-card border border-line rounded-xl p-5 sm:p-6 mb-5 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-soft font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            Filter leads
          </div>
          {!isDefaultFilter && (
            <button
              type="button"
              onClick={() =>
                router.push("/leads")
              }
              className="text-xs text-ink-soft hover:text-ink flex items-center gap-1 transition-colors"
              title="Zet filter terug naar standaardwaarden"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <FilterField icon={<Inbox className="h-3.5 w-3.5" />} label="Aantal">
            <Input
              type="number"
              min={1}
              max={500}
              value={perPage}
              onChange={(e) => updateParams({ perPage: e.target.value || DEFAULT_PER_PAGE })}
              className="w-full"
            />
          </FilterField>

          <FilterField icon={<ListChecks className="h-3.5 w-3.5" />} label="Status">
            <Select value={status} onValueChange={(v) => updateParams({ status: v ?? "" })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="rejected">Afgewezen</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField icon={<Award className="h-3.5 w-3.5" />} label="GBP-score">
            <Select
              value={minGbp || "any"}
              onValueChange={(v) => updateParams({ minGbp: !v || v === "any" ? "" : v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Min GBP" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Alle scores</SelectItem>
                <SelectItem value="5">≥ 5 / 7</SelectItem>
                <SelectItem value="6">≥ 6 / 7</SelectItem>
                <SelectItem value="7">= 7 / 7</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField icon={<Mail className="h-3.5 w-3.5" />} label="E-mail">
            <Select value={hasEmail} onValueChange={(v) => updateParams({ hasEmail: v ?? "" })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="E-mail" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Met e-mail</SelectItem>
                <SelectItem value="no">Zonder e-mail</SelectItem>
                <SelectItem value="any">Maakt niet uit</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          {data?.availableCities && (
            <FilterField icon={<MapPin className="h-3.5 w-3.5" />} label="Stad">
              <Select value={city || "all"} onValueChange={(v) => updateParams({ city: !v || v === "all" ? "" : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Stad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle steden</SelectItem>
                  {data.availableCities.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          )}

          {data?.availableCategories && (
            <FilterField icon={<Tag className="h-3.5 w-3.5" />} label="Categorie">
              <Select value={category || "all"} onValueChange={(v) => updateParams({ category: !v || v === "all" ? "" : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Categorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle categorieën</SelectItem>
                  {data.availableCategories.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORIES[c] || c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          )}
        </div>

        <div className="mt-4 relative">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <Input
            placeholder="Zoek op bedrijfsnaam…"
            value={search}
            onChange={(e) => updateParams({ search: e.target.value })}
            className="pl-9"
          />
        </div>

        {data && !loading && (
          <div className="mt-4 pt-4 border-t border-line text-sm">
            {data.total >= requestedCount ? (
              <p className="text-ink-soft">
                <span className="font-medium text-ink">{Math.min(data.total, requestedCount)}</span> leads
                {hasEmail === "yes" ? " klaar om te mailen" : " gevonden"} — uit {data.total} matchende leads
              </p>
            ) : data.total > 0 ? (
              <p className="text-warning flex items-start gap-1.5">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Slechts <span className="font-medium">{data.total}</span> van je gevraagde {requestedCount} leads voldoen.
                  Run <span className="font-medium">Start cyclus</span> in de cockpit om meer leads te vinden,
                  of versoepel je filter.
                </span>
              </p>
            ) : (
              <p className="text-ink-soft flex items-start gap-1.5">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Geen leads matchen dit filter. Versoepel de criteria of run <span className="font-medium">Start cyclus</span>.
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-line rounded-lg overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <SortHeader col="name">Naam</SortHeader>
              <SortHeader col="city_query">Stad</SortHeader>
              <TableHead>Type</TableHead>
              <SortHeader col="rating_count">Reviews</SortHeader>
              <SortHeader col="rating">Rating</SortHeader>
              <SortHeader col="photo_count">Foto&apos;s</SortHeader>
              <SortHeader col="good_gbp_score">GBP</SortHeader>
              <SortHeader col="bad_site_score">Site</SortHeader>
              <SortHeader col="qualified">Status</SortHeader>
              <TableHead>Web</TableHead>
              <TableHead>Mail</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-ink-soft">
                  Laden…
                </TableCell>
              </TableRow>
            ) : data?.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-ink-soft">
                  Geen leads gevonden.
                </TableCell>
              </TableRow>
            ) : (
              data?.leads.map((lead) => (
                <TableRow
                  key={lead.place_id}
                  className="cursor-pointer hover:bg-background-alt/50"
                  onClick={() => openDetail(lead)}
                >
                  <TableCell className="font-medium max-w-[200px] truncate">{lead.name}</TableCell>
                  <TableCell className="text-ink-soft text-sm">{lead.city_query}</TableCell>
                  <TableCell className="text-ink-soft text-xs">
                    {CATEGORIES[lead.category_query || ""] || lead.primary_type}
                  </TableCell>
                  <TableCell className="text-sm">{lead.rating_count ?? "—"}</TableCell>
                  <TableCell>
                    {lead.rating ? (
                      <div className="flex items-center gap-1 text-sm">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        {lead.rating}
                      </div>
                    ) : (
                      <span className="text-ink-soft text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{lead.photo_count}</TableCell>
                  <TableCell>
                    <ScoreBadge score={lead.good_gbp_score} max={7} type="gbp" />
                  </TableCell>
                  <TableCell>
                    <ScoreBadge score={lead.bad_site_score} type="site" />
                  </TableCell>
                  <TableCell>
                    <ScoreBadge score={lead.qualified} type="status" />
                  </TableCell>
                  <TableCell>
                    {lead.website && (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-soft hover:text-navy"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const result = mailResult[lead.place_id];
                      const isMailing = mailingId === lead.place_id;
                      const hasEmail = !!lead.contact_email;
                      const alreadySent = !!lead.emailed_at;
                      const title = !hasEmail
                        ? "Geen e-mailadres opgeslagen — open lead om er een toe te voegen"
                        : alreadySent
                          ? `Eerder gemaild op ${new Date(lead.emailed_at!).toLocaleDateString("nl-NL")} — klik om opnieuw te sturen`
                          : `Verstuur template naar ${lead.contact_email}`;
                      return (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={!hasEmail || isMailing}
                          title={title}
                          onClick={(e) => handleQuickMail(lead, e)}
                        >
                          {isMailing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : result?.ok ? (
                            <Check className="h-3.5 w-3.5 text-success" />
                          ) : result && !result.ok ? (
                            <AlertCircle className="h-3.5 w-3.5 text-warning" />
                          ) : (
                            <Mail className={`h-3.5 w-3.5 ${alreadySent ? "text-success" : ""}`} />
                          )}
                        </Button>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(lead);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-ink-soft">
            {data.total} leads — pagina {data.page} van {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <LeadDetailSheet
        key={selectedLead?.place_id ?? "no-lead"}
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
