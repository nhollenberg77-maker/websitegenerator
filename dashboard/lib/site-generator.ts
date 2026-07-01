import fs from "fs";
import path from "path";
import type { Lead, LeadReview } from "./types";
import { applyPhotoCuration } from "./ai-photo-curator";
import {
  CATEGORY_CONTENT,
  NEUTRAL_CONTENT,
  CATEGORY_VARIANT,
  VARIANT_COLORS,
  type TemplateVariant,
  type CategoryContent,
} from "./site-content";

const SITES_DIR = path.resolve(process.cwd(), "public/sites");
const SUB_DIR = path.resolve(process.cwd(), "public/sub");

function getVariant(lead: Lead): TemplateVariant {
  return CATEGORY_VARIANT[lead.category_query || ""] || "premium";
}

type TemplateStyle = "editorial" | "service" | "established" | "food" | "salon" | "medical" | "retail";

// Horeca-types → eigen template met menukaart, openingstijden en reserveren.
const FOOD_TYPES = new Set([
  "restaurant", "cafe", "coffee_shop", "bakery", "bar", "meal_takeaway", "meal_delivery",
  "pizza_restaurant", "ice_cream_shop", "fast_food_restaurant", "food", "sandwich_shop",
  "bistro", "brunch_restaurant", "breakfast_restaurant", "tea_house", "pub", "wine_bar",
]);
// Afspraak / persoonlijke verzorging → prijslijst, openingstijden, "umów wizytę", galerij.
const SALON_TYPES = new Set([
  "hair_care", "hair_salon", "barber_shop", "beauty_salon", "nail_salon",
  "spa", "day_spa", "tattoo_parlor", "massage", "skin_care_clinic", "make_up_artist",
  "waxing_hair_removal_service", "tanning_studio", "wellness_center",
]);
// Zorg / medisch → behandelingen, vertrouwen, afspraak (geen verzonnen claims).
const MEDICAL_TYPES = new Set([
  "dentist", "dental_clinic", "doctor", "physiotherapist", "medical_center", "clinic",
  "veterinary_care", "chiropractor", "optician", "optometrist", "psychologist",
  "podiatrist", "dermatologist", "orthodontist", "hospital",
]);
// Retail / lokale winkel → assortiment, aanbod, openingstijden, locatie.
const RETAIL_TYPES = new Set([
  "store", "clothing_store", "shoe_store", "furniture_store", "florist", "book_store",
  "jewelry_store", "electronics_store", "hardware_store", "pet_store", "gift_shop",
  "bicycle_store", "home_goods_store", "sporting_goods_store", "supplement_store",
  "convenience_store", "grocery_store", "liquor_store", "bookstore",
]);
// Exacte token-match (GEEN substring — anders matcht 'barber_shop' op 'bar').
function matchesTypes(lead: Lead, set: Set<string>): boolean {
  const tokens = new Set<string>();
  if (lead.category_query) tokens.add(lead.category_query.toLowerCase());
  if (lead.primary_type) tokens.add(lead.primary_type.toLowerCase());
  const raw = lead.types || "";
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach((t) => tokens.add(String(t).toLowerCase()));
  } catch {
    raw.toLowerCase().split(/[\s,[\]"']+/).forEach((t) => { if (t) tokens.add(t); });
  }
  for (const t of set) if (tokens.has(t)) return true;
  return false;
}
// Venues/entertainment die als "cafe" opduiken maar GEEN horeca zijn (klimhal,
// bioscoop, podium, club). Die krijgen de neutrale template i.p.v. een menukaart.
const VENUE_TYPES = new Set([
  "movie_theater", "performing_arts_theater", "sports_activity_location", "night_club",
  "tourist_attraction", "amusement_center", "bowling_alley", "concert_hall", "art_gallery",
  "museum", "stadium", "gym", "fitness_center", "event_venue", "cultural_center",
]);
// Strikte match: alleen op het PRIMAIRE signaal (zoek-categorie of primary_type),
// niet op de volledige types-array — anders matcht een restaurant met 'event_venue'
// in z'n tags ten onrechte als venue.
function matchesPrimaryTypes(lead: Lead, set: Set<string>): boolean {
  return set.has((lead.category_query || "").toLowerCase()) || set.has((lead.primary_type || "").toLowerCase());
}
function isVenue(lead: Lead): boolean {
  return matchesPrimaryTypes(lead, VENUE_TYPES);
}
function isFood(lead: Lead): boolean {
  if (isVenue(lead)) return false; // primair een venue (klimhal/bioscoop) ≠ restaurant
  return matchesTypes(lead, FOOD_TYPES);
}

// Trefwoorden die wijzen op een echte 24/7 noodservice — alleen die krijgen
// het phone-first urgency-template. Een normale loodgieter/elektricien zonder
// deze signalen wordt afspraak-gebaseerd verkocht via het editorial-template.
const EMERGENCY_KEYWORDS = [
  "24h", "24/7", "pogotowie", "awari", "całodobow", "całodobow",
  "interwencj", "emergency", "non-stop", "nonstop", " noc", "noc ",
];

function isEmergencyService(lead: Lead): boolean {
  const haystack = `${lead.name || ""} ${lead.types || ""}`.toLowerCase();
  return EMERGENCY_KEYWORDS.some((k) => haystack.includes(k));
}

function getTemplateStyle(lead: Lead): TemplateStyle {
  // Venue/entertainment (klimhal, bioscoop, podium, museum) → neutrale template,
  // maar alleen als het PRIMAIR een venue is (niet als 'event_venue' toevallig in
  // de types-array van een restaurant staat — zoals HEVRE).
  if (isVenue(lead)) return "editorial";
  // Horeca → food-template (menukaart, openingstijden, reserveren)
  if (isFood(lead)) return "food";
  // Persoonlijke verzorging (kapper/beauty/nagels/tattoo/spa) → afspraak-template
  if (matchesTypes(lead, SALON_TYPES)) return "salon";
  // Zorg (tandarts/fysio/kliniek/dierenarts) → zorg-template
  if (matchesTypes(lead, MEDICAL_TYPES)) return "medical";
  // Lokale winkel → retail-template
  if (matchesTypes(lead, RETAIL_TYPES)) return "retail";
  // Echte noodservice (24h locksmith/hydraulik/elektryk pogotowie) → phone-first
  if (isEmergencyService(lead)) return "service";
  // Dakdekkers → established (traditioneel, gevestigd gevoel)
  if (lead.category_query === "roofing_contractor") return "established";
  // Default: editorial — nette neutrale site die de dienst verkoopt
  return "editorial";
}

function getContent(lead: Lead): CategoryContent {
  // Bekende bouw-categorie → vakspecifieke template; al het andere → neutraal.
  // (De Builder-agent overschrijft dit toch met eigen, bedrijfsspecifieke copy.)
  return CATEGORY_CONTENT[lead.category_query || ""] || NEUTRAL_CONTENT;
}

// Door de Builder-agent geschreven content-spec (geldt voor ELK type bedrijf).
export interface SiteContentSpec {
  category_label?: string;
  hero_headline?: string;
  hero_headline_em?: string;
  hero_lead?: string;
  about?: string;
  services?: { title: string; description: string }[];
  highlights?: string[];
  faq?: { q: string; a: string }[];
  select_options?: string[];
  cta_label?: string;
  brand_name?: string;     // exacte naam in logo/header (volledige bedrijfsnaam zonder rechtsvorm)
  // Horeca-specifiek (restaurant/bistro/café/bakkerij):
  cuisine?: string;        // bv. "kuchnia polska", "ramen", "piekarnia rzemieślnicza"
  hours?: string;          // bv. "Pn-Pt 8-20, So-Nd 9-18"
  menu?: { section: string; items: { name: string; description?: string; price?: string }[] }[];
  // Afspraak/verzorging + zorg + retail: prijslijst van diensten/behandelingen/aanbod.
  pricelist?: { name: string; price?: string; note?: string }[];
}

// Maakt modeltekst schoon: letterlijke "\n"-escapes en echte newlines die het
// model in de velden zette renderen anders zichtbaar als "\n\n" op de pagina.
function cleanProseDeep<T>(v: T): T {
  if (typeof v === "string") {
    return v.replace(/\\r|\\n|[\r\n]+/g, " ").replace(/\\t|\t/g, " ").replace(/ {2,}/g, " ").trim() as unknown as T;
  }
  if (Array.isArray(v)) return v.map((x) => cleanProseDeep(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = cleanProseDeep((v as Record<string, unknown>)[k]);
    return o as unknown as T;
  }
  return v;
}

function parseSiteContent(lead: Lead): SiteContentSpec | null {
  const sc = parseJson<SiteContentSpec | null>(lead.site_content ?? null, null);
  return sc ? cleanProseDeep(sc) : sc;
}

// Deterministische kwaliteitscontrole van een gebouwde site. Retourneert de
// concrete problemen (leeg → geen problemen). Gebruikt door de orchestrator om
// zwakke sites automatisch te laten herbouwen — de Manager doet de inhoudelijke
// beoordeling (toon, claims, of het bedrijf klopt).
const QC_FOREIGN = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ฀-๿]/;
export function siteQualityIssues(lead: Lead): string[] {
  const issues: string[] = [];
  const sc = parseSiteContent(lead);
  // Alleen ECHTE, herstelbare problemen triggeren een herbouw. Ontbrekende
  // menukaart/prijslijst NIET — een bar/venue kan die per definitie niet hebben,
  // wat anders een eindeloze herbouw-lus geeft (en het versturen verhongert).
  if (!sc || !sc.about || sc.about.length < 40) issues.push("lege/generieke content");
  if (lead.site_content && QC_FOREIGN.test(lead.site_content)) issues.push("niet-Poolse tekens");
  return issues;
}

// Smelt agent-copy in de basis-template. Lege/ontbrekende velden vallen terug.
function mergeSiteContent(base: CategoryContent, sc: SiteContentSpec | null): CategoryContent {
  if (!sc) return base;
  return {
    ...base,
    heroHeadline: sc.hero_headline || base.heroHeadline,
    heroHeadlineEm: sc.hero_headline_em || base.heroHeadlineEm,
    heroLead: sc.hero_lead || base.heroLead,
    aboutP1: sc.about || base.aboutP1,
    aboutP2: sc.about ? "" : base.aboutP2,
    services: sc.services?.length
      ? sc.services.slice(0, 6).map((s, i) => ({ icon: base.services[i % Math.max(1, base.services.length)]?.icon ?? base.services[0]?.icon ?? "", title: s.title, description: s.description }))
      : base.services,
    faqItems: sc.faq?.length ? sc.faq.slice(0, 5) : base.faqItems,
    trustItems: sc.highlights?.length ? sc.highlights.slice(0, 5) : base.trustItems,
    selectOptions: sc.select_options?.length ? sc.select_options : base.selectOptions,
  };
}

function categoryLabel(lead: Lead, sc: SiteContentSpec | null): string {
  return sc?.category_label || CATEGORY_PL[lead.category_query || ""] || "usługi lokalne";
}

// Poolse locatief (miejscownik) voor de bekende steden/voivodeships. Voorkomt
// de "w Warszawa"-fout. Onbekende namen → "w rejonie/regionie X" (grammaticaal
// veilig, geen verkeerde verbuiging).
const LOCATIVE_CITY: Record<string, string> = {
  "Kraków": "Krakowie", "Warszawa": "Warszawie", "Wrocław": "Wrocławiu",
  "Poznań": "Poznaniu", "Gdańsk": "Gdańsku", "Łódź": "Łodzi",
  "Katowice": "Katowicach", "Lublin": "Lublinie", "Bydgoszcz": "Bydgoszczy",
  "Szczecin": "Szczecinie", "Wieliczka": "Wieliczce", "Niepołomice": "Niepołomicach",
};
const LOCATIVE_VOIV: Record<string, string> = {
  "Małopolskie": "Małopolsce", "Mazowieckie": "Mazowieckiem", "Dolnośląskie": "Dolnośląskiem",
  "Wielkopolskie": "Wielkopolsce", "Pomorskie": "Pomorskiem", "Łódzkie": "Łódzkiem",
  "Śląskie": "Śląskiem", "Lubelskie": "Lubelskiem", "Kujawsko-pomorskie": "Kujawsko-pomorskiem",
  "Zachodniopomorskie": "Zachodniopomorskiem",
};
function wCity(city: string): string {
  return LOCATIVE_CITY[city] ? `w ${LOCATIVE_CITY[city]}` : `w rejonie ${city}`;
}
function wVoiv(v: string): string {
  return LOCATIVE_VOIV[v] ? `w ${LOCATIVE_VOIV[v]}` : `w regionie ${v}`;
}

// Poolse rechtsvormen + prefixen die we niet in het logo willen tonen.
// Wordt zowel als prefix als als suffix gestript (case-insensitive).
const PL_COMPANY_NOISE = [
  "sp. z o.o.", "sp.z o.o.", "spółka z o.o.",
  "s.a.", "spółka akcyjna",
  "s.c.", "spółka cywilna",
  "p.p.u.h.", "ppuh",
  "f.h.u.", "fhu",
  "f.u.h.", "fuh",
  "z.u.h.", "zuh",
  "p.u.h.", "puh",
  "z.p.h.u.", "zphu",
  "p.h.u.", "phu",
];

function stripCompanyNoise(name: string): string {
  let cleaned = name;
  for (const noise of PL_COMPANY_NOISE) {
    const re = new RegExp(`(^|\\s)${noise.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=\\s|$|,)`, "gi");
    cleaned = cleaned.replace(re, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function splitCompanyName(name: string): { main: string; sub: string } {
  // T6: strip Poolse rechtsvormen vóór de split zodat "P.P.U.H. Drewbud
  // sp. z o.o." → "Drewbud" en niet "P.P.U.H." als hoofdwoord eindigt.
  const cleaned = stripCompanyNoise(name);
  const firstPart = cleaned.split(/[.,]/)[0].trim() || cleaned;
  const words = firstPart.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { main: name, sub: "" };
  if (words.length === 1) return { main: words[0], sub: "" };
  if (words.length === 2) return { main: words[0], sub: words[1] };
  return { main: words.slice(0, 2).join(" "), sub: "" };
}

// Naam voor logo/header. De Builder kan dit expliciet sturen via brand_name
// (zodat een meerwoordige naam als "Kawiarnia Drukarnia" niet wordt afgekapt).
function displayName(lead: Lead, sc: SiteContentSpec | null): { main: string; sub: string } {
  const bn = sc?.brand_name?.trim();
  if (bn) return { main: bn.slice(0, 36), sub: "" };
  return splitCompanyName(lead.name);
}
// Volledige (schone) merknaam voor templates met één logo-regel (food).
function brandLine(lead: Lead, sc: SiteContentSpec | null): string {
  return (sc?.brand_name?.trim() || stripCompanyNoise(lead.name) || lead.name).slice(0, 36);
}

const TRUST_ICONS = [
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
];

function formatPhone(phone: string | null): string {
  return phone || ""; // geen nep "+48 000 000 000" meer — templates tonen alleen bij hasPhone
}

function phoneDigits(phone: string | null): string {
  if (!phone) return ""; // leeg → WhatsApp-knop wordt niet gerenderd (geen wa.me/48000000000)
  return phone.replace(/[^0-9+]/g, "").replace("+", "");
}

// Klikbare tel:-link. Leeg bij ontbrekend nummer (caller gate't op hasPhone).
function phoneLink(phone: string | null): string {
  const digits = phoneDigits(phone);
  if (!digits) return "#kontakt";
  return digits.startsWith("48") ? `tel:+${digits}` : `tel:+48${digits}`;
}

// Echte plaats uit het adres (na de postcode) — voorkomt dat de site "Kraków"
// toont terwijl het bedrijf in een randgemeente (Gdynia/Skawina/Wieliczka) zit.
function localityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(/\d{2}-\d{3}\s+([^,]+?)\s*$/);
  return m ? m[1].trim() : null;
}
function displayCity(lead: Lead): string {
  return localityFromAddress(lead.address) || lead.city_query || "Twoje miasto";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeCssUrl(url: string): string {
  return url.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[,.;:!?-]+$/, "") + "…";
}

const SITE_DOMAIN = "stronadlatwojejfirmy.com.pl";

function siteOrigin(lead: Lead): string {
  return lead.slug ? `https://${lead.slug}.${SITE_DOMAIN}` : "";
}

function getInitials(name: string): string {
  const words = name.replace(/[^\p{L} ]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildSeoHead(
  lead: Lead,
  opts: { title: string; description: string; city: string; accent: string }
): string {
  const origin = siteOrigin(lead);
  const photos = proxyPhotos(parseJson<string[]>(lead.photo_urls, []));
  const firstPhoto = photos[0] || "";
  const ogImage = firstPhoto && origin && firstPhoto.startsWith("/") ? `${origin}${firstPhoto}` : firstPhoto;
  const desc = opts.description.length > 200 ? opts.description.slice(0, 197) + "..." : opts.description;

  const initials = escapeHtml(getInitials(lead.name));
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${opts.accent}"/><text x="32" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="white">${initials}</text></svg>`;
  const faviconDataUri = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: lead.name,
    description: desc,
  };
  if (origin) jsonLd.url = origin;
  if (lead.phone_intl || lead.phone_national) jsonLd.telephone = lead.phone_intl || lead.phone_national;
  if (lead.address) {
    jsonLd.address = {
      "@type": "PostalAddress",
      streetAddress: lead.address,
      addressLocality: opts.city,
      addressCountry: "PL",
    };
  }
  if (typeof lead.latitude === "number" && typeof lead.longitude === "number") {
    jsonLd.geo = { "@type": "GeoCoordinates", latitude: lead.latitude, longitude: lead.longitude };
  }
  if (ogImage) jsonLd.image = ogImage;
  if (lead.rating && lead.rating_count && lead.rating_count > 0) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: lead.rating,
      reviewCount: lead.rating_count,
    };
  }
  // </script> in JSON breekt het script-blok — escape de slash.
  const jsonLdEscaped = JSON.stringify(jsonLd).replace(/<\/script/gi, "<\\/script");

  const tags: string[] = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="pl_PL">`,
    `<meta property="og:title" content="${escapeHtml(opts.title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:site_name" content="${escapeHtml(lead.name)}">`,
    `<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(opts.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}">`,
  ];
  if (origin) tags.push(`<meta property="og:url" content="${escapeHtml(origin)}">`);
  if (ogImage) {
    tags.push(`<meta property="og:image" content="${escapeHtml(ogImage)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}">`);
  }
  if (origin) tags.push(`<link rel="canonical" href="${escapeHtml(origin)}">`);
  tags.push(`<link rel="icon" type="image/svg+xml" href="${faviconDataUri}">`);
  tags.push(`<script type="application/ld+json">${jsonLdEscaped}</script>`);

  return tags.join("\n  ");
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// Saneert een photo-URL voor gebruik in <img src=...>. Modern (sinds enrich.py
// de proxy gebruikt) zijn dit al "/api/photo?ref=..." paden — die gaan
// ongewijzigd door. Voor eventuele legacy DB-rijen waar nog
// "https://places.googleapis.com/.../media?...&key=ABC" in staat: pak de
// photo-ref eruit en gebruik alsnog de proxy zodat de key niet lekt.
function proxyPhotoUrl(input: string): string {
  if (!input) return "";
  if (input.startsWith("/api/photo")) return input;
  // Legacy: bare Places URL met key. Pak ref + width eruit.
  const m = input.match(/places\.googleapis\.com\/v1\/(places\/[^/]+\/photos\/[^/?]+)\/media(?:\?([^#]*))?/);
  if (m) {
    const ref = m[1];
    const params = new URLSearchParams(m[2] || "");
    const w = params.get("maxWidthPx") || "1200";
    return `/api/photo?ref=${encodeURIComponent(ref)}&w=${w}`;
  }
  return input;
}

function proxyPhotos(urls: string[]): string[] {
  return urls.map(proxyPhotoUrl).filter(Boolean);
}

const CATEGORY_PL: Record<string, string> = {
  roofing_contractor: "dekarstwo i pokrycia dachowe",
  electrician: "instalacje elektryczne",
  plumber: "instalacje sanitarne i hydrauliczne",
  painter: "malowanie i wykończenia",
  general_contractor: "usługi budowlane i remontowe",
};

export function generateSiteHtml(lead: Lead): string {
  const style = getTemplateStyle(lead);
  if (style === "food") return generateFoodSiteHtml(lead);
  if (style === "salon") return generateAppointmentSiteHtml(lead, "salon");
  if (style === "medical") return generateAppointmentSiteHtml(lead, "medical");
  if (style === "retail") return generateAppointmentSiteHtml(lead, "retail");
  if (style === "service") return generateServiceSiteHtml(lead);
  const variant = getVariant(lead);
  const templateStyle = getTemplateStyle(lead);
  const sc = parseSiteContent(lead);
  const content = mergeSiteContent(getContent(lead), sc);
  const colors = VARIANT_COLORS[variant];
  const { main: namePart1, sub: namePart2 } = displayName(lead, sc);
  const city = displayCity(lead);
  const voivodeship = lead.voivodeship || city;
  const hasPhone = !!(lead.phone_national || lead.phone_intl);
  const hasAddress = !!lead.address;
  const phone = formatPhone(lead.phone_national);
  const phoneLnk = phoneLink(lead.phone_intl || lead.phone_national);
  const waPhone = phoneDigits(lead.phone_intl || lead.phone_national);
  const address = lead.address || "";
  const rating = lead.rating ?? 0;
  const ratingCount = lead.rating_count ?? 0;
  const categoryPl = categoryLabel(lead, sc);

  const photoUrls: string[] = proxyPhotos(applyPhotoCuration(parseJson(lead.photo_urls, []), lead.ai_polish));
  const reviews: LeadReview[] = parseJson<LeadReview[]>(lead.reviews_json, [])
    .filter((r) => r.rating >= 4 && r.text && r.text.trim().length >= 20)
    .map((r) => {
      // Prefer the Polish original text if Google translated it for us
      if (r.original_language === "pl" && r.original_text) return { ...r, text: r.original_text };
      return r;
    })
    .filter((r) => {
      // Drop reviews that we know are originally non-Polish (English, UK, etc.)
      if (r.original_language && r.original_language !== "pl") return false;
      if (r.language && r.language !== "pl" && !r.original_language) return false;
      return true;
    });
  const businessDesc = sc?.about || lead.description || "";
  const hasPhotos = photoUrls.length > 0;
  const hasReviews = reviews.length > 0;
  const hasRating = ratingCount > 0 && rating > 0;

  const heroImg = photoUrls[0] || "";
  const galleryPhotos = photoUrls.slice(1);
  const aboutImg = photoUrls.length > 3 ? photoUrls[Math.min(photoUrls.length - 1, 6)] : "";

  // Wie ontvangt het ingevulde formulier? Bij voorkeur de aannemer zelf —
  // anders blijft het veld leeg en moet de bezoeker het invullen voordat hij
  // verzendt. Het formulier opent de mailclient van de bezoeker via mailto:
  // met alle velden voorgevuld als body.
  const formRecipient = (lead.contact_email || "").trim();

  const servicesHtml = content.services
    .map(
      (s) => `
        <div class="service">
          ${s.icon}
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.description)}</p>
        </div>`
    )
    .join("");

  const faqHtml = content.faqItems
    .slice(0, 3)
    .map(
      (f) => `
        <details class="faq-item">
          <summary class="faq-q">
            <h3>${escapeHtml(f.q)}</h3>
            <span class="faq-icon">+</span>
          </summary>
          <div class="faq-a">${escapeHtml(f.a)}</div>
        </details>`
    )
    .join("");

  const selectHtml = content.selectOptions
    .map((o) => `<option>${escapeHtml(o)}</option>`)
    .join("\n              ");

  const starsHtml = hasRating
    ? "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating))
    : "";

  const nearbyAreas = getNearbyAreas(city, voivodeship);

  // --- Trust strip: only real data ---
  const trustItems: string[] = [];
  if (hasRating) trustItems.push(`${rating.toFixed(1)} ★ na Google (${ratingCount} opinii)`);
  if (lead.phone_national) trustItems.push("Bezpośredni kontakt telefoniczny");
  trustItems.push(...content.trustItems.slice(0, 4 - trustItems.length));

  // --- Hero meta: only verifiable data ---
  const strongRating = hasRating && rating >= 4.0;
  const socialProofCount = ratingCount >= 10 ? Math.floor(ratingCount / 10) * 10 : 0;
  const showSocialProof = strongRating && socialProofCount >= 10;
  const heroMetaItems: { num: string; label: string }[] = [];
  if (strongRating) heroMetaItems.push({ num: rating.toFixed(1), label: `ocena Google (${ratingCount})` });
  heroMetaItems.push({ num: escapeHtml(city), label: "i okolice" });
  if (hasPhotos) heroMetaItems.push({ num: String(photoUrls.length), label: "zdjęć" });
  if (!hasRating && !hasPhotos) heroMetaItems.push({ num: categoryPl.split(" ")[0], label: categoryPl.split(" ").slice(1).join(" ") });

  // --- Gallery section: only if we have real photos ---
  const showGallery = galleryPhotos.length >= 2;
  const galleryHtml = showGallery ? `
  <section class="block" id="realizacje">
    <div class="block-inner">
      <div class="projects-head">
        <div>
          <div class="eyebrow">Zdjęcia</div>
          <h2 style="font-size: clamp(32px, 4.5vw, 52px)">Nasza praca <em>mówi za siebie.</em></h2>
        </div>
      </div>
      <div class="projects-grid">
        ${galleryPhotos.slice(0, 5).map((url, i) => `<div class="project"><img src="${escapeHtml(url)}" alt="${escapeHtml(lead.name)} — zdjęcie ${i + 1}"></div>`).join("\n        ")}
      </div>
    </div>
  </section>` : "";

  // --- Reviews section: only real reviews ---
  const reviewsHtml = hasReviews ? `
  <section class="block" id="opinie" style="background: var(--bg-alt);">
    <div class="block-inner">
      <div class="section-head">
        <div class="eyebrow">Opinie klientów</div>
        <h2>Co mówią o nas <em>nasi klienci.</em></h2>
      </div>
      <div class="reviews-grid">
        ${reviews.slice(0, 3).map((rev) => {
          const revStars = "★".repeat(Math.round(rev.rating)) + "☆".repeat(5 - Math.round(rev.rating));
          const revText = rev.text ? smartTruncate(rev.text, 200) : "Polecam!";
          return `<div class="review">
          <div class="review-stars">${revStars}</div>
          <p>"${escapeHtml(revText)}"</p>
          <div class="review-author">${escapeHtml(rev.author)}<span>${escapeHtml(rev.time || "")}</span></div>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>
  </section>` : "";

  // --- Hero card: only with real review ---
  const heroCardHtml = hasReviews && reviews[0].text ? `
        <div class="hero-card">
          <div class="stars">${"★".repeat(Math.round(reviews[0].rating))}</div>
          <p>"${escapeHtml(smartTruncate(reviews[0].text, 90))}"</p>
          <div class="author">${escapeHtml(reviews[0].author)}</div>
        </div>` : "";

  // --- About quote: only from real review ---
  // T5: expliciet als klant-opinie labelen — anders leest het alsof het de
  // eigenaar zelf is die in eerste persoon spreekt.
  const aboutQuoteReview = reviews.find((r) => r.text && r.text.length > 30);
  const aboutQuoteHtml = aboutQuoteReview ? `
          <div class="about-quote">
            <div class="quote-label">Opinia klienta</div>
            <p>"${escapeHtml(smartTruncate(aboutQuoteReview.text, 160))}"</p>
            <div class="author">${escapeHtml(aboutQuoteReview.author)}</div>
          </div>` : "";

  // --- About title: short form, full name stays in <p> ---
  const aboutTitle = namePart2 ? `${namePart1} ${namePart2}` : namePart1;

  // --- Nav items: only link to sections that exist ---
  const navItems: { href: string; label: string }[] = [
    { href: "#uslugi", label: "Usługi" },
  ];
  if (showGallery) navItems.push({ href: "#realizacje", label: "Zdjęcia" });
  navItems.push({ href: "#dlaczego-my", label: "Jak pracujemy" });
  navItems.push({ href: "#o-nas", label: "O nas" });
  if (hasReviews) navItems.push({ href: "#opinie", label: "Opinie" });
  navItems.push({ href: "#kontakt", label: "Kontakt" });

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(lead.name)} — ${escapeHtml(categoryPl)} ${escapeHtml(city)}</title>
  <meta name="description" content="${escapeHtml(lead.name)} — ${escapeHtml(categoryPl)} ${wCity(city)}. ${businessDesc ? escapeHtml(businessDesc.slice(0, 140)) : (hasPhone ? `Zadzwoń: ${escapeHtml(phone)}` : "Zapraszamy do kontaktu.")}">
  ${buildSeoHead(lead, {
    title: `${lead.name} — ${categoryPl} ${city}`,
    description: businessDesc || (hasPhone ? `${lead.name} — ${categoryPl} ${wCity(city)}. Zadzwoń: ${phone}.` : `${lead.name} — ${categoryPl} ${wCity(city)}. Zapraszamy do kontaktu.`),
    city,
    accent: colors.accent,
  })}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Inter:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..500&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAFAF7;
      --bg-alt: #F2F0EA;
      --bg-dark: ${colors.bgDark};
      --ink: #1A1A1A;
      --ink-soft: #5A5A55;
      --ink-faint: #9A9A95;
      --line: #E5E2DC;
      --line-soft: #EFEDE7;
      --accent: ${colors.accent};
      --accent-hover: ${colors.accentHover};
      --accent-soft: ${colors.accentSoft};
      --whatsapp: #25D366;
      --whatsapp-hover: #1FA855;
      --warn: #E8B339;
      --display: 'Bricolage Grotesque', system-ui, sans-serif;
      --body: 'Inter', system-ui, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: var(--body); background: var(--bg); color: var(--ink); line-height: 1.6; font-size: 16px; letter-spacing: -0.011em; font-feature-settings: 'ss01', 'cv11'; -webkit-font-smoothing: antialiased; padding-bottom: 80px; }
    @media (min-width: 768px) { body { padding-bottom: 0; font-size: 16.5px; } }
    .container, .block-inner { max-width: 1340px; margin: 0 auto; padding: 0 32px; }
    h1, h2, h3, h4 { font-family: var(--display); font-weight: 500; letter-spacing: -0.035em; line-height: 1.02; font-optical-sizing: auto; }
    h1 em, h2 em, h3 em { font-style: normal; color: var(--ink-soft); font-weight: 400; }
    p { color: var(--ink); }
    .eyebrow { font-family: var(--body); font-size: 12px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 18px; display: inline-flex; align-items: center; gap: 8px; }
    .eyebrow::before { content: ''; width: 24px; height: 1px; background: var(--ink-soft); }
    .topbar { background: var(--bg-dark); color: rgba(255,255,255,0.85); font-size: 13px; padding: 8px 24px; text-align: center; }
    .topbar a { color: white; font-weight: 600; text-decoration: none; }
    header { position: sticky; top: 0; z-index: 50; background: rgba(250, 250, 247, 0.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .header-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px 32px; max-width: 1340px; margin: 0 auto; gap: 32px; }
    .logo { font-family: var(--display); font-size: 22px; font-weight: 600; letter-spacing: -0.035em; text-decoration: none; color: var(--ink); flex-shrink: 0; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
    .logo span { color: var(--ink-soft); font-weight: 400; }
    nav.main-nav { display: none; gap: 32px; flex: 1; justify-content: center; }
    @media (min-width: 1024px) { nav.main-nav { display: flex; } }
    nav.main-nav a { color: var(--ink); text-decoration: none; font-size: 15px; font-weight: 500; transition: color 0.2s ease; }
    nav.main-nav a:hover { color: var(--accent); }
    .header-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .phone-link { display: none; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); text-decoration: none; font-size: 15px; }
    @media (min-width: 768px) { .phone-link { display: inline-flex; } }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 100px; font-family: var(--body); font-size: 14px; font-weight: 600; text-decoration: none; transition: all 0.2s ease; border: none; cursor: pointer; white-space: nowrap; }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .btn-whatsapp { background: var(--whatsapp); color: white; }
    .btn-whatsapp:hover { background: var(--whatsapp-hover); transform: translateY(-1px); }
    .btn-ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .btn-ghost:hover { background: var(--ink); color: white; border-color: var(--ink); }
    .btn-lg { padding: 16px 28px; font-size: 16px; }
    a:focus-visible, .btn:focus-visible, summary:focus-visible, .faq-q:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
    .form-group input:focus-visible, .form-group textarea:focus-visible, .form-group select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
    .hero { padding: 64px 24px 80px; max-width: 1340px; margin: 0 auto; }
    @media (min-width: 768px) { .hero { padding: 100px 24px 120px; } }
    .hero-grid { display: grid; grid-template-columns: 1fr; gap: 56px; align-items: center; }
    @media (min-width: 1024px) { .hero-grid { grid-template-columns: ${hasPhotos ? "1.15fr 1fr" : "1fr"}; gap: 80px; } }
    .hero h1 { font-size: clamp(40px, 7vw, 80px); margin-bottom: 28px; }
    .hero-lead { font-size: 18px; color: var(--ink-soft); margin-bottom: 36px; max-width: 520px; }
    .hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
    .hero-social-proof { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 36px; font-size: 13px; color: var(--ink-soft); font-weight: 500; letter-spacing: -0.005em; }
    .hero-social-proof::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
    .hero-meta { display: grid; grid-template-columns: repeat(${heroMetaItems.length}, 1fr); gap: 24px; padding-top: 32px; border-top: 1px solid var(--line); }
    .hero-meta-item .num { font-family: var(--display); font-size: clamp(28px, 4vw, 40px); font-weight: 600; line-height: 1; margin-bottom: 6px; }
    .hero-meta-item .label { font-size: 12px; color: var(--ink-soft); letter-spacing: 0.02em; }
    .hero-image-wrap { position: relative; }
    .hero-image { position: relative; aspect-ratio: 4/5; border-radius: 6px; overflow: hidden; ${heroImg ? `background: var(--bg-alt) url('${escapeCssUrl(heroImg)}') center/cover;` : "background: var(--bg-alt);"} }
    .hero-image::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.2), transparent 50%); }
    .hero-tag { position: absolute; bottom: 24px; left: 24px; background: rgba(255,255,255,0.96); padding: 10px 16px; border-radius: 100px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; z-index: 2; }
    .hero-card { position: absolute; bottom: 24px; right: 24px; background: white; padding: 18px 22px; border-radius: 8px; box-shadow: 0 14px 40px rgba(26, 43, 74, 0.18); max-width: 260px; z-index: 3; display: none; }
    @media (min-width: 768px) { .hero-card { display: block; } }
    .hero-card .stars { color: var(--warn); font-size: 13px; letter-spacing: 2px; margin-bottom: 6px; }
    .hero-card p { font-size: 13px; color: var(--ink); margin-bottom: 8px; line-height: 1.4; }
    .hero-card .author { font-size: 12px; color: var(--ink-soft); font-weight: 600; }
    .trust-strip { background: var(--bg-alt); padding: 24px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .trust-strip-inner { max-width: 1340px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 24px 48px; align-items: center; justify-content: center; color: var(--ink-soft); font-size: 13px; font-weight: 500; }
    .trust-strip-inner span { display: inline-flex; align-items: center; gap: 8px; }
    .trust-strip-inner svg { color: var(--accent); }
    section.block { padding: 72px 24px; }
    @media (min-width: 768px) { section.block { padding: 110px 24px; } }
    .section-head { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 56px; margin-bottom: 64px; align-items: end; }
    .section-head > .eyebrow { grid-column: 1 / -1; }
    .section-head h2 { font-size: clamp(36px, 5vw, 60px); margin: 0; grid-column: 1; }
    .section-head p { font-size: 17px; color: var(--ink-soft); grid-column: 2; padding-bottom: 12px; line-height: 1.55; }
    @media (max-width: 900px) { .section-head { grid-template-columns: 1fr; gap: 20px; } .section-head h2, .section-head p { grid-column: 1; padding-bottom: 0; } }
    .services { background: var(--bg-alt); }
    .services-grid { display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    @media (min-width: 640px) { .services-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (min-width: 1024px) { .services-grid { grid-template-columns: repeat(3, 1fr); } }
    .service { background: var(--bg); padding: 40px 32px; transition: background 0.2s ease; }
    .service:hover { background: white; }
    .service-icon { width: 40px; height: 40px; margin-bottom: 24px; color: var(--accent); }
    .service h3 { font-size: 22px; margin-bottom: 12px; }
    .service p { color: var(--ink-soft); font-size: 15px; line-height: 1.6; }
    .projects-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 48px; flex-wrap: wrap; }
    .projects-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 640px) { .projects-grid { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 180px; } .project:nth-child(1) { grid-column: span 4; grid-row: span 2; } .project:nth-child(2) { grid-column: span 2; grid-row: span 1; } .project:nth-child(3) { grid-column: span 2; grid-row: span 1; } .project:nth-child(4) { grid-column: span 3; grid-row: span 1; } .project:nth-child(5) { grid-column: span 3; grid-row: span 1; } }
    .project { position: relative; overflow: hidden; border-radius: 6px; aspect-ratio: 4/3; background: var(--bg-alt); }
    @media (min-width: 640px) { .project { aspect-ratio: auto; min-height: 180px; } }
    .project img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s ease; }
    .project:hover img { transform: scale(1.04); }
    .why-grid { display: grid; grid-template-columns: 1fr; gap: 32px; }
    @media (min-width: 768px) { .why-grid { grid-template-columns: repeat(2, 1fr); gap: 48px; } }
    @media (min-width: 1024px) { .why-grid { grid-template-columns: repeat(4, 1fr); gap: 32px; } }
    .why-item { display: flex; flex-direction: column; gap: 12px; }
    .why-icon { width: 32px; height: 32px; color: var(--accent); margin-bottom: 4px; }
    .why-item h3 { font-size: 19px; }
    .why-item p { color: var(--ink-soft); font-size: 15px; }
    .about { background: var(--bg-alt); }
    .about-grid { display: grid; grid-template-columns: 1fr; gap: 56px; align-items: center; }
    @media (min-width: 1024px) { .about-grid { grid-template-columns: ${aboutImg ? "1fr 1fr" : "1fr"}; gap: 88px; } }
    .about-text h2 { font-size: clamp(32px, 4vw, 48px); margin-bottom: 24px; max-width: 18ch; line-height: 1.08; }
    .about-text p { font-size: 17px; color: var(--ink-soft); margin-bottom: 20px; }
    .about-image { aspect-ratio: 4/5; border-radius: 6px; overflow: hidden; ${aboutImg ? `background: var(--bg) url('${escapeCssUrl(aboutImg)}') center/cover;` : ""} }
    .about-quote { margin-top: 36px; padding-left: 28px; border-left: 2px solid var(--accent); }
    .about-quote .quote-label { font-family: var(--body); font-size: 11px; color: var(--ink-soft); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 10px; }
    .about-quote p { font-family: var(--display); font-style: normal; font-size: 22px; font-weight: 400; color: var(--ink); margin-bottom: 14px; line-height: 1.35; letter-spacing: -0.025em; }
    .about-quote .author { font-family: var(--body); font-size: 12px; color: var(--ink-soft); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
    .reviews-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
    @media (min-width: 768px) { .reviews-grid { grid-template-columns: repeat(${Math.min(reviews.length, 3)}, 1fr); } }
    .review { padding: 36px 32px; background: var(--bg-alt); border-radius: 8px; }
    .review-stars { color: var(--warn); margin-bottom: 16px; font-size: 14px; letter-spacing: 2px; }
    .review p { font-family: var(--body); font-size: 17px; font-weight: 400; line-height: 1.55; margin-bottom: 24px; color: var(--ink); letter-spacing: -0.01em; }
    .review-author { font-size: 14px; color: var(--ink-soft); font-weight: 600; }
    .review-author span { font-weight: 400; display: block; margin-top: 2px; }
    .area-grid { display: grid; grid-template-columns: 1fr; gap: 48px; align-items: start; }
    @media (min-width: 900px) { .area-grid { grid-template-columns: 1.1fr 1fr; gap: 72px; } }
    .area-heading { font-size: clamp(32px, 4.5vw, 52px); margin-bottom: 20px; }
    .area-intro { font-size: 17px; color: var(--ink-soft); margin-bottom: 28px; max-width: 480px; }
    .area-facts { list-style: none; margin: 0 0 28px; padding: 24px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 18px; }
    .area-facts > div { display: grid; grid-template-columns: 1fr; gap: 4px; }
    @media (min-width: 480px) { .area-facts > div { grid-template-columns: minmax(0, 170px) minmax(0, 1fr); gap: 6px 24px; align-items: baseline; } }
    .area-facts dt { font-family: var(--body); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
    .area-facts dd { font-size: 15px; color: var(--ink); margin: 0; font-weight: 500; line-height: 1.45; }
    .area-cities-line { font-size: 13px; color: var(--ink-soft); line-height: 1.7; margin-bottom: 24px; max-width: 520px; }
    .area-cities-label { font-family: var(--body); display: block; font-weight: 700; color: var(--ink); text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; margin-bottom: 6px; }
    .area-cta { font-size: 14px; color: var(--ink-soft); line-height: 1.5; max-width: 480px; }
    .area-cta a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .area-cta a:hover { text-decoration: underline; }
    .area-map { aspect-ratio: 4/3; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: var(--bg-alt); }
    @media (min-width: 900px) { .area-map { aspect-ratio: 1; min-height: 440px; } }
    .area-map iframe { width: 100%; height: 100%; border: 0; display: block; filter: grayscale(0.15) contrast(0.95); }
    .faq-list { max-width: none; margin: 0; }
    .faq-item { border-bottom: 1px solid var(--line); padding: 28px 0; }
    .faq-item:first-child { border-top: 1px solid var(--line); }
    .faq-q { display: flex; gap: 16px; align-items: start; justify-content: space-between; cursor: pointer; list-style: none; }
    @media (min-width: 768px) { .faq-q { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; } }
    .faq-q::-webkit-details-marker { display: none; }
    .faq-q h3 { font-family: var(--body); font-size: 17px; font-weight: 500; color: var(--ink); letter-spacing: -0.015em; line-height: 1.4; flex: 1; }
    @media (min-width: 768px) { .faq-q h3 { font-size: 18px; grid-column: 1; } }
    .faq-icon { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 400; line-height: 1; transition: transform 0.2s ease; }
    @media (min-width: 768px) { .faq-icon { grid-column: 2; } }
    details[open] .faq-icon { transform: rotate(45deg); }
    .faq-a { padding-top: 18px; padding-left: 0; color: var(--ink-soft); font-size: 16px; line-height: 1.65; max-width: 720px; }
    @media (min-width: 900px) { .faq-a { padding-left: 0; max-width: 760px; } }
    .contact-grid { display: grid; grid-template-columns: 1fr; gap: 48px; }
    @media (min-width: 1024px) { .contact-grid { grid-template-columns: 1fr 1fr; gap: 80px; } }
    .contact-info h3 { font-size: 13px; font-family: var(--body); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
    .contact-info .value { font-family: var(--display); font-size: 26px; font-weight: 500; margin-bottom: 28px; display: block; color: var(--ink); text-decoration: none; line-height: 1.3; }
    .contact-info .value:hover { color: var(--accent); }
    .contact-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
    .contact-form { background: var(--bg-alt); padding: 40px 32px; border-radius: 8px; }
    .rodo-notice { font-size: 11px; color: var(--ink-soft); margin-top: 14px; line-height: 1.5; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--ink); }
    .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 13px 16px; border: 1px solid var(--line); border-radius: 6px; background: white; font-family: var(--body); font-size: 15px; color: var(--ink); transition: border-color 0.2s ease; }
    .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: var(--accent); }
    .form-group textarea { min-height: 110px; resize: vertical; }
    .cta-banner { background: var(--bg-dark); color: white; padding: 60px 24px; text-align: center; }
    .cta-banner h2 { font-size: clamp(28px, 4vw, 44px); color: white; margin-bottom: 16px; }
    .cta-banner h2 em { color: rgba(255,255,255,0.6); }
    .cta-banner p { color: rgba(255,255,255,0.75); font-size: 17px; margin-bottom: 32px; max-width: 600px; margin-left: auto; margin-right: auto; }
    .cta-banner .btn-primary { background: white; color: var(--accent); }
    .cta-banner .btn-primary:hover { background: rgba(255,255,255,0.92); }
    .cta-banner-ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    footer { padding: 56px 24px 32px; background: var(--ink); color: rgba(255,255,255,0.7); font-size: 14px; }
    .footer-inner { max-width: 1340px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 32px; align-items: start; }
    @media (min-width: 768px) { .footer-inner { grid-template-columns: 2fr 1fr 1fr 1fr; } }
    footer .logo { color: white; margin-bottom: 12px; display: block; }
    footer .logo span { color: rgba(255,255,255,0.5); }
    footer p { margin-bottom: 8px; color: rgba(255,255,255,0.7); }
    footer h4 { color: white; font-family: var(--body); font-size: 13px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px; }
    footer ul { list-style: none; }
    footer ul li { margin-bottom: 8px; }
    footer ul a { color: rgba(255,255,255,0.7); text-decoration: none; }
    footer ul a:hover { color: white; }
    .footer-bottom { max-width: 1340px; margin: 40px auto 0; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; font-size: 12px; color: rgba(255,255,255,0.4); flex-wrap: wrap; gap: 12px; }
    .mobile-cta { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 8px; padding: 12px; background: rgba(250, 250, 247, 0.96); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid var(--line); z-index: 100; }
    .mobile-cta .btn { flex: 1; justify-content: center; }
    @media (min-width: 768px) { .mobile-cta { display: none; } }
    @media (prefers-reduced-motion: no-preference) { .reveal { opacity: 0; transform: translateY(20px); animation: reveal 0.8s ease forwards; } .reveal:nth-child(2) { animation-delay: 0.1s; } @keyframes reveal { to { opacity: 1; transform: translateY(0); } } }

    /* === SERVICE TEMPLATE (plumber, electrician — emergency-focused) === */
    body.style-service {
      --display: 'Space Grotesk', system-ui, sans-serif;
      --bg: #F7F8FA;
      --bg-alt: #EBEEF3;
      --line: #D8DDE5;
      --line-soft: #E5E9EF;
      --accent: #0F3D8C;
      --accent-hover: #1248A6;
      --accent-soft: #DCE5F2;
      --bg-dark: #0B2545;
    }
    body.style-service .topbar { display: none; }
    body.style-service h1, body.style-service h2, body.style-service h3, body.style-service h4 { font-weight: 700; letter-spacing: -0.03em; line-height: 1.02; }
    body.style-service h1 em, body.style-service h2 em, body.style-service h3 em { font-weight: 500; color: var(--accent); font-style: normal; }
    body.style-service .hero h1 { font-size: clamp(36px, 6vw, 64px); }
    body.style-service .section-head h2 { font-size: clamp(30px, 4.5vw, 50px); }
    body.style-service .btn { border-radius: 6px; font-weight: 700; letter-spacing: -0.005em; }
    body.style-service .btn-lg { padding: 18px 32px; font-size: 15px; }
    body.style-service .logo { font-weight: 700; letter-spacing: -0.025em; font-size: 22px; }
    body.style-service .logo span { font-weight: 500; color: var(--ink-soft); }
    body.style-service header .phone-link { font-size: 16px; font-weight: 700; color: var(--accent); padding: 8px 14px; background: var(--accent-soft); border-radius: 6px; }
    body.style-service header .phone-link svg { color: var(--accent); }
    body.style-service .eyebrow { font-weight: 700; letter-spacing: 0.14em; color: var(--accent); }
    body.style-service .eyebrow::before { background: var(--accent); }
    body.style-service .service h3, body.style-service .why-item h3 { font-weight: 700; letter-spacing: -0.02em; }
    body.style-service .contact-info .value { font-weight: 700; letter-spacing: -0.025em; }
    body.style-service .hero-meta-item .num { font-weight: 700; letter-spacing: -0.03em; }
    body.style-service .about-quote p { font-family: var(--display); font-style: normal; font-weight: 500; letter-spacing: -0.02em; }
    body.style-service .about-quote { border-left-width: 3px; }
    body.style-service .hero-tag { background: var(--accent); color: white; }

    .emergency-strip { background: #B41E1E; color: white; padding: 11px 24px; }
    .emergency-strip-inner { max-width: 1340px; margin: 0 auto; display: flex; gap: 14px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 14px; font-weight: 600; letter-spacing: -0.005em; font-family: 'Inter', system-ui, sans-serif; }
    .emergency-pulse { width: 9px; height: 9px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); animation: emergency-pulse 1.8s infinite; flex-shrink: 0; }
    @keyframes emergency-pulse { 0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); } 70% { box-shadow: 0 0 0 12px rgba(74, 222, 128, 0); } 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); } }
    .emergency-label { opacity: 0.95; }
    .emergency-divider { opacity: 0.4; }
    .emergency-phone { color: white; text-decoration: none; font-size: 16px; font-weight: 800; letter-spacing: -0.015em; }
    .emergency-phone:hover { text-decoration: underline; }

    /* === ESTABLISHED TEMPLATE (roofing — heritage, generational) === */
    body.style-established {
      --display: 'Newsreader', Georgia, serif;
      --bg: #FAF6EE;
      --bg-alt: #F0E9D9;
      --line: #E5DBC4;
      --line-soft: #EEE6D2;
      --accent: #5C2018;
      --accent-hover: #6E2920;
      --accent-soft: #EFE0DD;
      --bg-dark: #2B1916;
      --ink: #1A1410;
      --ink-soft: #5A5045;
    }
    body.style-established h1, body.style-established h2, body.style-established h3, body.style-established h4 { font-weight: 500; letter-spacing: -0.018em; line-height: 1.08; font-optical-sizing: auto; }
    body.style-established h1 em, body.style-established h2 em, body.style-established h3 em { font-style: italic; font-weight: 400; color: var(--accent); }
    body.style-established .hero h1 { font-size: clamp(40px, 6.5vw, 76px); line-height: 1.05; }
    body.style-established .section-head h2 { font-size: clamp(34px, 4.5vw, 56px); }
    body.style-established .logo { font-family: var(--display); font-weight: 500; font-style: normal; font-size: 26px; letter-spacing: -0.015em; }
    body.style-established .logo span { font-weight: 400; font-style: italic; color: var(--ink-soft); }
    body.style-established .btn { border-radius: 100px; font-family: 'Inter', system-ui, sans-serif; }
    body.style-established header .phone-link { font-family: var(--display); font-size: 17px; font-weight: 500; }
    body.style-established section.block { padding: 100px 24px; }
    @media (min-width: 768px) { body.style-established section.block { padding: 130px 24px; } }
    body.style-established section.block + section.block::before { content: ''; display: block; max-width: 1340px; margin: 0 auto; height: 1px; background: var(--line); position: relative; top: -1px; }
    body.style-established .service h3 { font-family: var(--display); font-weight: 500; font-size: 24px; letter-spacing: -0.02em; }
    body.style-established .why-item h3 { font-family: var(--display); font-weight: 500; font-size: 22px; letter-spacing: -0.02em; }
    body.style-established .step-num, body.style-established .eyebrow { font-family: 'Inter', system-ui, sans-serif; }
    body.style-established .review p { font-family: var(--display); font-style: italic; font-size: 21px; font-weight: 400; line-height: 1.45; }
    body.style-established .about-quote p { font-family: var(--display); font-style: italic; font-size: 26px; font-weight: 400; line-height: 1.35; letter-spacing: -0.015em; }
    body.style-established .about-quote { padding-left: 32px; border-left-width: 1px; border-left-color: var(--accent); }
    body.style-established .contact-info .value { font-family: var(--display); font-weight: 500; font-size: 28px; letter-spacing: -0.015em; }
    body.style-established .hero-meta-item .num { font-family: var(--display); font-weight: 500; }
  </style>
</head>
<body class="style-${templateStyle}">
  <div style="background:#1a2b4a;color:#fff;text-align:center;font:600 13px/1.45 system-ui,-apple-system,sans-serif;padding:9px 16px">Niezobowiązujący szkic strony przygotowany dla ${escapeHtml(lead.name)} — wersja demonstracyjna do oceny, nie jest to oficjalna strona firmy.</div>

  ${templateStyle === "service" && hasPhone ? `<div class="emergency-strip">
    <div class="emergency-strip-inner">
      <span class="emergency-pulse"></span>
      <span class="emergency-label">AWARIE · Działamy 24/7</span>
      <span class="emergency-divider">·</span>
      <a href="${phoneLnk}" class="emergency-phone">${escapeHtml(phone)}</a>
    </div>
  </div>` : ""}

  <div class="topbar">
    ${escapeHtml(lead.name)} — ${escapeHtml(categoryPl)} ${wCity(city)} — <a href="#kontakt">zapytaj o wycenę →</a>
  </div>

  <header>
    <div class="header-inner">
      <a href="#" class="logo">${escapeHtml(namePart1)} <span>${escapeHtml(namePart2)}</span></a>
      <nav class="main-nav">
        ${navItems.map((n) => `<a href="${n.href}">${n.label}</a>`).join("\n        ")}
      </nav>
      <div class="header-actions">
        ${hasPhone ? `<a href="${phoneLnk}" class="phone-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          ${escapeHtml(phone)}
        </a>` : ""}
        <a href="#kontakt" class="btn btn-primary">Bezpłatna wycena</a>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-grid">
      <div class="reveal">
        <div class="eyebrow">${escapeHtml(city)} · ${escapeHtml(voivodeship)}</div>
        <h1>${escapeHtml(content.heroHeadline)} <em>${escapeHtml(content.heroHeadlineEm)}</em></h1>
        <p class="hero-lead">${businessDesc ? escapeHtml(businessDesc) : escapeHtml(content.heroLead)}</p>
        <div class="hero-ctas">
          ${hasPhone ? `<a href="${phoneLnk}" class="btn btn-primary btn-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Zadzwoń teraz
          </a>
          <a href="https://wa.me/${waPhone}" class="btn btn-whatsapp btn-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345"/></svg>
            WhatsApp
          </a>` : `<a href="#kontakt" class="btn btn-primary btn-lg">Bezpłatna wycena</a>`}
        </div>
        ${showSocialProof ? `<div class="hero-social-proof">Dołącz do ${socialProofCount}+ klientów, którzy nam zaufali</div>` : ""}
        <div class="hero-meta">
          ${heroMetaItems.map((m) => `<div class="hero-meta-item">
            <div class="num">${m.num}</div>
            <div class="label">${m.label}</div>
          </div>`).join("\n          ")}
        </div>
      </div>
      ${hasPhotos ? `<div class="hero-image-wrap reveal">
        <div class="hero-image">
          <span class="hero-tag">${escapeHtml(lead.name)} · ${escapeHtml(city)}</span>
        </div>${heroCardHtml}
      </div>` : ""}
    </div>
  </section>

  <div class="trust-strip">
    <div class="trust-strip-inner">
      ${trustItems.map((t, i) => `<span>${TRUST_ICONS[i % TRUST_ICONS.length]} ${escapeHtml(t)}</span>`).join("\n      ")}
    </div>
  </div>

  <section class="block services" id="uslugi">
    <div class="block-inner">
      <div class="section-head">
        <div class="eyebrow">Zakres usług</div>
        <h2>Wszystko, czego <em>potrzebujesz.</em></h2>
        <p>Pracujemy z własną, sprawdzoną ekipą. Bez podwykonawców z łapanki, bez niespodzianek w trakcie.</p>
      </div>
      <div class="services-grid">${servicesHtml}
      </div>
    </div>
  </section>

  ${galleryHtml}

  <section class="block" id="dlaczego-my">
    <div class="block-inner">
      <div class="section-head">
        <div class="eyebrow">Jak pracujemy</div>
        <h2>Cztery zasady, którymi się <em>kierujemy.</em></h2>
        <p>Bez podwykonawców z łapanki, bez ukrytych kosztów, bez ciszy radiowej. Tak pracujemy od lat — i tak wygląda każde zlecenie.</p>
      </div>
      <div class="why-grid">
        <div class="why-item">
          <svg class="why-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <h3>Bezpośredni kontakt z właścicielem</h3>
          <p>Telefon do właściciela działa codziennie. To on prowadzi każde zlecenie osobiście, bez sekretarek i pośredników.</p>
        </div>
        <div class="why-item">
          <svg class="why-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <h3>Wycena i umowa na piśmie</h3>
          <p>Spotkanie na miejscu, wycena w 5 dni. Szczegółowa umowa z cenami i terminami — wszystko podpisane przed startem.</p>
        </div>
        <div class="why-item">
          <svg class="why-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <h3>Stała, sprawdzona ekipa</h3>
          <p>Ci sami ludzie od lat. Bez łapanki w sezonie. Każdy zna nasze standardy i odpowiada za swoją robotę.</p>
        </div>
        <div class="why-item">
          <svg class="why-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <h3>Termin to termin</h3>
          <p>Co zapisaliśmy w umowie, tego się trzymamy. Raporty z postępów na bieżąco, gwarancja na wykonaną pracę.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="block about" id="o-nas">
    <div class="block-inner">
      <div class="about-grid">
        <div class="about-text">
          <div class="eyebrow">O firmie</div>
          <h2>${escapeHtml(aboutTitle)}</h2>
          ${businessDesc ? `<p>${escapeHtml(businessDesc)}</p>` : `<p style="font-weight: 500; color: var(--ink);">${escapeHtml(lead.name)}</p>`}
          ${content.aboutP1 ? `<p>${escapeHtml(content.aboutP1)}</p>` : ""}
          ${content.aboutP2 && content.aboutP2 !== content.aboutP1 ? `<p>${escapeHtml(content.aboutP2)}</p>` : ""}${aboutQuoteHtml}
        </div>
        ${aboutImg ? `<div class="about-image"></div>` : ""}
      </div>
    </div>
  </section>

  ${reviewsHtml}

  <section class="block" id="obszar">
    <div class="block-inner">
      <div class="area-grid">
        <div class="area-text">
          <div class="eyebrow">Obszar działania</div>
          <h2 class="area-heading">Pracujemy <em>${wVoiv(voivodeship)} i okolicach.</em></h2>
          <p class="area-intro">Główny obszar działania: ${escapeHtml(city)} i okolice w promieniu 30 km. Większe zlecenia realizujemy też dalej.</p>
          <dl class="area-facts">
            <div>
              <dt>Czas dojazdu</dt>
              <dd>~30 min ${wCity(city)}, ~1 h w okolicach</dd>
            </div>
            <div>
              <dt>Wolne terminy</dt>
              <dd>Sprawdź telefonicznie — terminy aktualizujemy co tydzień</dd>
            </div>
            <div>
              <dt>Koszt dojazdu</dt>
              <dd>Wliczony w wycenę w promieniu 30 km</dd>
            </div>
          </dl>
          <div class="area-cities-line">
            <span class="area-cities-label">Często odwiedzamy</span>
            ${[city, ...nearbyAreas].map((a) => escapeHtml(a)).join(' · ')}
          </div>
          ${hasPhone ? `<p class="area-cta">Twojej miejscowości tu nie ma? <a href="${phoneLnk}">Zadzwoń</a> — powiemy w 30 sekund, czy dojedziemy.</p>` : ""}
        </div>
        ${(lead.latitude && lead.longitude)
          ? `<div class="area-map">
          <iframe src="https://maps.google.com/maps?q=${lead.latitude},${lead.longitude}&z=11&hl=pl&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa lokalizacji: ${escapeHtml(city)}"></iframe>
        </div>`
          : ""}
      </div>
    </div>
  </section>

  <section class="block" id="faq">
    <div class="block-inner">
      <div class="section-head">
        <div class="eyebrow">Najczęstsze pytania</div>
        <h2>Nim zadzwonisz — <em>na pewno to przeczytaj.</em></h2>
        <p>Najczęściej zadawane pytania od osób, które szukają dobrego specjalisty.</p>
      </div>
      <div class="faq-list">${faqHtml}
      </div>
    </div>
  </section>

  <section class="cta-banner">
    <h2>Masz pytania? <em>Porozmawiajmy.</em></h2>
    <p>Wycena jest bezpłatna i niezobowiązująca. Najczęściej odpowiadamy tego samego dnia.</p>
    <div class="cta-banner-ctas">
      ${hasPhone ? `<a href="${phoneLnk}" class="btn btn-primary btn-lg">Zadzwoń: ${escapeHtml(phone)}</a>
      <a href="https://wa.me/${waPhone}" class="btn btn-whatsapp btn-lg">Napisz na WhatsApp</a>` : `<a href="#kontakt" class="btn btn-primary btn-lg">Wypełnij formularz</a>`}
    </div>
  </section>

  <section class="block" id="kontakt">
    <div class="block-inner">
      <div class="section-head">
        <div class="eyebrow">Kontakt</div>
        <h2>Porozmawiajmy o <em>Państwa potrzebach.</em></h2>
        <p>Wypełnij formularz lub zadzwoń bezpośrednio. Każde zapytanie traktujemy poważnie.</p>
      </div>
      <div class="contact-grid">
        <div class="contact-info">
          ${hasPhone ? `<h3>Telefon</h3>
          <a href="${phoneLnk}" class="value">${escapeHtml(phone)}</a>` : ""}
          ${hasAddress ? `<h3>Adres</h3>
          <span class="value" style="display:block">${escapeHtml(address)}</span>` : ""}
          <h3>Godziny pracy</h3>
          <span class="value" style="font-size: 17px; font-family: var(--body); font-weight: 500">pn-pt 7:00–18:00 · sb 8:00–14:00</span>
          ${hasPhone ? `<div class="contact-cta">
            <a href="${phoneLnk}" class="btn btn-primary">Zadzwoń</a>
            <a href="https://wa.me/${waPhone}" class="btn btn-whatsapp">WhatsApp</a>
          </div>` : ""}
        </div>
        <!--
          Formulier opent de mailclient van de bezoeker met de ingevulde
          gegevens. Voor productie aanbevolen: vervangen door een server-side
          POST (Vercel form-handler, Resend Contact API, of een eigen
          /api/contact route). Dan ook spam-protect (honeypot of hCaptcha)
          aanzetten — een blootgesteld mailto stuurt geen spam, een open
          POST-endpoint wel.
        -->
        <form class="contact-form" onsubmit="return submitContact(this)">
          <div class="form-group">
            <label for="imie">Imię i nazwisko</label>
            <input type="text" id="imie" name="imie" placeholder="Jan Kowalski" required>
          </div>
          <div class="form-group">
            <label for="tel">Telefon</label>
            <input type="tel" id="tel" name="tel" placeholder="+48 600 000 000" required>
          </div>
          <div class="form-group">
            <label for="email">E-mail</label>
            <input type="email" id="email" name="email" placeholder="jan@example.com">
          </div>
          <div class="form-group">
            <label for="zakres">Czego dotyczy zapytanie?</label>
            <select id="zakres" name="zakres">
              ${selectHtml}
            </select>
          </div>
          <div class="form-group">
            <label for="wiadomosc">Krótki opis</label>
            <textarea id="wiadomosc" name="wiadomosc" placeholder="Opowiedz nam krótko o swoich potrzebach..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width: 100%; justify-content: center;">Wyślij zapytanie</button>
          <p class="rodo-notice">
            Wysłanie formularza oznacza zgodę na przetwarzanie podanych danych w celu odpowiedzi
            na zapytanie zgodnie z RODO. Dane nie są przekazywane osobom trzecim.
          </p>
        </form>
        <script>
          (function () {
            var recipient = ${JSON.stringify(formRecipient)};
            var firma = ${JSON.stringify(lead.name)};
            // Wersja demonstracyjna: formularz nie wysyła jeszcze wiadomości.
            void recipient; void firma;
            window.submitContact = function (form) {
              form.innerHTML = '<div style="text-align:center; padding: 48px 24px;"><div style="width:64px; height:64px; border-radius:50%; background:var(--accent-soft); color:var(--accent); display:inline-flex; align-items:center; justify-content:center; margin-bottom:24px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><h3 style="font-family:var(--display); font-size:26px; font-weight:500; margin-bottom:12px; letter-spacing:-0.025em;">To jest wersja demonstracyjna</h3><p style="color:var(--ink-soft); font-size:15px; line-height:1.55; max-width:360px; margin:0 auto;">Na gotowej stronie ten formularz będzie wysyłał zapytania prosto do firmy ' + firma + '. Tutaj służy tylko do pokazania, jak będzie wyglądać.</p></div>';
              return false;
            };
          })();
        </script>
      </div>
    </div>
  </section>

  <footer>
    <div class="footer-inner">
      <div>
        <a href="#" class="logo">${escapeHtml(namePart1)} <span>${escapeHtml(namePart2)}</span></a>
        <p>${escapeHtml(lead.name)}<br>${escapeHtml(city)} i okolice.</p>
      </div>
      <div>
        <h4>Usługi</h4>
        <ul>
          ${content.services.slice(0, 5).map((s) => `<li><a href="#uslugi">${escapeHtml(s.title)}</a></li>`).join("\n          ")}
        </ul>
      </div>
      <div>
        <h4>Firma</h4>
        <ul>
          <li><a href="#o-nas">O nas</a></li>
          ${showGallery ? `<li><a href="#realizacje">Zdjęcia</a></li>` : ""}
          <li><a href="#dlaczego-my">Jak pracujemy</a></li>
          ${hasReviews ? `<li><a href="#opinie">Opinie</a></li>` : ""}
          <li><a href="#faq">FAQ</a></li>
        </ul>
      </div>
      <div>
        <h4>Kontakt</h4>
        <ul>
          ${hasPhone ? `<li><a href="${phoneLnk}">${escapeHtml(phone)}</a></li>` : ""}
          ${hasAddress ? `<li>${escapeHtml(address)}</li>` : ""}
          <li><a href="#kontakt">Formularz kontaktowy</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <div>&copy; 2026 ${escapeHtml(lead.name)}. Wszelkie prawa zastrzeżone.</div>
      <div>Strona stworzona przez <a href="#" style="color: rgba(255,255,255,0.6);">stronadlatwojejfirmy.com.pl</a></div>
    </div>
  </footer>

  ${hasPhone ? `<div class="mobile-cta">
    <a href="${phoneLnk}" class="btn btn-primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      Zadzwoń
    </a>
    <a href="https://wa.me/${waPhone}" class="btn btn-whatsapp">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345"/></svg>
      WhatsApp
    </a>
  </div>` : `<div class="mobile-cta">
    <a href="#kontakt" class="btn btn-primary" style="flex:1; justify-content:center;">Bezpłatna wycena</a>
  </div>`}

<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('tel:')===0||h.indexOf('mailto:')===0||h.indexOf('wa.me')>-1){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault();},true);})();</script>
</body>
</html>`;
}

// ============================================================
// SERVICE TEMPLATE (plumber / electrician — phone-first design)
// Completely different page architecture from the editorial template.
// ============================================================
// ============================================================
//  FOOD-TEMPLATE — restaurant / bistro / café / bakkerij
//  Menukaart, openingstijden, reserveren. Copy komt van de Builder-agent.
// ============================================================
function generateFoodSiteHtml(lead: Lead): string {
  const sc = parseSiteContent(lead);
  const fullName = escapeHtml(lead.name);
  const brand = brandLine(lead, sc);
  const city = displayCity(lead);
  const hasPhone = !!(lead.phone_national || lead.phone_intl);
  const phone = formatPhone(lead.phone_national);
  const phoneLnk = phoneLink(lead.phone_intl || lead.phone_national);
  const waPhone = phoneDigits(lead.phone_intl || lead.phone_national);
  const address = lead.address || "";
  const rating = lead.rating ?? 0;
  const ratingCount = lead.rating_count ?? 0;
  const hasRating = ratingCount > 0 && rating > 0;
  const cuisine = escapeHtml(sc?.cuisine || categoryLabel(lead, sc));
  const hours = sc?.hours ? escapeHtml(sc.hours) : "";
  const about = sc?.about || lead.description || `${lead.name} — miejsce, do którego wraca się z przyjemnością.`;
  const cta = escapeHtml(sc?.cta_label || (hasPhone ? "Zarezerwuj stolik" : "Skontaktuj się"));
  const heroTitle = escapeHtml(sc?.hero_headline || lead.name);
  const heroSub = escapeHtml(sc?.hero_lead || `${sc?.cuisine || "Dobre jedzenie"} ${wCity(city)}.`);

  const photoUrls = proxyPhotos(applyPhotoCuration(parseJson<string[]>(lead.photo_urls, []), lead.ai_polish));
  const heroImg = photoUrls[0] || "";
  const gallery = photoUrls.slice(1, 7);

  const reviews = parseJson<LeadReview[]>(lead.reviews_json, [])
    .filter((r) => r.rating >= 4 && r.text && r.text.trim().length >= 20)
    .map((r) => (r.original_language === "pl" && r.original_text ? { ...r, text: r.original_text } : r))
    .filter((r) => !(r.original_language && r.original_language !== "pl") && !(r.language && r.language !== "pl" && !r.original_language))
    .slice(0, 3);

  const menu = sc?.menu ?? [];
  const menuHtml = menu.length
    ? menu.slice(0, 6).map((sec) => `
        <div class="menu-sec">
          <h3>${escapeHtml(sec.section)}</h3>
          <ul>
            ${sec.items.slice(0, 12).map((it) => `<li>
              <div class="mi-top"><span class="mi-name">${escapeHtml(it.name)}</span>${it.price ? `<span class="mi-dots"></span><span class="mi-price">${escapeHtml(it.price)}</span>` : ""}</div>
              ${it.description ? `<div class="mi-desc">${escapeHtml(it.description)}</div>` : ""}
            </li>`).join("")}
          </ul>
        </div>`).join("")
    : `<p class="menu-empty">Zapraszamy do kontaktu — chętnie przedstawimy aktualne menu i polecenia szefa kuchni.</p>`;

  const galleryHtml = gallery.length
    ? `<section class="gallery" id="galeria"><div class="wrap"><h2>Galeria</h2><div class="g-grid">${gallery.map((u) => `<img src="${escapeHtml(u)}" alt="${fullName}" loading="lazy">`).join("")}</div></div></section>`
    : "";

  const reviewsHtml = reviews.length
    ? `<section class="reviews"><div class="wrap"><h2>Opinie gości${hasRating ? ` · ${rating.toFixed(1)} ★ (${ratingCount})` : ""}</h2><div class="r-grid">${reviews.map((r) => `<figure><div class="stars">${"★".repeat(Math.round(r.rating))}</div><blockquote>${escapeHtml(r.text.slice(0, 240))}</blockquote><figcaption>— ${escapeHtml(r.author)}</figcaption></figure>`).join("")}</div></div></section>`
    : "";

  const ctaHref = hasPhone ? phoneLnk : "#kontakt";

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullName} — ${cuisine} ${escapeHtml(city)}</title>
  <meta name="description" content="${fullName} — ${cuisine} ${wCity(city)}. Menu, opinie i rezerwacja.">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--cream:#faf7f0;--paper:#fffdf9;--ink:#211e19;--soft:#6f685b;--line:#ece3d4;--wine:#8a3b32;--wineh:#a14a3f;--gold:#b89150}
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:var(--cream);line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    .wrap{max-width:1080px;margin:0 auto;padding:0 28px}
    h1,h2,h3{font-family:Fraunces,Georgia,serif;font-weight:600;line-height:1.08;letter-spacing:-.01em}
    a{color:inherit;cursor:pointer}
    .btn,.btn-ghost{cursor:pointer}
    :focus-visible{outline:2px solid var(--accent,var(--wine,currentColor));outline-offset:3px}
    .topbar{position:sticky;top:0;z-index:30;background:rgba(250,247,240,.82);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line)}
    .nav{display:flex;align-items:center;justify-content:space-between;height:68px}
    .brand{font-family:Fraunces,serif;font-size:21px;font-weight:600;letter-spacing:.005em}
    .nav-links{display:flex;gap:30px;font-size:14px}.nav-links a{text-decoration:none;color:var(--soft);transition:color .2s}.nav-links a:hover{color:var(--ink)}
    .btn{display:inline-block;background:var(--wine);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:.01em;box-shadow:0 1px 2px rgba(40,20,15,.12);transition:background .2s,transform .2s,box-shadow .2s}.btn:hover{background:var(--wineh);transform:translateY(-1px);box-shadow:0 8px 20px rgba(138,59,50,.22)}
    @media(max-width:720px){.nav-links{display:none}}
    .hero{position:relative;min-height:82vh;display:flex;align-items:flex-end;color:#fff;${heroImg ? `background:linear-gradient(180deg,rgba(20,14,11,.1) 0%,rgba(20,14,11,.36) 45%,rgba(18,12,9,.82) 100%),url('${escapeHtml(heroImg)}') center/cover` : "background:linear-gradient(140deg,#2c2018,#43302a)"}}
    .hero .wrap{padding-top:96px;padding-bottom:66px}
    .eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:12px;font-weight:600;opacity:.92;margin-bottom:18px}
    .hero h1{font-size:clamp(42px,7.2vw,80px);max-width:15ch;text-shadow:0 2px 30px rgba(0,0,0,.22)}
    .hero p{font-size:clamp(17px,2.4vw,22px);max-width:46ch;margin-top:18px;opacity:.94}
    .hero-cta{margin-top:30px;display:flex;gap:14px;flex-wrap:wrap}
    .btn-ghost{display:inline-block;border:1px solid rgba(255,255,255,.6);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:14px;backdrop-filter:blur(4px);transition:background .2s}.btn-ghost:hover{background:rgba(255,255,255,.14)}
    section{padding:92px 0}
    .sec-head{text-align:center;margin-bottom:46px}
    .sec-eyebrow{text-transform:uppercase;letter-spacing:.24em;font-size:12px;font-weight:600;color:var(--wine);margin-bottom:12px;display:block}
    .sec-head h2{font-size:clamp(30px,4.2vw,46px)}
    .gallery h2,.reviews h2{font-size:clamp(30px,4.2vw,46px);text-align:center;margin-bottom:46px}
    .menu-cols{columns:2;column-gap:60px}@media(max-width:720px){.menu-cols{columns:1}}
    .menu-sec{break-inside:avoid;margin-bottom:40px}
    .menu-sec h3{font-size:14px;text-transform:uppercase;letter-spacing:.16em;font-family:Inter,sans-serif;font-weight:600;color:var(--wine);padding-bottom:12px;margin-bottom:20px;border-bottom:1px solid var(--line)}
    .menu-sec ul{list-style:none}
    .menu-sec li{margin-bottom:21px}
    .mi-top{display:flex;align-items:baseline;gap:8px}
    .mi-name{font-weight:600;font-size:16px}.mi-dots{flex:1;border-bottom:1px dotted #cbbfab;margin-bottom:4px}.mi-price{font-weight:600;color:var(--wine);white-space:nowrap;font-variant-numeric:tabular-nums}
    .mi-desc{font-size:14px;color:var(--soft);margin-top:5px;max-width:46ch}
    .menu-empty{text-align:center;color:var(--soft);max-width:42ch;margin:0 auto}
    .about{background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .about .wrap{max-width:700px;text-align:center}.about p{font-size:clamp(18px,2.2vw,21px);color:var(--soft);line-height:1.75}
    .g-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}@media(max-width:720px){.g-grid{grid-template-columns:repeat(2,1fr)}}
    .g-grid img{width:100%;height:250px;object-fit:cover;border-radius:12px;display:block;transition:transform .4s ease}.g-grid img:hover{transform:scale(1.02)}
    .reviews{background:var(--paper);border-top:1px solid var(--line)}
    .r-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}@media(max-width:720px){.r-grid{grid-template-columns:1fr}}
    .reviews figure{background:var(--cream);border:1px solid var(--line);border-radius:16px;padding:26px}
    .stars{color:var(--gold);margin-bottom:10px;letter-spacing:2px}.reviews blockquote{font-size:15px;line-height:1.6}.reviews figcaption{margin-top:14px;font-size:13px;color:var(--soft);font-weight:500}
    .info{background:#241a14;color:#f3ece2}
    .info .grid{display:grid;grid-template-columns:1fr 1fr;gap:48px}@media(max-width:720px){.info .grid{grid-template-columns:1fr}}
    .info h2{color:#fff;font-size:clamp(26px,3vw,34px);margin-bottom:22px}
    .info .row{display:flex;gap:14px;margin-bottom:16px;font-size:15px}.info .row b{min-width:96px;color:var(--gold);font-weight:600}
    .info a{color:#f3ece2}
    footer{background:#1b130e;color:#9a8d7c;text-align:center;padding:30px;font-size:13px}
  </style>
</head>
<body>
  <div style="background:#1a2b4a;color:#fff;text-align:center;font:600 13px/1.45 system-ui,-apple-system,sans-serif;padding:9px 16px">Niezobowiązujący szkic strony przygotowany dla ${fullName} — wersja demonstracyjna do oceny, nie jest to oficjalna strona firmy.</div>
  <div class="topbar"><div class="wrap nav">
    <span class="brand">${escapeHtml(brand || lead.name)}</span>
    <nav class="nav-links"><a href="#menu">Menu</a><a href="#galeria">Galeria</a><a href="#kontakt">Kontakt</a></nav>
    <a class="btn" href="${ctaHref}">${cta}</a>
  </div></div>

  <header class="hero"><div class="wrap">
    <div class="eyebrow">${cuisine} · ${escapeHtml(city)}</div>
    <h1>${heroTitle}</h1>
    <p>${heroSub}</p>
    <div class="hero-cta">
      <a class="btn" href="${ctaHref}">${cta}</a>
      <a class="btn-ghost" href="#menu">Zobacz menu</a>
    </div>
  </div></header>

  <section class="menu" id="menu"><div class="wrap">
    <div class="sec-head"><span class="sec-eyebrow">${escapeHtml(sc?.cuisine || "Nasza kuchnia")}</span><h2>Menu</h2></div>
    <div class="menu-cols">${menuHtml}</div>
  </div></section>

  <section class="about"><div class="wrap">
    <div class="sec-head"><span class="sec-eyebrow">Poznaj nas</span><h2>O nas</h2></div>
    <p>${escapeHtml(about)}</p>
  </div></section>

  ${galleryHtml}
  ${reviewsHtml}

  <section class="info" id="kontakt"><div class="wrap"><div class="grid">
    <div>
      <h2>Odwiedź nas</h2>
      ${address ? `<div class="row"><b>Adres</b><span>${escapeHtml(address)}</span></div>` : ""}
      ${hours ? `<div class="row"><b>Godziny</b><span>${hours}</span></div>` : `<div class="row"><b>Godziny</b><span>Zadzwoń, aby potwierdzić aktualne godziny otwarcia.</span></div>`}
      ${hasPhone ? `<div class="row"><b>Telefon</b><a href="${phoneLnk}">${escapeHtml(phone)}</a></div>` : ""}
    </div>
    <div>
      <h2>${cta}</h2>
      <p style="color:#cdbfae;margin-bottom:18px">Zarezerwuj stolik telefonicznie lub przez WhatsApp — odpowiadamy szybko.</p>
      <div class="hero-cta">
        ${hasPhone ? `<a class="btn" href="${phoneLnk}">Zadzwoń: ${escapeHtml(phone)}</a>` : ""}
        ${waPhone ? `<a class="btn-ghost" href="https://wa.me/${waPhone}">WhatsApp</a>` : ""}
      </div>
    </div>
  </div></div></section>

  <footer>© ${new Date().getFullYear()} ${fullName}. Szkic strony — wersja demonstracyjna.</footer>
<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('tel:')===0||h.indexOf('mailto:')===0||h.indexOf('wa.me')>-1){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault();},true);})();</script>
</body>
</html>`;
}

// Eén flexibele renderer voor afspraak/verzorging (salon), zorg (medical) en
// lokale winkel (retail). Zelfde structuur, archetype bepaalt accent, labels en CTA.
type ApptArchetype = "salon" | "medical" | "retail";
const APPT_CONFIG: Record<ApptArchetype, {
  accent: string; accentH: string; ink: string; bg: string; soft: string; line: string; dark: string;
  listTitle: string; cta: string; ghost: string; reviewWord: string; bookingNote: string; metaTail: string;
}> = {
  salon: { accent: "#a8576b", accentH: "#8f4659", ink: "#241b1e", bg: "#faf5f3", soft: "#7a6b6f", line: "#ecdfe0", dark: "#241619",
    listTitle: "Cennik usług", cta: "Umów wizytę", ghost: "Zobacz cennik", reviewWord: "klientów",
    bookingNote: "Umów się telefonicznie lub przez WhatsApp — potwierdzamy termin od ręki.", metaTail: "Cennik, opinie i rezerwacja wizyty." },
  medical: { accent: "#2c7a7b", accentH: "#236363", ink: "#1b2a2a", bg: "#f4f8f8", soft: "#5e7373", line: "#d9e8e8", dark: "#142525",
    listTitle: "Zakres usług", cta: "Umów wizytę", ghost: "Zobacz usługi", reviewWord: "pacjentów",
    bookingNote: "Umów wizytę telefonicznie — pomożemy dobrać dogodny termin.", metaTail: "Zakres usług, opinie i rejestracja." },
  retail: { accent: "#3f6f52", accentH: "#335c43", ink: "#1f2620", bg: "#f6f7f4", soft: "#65706a", line: "#e2e7df", dark: "#16201a",
    listTitle: "Oferta", cta: "Zadzwoń", ghost: "Zobacz ofertę", reviewWord: "klientów",
    bookingNote: "Zadzwoń lub odwiedź nas — chętnie doradzimy i sprawdzimy dostępność.", metaTail: "Oferta, opinie i informacje o sklepie." },
};

function generateAppointmentSiteHtml(lead: Lead, archetype: ApptArchetype): string {
  const cfg = APPT_CONFIG[archetype];
  const sc = parseSiteContent(lead);
  const fullName = escapeHtml(lead.name);
  const brand = brandLine(lead, sc);
  const city = displayCity(lead);
  const label = escapeHtml(categoryLabel(lead, sc));
  const hasPhone = !!(lead.phone_national || lead.phone_intl);
  const phone = formatPhone(lead.phone_national);
  const phoneLnk = phoneLink(lead.phone_intl || lead.phone_national);
  const waPhone = phoneDigits(lead.phone_intl || lead.phone_national);
  const address = lead.address || "";
  const rating = lead.rating ?? 0;
  const ratingCount = lead.rating_count ?? 0;
  const hasRating = ratingCount > 0 && rating > 0;
  const hours = sc?.hours ? escapeHtml(sc.hours) : "";
  const about = sc?.about || lead.description || `${lead.name} — ${wCity(city)}.`;
  const cta = escapeHtml(sc?.cta_label || cfg.cta);
  const heroTitle = escapeHtml(sc?.hero_headline || lead.name);
  const heroSub = escapeHtml(sc?.hero_lead || `${label}${city ? " " + wCity(city) : ""}.`);
  const ctaHref = hasPhone ? phoneLnk : "#kontakt";

  const photoUrls = proxyPhotos(applyPhotoCuration(parseJson<string[]>(lead.photo_urls, []), lead.ai_polish));
  const heroImg = photoUrls[0] || "";
  const gallery = photoUrls.slice(1, 7);

  const reviews = parseJson<LeadReview[]>(lead.reviews_json, [])
    .filter((r) => r.rating >= 4 && r.text && r.text.trim().length >= 20)
    .map((r) => (r.original_language === "pl" && r.original_text ? { ...r, text: r.original_text } : r))
    .filter((r) => !(r.original_language && r.original_language !== "pl") && !(r.language && r.language !== "pl" && !r.original_language))
    .slice(0, 3);

  // Prijslijst: agent-pricelist → anders services-titels → anders zachte placeholder.
  const pricelist = sc?.pricelist?.length ? sc.pricelist.slice(0, 14) : null;
  const svc = sc?.services?.length ? sc.services.slice(0, 8) : [];
  const listHtml = pricelist
    ? `<ul class="plist">${pricelist.map((p) => `<li>
        <div class="pl-top"><span class="pl-name">${escapeHtml(p.name)}</span>${p.price ? `<span class="pl-dots"></span><span class="pl-price">${escapeHtml(p.price)}</span>` : ""}</div>
        ${p.note ? `<div class="pl-note">${escapeHtml(p.note)}</div>` : ""}</li>`).join("")}</ul>`
    : svc.length
      ? `<ul class="plist">${svc.map((s) => `<li><div class="pl-top"><span class="pl-name">${escapeHtml(s.title)}</span></div>${s.description ? `<div class="pl-note">${escapeHtml(s.description)}</div>` : ""}</li>`).join("")}</ul>`
      : `<p class="pl-empty">Zadzwoń lub napisz — chętnie przedstawimy pełną ofertę i aktualne ceny.</p>`;

  const galleryHtml = gallery.length
    ? `<section class="gallery" id="galeria"><div class="wrap"><h2>Galeria</h2><div class="g-grid">${gallery.map((u) => `<img src="${escapeHtml(u)}" alt="${fullName}" loading="lazy">`).join("")}</div></div></section>`
    : "";

  const reviewsHtml = reviews.length
    ? `<section class="reviews"><div class="wrap"><h2>Opinie ${cfg.reviewWord}${hasRating ? ` · ${rating.toFixed(1)} ★ (${ratingCount})` : ""}</h2><div class="r-grid">${reviews.map((r) => `<figure><div class="stars">${"★".repeat(Math.round(r.rating))}</div><blockquote>${escapeHtml(r.text.slice(0, 240))}</blockquote><figcaption>— ${escapeHtml(r.author)}</figcaption></figure>`).join("")}</div></div></section>`
    : "";

  const navLabel = archetype === "retail" ? "Oferta" : "Cennik";

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta name="robots" content="noindex, nofollow"><meta name="googlebot" content="noindex, nofollow">
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullName} — ${label} ${escapeHtml(city)}</title>
  <meta name="description" content="${fullName} — ${label} ${wCity(city)}. ${cfg.metaTail}">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--accent:${cfg.accent};--accenth:${cfg.accentH};--ink:${cfg.ink};--bg:${cfg.bg};--soft:${cfg.soft};--line:${cfg.line};--dark:${cfg.dark}}
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    .wrap{max-width:1080px;margin:0 auto;padding:0 28px}
    h1,h2,h3{font-family:Fraunces,Georgia,serif;font-weight:600;line-height:1.08;letter-spacing:-.01em}
    a{color:inherit;cursor:pointer}
    .btn,.btn-ghost{cursor:pointer}
    :focus-visible{outline:2px solid var(--accent,var(--wine,currentColor));outline-offset:3px}
    .topbar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.82);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line)}
    .nav{display:flex;align-items:center;justify-content:space-between;height:68px}
    .brand{font-family:Fraunces,serif;font-size:21px;font-weight:600}
    .nav-links{display:flex;gap:30px;font-size:14px}.nav-links a{text-decoration:none;color:var(--soft);transition:color .2s}.nav-links a:hover{color:var(--ink)}
    .btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:.01em;box-shadow:0 1px 2px rgba(20,20,20,.12);transition:background .2s,transform .2s,box-shadow .2s}.btn:hover{background:var(--accenth);transform:translateY(-1px);box-shadow:0 8px 20px rgba(20,20,20,.16)}
    @media(max-width:720px){.nav-links{display:none}}
    .hero{position:relative;min-height:78vh;display:flex;align-items:flex-end;color:#fff;${heroImg ? `background:linear-gradient(180deg,rgba(15,11,11,.1) 0%,rgba(15,11,11,.34) 45%,rgba(13,9,9,.8) 100%),url('${escapeHtml(heroImg)}') center/cover` : "background:linear-gradient(140deg,var(--accent),var(--dark))"}}
    .hero .wrap{padding-top:92px;padding-bottom:64px}
    .eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:12px;font-weight:600;opacity:.92;margin-bottom:18px}
    .hero h1{font-size:clamp(40px,6.8vw,74px);max-width:15ch;text-shadow:0 2px 30px rgba(0,0,0,.22)}
    .hero p{font-size:clamp(16px,2.3vw,21px);max-width:46ch;margin-top:16px;opacity:.94}
    .hero-cta{margin-top:28px;display:flex;gap:14px;flex-wrap:wrap}
    .btn-ghost{display:inline-block;border:1px solid rgba(255,255,255,.6);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:14px;backdrop-filter:blur(4px);transition:background .2s}.btn-ghost:hover{background:rgba(255,255,255,.14)}
    section{padding:88px 0}
    .sec-head{text-align:center;margin-bottom:44px}
    .sec-eyebrow{text-transform:uppercase;letter-spacing:.24em;font-size:12px;font-weight:600;color:var(--accent);margin-bottom:12px;display:block}
    .sec-head h2,h2.sec{font-size:clamp(28px,4.2vw,44px);margin-bottom:0;text-align:center}
    .gallery h2,.reviews h2{font-size:clamp(28px,4.2vw,44px);text-align:center;margin-bottom:44px}
    .plist{list-style:none;max-width:660px;margin:0 auto}
    .plist li{padding:18px 0;border-bottom:1px solid var(--line)}
    .pl-top{display:flex;align-items:baseline;gap:8px}
    .pl-name{font-weight:600;font-size:16px}.pl-dots{flex:1;border-bottom:1px dotted var(--line);margin-bottom:4px}.pl-price{font-weight:600;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
    .pl-note{font-size:14px;color:var(--soft);margin-top:5px}
    .pl-empty{text-align:center;color:var(--soft);max-width:42ch;margin:0 auto}
    .about{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .about .wrap{max-width:700px;text-align:center}.about p{font-size:clamp(18px,2.2vw,21px);color:var(--soft);line-height:1.75}
    .g-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}@media(max-width:720px){.g-grid{grid-template-columns:repeat(2,1fr)}}
    .g-grid img{width:100%;height:240px;object-fit:cover;border-radius:12px;display:block;transition:transform .4s ease}.g-grid img:hover{transform:scale(1.02)}
    .reviews{background:#fff;border-top:1px solid var(--line)}
    .r-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}@media(max-width:720px){.r-grid{grid-template-columns:1fr}}
    .reviews figure{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:26px}
    .stars{color:#c79a3a;margin-bottom:10px;letter-spacing:2px}.reviews blockquote{font-size:15px;line-height:1.6}.reviews figcaption{margin-top:14px;font-size:13px;color:var(--soft);font-weight:500}
    .info{background:var(--dark);color:#f3ece6}
    .info .grid{display:grid;grid-template-columns:1fr 1fr;gap:48px}@media(max-width:720px){.info .grid{grid-template-columns:1fr}}
    .info h2{color:#fff;font-size:clamp(26px,3vw,32px);margin-bottom:22px}
    .info .row{display:flex;gap:14px;margin-bottom:16px;font-size:15px}.info .row b{min-width:96px;color:rgba(255,255,255,.6);font-weight:600}
    .info a{color:#f3ece6}
    footer{background:#13100e;color:#9a8d7c;text-align:center;padding:30px;font-size:13px}
  </style>
</head>
<body>
  <div style="background:#1a2b4a;color:#fff;text-align:center;font:600 13px/1.45 system-ui,-apple-system,sans-serif;padding:9px 16px">Niezobowiązujący szkic strony przygotowany dla ${fullName} — wersja demonstracyjna do oceny, nie jest to oficjalna strona firmy.</div>
  <div class="topbar"><div class="wrap nav">
    <span class="brand">${escapeHtml(brand || lead.name)}</span>
    <nav class="nav-links"><a href="#oferta">${navLabel}</a><a href="#galeria">Galeria</a><a href="#kontakt">Kontakt</a></nav>
    <a class="btn" href="${ctaHref}">${cta}</a>
  </div></div>

  <header class="hero"><div class="wrap">
    <div class="eyebrow">${label} · ${escapeHtml(city)}</div>
    <h1>${heroTitle}</h1>
    <p>${heroSub}</p>
    <div class="hero-cta">
      <a class="btn" href="${ctaHref}">${cta}</a>
      <a class="btn-ghost" href="#oferta">${escapeHtml(cfg.ghost)}</a>
    </div>
  </div></header>

  <section id="oferta"><div class="wrap">
    <div class="sec-head"><span class="sec-eyebrow">${label}</span><h2 class="sec">${escapeHtml(cfg.listTitle)}</h2></div>
    ${listHtml}
  </div></section>

  <section class="about"><div class="wrap">
    <div class="sec-head"><span class="sec-eyebrow">Poznaj nas</span><h2 class="sec">O nas</h2></div>
    <p>${escapeHtml(about)}</p>
  </div></section>

  ${galleryHtml}
  ${reviewsHtml}

  <section class="info" id="kontakt"><div class="wrap"><div class="grid">
    <div>
      <h2>Kontakt</h2>
      ${address ? `<div class="row"><b>Adres</b><span>${escapeHtml(address)}</span></div>` : ""}
      ${hours ? `<div class="row"><b>Godziny</b><span>${hours}</span></div>` : `<div class="row"><b>Godziny</b><span>Zadzwoń, aby potwierdzić aktualne godziny.</span></div>`}
      ${hasPhone ? `<div class="row"><b>Telefon</b><a href="${phoneLnk}">${escapeHtml(phone)}</a></div>` : ""}
    </div>
    <div>
      <h2>${cta}</h2>
      <p style="color:rgba(255,255,255,.7);margin-bottom:18px">${escapeHtml(cfg.bookingNote)}</p>
      <div class="hero-cta">
        ${hasPhone ? `<a class="btn" href="${phoneLnk}">Zadzwoń: ${escapeHtml(phone)}</a>` : ""}
        ${waPhone ? `<a class="btn-ghost" href="https://wa.me/${waPhone}">WhatsApp</a>` : ""}
      </div>
    </div>
  </div></div></section>

  <footer>© ${new Date().getFullYear()} ${fullName}. Szkic strony — wersja demonstracyjna.</footer>
<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('tel:')===0||h.indexOf('mailto:')===0||h.indexOf('wa.me')>-1){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault();},true);})();</script>
</body>
</html>`;
}

function generateServiceSiteHtml(lead: Lead): string {
  const sc = parseSiteContent(lead);
  const content = mergeSiteContent(getContent(lead), sc);
  const { main: namePart1, sub: namePart2 } = displayName(lead, sc);
  const city = displayCity(lead);
  const voivodeship = lead.voivodeship || city;
  const hasPhone = !!(lead.phone_national || lead.phone_intl);
  const hasAddress = !!lead.address;
  const phone = formatPhone(lead.phone_national);
  const phoneLnk = phoneLink(lead.phone_intl || lead.phone_national);
  const waPhone = phoneDigits(lead.phone_intl || lead.phone_national);
  const address = lead.address || "";
  const rating = lead.rating ?? 0;
  const ratingCount = lead.rating_count ?? 0;
  const categoryPl = categoryLabel(lead, sc);

  const reviews: LeadReview[] = parseJson<LeadReview[]>(lead.reviews_json, [])
    .filter((r) => r.rating >= 4 && r.text && r.text.trim().length >= 20)
    .map((r) => (r.original_language === "pl" && r.original_text ? { ...r, text: r.original_text } : r))
    .filter((r) => {
      if (r.original_language && r.original_language !== "pl") return false;
      if (r.language && r.language !== "pl" && !r.original_language) return false;
      return true;
    });

  const photoUrls: string[] = proxyPhotos(applyPhotoCuration(parseJson(lead.photo_urls, []), lead.ai_polish));
  const showGallery = photoUrls.length >= 3;
  const heroImg = photoUrls[0] || "";

  const hasReviews = reviews.length > 0;
  const hasRating = ratingCount > 0 && rating > 0;
  const strongRating = hasRating && rating >= 4.0;
  const nearbyAreas = getNearbyAreas(city, voivodeship);

  // Zelfde formulier-aanpak als in het editorial-template: bij submit
  // openen we de mailclient van de bezoeker. Recipient = de aannemer.
  const formRecipient = (lead.contact_email || "").trim();

  // --- Detect project-installer vs emergency-service ---
  // Installers: solar, heat pumps, smart home, metering, ventilation — planned project work
  // Emergency: pure plumbers without installer keywords
  const nameLower = (lead.name || "").toLowerCase();
  const isSolar = /fotowolt|panel sol|panele\b|solar|\bpv\b/.test(nameLower);
  const isInstaller = isSolar || /pompy? ciepła|smart home|inteligentn|automatyk|wodomierz|ciepłomierz|wentylac|rekuperac|klimat/.test(nameLower);
  const isEmergency = lead.category_query === "plumber" && !isInstaller;
  const hasHeroImage = isInstaller && !!heroImg;

  const heroTagline = isSolar
    ? "Fotowoltaika pod klucz. <em>Pomagamy z dotacją.</em>"
    : isInstaller
    ? "Sprawna instalacja. <em>W terminie, w cenie z umowy.</em>"
    : isEmergency
    ? "Awaria? Naprawiamy <em>w ciągu 2 godzin.</em>"
    : "Sprawna instalacja. <em>Bez bałaganu, w terminie.</em>";

  const heroSubtitle = isSolar
    ? "Instalator fotowoltaiki i pomp ciepła · pomoc z formalnościami i dotacjami"
    : isInstaller
    ? "Wszystko z jednej ręki — projekt, montaż, odbiory, dokumentacja"
    : isEmergency
    ? "Hydraulik z licencją · dojazd na terenie Krakowa i okolic"
    : "Elektryk z uprawnieniami SEP · realizacje w domach i firmach";

  // --- Status items: tuned per trade type ---
  const statusItems: { icon: string; label: string; value: string }[] = [];
  if (isInstaller) {
    statusItems.push({ icon: "calendar", label: "Wolne terminy", value: "Od ~2 tygodni" });
    statusItems.push({ icon: "check", label: isSolar ? "Dotacja" : "Wycena", value: isSolar ? "Pomagamy z formalnościami" : "Bezpłatna i niezobowiązująca" });
    statusItems.push({ icon: "pin", label: "Obszar", value: `${city} + 30 km` });
    if (strongRating) statusItems.push({ icon: "star", label: "Google", value: `${rating.toFixed(1)} ★ (${ratingCount})` });
  } else if (isEmergency) {
    statusItems.push({ icon: "clock", label: "Czas dojazdu", value: "~2h w Krakowie" });
    statusItems.push({ icon: "pin", label: "Obszar", value: `${city} + 30 km` });
    if (strongRating) statusItems.push({ icon: "star", label: "Google", value: `${rating.toFixed(1)} ★ (${ratingCount})` });
    statusItems.push({ icon: "check", label: "Licencja", value: "OC + gaz" });
  } else {
    statusItems.push({ icon: "calendar", label: "Wolne terminy", value: "Od przyszłego tygodnia" });
    statusItems.push({ icon: "pin", label: "Obszar", value: `${city} + 30 km` });
    if (strongRating) statusItems.push({ icon: "star", label: "Google", value: `${rating.toFixed(1)} ★ (${ratingCount})` });
    statusItems.push({ icon: "check", label: "Uprawnienia", value: "SEP do 1 kV" });
  }

  // --- FAQ early: 3 questions as cards (not accordion) ---
  const faqEarlyHtml = content.faqItems.slice(0, 3).map((f) => `
        <div class="svc-faq-card">
          <h3>${escapeHtml(f.q)}</h3>
          <p>${escapeHtml(f.a)}</p>
        </div>`).join("");

  // --- Services as compact list (not 3-col grid) ---
  const servicesListHtml = content.services.map((s) => `
        <div class="svc-list-item">
          <div class="svc-list-name">${escapeHtml(s.title)}</div>
          <div class="svc-list-desc">${escapeHtml(s.description)}</div>
        </div>`).join("");

  // --- Reviews compact ---
  const reviewsHtml = hasReviews ? `
  <section class="svc-block" id="opinie" style="background: #FCFCFD;">
    <div class="svc-container">
      <div class="svc-block-head">
        <div class="eyebrow">Opinie z Google</div>
        <h2>Co mówią klienci, którzy <em>nas wezwali.</em></h2>
      </div>
      <div class="svc-reviews">
        ${reviews.slice(0, 4).map((rev) => {
          const revStars = "★".repeat(Math.round(rev.rating));
          const revText = rev.text ? smartTruncate(rev.text, 180) : "Polecam!";
          return `<div class="svc-review">
          <div class="svc-review-stars">${revStars}</div>
          <p>"${escapeHtml(revText)}"</p>
          <div class="svc-review-author">${escapeHtml(rev.author)}<span>${escapeHtml(rev.time || "")}</span></div>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>
  </section>` : "";

  const selectHtml = content.selectOptions.map((o) => `<option>${escapeHtml(o)}</option>`).join("\n              ");

  const trustItems: string[] = [];
  if (strongRating) trustItems.push(`${rating.toFixed(1)} ★ (${ratingCount} opinii)`);
  if (hasPhone) trustItems.push("Bezpośredni telefon");
  trustItems.push(...content.trustItems.slice(0, 4 - trustItems.length));

  const STATUS_ICONS: Record<string, string> = {
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  };

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(lead.name)} — ${escapeHtml(categoryPl)} ${escapeHtml(city)}${hasPhone ? ` · tel. ${escapeHtml(phone)}` : ""}</title>
  <meta name="description" content="${escapeHtml(lead.name)} — ${escapeHtml(categoryPl)} ${wCity(city)}.${hasPhone ? ` Zadzwoń: ${escapeHtml(phone)}.` : ""} ${isEmergency ? "Awarie 24/7, dojazd ~2h." : "Bezpłatna wycena."}">
  ${buildSeoHead(lead, {
    title: `${lead.name} — ${categoryPl} ${city}`,
    description: `${lead.name} — ${categoryPl} ${wCity(city)}.${hasPhone ? ` Zadzwoń: ${phone}.` : ""} ${isEmergency ? "Awarie 24/7, dojazd ~2h." : "Bezpłatna wycena."}`,
    city,
    accent: isEmergency ? "#0F3D8C" : "#1E3A8A",
  })}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F7F8FA;
      --bg-alt: #ECEEF3;
      --bg-dark: #0B2545;
      --ink: #0F172A;
      --ink-soft: #475569;
      --ink-faint: #94A3B8;
      --line: #D8DDE5;
      --line-soft: #E5E9EF;
      --accent: ${isEmergency ? "#0F3D8C" : "#1E3A8A"};
      --accent-hover: ${isEmergency ? "#1248A6" : "#2949A8"};
      --accent-soft: #DCE5F2;
      --whatsapp: #25D366;
      --whatsapp-hover: #1FA855;
      --urgent: #B41E1E;
      --display: 'Space Grotesk', system-ui, sans-serif;
      --body: 'Inter', system-ui, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: var(--body); background: var(--bg); color: var(--ink); line-height: 1.55; font-size: 16px; letter-spacing: -0.011em; -webkit-font-smoothing: antialiased; padding-bottom: 80px; }
    @media (min-width: 768px) { body { padding-bottom: 0; font-size: 16.5px; } }
    .svc-container { max-width: 1240px; margin: 0 auto; padding: 0 24px; }
    @media (min-width: 768px) { .svc-container { padding: 0 32px; } }
    h1, h2, h3, h4 { font-family: var(--display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.02; }
    h1 em, h2 em, h3 em { font-style: normal; color: var(--accent); font-weight: 500; }
    .eyebrow { font-family: var(--body); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin-bottom: 14px; display: inline-flex; align-items: center; gap: 8px; }
    .eyebrow::before { content: ''; width: 24px; height: 1px; background: var(--accent); }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 6px; font-family: var(--body); font-size: 14px; font-weight: 700; text-decoration: none; transition: all 0.15s ease; border: none; cursor: pointer; white-space: nowrap; letter-spacing: -0.005em; }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .btn-whatsapp { background: var(--whatsapp); color: white; }
    .btn-whatsapp:hover { background: var(--whatsapp-hover); transform: translateY(-1px); }
    .btn-ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .btn-ghost:hover { background: var(--ink); color: white; border-color: var(--ink); }
    .btn-lg { padding: 16px 28px; font-size: 15px; }

    /* === Pulse dot (used in small 24/7 badge) === */
    .svc-pulse { width: 7px; height: 7px; border-radius: 50%; background: #16A34A; flex-shrink: 0; box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); animation: svc-pulse 2.2s infinite; }
    @keyframes svc-pulse { 0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); } 70% { box-shadow: 0 0 0 8px rgba(22, 163, 74, 0); } 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); } }

    /* === Header === */
    header.svc-header { position: sticky; top: 0; z-index: 50; background: rgba(247, 248, 250, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .svc-header-inner { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; max-width: 1240px; margin: 0 auto; gap: 24px; }
    .svc-logo { font-family: var(--display); font-size: 22px; font-weight: 700; letter-spacing: -0.025em; text-decoration: none; color: var(--ink); flex-shrink: 0; white-space: nowrap; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
    .svc-logo span { color: var(--ink-soft); font-weight: 500; }
    .svc-nav { display: none; gap: 28px; flex: 1; justify-content: center; }
    @media (min-width: 1024px) { .svc-nav { display: flex; } }
    .svc-nav a { color: var(--ink); text-decoration: none; font-size: 14px; font-weight: 600; }
    .svc-nav a:hover { color: var(--accent); }
    .svc-header-phone { display: none; align-items: center; gap: 8px; padding: 9px 16px; background: var(--accent-soft); color: var(--accent); border-radius: 6px; font-weight: 700; font-size: 15px; text-decoration: none; letter-spacing: -0.01em; }
    @media (min-width: 768px) { .svc-header-phone { display: inline-flex; } }
    .svc-header-phone:hover { background: var(--accent); color: white; }

    /* === PHONE-FIRST HERO === */
    .svc-hero { padding: 56px 24px 40px; background: var(--bg); }
    @media (min-width: 768px) { .svc-hero { padding: 88px 24px 64px; } }
    .svc-hero-inner { max-width: 1240px; margin: 0 auto; }
    .svc-hero-tagline { font-size: clamp(28px, 4.5vw, 48px); margin-bottom: 24px; max-width: 760px; }
    .svc-hero-phone-link { display: flex; align-items: baseline; gap: 0; flex-wrap: wrap; text-decoration: none; color: var(--ink); padding: 28px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: 28px; transition: background 0.15s ease; }
    .svc-hero-phone-link:hover { background: rgba(15, 61, 140, 0.02); }
    .svc-hero-phone-label { font-family: var(--body); font-size: 12px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.14em; text-transform: uppercase; flex-basis: 100%; margin-bottom: 8px; }
    .svc-hero-phone-number { font-family: var(--display); font-size: clamp(44px, 8vw, 88px); font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--accent); flex-grow: 1; }
    .svc-hero-phone-arrow { font-family: var(--display); font-size: clamp(32px, 5vw, 56px); color: var(--accent); margin-left: 16px; transition: transform 0.2s ease; }
    .svc-hero-phone-link:hover .svc-hero-phone-arrow { transform: translateX(8px); }
    .svc-hero-subtitle { font-size: 16px; color: var(--ink-soft); margin-bottom: 28px; max-width: 600px; }
    .svc-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }

    /* === Installer hero (visual, photo-led) === */
    .svc-hero-installer .svc-hero-inner { max-width: 1240px; }
    .svc-hero-installer-grid { display: grid; grid-template-columns: 1fr; gap: 40px; align-items: center; margin-bottom: 32px; }
    @media (min-width: 1024px) { .svc-hero-installer-grid { grid-template-columns: 1.05fr 1fr; gap: 64px; margin-bottom: 40px; } }
    .svc-hero-installer-text .svc-hero-meta { margin-bottom: 18px; }
    .svc-hero-installer-h1 { font-family: var(--display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.04; font-size: clamp(34px, 5.5vw, 60px); margin-bottom: 22px; }
    .svc-hero-installer-h1 em { font-style: normal; color: var(--accent); font-weight: 500; }
    .svc-hero-installer-text .svc-hero-subtitle { margin-top: 0; margin-bottom: 30px; font-size: 17px; color: var(--ink-soft); line-height: 1.55; max-width: 480px; }
    .svc-hero-installer-image { aspect-ratio: 4/3; border-radius: 14px; overflow: hidden; background: var(--bg-alt); border: 1px solid var(--line); }
    @media (min-width: 1024px) { .svc-hero-installer-image { aspect-ratio: 4/5; min-height: 460px; } }
    .svc-hero-installer-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .svc-badge-star { color: #F59E0B; font-size: 13px; }
    .svc-hero-installer .svc-hero-stats { margin-top: 0; padding-top: 28px; }

    /* === Hero meta + 24/7 badge === */
    .svc-hero-meta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .svc-hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; background: white; border: 1px solid var(--line); border-radius: 100px; font-size: 12px; font-weight: 600; color: var(--ink); letter-spacing: -0.005em; }

    /* === Hero inline stats (replaces dark status bar) === */
    .svc-hero-stats { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--line); }
    @media (min-width: 640px) { .svc-hero-stats { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px 32px; } }
    .svc-hero-stat { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink); letter-spacing: -0.005em; }
    .svc-hero-stat svg { color: var(--accent); flex-shrink: 0; }
    .svc-hero-stat-label { color: var(--ink-soft); }
    .svc-hero-stat-value { font-weight: 600; }

    /* === Blocks (single light bg, no alternation) === */
    .svc-block { padding: 56px 24px; }
    @media (min-width: 768px) { .svc-block { padding: 80px 24px; } }
    .svc-block-head { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 48px; margin-bottom: 44px; align-items: end; }
    .svc-block-head > .eyebrow { grid-column: 1 / -1; }
    .svc-block-head h2 { font-size: clamp(28px, 4vw, 44px); margin: 0; grid-column: 1; }
    .svc-block-head p { font-size: 16px; color: var(--ink-soft); grid-column: 2; padding-bottom: 6px; }
    @media (max-width: 900px) { .svc-block-head { grid-template-columns: 1fr; gap: 16px; } .svc-block-head h2, .svc-block-head p { grid-column: 1; padding-bottom: 0; } }

    /* === FAQ early as cards === */
    .svc-faq-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 768px) { .svc-faq-grid { grid-template-columns: repeat(${Math.min(content.faqItems.length, 3)}, 1fr); } }
    .svc-faq-card { padding: 28px 28px 30px; background: white; border: 1px solid var(--line); border-radius: 10px; transition: all 0.2s ease; }
    .svc-faq-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .svc-faq-card h3 { font-family: var(--body); font-size: 16px; font-weight: 700; margin-bottom: 12px; color: var(--accent); letter-spacing: -0.015em; line-height: 1.35; }
    .svc-faq-card p { color: var(--ink); font-size: 15px; line-height: 1.55; }

    /* === Services as list (not grid) === */
    .svc-list { border-top: 1px solid var(--line); }
    .svc-list-item { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.6fr); gap: 32px; padding: 24px 0; border-bottom: 1px solid var(--line); align-items: start; transition: padding 0.15s ease; }
    .svc-list-item:hover { padding-left: 8px; }
    .svc-list-name { font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: -0.025em; color: var(--ink); }
    .svc-list-desc { color: var(--ink-soft); font-size: 15px; line-height: 1.55; }
    @media (max-width: 768px) { .svc-list-item { grid-template-columns: 1fr; gap: 6px; padding: 20px 0; } }


    /* === Gallery (only when we have ≥3 photos) === */
    .svc-gallery-head { margin-bottom: 36px; }
    .svc-gallery-head h2 { font-size: clamp(28px, 4vw, 44px); margin: 0; }
    .svc-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (min-width: 768px) { .svc-gallery { gap: 16px; } }
    @media (min-width: 1024px) { .svc-gallery-3 { grid-template-columns: repeat(3, 1fr); } .svc-gallery-4 { grid-template-columns: repeat(4, 1fr); } }
    .svc-gallery-item { aspect-ratio: 4/3; overflow: hidden; border-radius: 10px; background: var(--bg-alt); border: 1px solid var(--line); }
    .svc-gallery-item img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.6s ease; }
    .svc-gallery-item:hover img { transform: scale(1.05); }

    /* === Reviews horizontal compact === */
    .svc-reviews { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 640px) { .svc-reviews { grid-template-columns: repeat(2, 1fr); } }
    .svc-review { padding: 24px 26px; background: var(--bg); border-radius: 8px; border: 1px solid var(--line); }
    .svc-review-stars { color: #F59E0B; font-size: 14px; letter-spacing: 2px; margin-bottom: 12px; }
    .svc-review p { font-size: 15px; line-height: 1.55; margin-bottom: 16px; color: var(--ink); }
    .svc-review-author { font-size: 13px; color: var(--ink-soft); font-weight: 600; }
    .svc-review-author span { font-weight: 400; display: block; margin-top: 2px; font-size: 12px; color: var(--ink-faint); }

    /* === Area with embedded map === */
    .svc-area-grid { display: grid; grid-template-columns: 1fr; gap: 40px; align-items: start; }
    @media (min-width: 900px) { .svc-area-grid { grid-template-columns: 1fr 1fr; gap: 64px; } }
    .svc-area-text h2 { font-size: clamp(28px, 4vw, 44px); margin-bottom: 16px; }
    .svc-area-text p { font-size: 16px; color: var(--ink-soft); margin-bottom: 24px; max-width: 480px; }
    .svc-area-facts { list-style: none; margin: 28px 0; padding: 24px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 18px; }
    .svc-area-facts > div { display: grid; grid-template-columns: 1fr; gap: 4px; }
    @media (min-width: 480px) { .svc-area-facts > div { grid-template-columns: minmax(0, 160px) minmax(0, 1fr); gap: 6px 24px; align-items: baseline; } }
    .svc-area-facts dt { font-family: var(--body); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
    .svc-area-facts dd { font-size: 15px; color: var(--ink); margin: 0; font-weight: 500; line-height: 1.45; }
    .svc-area-cities-line { font-size: 13px; color: var(--ink-soft); line-height: 1.7; margin-bottom: 24px; max-width: 520px; }
    .svc-area-cities-label { font-family: var(--body); display: block; font-weight: 700; color: var(--ink); text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; margin-bottom: 6px; }
    .svc-area-cta { font-size: 14px; color: var(--ink-soft); line-height: 1.5; max-width: 480px; }
    .svc-area-cta a { color: var(--accent); font-weight: 700; text-decoration: none; }
    .svc-area-cta a:hover { text-decoration: underline; }
    .svc-area-map { aspect-ratio: 4/3; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: var(--bg-alt); position: relative; }
    @media (min-width: 900px) { .svc-area-map { aspect-ratio: 1; min-height: 420px; } }
    .svc-area-map iframe { width: 100%; height: 100%; border: 0; display: block; filter: grayscale(0.15) contrast(0.95); }

    /* === About + values combined === */
    .svc-about { display: grid; grid-template-columns: 1fr; gap: 40px; }
    @media (min-width: 900px) { .svc-about { grid-template-columns: 1.3fr 1fr; gap: 72px; align-items: start; } }
    .svc-about-text h2 { font-size: clamp(28px, 4vw, 44px); margin-bottom: 20px; max-width: 16ch; }
    .svc-about-text p { font-size: 16px; color: var(--ink-soft); margin-bottom: 14px; line-height: 1.6; }
    .svc-about-values { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--line); }
    .svc-about-values li { padding: 18px 0; border-bottom: 1px solid var(--line); font-size: 15px; color: var(--ink-soft); line-height: 1.5; }
    .svc-about-values li span { display: inline; font-weight: 700; color: var(--ink); letter-spacing: -0.015em; }

    /* === Contact === */
    .svc-contact-grid { display: grid; grid-template-columns: 1fr; gap: 40px; }
    @media (min-width: 1024px) { .svc-contact-grid { grid-template-columns: 1fr 1.3fr; gap: 64px; } }
    .svc-contact-info h3 { font-size: 12px; font-family: var(--body); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 8px; }
    .svc-contact-info .value { font-family: var(--display); font-size: 22px; font-weight: 700; letter-spacing: -0.025em; margin-bottom: 24px; display: block; color: var(--ink); text-decoration: none; line-height: 1.3; }
    .svc-contact-info a.value:hover { color: var(--accent); }
    .svc-form { background: white; padding: 32px; border-radius: 10px; border: 1px solid var(--line); }
    .svc-form-group { margin-bottom: 18px; }
    .svc-form-group label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 6px; color: var(--ink); letter-spacing: 0.06em; text-transform: uppercase; }
    .svc-form-group input, .svc-form-group textarea, .svc-form-group select { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); font-family: var(--body); font-size: 15px; color: var(--ink); }
    .svc-form-group input:focus, .svc-form-group textarea:focus, .svc-form-group select:focus { outline: none; border-color: var(--accent); background: white; }
    .svc-form-group textarea { min-height: 100px; resize: vertical; }

    /* === Footer === */
    footer.svc-footer { padding: 48px 24px 28px; background: #1E293B; color: rgba(255,255,255,0.7); font-size: 14px; border-top: 1px solid var(--line); }
    .svc-footer-inner { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 32px; }
    @media (min-width: 768px) { .svc-footer-inner { grid-template-columns: 2fr 1fr 1fr; } }
    footer.svc-footer .svc-logo { color: white; margin-bottom: 12px; display: block; }
    footer.svc-footer .svc-logo span { color: rgba(255,255,255,0.5); }
    .svc-footer-inner p { color: rgba(255,255,255,0.6); }
    .svc-footer-inner h4 { color: white; font-family: var(--body); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px; }
    .svc-footer-inner ul { list-style: none; }
    .svc-footer-inner ul li { margin-bottom: 8px; }
    .svc-footer-inner a { color: rgba(255,255,255,0.7); text-decoration: none; }
    .svc-footer-inner a:hover { color: white; }
    .svc-footer-bottom { max-width: 1240px; margin: 32px auto 0; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; font-size: 12px; color: rgba(255,255,255,0.4); flex-wrap: wrap; gap: 12px; }

    /* === Mobile sticky phone bar === */
    .svc-mobile-cta { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 8px; padding: 10px 12px; background: white; border-top: 1px solid var(--line); z-index: 100; box-shadow: 0 -4px 20px rgba(15, 23, 42, 0.08); }
    .svc-mobile-cta .btn { flex: 1; justify-content: center; padding: 14px 16px; }
    @media (min-width: 768px) { .svc-mobile-cta { display: none; } }
  </style>
</head>
<body>
  <div style="background:#1a2b4a;color:#fff;text-align:center;font:600 13px/1.45 system-ui,-apple-system,sans-serif;padding:9px 16px">Niezobowiązujący szkic strony przygotowany dla ${escapeHtml(lead.name)} — wersja demonstracyjna do oceny, nie jest to oficjalna strona firmy.</div>

  <header class="svc-header">
    <div class="svc-header-inner">
      <a href="#" class="svc-logo">${escapeHtml(namePart1)}${namePart2 ? ` <span>${escapeHtml(namePart2)}</span>` : ""}</a>
      <nav class="svc-nav">
        <a href="#kontakt">Kontakt</a>
        <a href="#uslugi">Usługi</a>
        ${showGallery ? `<a href="#realizacje">Realizacje</a>` : ""}
        <a href="#obszar">Obszar</a>
        ${hasReviews ? `<a href="#opinie">Opinie</a>` : ""}
        <a href="#o-nas">O nas</a>
      </nav>
      ${hasPhone ? `<a href="${phoneLnk}" class="svc-header-phone">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        ${escapeHtml(phone)}
      </a>` : `<a href="#kontakt" class="btn btn-primary">Bezpłatna wycena</a>`}
    </div>
  </header>

  <!-- ====== HERO (variant per type) ====== -->
  ${hasHeroImage ? `
  <section class="svc-hero svc-hero-installer">
    <div class="svc-hero-inner">
      <div class="svc-hero-installer-grid">
        <div class="svc-hero-installer-text">
          <div class="svc-hero-meta">
            <span class="eyebrow" style="margin-bottom: 0">${escapeHtml(city)} · ${escapeHtml(voivodeship)}</span>
            ${strongRating ? `<span class="svc-hero-badge"><span class="svc-badge-star">★</span> ${rating.toFixed(1)} · ${ratingCount} opinii</span>` : ""}
          </div>
          <h1 class="svc-hero-installer-h1">${heroTagline}</h1>
          <p class="svc-hero-subtitle">${escapeHtml(heroSubtitle)}</p>
          <div class="svc-hero-ctas">
            <a href="#kontakt" class="btn btn-primary btn-lg">Bezpłatna wycena</a>
            ${hasPhone ? `<a href="${phoneLnk}" class="btn btn-ghost btn-lg">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              ${escapeHtml(phone)}
            </a>` : ""}
          </div>
        </div>
        <div class="svc-hero-installer-image">
          <img src="${escapeHtml(heroImg)}" alt="Realizacja ${escapeHtml(lead.name)}" loading="eager">
        </div>
      </div>
      <div class="svc-hero-stats">
        ${statusItems.slice(0, 4).map((s) => `<div class="svc-hero-stat">
          ${STATUS_ICONS[s.icon] || ""}
          <span class="svc-hero-stat-label">${escapeHtml(s.label)}:</span>
          <span class="svc-hero-stat-value">${escapeHtml(s.value)}</span>
        </div>`).join("\n        ")}
      </div>
    </div>
  </section>` : `
  <section class="svc-hero">
    <div class="svc-hero-inner">
      <div class="svc-hero-meta">
        <span class="eyebrow" style="margin-bottom: 0">${escapeHtml(city)} · ${escapeHtml(voivodeship)}</span>
        ${isEmergency ? `<span class="svc-hero-badge"><span class="svc-pulse"></span>Czynne 24/7</span>` : ""}
      </div>
      <h1 class="svc-hero-tagline">${heroTagline}</h1>
      ${hasPhone ? `<a href="${phoneLnk}" class="svc-hero-phone-link">
        <span class="svc-hero-phone-label">Zadzwoń</span>
        <span class="svc-hero-phone-number">${escapeHtml(phone)}</span>
        <span class="svc-hero-phone-arrow">→</span>
      </a>` : ""}
      <p class="svc-hero-subtitle">${escapeHtml(heroSubtitle)}</p>
      <div class="svc-hero-ctas">
        ${hasPhone ? `<a href="https://wa.me/${waPhone}" class="btn btn-whatsapp btn-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345"/></svg>
          Napisz na WhatsApp
        </a>` : ""}
        <a href="#kontakt" class="btn btn-ghost btn-lg">Zostaw wiadomość</a>
      </div>
      <div class="svc-hero-stats">
        ${statusItems.slice(0, 3).map((s) => `<div class="svc-hero-stat">
          ${STATUS_ICONS[s.icon] || ""}
          <span class="svc-hero-stat-label">${escapeHtml(s.label)}:</span>
          <span class="svc-hero-stat-value">${escapeHtml(s.value)}</span>
        </div>`).join("\n        ")}
      </div>
    </div>
  </section>`}

  <!-- ====== FAQ EARLY ====== -->
  <section class="svc-block">
    <div class="svc-container">
      <div class="svc-block-head">
        <div class="eyebrow">Najpierw odpowiadamy</div>
        <h2>Pytania, które klienci zadają <em>jako pierwsze.</em></h2>
        <p>Bez bełkotu, konkretne odpowiedzi. Jeśli czegoś tu nie ma — zadzwoń, odpowiemy w 30 sekund.</p>
      </div>
      <div class="svc-faq-grid">${faqEarlyHtml}
      </div>
    </div>
  </section>

  <!-- ====== SERVICES AS LIST ====== -->
  <section class="svc-block" id="uslugi">
    <div class="svc-container">
      <div class="svc-block-head">
        <div class="eyebrow">Co robimy</div>
        <h2>Zakres usług.</h2>
        <p>Każda pozycja to konkretna usługa z osobną wyceną. Bez pakietów, bez gimmicków.</p>
      </div>
      <div class="svc-list">${servicesListHtml}
      </div>
    </div>
  </section>

  <!-- ====== ABOUT + WERKWIJZE COMBINED ====== -->
  <section class="svc-block" id="o-nas">
    <div class="svc-container">
      <div class="svc-about">
        <div class="svc-about-text">
          <div class="eyebrow">O firmie</div>
          <h2>${escapeHtml(namePart2 ? `${namePart1} ${namePart2}` : namePart1)}</h2>
          ${content.aboutP1 ? `<p>${escapeHtml(content.aboutP1)}</p>` : ""}
          ${content.aboutP2 ? `<p>${escapeHtml(content.aboutP2)}</p>` : ""}
        </div>
        <ul class="svc-about-values">
          <li><span>Bezpośredni właściciel</span> — telefon działa codziennie, on prowadzi każde zlecenie.</li>
          <li><span>Wycena na piśmie</span> — cena i termin w umowie przed startem.</li>
          <li><span>Stała ekipa</span> — ci sami ludzie od lat, bez podwykonawców z łapanki.</li>
          <li><span>Termin to termin</span> — co zapisujemy, tego się trzymamy.</li>
        </ul>
      </div>
    </div>
  </section>

  ${showGallery ? `
  <section class="svc-block" id="realizacje">
    <div class="svc-container">
      <div class="svc-gallery-head">
        <div class="eyebrow">Nasza praca</div>
        <h2>Wybrane <em>realizacje.</em></h2>
      </div>
      <div class="svc-gallery svc-gallery-${Math.min(photoUrls.length, 4)}">
        ${photoUrls.slice(0, 4).map((url, i) => `<div class="svc-gallery-item"><img src="${escapeHtml(url)}" loading="lazy" alt="Realizacja ${escapeHtml(lead.name)} ${i + 1}"></div>`).join("\n        ")}
      </div>
    </div>
  </section>` : ""}

  ${reviewsHtml}

  <!-- ====== AREA WITH MAP ====== -->
  <section class="svc-block" id="obszar">
    <div class="svc-container">
      <div class="svc-area-grid">
        <div class="svc-area-text">
          <div class="eyebrow">Obszar działania</div>
          <h2>Pracujemy <em>${wCity(city)} i okolicach.</em></h2>
          <p>Główny obszar: ${escapeHtml(city)} + 30 km. Większe zlecenia realizujemy też dalej ${wVoiv(voivodeship)}.</p>
          <dl class="svc-area-facts">
            <div>
              <dt>Czas dojazdu</dt>
              <dd>${isEmergency ? `~2 h ${wCity(city)} (awarie szybciej)` : `~30 min ${wCity(city)}, ~1 h w okolicach`}</dd>
            </div>
            <div>
              <dt>${isEmergency ? "Awarie" : "Wolne terminy"}</dt>
              <dd>${isEmergency ? "Odbieramy 24/7 — zadzwoń, dojeżdżamy" : "Sprawdź telefonicznie — aktualizujemy co tydzień"}</dd>
            </div>
            <div>
              <dt>Koszt dojazdu</dt>
              <dd>Wliczony w wycenę w promieniu 30 km</dd>
            </div>
          </dl>
          <div class="svc-area-cities-line">
            <span class="svc-area-cities-label">Często odwiedzamy</span>
            ${[city, ...nearbyAreas.slice(0, 8)].map((a) => escapeHtml(a)).join(' · ')}
          </div>
          ${hasPhone ? `<p class="svc-area-cta">Twojej miejscowości tu nie ma? <a href="${phoneLnk}">Zadzwoń</a> — powiemy w 30 sekund, czy dojedziemy.</p>` : ""}
        </div>
        ${(lead.latitude && lead.longitude)
          ? `<div class="svc-area-map">
          <iframe src="https://maps.google.com/maps?q=${lead.latitude},${lead.longitude}&z=11&hl=pl&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa lokalizacji: ${escapeHtml(city)}"></iframe>
        </div>`
          : ""}
      </div>
    </div>
  </section>

  <!-- ====== CONTACT ====== -->
  <section class="svc-block" id="kontakt">
    <div class="svc-container">
      <div class="svc-block-head">
        <div class="eyebrow">Kontakt</div>
        <h2>Najszybciej: <em>telefonicznie.</em></h2>
        <p>Wiadomości z formularza odbieramy w godzinach pracy. Awarie ${isEmergency ? "24/7" : "w godzinach pracy"} — zadzwoń.</p>
      </div>
      <div class="svc-contact-grid">
        <div class="svc-contact-info">
          ${hasPhone ? `<h3>Telefon</h3>
          <a href="${phoneLnk}" class="value">${escapeHtml(phone)}</a>` : ""}
          ${hasAddress ? `<h3>Adres</h3>
          <span class="value" style="font-size:17px">${escapeHtml(address)}</span>` : ""}
          <h3>Godziny pracy</h3>
          <span class="value" style="font-size:17px">pn-pt 7:00–18:00 · sb 8:00–14:00${isEmergency ? "<br><span style=\"color:var(--urgent);font-size:14px\">+ dyżur 24/7 dla awarii</span>" : ""}</span>
        </div>
        <!-- Formulier opent de mailclient met de ingevulde data. Voor productie:
             vervang door server-side POST + spam-protection. -->
        <form class="svc-form" onsubmit="return svcSubmit(this)">
          <div class="svc-form-group">
            <label for="imie">Imię i nazwisko</label>
            <input type="text" id="imie" name="imie" placeholder="Jan Kowalski" required>
          </div>
          <div class="svc-form-group">
            <label for="tel">Telefon (do oddzwonienia)</label>
            <input type="tel" id="tel" name="tel" placeholder="+48 600 000 000" required>
          </div>
          <div class="svc-form-group">
            <label for="zakres">Czego dotyczy?</label>
            <select id="zakres" name="zakres">
              ${selectHtml}
            </select>
          </div>
          <div class="svc-form-group">
            <label for="wiadomosc">Krótki opis sytuacji</label>
            <textarea id="wiadomosc" name="wiadomosc" placeholder="Opisz krótko, z czym się zwracasz..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%; justify-content:center;">Oddzwońcie do mnie</button>
        </form>
        <script>
          (function () {
            var recipient = ${JSON.stringify(formRecipient)};
            var firma = ${JSON.stringify(lead.name)};
            window.svcSubmit = function (form) {
              var fd = new FormData(form);
              var lines = [
                'Imię: ' + (fd.get('imie') || ''),
                'Telefon: ' + (fd.get('tel') || ''),
                'Zakres: ' + (fd.get('zakres') || ''),
                '',
                (fd.get('wiadomosc') || ''),
              ];
              var subject = 'Prośba o oddzwonienie — ' + (fd.get('imie') || '');
              var href = 'mailto:' + recipient
                + '?subject=' + encodeURIComponent(subject)
                + '&body=' + encodeURIComponent(lines.join('\\n'));
              window.location.href = href;
              form.innerHTML = '<div style="text-align:center; padding:40px 20px;"><div style="width:56px; height:56px; border-radius:50%; background:var(--accent-soft); color:var(--accent); display:inline-flex; align-items:center; justify-content:center; margin-bottom:20px;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><h3 style="font-family:var(--display); font-size:22px; font-weight:700; margin-bottom:10px; letter-spacing:-0.025em;">Wiadomość gotowa</h3><p style="color:var(--ink-soft); font-size:14px;">Otworzyliśmy Państwa program pocztowy z gotową wiadomością do firmy ' + firma + '. Wystarczy nacisnąć „Wyślij".</p></div>';
              return false;
            };
          })();
        </script>
      </div>
    </div>
  </section>

  <footer class="svc-footer">
    <div class="svc-footer-inner">
      <div>
        <a href="#" class="svc-logo">${escapeHtml(namePart1)}${namePart2 ? ` <span>${escapeHtml(namePart2)}</span>` : ""}</a>
        <p>${escapeHtml(lead.name)}<br>${escapeHtml(city)} i okolice.</p>
      </div>
      <div>
        <h4>Kontakt</h4>
        <ul>
          ${hasPhone ? `<li><a href="${phoneLnk}">${escapeHtml(phone)}</a></li>` : ""}
          ${hasAddress ? `<li>${escapeHtml(address)}</li>` : ""}
          <li><a href="#kontakt">Formularz</a></li>
        </ul>
      </div>
      <div>
        <h4>Firma</h4>
        <ul>
          <li><a href="#uslugi">Usługi</a></li>
          <li><a href="#o-nas">O firmie</a></li>
          <li><a href="#obszar">Obszar działania</a></li>
          ${hasReviews ? `<li><a href="#opinie">Opinie</a></li>` : ""}
        </ul>
      </div>
    </div>
    <div class="svc-footer-bottom">
      <div>&copy; 2026 ${escapeHtml(lead.name)}. Wszelkie prawa zastrzeżone.</div>
      <div>Strona stworzona przez <a href="#" style="color:rgba(255,255,255,0.6);">stronadlatwojejfirmy.com.pl</a></div>
    </div>
  </footer>

  ${hasPhone ? `<div class="svc-mobile-cta">
    <a href="${phoneLnk}" class="btn btn-primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      Zadzwoń
    </a>
    <a href="https://wa.me/${waPhone}" class="btn btn-whatsapp">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345"/></svg>
      WhatsApp
    </a>
  </div>` : ""}

<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('tel:')===0||h.indexOf('mailto:')===0||h.indexOf('wa.me')>-1){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault();},true);})();</script>
</body>
</html>`;
}

function getNearbyAreas(city: string, voivodeship: string): string[] {
  const areaMap: Record<string, string[]> = {
    krakow: ["Wieliczka", "Niepołomice", "Myślenice", "Bochnia", "Skawina", "Wadowice", "Nowy Sącz", "Tarnów", "Olkusz", "Chrzanów"],
    warszawa: ["Piaseczno", "Pruszków", "Legionowo", "Wołomin", "Otwock", "Grodzisk Maz.", "Mińsk Maz.", "Nowy Dwór Maz.", "Józefów", "Konstancin"],
    wroclaw: ["Oleśnica", "Oława", "Trzebnica", "Środa Śląska", "Kąty Wrocławskie", "Kobierzyce", "Siechnice", "Jelcz-Laskowice", "Brzeg", "Strzelin"],
    poznan: ["Swarzędz", "Luboń", "Kórnik", "Mosina", "Puszczykowo", "Śrem", "Gniezno", "Września", "Kostrzyn", "Murowana Goślina"],
    gdansk: ["Sopot", "Gdynia", "Rumia", "Reda", "Pruszcz Gdański", "Tczew", "Starogard Gdański", "Wejherowo", "Kartuzy", "Kościerzyna"],
  };
  const key = city.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return areaMap[key] || [`${voivodeship} i okolice`];
}

export function generateSiteForLead(lead: Lead): { path: string; url: string; slug: string | null } {
  // Lazy import to avoid circular dep at module load
  const { ensureSlugForLead } = require("./db") as typeof import("./db");

  const html = generateSiteHtml(lead);

  // 1. Canonical path: /sites/{place_id}/index.html  (stable forever, used internally)
  const canonicalDir = path.join(SITES_DIR, lead.place_id);
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, "index.html"), html, "utf-8");

  // 2. Subdomain path: /sub/{slug}/index.html  (served as {slug}.stronadlatwojejfirmy.com.pl)
  let slug: string | null = null;
  try {
    slug = ensureSlugForLead(lead.place_id);
    const subDirForSlug = path.join(SUB_DIR, slug);
    fs.mkdirSync(subDirForSlug, { recursive: true });
    fs.writeFileSync(path.join(subDirForSlug, "index.html"), html, "utf-8");
  } catch (err) {
    // If slug allocation fails (e.g. db not migrated yet) we still wrote canonical
    console.error(`Slug allocation failed for ${lead.place_id}:`, err);
  }

  return {
    path: path.join(canonicalDir, "index.html"),
    url: `/sites/${lead.place_id}/index.html`,
    slug,
  };
}

export function siteExists(placeId: string): boolean {
  return fs.existsSync(path.join(SITES_DIR, placeId, "index.html"));
}

export function deleteSite(placeId: string): void {
  const dir = path.join(SITES_DIR, placeId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  // Also wipe the subdomain copy if we have a slug
  try {
    const { getLeadById } = require("./db") as typeof import("./db");
    const lead = getLeadById(placeId);
    if (lead?.slug) {
      const subDirForSlug = path.join(SUB_DIR, lead.slug);
      if (fs.existsSync(subDirForSlug)) fs.rmSync(subDirForSlug, { recursive: true });
    }
  } catch {
    // best-effort
  }
}

export function listGeneratedSites(): string[] {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs.readdirSync(SITES_DIR).filter((d) =>
    fs.existsSync(path.join(SITES_DIR, d, "index.html"))
  );
}
