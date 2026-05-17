"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Eye, ExternalLink, Star, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import type { Lead, LeadsResponse } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<LeadsResponse & { availableCities: string[]; availableCategories: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const page = parseInt(searchParams.get("page") || "1");
  const status = searchParams.get("status") || "all";
  const city = searchParams.get("city") || "";
  const category = searchParams.get("category") || "";
  const search = searchParams.get("search") || "";
  const sortBy = searchParams.get("sortBy") || "discovered_at";
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("perPage", "50");
    if (status !== "all") params.set("status", status);
    if (city) params.set("cities", city);
    if (category) params.set("categories", category);
    if (search) params.set("search", search);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    const res = await fetch(`/api/leads?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, status, city, category, search, sortBy, sortDir]);

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
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Leads. <span className="italic font-normal text-ink-soft">Filter en beheer.</span>
        </h2>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-3 mb-6">
        <Input
          placeholder="Zoek op naam…"
          value={search}
          onChange={(e) => updateParams({ search: e.target.value })}
          className="w-full sm:w-56"
        />

        <Select value={status} onValueChange={(v) => updateParams({ status: v })}>
          <SelectTrigger className="flex-1 sm:flex-none sm:w-40 min-w-[120px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="rejected">Afgewezen</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        {data?.availableCities && (
          <Select value={city || "all"} onValueChange={(v) => updateParams({ city: v === "all" ? "" : v })}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-40 min-w-[120px]">
              <SelectValue placeholder="Stad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle steden</SelectItem>
              {data.availableCities.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {data?.availableCategories && (
          <Select value={category || "all"} onValueChange={(v) => updateParams({ category: v === "all" ? "" : v })}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-44 min-w-[140px]">
              <SelectValue placeholder="Categorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle categorieën</SelectItem>
              {data.availableCategories.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORIES[c] || c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-ink-soft">
                  Laden…
                </TableCell>
              </TableRow>
            ) : data?.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-ink-soft">
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
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
