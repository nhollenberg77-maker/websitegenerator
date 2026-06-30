export interface Lead {
  place_id: string;
  name: string;
  address: string | null;
  website: string | null;
  phone_national: string | null;
  phone_intl: string | null;
  rating: number | null;
  rating_count: number | null;
  primary_type: string | null;
  types: string | null;
  business_status: string | null;
  photo_count: number;
  latitude: number | null;
  longitude: number | null;
  city_query: string | null;
  voivodeship: string | null;
  category_query: string | null;
  discovered_at: string | null;
  qualified: number | null;
  bad_site_score: number | null;
  good_gbp_score: number | null;
  qualified_at: string | null;
  emailed_at: string | null;
  site_generated_at: string | null;
  photo_refs: string | null;
  photo_urls: string | null;
  reviews_json: string | null;
  description: string | null;
  enriched_at: string | null;
  slug: string | null;
  contact_email: string | null;
  unsubscribed_at: string | null;
  ai_polish: string | null;
  ai_email: string | null;
  // Agent-team velden (zie AGENT_TEAM.md §4)
  site_quality_score?: number | null;
  site_critique?: string | null;
  email_quality_score?: number | null;
  email_subject?: string | null;
  email_body_html?: string | null;
  approval_status?: string | null;
  approval_note?: string | null;
  approved_at?: string | null;
  site_content?: string | null;
  dossier?: string | null;
}

export interface LeadReview {
  author: string;
  rating: number;
  text: string;
  language?: string;
  original_text?: string;
  original_language?: string;
  time: string;
  photo: string;
}

export interface LeadStats {
  total: number;
  qualified: number;
  rejected: number;
  pending: number;
  emailed: number;
  sites: number;
  byCity: { city: string; count: number }[];
  byCategory: { category: string; qualified: number; total: number }[];
  recentQualified: Lead[];
}

export interface LeadsQuery {
  page: number;
  perPage: number;
  cities: string[];
  categories: string[];
  status: "all" | "qualified" | "rejected" | "pending";
  search: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  minGbp: number | null;
  hasEmail: boolean | null;
}

export interface LeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export const CITIES: Record<string, string> = {
  krakow: "Kraków",
  warszawa: "Warszawa",
  wroclaw: "Wrocław",
  poznan: "Poznań",
  gdansk: "Gdańsk",
  lodz: "Łódź",
  katowice: "Katowice",
  lublin: "Lublin",
  bydgoszcz: "Bydgoszcz",
  szczecin: "Szczecin",
  wieliczka: "Wieliczka",
  niepolomice: "Niepołomice",
};

export const CATEGORIES: Record<string, string> = {
  roofing_contractor: "Dakdekker",
  electrician: "Elektricien",
  plumber: "Loodgieter",
  painter: "Schilder",
  general_contractor: "Aannemer",
};
