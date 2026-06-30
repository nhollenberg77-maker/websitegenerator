// Tool-registry: alle gereedschappen die de agents kunnen aanroepen.
// Gegroepeerd per domein; registry.ts wijst per agent een subset toe.

import fs from "fs";
import type { AgentTool, ToolContext } from "../runner";
import { searchNearby, placeDetails, photoProxyUrls, CITIES } from "../places";
import { fetchWebsite } from "../web";
import * as store from "../store";
import {
  getLeadById, setLeadContactEmail, setLeadAiEmail, markSiteGenerated,
} from "../../db";
import { generateSiteForLead, siteExists, deleteSite } from "../../site-generator";
import { generateScreenshot, screenshotFilePath, hasScreenshot, deleteScreenshot, getScreenshotLocalUrl } from "../../screenshot";
import { generateEmailHtml, generateEmailSubject } from "../../email-template";
import { findContactEmail } from "../../email-scraper";

const J = (v: unknown) => JSON.stringify(v);

// Detecteert duidelijk niet-Poolse tekens (CJK/kana/hangul/Cyrillisch/Arabisch) —
// een teken dat het model rommel produceerde. Pools is puur Latijns schrift.
const FOREIGN_SCRIPT = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ฀-๿]/;
function hasForeignScript(...strings: unknown[]): boolean {
  return strings.some((s) => typeof s === "string" && FOREIGN_SCRIPT.test(s));
}

// ICP: ELK lokaal MKB-dienstverlenend bedrijf dat baat heeft bij een eigen site
// (vakman, kapper, restaurant, tandarts, garage, salon, lokale winkel met
// diensten, enz.). We wijzen alleen types hard af die GEEN baat hebben bij een
// lokale concept-site of te groot/B2B/online zijn.
const OFF_TARGET_TYPES = new Set([
  "wholesaler", "supplier", "manufacturer", "corporate_office", "shopping_mall",
  "warehouse_store", "department_store", "bank", "atm", "government_office",
  "local_government_office", "post_office", "embassy", "courthouse", "city_hall",
  "airport", "train_station", "bus_station", "transit_station", "gas_station",
]);
// Of een kandidaat plausibel binnen de (brede) ICP valt. Onbekend → true:
// de agent oordeelt verder; alleen duidelijk off-target wordt false.
export function isLikelyIcp(primaryType: string | null, types: string[] = []): boolean {
  const all = [primaryType, ...types].filter(Boolean) as string[];
  if (all.some((t) => OFF_TARGET_TYPES.has(t))) return false;
  return true;
}
function leadId(input: Record<string, unknown>, ctx: ToolContext): string {
  const id = (input.place_id as string) || ctx.leadPlaceId;
  if (!id) throw new Error("place_id ontbreekt (en geen lead in context)");
  return id;
}
function leadBrief(placeId: string): string {
  const l = getLeadById(placeId);
  if (!l) return J({ error: "lead niet gevonden" });
  return J({
    place_id: l.place_id, name: l.name, city: l.city_query, category: l.category_query,
    website: l.website, rating: l.rating, rating_count: l.rating_count, photo_count: l.photo_count,
    phone: l.phone_national, email: l.contact_email, address: l.address,
    qualified: l.qualified, has_site: !!l.site_generated_at, has_reviews: !!l.reviews_json,
    description: l.description ?? null,
  });
}

/* ─────────────────────────── ONDERZOEK ─────────────────────────── */

const placesSearch: AgentTool = {
  name: "places_search",
  description: "Zoek bedrijven via Google Maps in een stad+categorie. Slaat nieuwe kandidaten op (status: nog niet gekwalificeerd) en geeft een beknopte lijst terug. Categorie = Google place type (plumber, roofing_contractor, electrician, painter, general_contractor).",
  input_schema: {
    type: "object", additionalProperties: false, required: ["city", "category"],
    properties: {
      city: { type: "string", description: `stad-key, één van: ${Object.keys(CITIES).join(", ")}` },
      category: { type: "string" },
      radius_m: { type: "integer" },
      limit: { type: "integer" },
    },
  },
  handler: async (input) => {
    const city = String(input.city);
    const cinfo = CITIES[city.toLowerCase()];
    const places = await searchNearby({
      city, category: String(input.category),
      radiusM: (input.radius_m as number) ?? 30000, limit: (input.limit as number) ?? 20,
    });
    const out: Record<string, unknown>[] = [];
    let saved = 0;
    for (const p of places) {
      const state = store.leadKnownState(p.place_id);
      if (state === "rejected") continue;
      if (state === "new") {
        store.upsertLead({
          ...p, city_query: cinfo?.name ?? city, voivodeship: cinfo?.voivodeship ?? null,
          category_query: String(input.category),
        });
        saved++;
      }
      out.push({
        place_id: p.place_id, name: p.name, website: p.website, rating: p.rating,
        rating_count: p.rating_count, photo_count: p.photo_count, state,
        primary_type: p.primary_type, likely_icp: isLikelyIcp(p.primary_type, p.types),
      });
    }
    return J({ found: places.length, new_saved: saved, candidates: out.slice(0, 30) });
  },
};

const fetchWebsiteTool: AgentTool = {
  name: "fetch_website",
  description: "Haal een website op en krijg signalen terug (status, https, titel, viewport, favicon, OG-tags, schema.org, tekstlengte, e-mails, of het een social/listing-pagina is). Gebruik dit om zelf te beoordelen of een site zwak of ontbrekend is.",
  input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } },
  handler: async (input) => J(await fetchWebsite(String(input.url))),
};

const placeDetailsTool: AgentTool = {
  name: "place_details",
  description: "Haal Google-reviews + editorial summary op voor een place_id. Gebruik voor het beoordelen van een lead of het vullen van site-content.",
  input_schema: { type: "object", additionalProperties: false, required: ["place_id"], properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const details = await placeDetails(leadId(input, ctx));
    return details ? J(details) : J({ error: "geen details beschikbaar" });
  },
};

/* ─────────────────────────── LEAD-DATA ─────────────────────────── */

const getLead: AgentTool = {
  name: "get_lead",
  description: "Lees de huidige gegevens van een lead.",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => leadBrief(leadId(input, ctx)),
};

// Deterministische vangrail: een site die ophaalt mét https + mobiel-meta +
// (schema.org of OG-tags) + voldoende inhoud, is een STERKE moderne site —
// zo'n bedrijf heeft ons niet nodig.
export function isStrongSite(s: { ok: boolean; https: boolean; hasViewport: boolean; hasSchemaOrg: boolean; hasOgTags: boolean; textLength: number; isSocialOrListing: boolean }): boolean {
  if (!s.ok || s.isSocialOrListing) return false;
  return s.https && s.hasViewport && (s.hasSchemaOrg || s.hasOgTags) && s.textLength >= 1500;
}

const qualifyLead: AgentTool = {
  name: "qualify_lead",
  description: "Beslis over een lead: 'keep' (zwakke maar BESTAANDE site + gezond Google-profiel = goede prospect) of 'reject'. LET OP: bij 'keep' checkt het systeem automatisch: geen eigen website → afgewezen (niet te mailen); sterke moderne site → afgewezen (heeft ons niet nodig); geen vindbaar e-mailadres → afgewezen. Alleen bedrijven met een zwakke site én een e-mail blijven over.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["place_id", "decision", "reason"],
    properties: {
      place_id: { type: "string" },
      decision: { type: "string", enum: ["keep", "reject"] },
      reason: { type: "string" },
      gbp_score: { type: "integer", description: "0-10 sterkte Google-profiel (optioneel)" },
      site_score: { type: "integer", description: "0-10 hoe zwak de site is, hoger = zwakker (optioneel)" },
    },
  },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    if (input.decision === "keep") {
      const lead = getLeadById(id);
      // Doelgroep: een ZWAKKE maar BESTAANDE site. Geen website = niet te mailen.
      if (!lead?.website) {
        store.rejectLead(id, "geen eigen website — buiten doelgroep (we mikken op een zwakke site mét e-mail)");
        return `❌ AUTOMATISCH AFGEWEZEN: ${lead?.name ?? id} heeft geen eigen website — niet te mailen. Kwalificeer alleen bedrijven met een zwakke maar bestaande site.`;
      }
      // Vangrail: sterke moderne site → heeft ons niet nodig.
      try {
        const sig = await fetchWebsite(lead.website);
        if (isStrongSite(sig)) {
          store.rejectLead(id, `sterke moderne site: ${sig.title || lead.website}`);
          return `❌ AUTOMATISCH AFGEWEZEN: ${lead.name} heeft al een sterke moderne site (https + mobiel + schema/OG + ${sig.textLength} tekens) — die hebben ons niet nodig.`;
        }
      } catch { /* niet bereikbaar → onzeker, probeer hieronder toch een mail te vinden */ }
      // Mailbaar? Zoek meteen het gepubliceerde e-mailadres; geen adres = afwijzen.
      const email = await findContactEmail(lead.website);
      if (!email) {
        store.rejectLead(id, "geen gepubliceerd e-mailadres op de site — niet te benaderen");
        return `❌ AUTOMATISCH AFGEWEZEN: ${lead.name} heeft een zwakke site maar GEEN vindbaar e-mailadres — niet te mailen.`;
      }
      setLeadContactEmail(id, email);
      store.markLeadQualified(id, input.gbp_score as number, input.site_score as number);
      return `✓ lead ${id} gekwalificeerd én mailbaar (${email}): ${input.reason}`;
    }
    store.rejectLead(id, String(input.reason));
    return `lead ${id} afgewezen: ${input.reason}`;
  },
};

const findEmail: AgentTool = {
  name: "find_email",
  description: "Zoek een GEPUBLICEERD contact-e-mailadres op de website van de lead. Verzint geen adressen (geen info@-gok) — alleen wat het bedrijf zelf publiceert. Slaat het op als gevonden.",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const lead = getLeadById(id);
    if (!lead?.website) return "geen website om e-mail uit te halen (telefoon-lead)";
    const email = await findContactEmail(lead.website);
    if (email) { setLeadContactEmail(id, email); return `gepubliceerd e-mailadres gevonden: ${email}`; }
    return "geen gepubliceerd e-mailadres gevonden (verzin er geen — markeer als telefoon-lead)";
  },
};

const saveDossier: AgentTool = {
  name: "save_dossier",
  description: "Bewaar je onderzoeksnotities over een lead (voor latere agents).",
  input_schema: { type: "object", additionalProperties: false, required: ["notes"], properties: { place_id: { type: "string" }, notes: { type: "string" } } },
  handler: async (input, ctx) => { store.setDossier(leadId(input, ctx), String(input.notes)); return "dossier opgeslagen"; },
};

/* ─────────────────────────── BOUW ─────────────────────────── */

const enrichLead: AgentTool = {
  name: "enrich_lead",
  description: "Haal reviews + foto's op en sla ze bij de lead op (nodig vóór site-generatie).",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const lead = getLeadById(id);
    if (!lead) return "lead niet gevonden";
    const details = await placeDetails(id);
    let refs: string[] = [];
    try { refs = lead.photo_refs ? (JSON.parse(lead.photo_refs) as string[]) : []; } catch { /* ignore */ }
    store.setLeadEnrichment(id, {
      reviewsJson: details?.reviews.length ? J(details.reviews) : null,
      description: details?.description || null,
      photoUrls: refs.length ? J(photoProxyUrls(refs)) : null,
    });
    return `verrijkt: ${details?.reviews.length ?? 0} reviews, ${refs.length} foto's`;
  },
};

const setSiteContent: AgentTool = {
  name: "set_site_content",
  description: "Schrijf de volledige content-spec voor de concept-site in natuurlijk Pools, volledig toegespitst op DIT bedrijf (welke branche dan ook — kapper, restaurant, tandarts, garage, vakman, enz.). Dit bepaalt wat de site toont. Schrijf concreet en geloofwaardig, geen verzonnen keurmerken/certificaten.",
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["category_label", "hero_headline", "hero_headline_em", "hero_lead", "about", "services"],
    properties: {
      place_id: { type: "string" },
      brand_name: { type: "string", description: "exacte naam voor het logo/de header — de VOLLEDIGE bedrijfsnaam zonder rechtsvorm (bv. 'Kawiarnia Drukarnia', niet alleen 'Kawiarnia'). Kort 1-3 woorden." },
      category_label: { type: "string", description: "korte branche-omschrijving in het Pools, bv. 'fryzjer', 'restauracja', 'gabinet stomatologiczny', 'usługi dekarskie'" },
      hero_headline: { type: "string", description: "korte krachtige kop (begin)" },
      hero_headline_em: { type: "string", description: "vervolg van de kop (wordt cursief getoond)" },
      hero_lead: { type: "string", description: "1-2 zinnen intro onder de kop" },
      about: { type: "string", description: "1-2 alinea's over het bedrijf, op basis van reviews/specialisatie" },
      services: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["title", "description"], properties: { title: { type: "string" }, description: { type: "string" } } } },
      highlights: { type: "array", maxItems: 5, items: { type: "string" }, description: "korte vertrouwens-punten (bv. 'Wieloletnie doświadczenie')" },
      faq: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["q", "a"], properties: { q: { type: "string" }, a: { type: "string" } } } },
      select_options: { type: "array", maxItems: 6, items: { type: "string" }, description: "opties voor het contactformulier-dropdown" },
      cta_label: { type: "string" },
      cuisine: { type: "string", description: "ALLEEN horeca: keuken/type, bv. 'kuchnia polska', 'ramen', 'piekarnia rzemieślnicza'" },
      hours: { type: "string", description: "Openingstijden (horeca, kapper/beauty, zorg, winkel), bv. 'Pn-Pt 8-20, So-Nd 9-18' (laat leeg als onbekend)" },
      pricelist: {
        type: "array", maxItems: 14,
        description: "Voor kapper/beauty/nagels/tattoo/spa, zorg (tandarts/fysio) en winkels: prijslijst van diensten/behandelingen of aanbod. Verzin plausibele, passende posten + prijzen in zł op basis van type/naam/reviews.",
        items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", description: "bv. 'Strzyżenie męskie', 'Konsultacja stomatologiczna', 'Bukiet okolicznościowy'" }, price: { type: "string", description: "bv. '60 zł', 'od 120 zł'" }, note: { type: "string", description: "korte toelichting (optioneel)" } } },
      },
      menu: {
        type: "array", maxItems: 6, description: "ALLEEN horeca: de menukaart — secties met gerechten. Verzin een plausibel, passend menu voor dit type zaak (op basis van naam/keuken/reviews).",
        items: {
          type: "object", additionalProperties: false, required: ["section", "items"],
          properties: {
            section: { type: "string", description: "bv. 'Śniadania', 'Dania główne', 'Desery', 'Napoje'" },
            items: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" }, description: { type: "string" }, price: { type: "string", description: "bv. '24 zł'" } } } },
          },
        },
      },
    },
  },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const { place_id, ...content } = input; void place_id;
    store.setSiteContent(id, J(content));
    return "site-content opgeslagen";
  },
};

const generateSite: AgentTool = {
  name: "generate_site",
  description: "Genereer de concept-site HTML voor de lead (gebruikt je site-content als die er is).",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const lead = getLeadById(id);
    if (!lead) return "lead niet gevonden";
    generateSiteForLead(lead);
    markSiteGenerated(id);
    return "site gegenereerd";
  },
};

const screenshotTool: AgentTool = {
  name: "screenshot",
  description: "Maak een screenshot van de gegenereerde site (nodig voordat je hem kunt bekijken).",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    if (!siteExists(id)) return "geen site om te fotograferen — genereer eerst";
    const path = await generateScreenshot(id);
    return path ? "screenshot gemaakt" : "screenshot mislukt";
  },
};

const viewScreenshot: AgentTool = {
  name: "view_screenshot",
  description: "Bekijk de screenshot van de site zelf (visueel). Gebruik dit om je eigen werk te beoordelen.",
  input_schema: { type: "object", additionalProperties: false, properties: { place_id: { type: "string" } } },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const p = screenshotFilePath(id);
    if (!hasScreenshot(id)) return { content: "geen screenshot beschikbaar — maak er eerst één", isError: true };
    const data = fs.readFileSync(p).toString("base64");
    return { content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data } },
      { type: "text", text: "Dit is de huidige concept-site. Beoordeel hero, vertrouwen, content en mobiel-gevoel." },
    ] };
  },
};

const setSiteQuality: AgentTool = {
  name: "set_site_quality",
  description: "Leg je eindoordeel over de site vast (0-10 + ship/revise).",
  input_schema: {
    type: "object", additionalProperties: false, required: ["score", "verdict"],
    properties: { place_id: { type: "string" }, score: { type: "integer" }, verdict: { type: "string", enum: ["ship", "revise"] }, notes: { type: "string" } },
  },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    store.setSiteQuality(id, input.score as number, { score: input.score, verdict: input.verdict, notes: input.notes });
    return "kwaliteit vastgelegd";
  },
};

/* ─────────────────────────── SCHRIJF ─────────────────────────── */

const setEmailCopy: AgentTool = {
  name: "set_email_copy",
  description: "Schrijf de persoonlijke Poolse outreach-copy voor de mail (de template zorgt voor opmaak, screenshot, prijs en GDPR-voetnoot). Zet de mail daarna klaar voor goedkeuring.",
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["branza_pl", "nisza_pl", "hero_title", "hero_sub", "hero_cta", "firma_krotka", "quality_score"],
    properties: {
      place_id: { type: "string" },
      branza_pl: { type: "string", description: "branche, 2e naamval meervoud (bv. 'dekarzy')" },
      nisza_pl: { type: "string", description: "specialisatie in locatief (bv. 'pokryciach dachowych')" },
      hero_title: { type: "string" },
      hero_sub: { type: "string" },
      hero_cta: { type: "string" },
      firma_krotka: { type: "string", description: "korte bedrijfsnaam zonder rechtsvorm" },
      quality_score: { type: "integer", description: "je eigen 0-10 kwaliteitsoordeel van de mail" },
    },
  },
  handler: async (input, ctx) => {
    const id = leadId(input, ctx);
    const lead = getLeadById(id);
    if (!lead) return "lead niet gevonden";
    if (!lead.contact_email) return { content: "lead heeft geen e-mailadres — gebruik eerst find_email", isError: true };
    const siteUrl = siteExists(id) ? `/sites/${id}/index.html` : undefined;

    // Vangrail: bevat de copy niet-Poolse tekens (CJK/Cyrillisch/…)? Dan is het
    // modelrommel — gooi de agent-copy weg en gebruik de schone sjabloontekst.
    const garbage = hasForeignScript(input.branza_pl, input.nisza_pl, input.hero_title, input.hero_sub, input.hero_cta, input.firma_krotka);
    if (garbage) {
      store.setEmailDraft({ placeId: id, subject: generateEmailSubject(lead), html: generateEmailHtml(lead, siteUrl, getScreenshotLocalUrl(id)), score: 4, approvalStatus: "pending" });
      store.postMessage({ from: "writer", to: "manager", kind: "alert", body: `Mail-copy voor "${lead.name}" bevatte niet-Poolse tekens (modelrommel) — vervangen door schone sjabloontekst. Controleer.`, leadPlaceId: id });
      return "agent-copy bevatte niet-Poolse tekens — schone sjabloon-mail klaargezet";
    }

    const personalization = {
      branza_pl: input.branza_pl, nisza_pl: input.nisza_pl, hero_title: input.hero_title,
      hero_sub: input.hero_sub, hero_cta: input.hero_cta, firma_krotka: input.firma_krotka,
    };
    setLeadAiEmail(id, J(personalization));
    const subject = generateEmailSubject(lead);
    const html = generateEmailHtml(lead, siteUrl, getScreenshotLocalUrl(id));
    store.setEmailDraft({ placeId: id, subject, html, score: input.quality_score as number, approvalStatus: "pending" });
    return `mail klaargezet voor goedkeuring (onderwerp: "${subject}")`;
  },
};

/* ─────────────────────────── COÖRDINATIE ─────────────────────────── */

const postMessage: AgentTool = {
  name: "post_message",
  description: "Stuur een bericht naar het team (zichtbaar in de activiteitenfeed). Gebruik voor handoffs en alerts.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["body"],
    properties: { to: { type: "string" }, kind: { type: "string", enum: ["info", "handoff", "feedback", "request", "alert"] }, body: { type: "string" } },
  },
  handler: async (input, ctx) => {
    store.postMessage({ from: ctx.agent, to: (input.to as string) ?? null, kind: (input.kind as "info") ?? "info", body: String(input.body), leadPlaceId: ctx.leadPlaceId, taskId: ctx.taskId });
    return "bericht geplaatst";
  },
};

/* ── Manager-tools ── */

const readStatus: AgentTool = {
  name: "read_status",
  description: "Huidige stand: actieve doelen + voortgang, takenwachtrij, openstaande goedkeuringen.",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  handler: async () => {
    const goals = store.getActiveGoals().map((g) => {
      const params = g.params ? JSON.parse(g.params) : {};
      const cats = params.categories as string[] | undefined;
      const current = g.metric === "qualified_leads" && cats?.length
        ? store.countLeads(`WHERE qualified=1 AND category_query IN (${cats.map(() => "?").join(",")})`, cats)
        : g.metric === "qualified_leads" ? store.countLeads("WHERE qualified=1") : g.current_value;
      return { id: g.id, description: g.description, target: g.target_value, current, params };
    });
    return J({ goals, queue: store.countTasksByStatus(), pendingApprovals: store.countLeads("WHERE approval_status='pending'"), emailed: store.countLeads("WHERE emailed_at IS NOT NULL") });
  },
};

const readFeedback: AgentTool = {
  name: "read_feedback",
  description: "Recente feedback/uitkomsten (kwaliteit, e-mail-resultaten).",
  input_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } } },
  handler: async (input) => J(store.listFeedback({ limit: (input.limit as number) ?? 15 }).map((f) => ({ kind: f.kind, metric: f.metric, value: f.value ? JSON.parse(f.value) : null, note: f.note }))),
};

const readMessages: AgentTool = {
  name: "read_messages",
  description: "Recente onderlinge berichten van het team.",
  input_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } } },
  handler: async (input) => J(store.listMessages({ limit: (input.limit as number) ?? 20 }).map((m) => ({ from: m.from_agent, to: m.to_agent, kind: m.kind, body: m.body }))),
};

const createDiscoverTask: AgentTool = {
  name: "create_discover_task",
  description: "Geef Scout opdracht leads te zoeken+kwalificeren in deze steden/categorieën.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["cities", "categories"],
    properties: { cities: { type: "array", items: { type: "string" } }, categories: { type: "array", items: { type: "string" } }, goal_id: { type: "integer" } },
  },
  handler: async (input) => {
    const id = store.createTask({ type: "discover", assignedAgent: "scout", priority: 3, goalId: (input.goal_id as number) ?? null, payload: { cities: input.cities, categories: input.categories } });
    return `discover-taak #${id} aangemaakt`;
  },
};

const setStrategy: AgentTool = {
  name: "set_strategy",
  description: "Werk de strategie van een agent bij op basis van wat werkt.",
  input_schema: { type: "object", additionalProperties: false, required: ["agent", "strategy"], properties: { agent: { type: "string", enum: ["scout", "builder", "writer"] }, strategy: { type: "string" } } },
  handler: async (input) => {
    store.upsertAgentConfig({ agent: input.agent as "scout", strategy: String(input.strategy), updatedBy: "manager" });
    store.postMessage({ from: "manager", to: String(input.agent), kind: "feedback", body: `Nieuwe strategie: ${input.strategy}` });
    return `strategie van ${input.agent} bijgewerkt`;
  },
};

const manageGoal: AgentTool = {
  name: "manage_goal",
  description: "Maak een nieuw doel of sluit/pauzeer een bestaand doel.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["action"],
    properties: { action: { type: "string", enum: ["create", "close", "pause"] }, goal_id: { type: "integer" }, description: { type: "string" }, target_value: { type: "integer" }, cities: { type: "array", items: { type: "string" } }, categories: { type: "array", items: { type: "string" } } },
  },
  handler: async (input) => {
    if (input.action === "create") {
      const id = store.createGoal({ description: (input.description as string) ?? "Nieuw doel", metric: "qualified_leads", targetValue: input.target_value as number, params: { cities: input.cities, categories: input.categories }, createdBy: "manager" });
      return `doel #${id} aangemaakt`;
    }
    if (input.goal_id) store.setGoalStatus(input.goal_id as number, input.action === "close" ? "done" : "paused");
    return `doel #${input.goal_id} → ${input.action}`;
  },
};

const categoryPerformance: AgentTool = {
  name: "category_performance",
  description: "Zie per categorie en per stad hoeveel leads gevonden/gekwalificeerd/gemaild zijn. Gebruik dit om te LEREN wat werkt en je targeting bij te sturen (welke branches/steden leveren de beste qualified leads op?).",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  handler: async () => {
    const byCat = store.leadStatsBy("category_query");
    const byCity = store.leadStatsBy("city_query");
    return J({ per_categorie: byCat, per_stad: byCity });
  },
};

const budgetStatusTool: AgentTool = {
  name: "budget_status",
  description: "Zie de kosten (USD): vandaag, deze week, deze maand, het maandplafond, wat er nog over is, en de kosten per qualified lead. Gebruik dit om te bewaken dat de kosten niet te hoog worden — neem gas terug of stop lage-ROI-sectoren als je het plafond nadert.",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  handler: async () => {
    const { budgetStatus } = await import("../budget");
    const b = budgetStatus();
    return J({
      vandaag_usd: +b.today.toFixed(2), week_usd: +b.week.toFixed(2), maand_usd: +b.month.toFixed(2),
      maandplafond_usd: b.monthlyCap || "geen", resterend_usd: b.remaining == null ? "n.v.t." : +b.remaining.toFixed(2),
      plafond_gebruikt_pct: b.pctUsed == null ? "n.v.t." : Math.round(b.pctUsed),
      qualified_leads: b.qualified, kosten_per_qualified_usd: b.costPerQualified == null ? "n.v.t." : +b.costPerQualified.toFixed(3),
    });
  },
};

const reviewQualifiedLeads: AgentTool = {
  name: "review_qualified_leads",
  description: "KWALITEITSCONTROLE: haal een steekproef van recent gekwalificeerde leads op en controleer ze kritisch. Per lead wordt de site live opgehaald en gemarkeerd of die toch STERK is (= fout gekwalificeerd), plus het bedrijfstype. Gebruik dit om te zien of het team de juiste leads kiest.",
  input_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } } },
  handler: async (input) => {
    const leads = store.recentQualified((input.limit as number) ?? 8);
    const out: Record<string, unknown>[] = [];
    for (const l of leads) {
      let siteFlag = l.website ? "onbekend" : "geen-site";
      if (l.website) {
        try { const s = await fetchWebsite(l.website); siteFlag = isStrongSite(s) ? "⚠ STERKE SITE (mogelijk fout gekwalificeerd)" : (s.ok ? "zwakke/oude site" : "onbereikbaar"); }
        catch { siteFlag = "onbereikbaar"; }
      }
      out.push({ place_id: l.place_id, name: l.name, type: l.category_query, reviews: l.rating_count, site: l.website ? l.website.slice(0, 45) : "GEEN", site_oordeel: siteFlag, heeft_concept_site: !!l.site_generated_at });
    }
    return J(out);
  },
};

const inspectSite: AgentTool = {
  name: "inspect_site",
  description: "KWALITEITSCONTROLE: bekijk de gebouwde concept-site van een lead visueel (screenshot). Beoordeel kritisch: past de site bij dit type bedrijf en deze branche? Spreekt het aan? Klopt het (geen verkeerde template/sector)? Gebruik dit om het werk van de Builder te controleren.",
  input_schema: { type: "object", additionalProperties: false, required: ["place_id"], properties: { place_id: { type: "string" } } },
  handler: async (input) => {
    const id = String(input.place_id);
    const lead = getLeadById(id);
    const p = screenshotFilePath(id);
    if (!hasScreenshot(id)) return { content: `Geen screenshot voor ${lead?.name ?? id} — site nog niet (volledig) gebouwd.`, isError: true };
    const data = fs.readFileSync(p).toString("base64");
    return { content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data } },
      { type: "text", text: `Concept-site voor "${lead?.name}" (${lead?.category_query}, ${lead?.city_query}). Beoordeel of de site past bij dit bedrijf/branche, of de toon klopt, en of het aanspreekt.` },
    ] };
  },
};

const overruleLead: AgentTool = {
  name: "overrule_lead",
  description: "Overrule een foute kwalificatie: wijs een lead alsnog af (bv. omdat hij toch een sterke site heeft of niet binnen de doelgroep valt). Verwijdert ook de eventueel gebouwde concept-site.",
  input_schema: { type: "object", additionalProperties: false, required: ["place_id", "reason"], properties: { place_id: { type: "string" }, reason: { type: "string" } } },
  handler: async (input) => {
    const id = String(input.place_id);
    const name = getLeadById(id)?.name ?? id;
    try { if (siteExists(id)) deleteSite(id); deleteScreenshot(id); } catch { /* best-effort */ }
    store.rejectLead(id, `manager-overrule: ${input.reason}`);
    store.postMessage({ from: "manager", to: "scout", kind: "feedback", body: `Lead "${name}" teruggedraaid: ${input.reason}` });
    return `lead "${name}" afgewezen en opgeruimd: ${input.reason}`;
  },
};

const recordInsight: AgentTool = {
  name: "record_insight",
  description: "Leg een geleerde les vast (verschijnt in 'Wat het team leerde').",
  input_schema: { type: "object", additionalProperties: false, required: ["note"], properties: { note: { type: "string" } } },
  handler: async (input) => {
    store.addFeedback({ kind: "manager_insight", note: String(input.note) });
    store.postMessage({ from: "manager", kind: "info", body: `💡 ${input.note}` });
    return "inzicht vastgelegd";
  },
};

/* ─────────────────────────── GROEPEN ─────────────────────────── */

export const SCOUT_TOOLS: AgentTool[] = [placesSearch, fetchWebsiteTool, placeDetailsTool, getLead, qualifyLead, findEmail, saveDossier, postMessage];
// Builder = alleen content schrijven; verrijken/genereren/screenshotten doet de code.
export const BUILDER_TOOLS: AgentTool[] = [getLead, placeDetailsTool, setSiteContent, saveDossier, postMessage];
export const WRITER_TOOLS: AgentTool[] = [getLead, findEmail, setEmailCopy, postMessage];
export const MANAGER_TOOLS: AgentTool[] = [readStatus, readFeedback, readMessages, categoryPerformance, budgetStatusTool, reviewQualifiedLeads, inspectSite, overruleLead, createDiscoverTask, setStrategy, manageGoal, recordInsight, postMessage];
